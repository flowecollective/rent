import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { stripe } from "@/lib/stripe";
import { checkAuthOrFail } from "@/lib/auth";
import { monthRangeContaining } from "@/lib/dates";

type Entry = { stylist_id: string; net_service_revenue: number };

export async function POST(req: NextRequest) {
  const authFail = await checkAuthOrFail();
  if (authFail) return authFail;

  const { week_start, week_end, entries } = await req.json();
  if (!week_start || !week_end || !Array.isArray(entries)) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const results: { stylistId: string; ok: boolean; message: string }[] = [];

  for (const entry of entries as Entry[]) {
    const result = await processOne(entry, week_start, week_end);
    results.push(result);
  }

  return NextResponse.json({ results });
}

async function processOne(
  entry: Entry,
  week_start: string,
  week_end: string
): Promise<{ stylistId: string; ok: boolean; message: string }> {
  const rev = Math.max(0, Number(entry.net_service_revenue) || 0);
  const rent = 600;
  const serviceFeeRate = 0.075;

  // Load stylist
  const { data: stylist, error: sErr } = await supabaseAdmin
    .from("stylists")
    .select("*")
    .eq("id", entry.stylist_id)
    .single();

  if (sErr || !stylist) {
    return { stylistId: entry.stylist_id, ok: false, message: "Stylist not found" };
  }
  if (!stylist.stripe_customer_id || stylist.payment_method_status !== "verified") {
    return {
      stylistId: entry.stylist_id,
      ok: false,
      message: "Payment method not verified",
    };
  }

  // Apply monthly service-fee cap. Count only invoices already billed
  // (sent/processing/paid) whose week_end falls in the same calendar month
  // as this invoice's week_end.
  const { monthStart, nextMonthStart } = monthRangeContaining(week_end);
  const { data: priorInvoices } = await supabaseAdmin
    .from("invoices")
    .select("service_fee_amount")
    .eq("stylist_id", stylist.id)
    .in("status", ["sent", "processing", "paid"])
    .gte("week_end", monthStart)
    .lt("week_end", nextMonthStart);

  const paidThisMonth = (priorInvoices || []).reduce(
    (sum, r) => sum + Number(r.service_fee_amount),
    0
  );
  const cap = Number(stylist.service_fee_monthly_cap) || 1000;
  const remainingCap = Math.max(0, cap - paidThisMonth);
  const rawServiceFee = Math.round(rev * serviceFeeRate * 100) / 100;
  const serviceFee = Math.min(rawServiceFee, remainingCap);
  const total = rent + serviceFee;

  // Create draft invoice row in our DB first
  const { data: invoiceRow, error: iErr } = await supabaseAdmin
    .from("invoices")
    .insert({
      stylist_id: stylist.id,
      week_start,
      week_end,
      net_service_revenue: rev,
      rent_amount: rent,
      service_fee_rate: serviceFeeRate,
      service_fee_amount: serviceFee,
      total_amount: total,
      status: "draft",
    })
    .select()
    .single();

  if (iErr || !invoiceRow) {
    return { stylistId: entry.stylist_id, ok: false, message: "DB insert failed" };
  }

  try {
    const weekLabel = `${week_start} to ${week_end}`;

    // 1. Create the invoice as a draft (send_invoice mode — no auto-charge;
    //    stylist receives an email and reviews before paying).
    const draft = await stripe.invoices.create({
      customer: stylist.stripe_customer_id,
      collection_method: "send_invoice",
      days_until_due: 2,
      payment_settings: {
        payment_method_types: ["us_bank_account"],
      },
      description: `Flowe Collective — chair rental, week of ${weekLabel}`,
      metadata: {
        internal_invoice_id: invoiceRow.id,
        stylist_id: stylist.id,
        week_start,
        week_end,
      },
    });

    // 2. Attach line items directly to this draft invoice
    await stripe.invoiceItems.create({
      customer: stylist.stripe_customer_id,
      invoice: draft.id,
      amount: Math.round(rent * 100),
      currency: "usd",
      description: `Weekly chair rental — week of ${weekLabel}`,
    });

    if (serviceFee > 0) {
      const capped = serviceFee < rawServiceFee;
      const description = capped
        ? `Service fee (capped at $${cap.toFixed(0)}/mo — $${serviceFee.toFixed(2)} of $${rawServiceFee.toFixed(2)} due) — week of ${weekLabel}`
        : `Service fee (7.5% of $${rev.toFixed(2)} net services) — week of ${weekLabel}`;
      await stripe.invoiceItems.create({
        customer: stylist.stripe_customer_id,
        invoice: draft.id,
        amount: Math.round(serviceFee * 100),
        currency: "usd",
        description,
      });
    }

    // 3. Finalize, then explicitly send the invoice email. Explicit send is
    //    more reliable than relying on Stripe's auto-send on finalize, which
    //    can be disabled by account-level email settings.
    const finalized = await stripe.invoices.finalizeInvoice(draft.id!);
    const sent = await stripe.invoices.sendInvoice(finalized.id!);

    await supabaseAdmin
      .from("invoices")
      .update({
        stripe_invoice_id: sent.id,
        stripe_invoice_url: sent.hosted_invoice_url,
        status: "sent",
        updated_at: new Date().toISOString(),
      })
      .eq("id", invoiceRow.id);

    return {
      stylistId: stylist.id,
      ok: true,
      message: `Invoice emailed — $${total.toFixed(2)}, stylist has 2 days to pay via ACH`,
    };
  } catch (err: any) {
    await supabaseAdmin
      .from("invoices")
      .update({
        status: "failed",
        error_message: err?.message || "Unknown error",
        updated_at: new Date().toISOString(),
      })
      .eq("id", invoiceRow.id);
    return {
      stylistId: stylist.id,
      ok: false,
      message: err?.message || "Failed to create invoice",
    };
  }
}
