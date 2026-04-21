import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { stripe } from "@/lib/stripe";
import { checkAuthOrFail } from "@/lib/auth";

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
  const commissionRate = 0.075;
  const commission = Math.round(rev * commissionRate * 100) / 100;
  const total = rent + commission;

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

  // Create draft invoice row in our DB first
  const { data: invoiceRow, error: iErr } = await supabaseAdmin
    .from("invoices")
    .insert({
      stylist_id: stylist.id,
      week_start,
      week_end,
      net_service_revenue: rev,
      rent_amount: rent,
      commission_rate: commissionRate,
      commission_amount: commission,
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

    // Create pending invoice items attached to customer
    await stripe.invoiceItems.create({
      customer: stylist.stripe_customer_id,
      amount: Math.round(rent * 100),
      currency: "usd",
      description: `Weekly chair rental — week of ${weekLabel}`,
    });

    if (commission > 0) {
      await stripe.invoiceItems.create({
        customer: stylist.stripe_customer_id,
        amount: Math.round(commission * 100),
        currency: "usd",
        description: `Commission (7.5% of $${rev.toFixed(2)} service revenue) — week of ${weekLabel}`,
      });
    }

    // Create invoice in auto-charge mode
    const invoice = await stripe.invoices.create({
      customer: stylist.stripe_customer_id,
      collection_method: "charge_automatically",
      default_payment_method: stylist.payment_method_id || undefined,
      auto_advance: true,
      description: `Flowe Collective — chair rental, week of ${weekLabel}`,
      metadata: {
        internal_invoice_id: invoiceRow.id,
        stylist_id: stylist.id,
        week_start,
        week_end,
      },
    });

    // Finalize and attempt payment
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id!);
    let paid = finalized;
    try {
      paid = await stripe.invoices.pay(finalized.id!);
    } catch (payErr: any) {
      // Payment failed immediately (rare for ACH - usually it goes to 'processing')
      await supabaseAdmin
        .from("invoices")
        .update({
          stripe_invoice_id: finalized.id,
          stripe_invoice_url: finalized.hosted_invoice_url,
          status: "failed",
          error_message: payErr?.message || "Payment failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", invoiceRow.id);
      return {
        stylistId: stylist.id,
        ok: false,
        message: `Payment failed: ${payErr?.message || "unknown"}`,
      };
    }

    // ACH will be 'open' after .pay() - it moves to 'paid' async via webhook
    const status =
      paid.status === "paid"
        ? "paid"
        : paid.status === "open"
        ? "processing"
        : "sent";

    await supabaseAdmin
      .from("invoices")
      .update({
        stripe_invoice_id: paid.id,
        stripe_invoice_url: paid.hosted_invoice_url,
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invoiceRow.id);

    return {
      stylistId: stylist.id,
      ok: true,
      message:
        status === "processing"
          ? `ACH submitted — $${total.toFixed(2)} (clears in 3–5 business days)`
          : `Invoice created — $${total.toFixed(2)}`,
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
