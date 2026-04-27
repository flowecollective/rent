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

type PreparedLines = {
  rent_amount: number;
  service_fee_rate: number;
  service_fee_amount: number;
  total_amount: number;
  minimum_applied: boolean;
  stripeItems: Array<{ amount: number; description: string }>;
};

async function processOne(
  entry: Entry,
  week_start: string,
  week_end: string
): Promise<{ stylistId: string; ok: boolean; message: string }> {
  const rev = Math.max(0, Number(entry.net_service_revenue) || 0);

  const { data: stylist, error: sErr } = await supabaseAdmin
    .from("stylists")
    .select("*")
    .eq("id", entry.stylist_id)
    .single();

  if (sErr || !stylist) {
    return { stylistId: entry.stylist_id, ok: false, message: "Stylist not found" };
  }
  if (!stylist.stripe_customer_id) {
    return {
      stylistId: entry.stylist_id,
      ok: false,
      message: "No Stripe customer",
    };
  }
  // Note: we no longer require payment_method_status === "verified". When the
  // stylist opens the invoice link, Stripe's hosted page lets them link a
  // bank inline. The webhook flips them to verified once they pay.

  const weekLabel = `${week_start} to ${week_end}`;
  const model =
    stylist.billing_model === "percent_rent" ? "percent_rent" : "rent_plus_fee";

  let prepared: PreparedLines;
  try {
    prepared =
      model === "percent_rent"
        ? buildPercentRentLines(stylist, rev, weekLabel)
        : await buildRentPlusFeeLines(stylist, rev, week_end, weekLabel);
  } catch (err: any) {
    return {
      stylistId: stylist.id,
      ok: false,
      message: err?.message || "Failed to compute billing",
    };
  }

  const { data: invoiceRow, error: iErr } = await supabaseAdmin
    .from("invoices")
    .insert({
      stylist_id: stylist.id,
      week_start,
      week_end,
      net_service_revenue: rev,
      rent_amount: prepared.rent_amount,
      service_fee_rate: prepared.service_fee_rate,
      service_fee_amount: prepared.service_fee_amount,
      total_amount: prepared.total_amount,
      billing_model: model,
      minimum_applied: prepared.minimum_applied,
      status: "draft",
    })
    .select()
    .single();

  if (iErr || !invoiceRow) {
    return { stylistId: entry.stylist_id, ok: false, message: "DB insert failed" };
  }

  try {
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
        billing_model: model,
      },
    });

    for (const item of prepared.stripeItems) {
      if (item.amount <= 0) continue;
      await stripe.invoiceItems.create({
        customer: stylist.stripe_customer_id,
        invoice: draft.id,
        amount: item.amount,
        currency: "usd",
        description: item.description,
      });
    }

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
      message: `Invoice emailed — $${prepared.total_amount.toFixed(2)}, stylist has 2 days to pay via ACH`,
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

async function buildRentPlusFeeLines(
  stylist: any,
  rev: number,
  week_end: string,
  weekLabel: string
): Promise<PreparedLines> {
  const feeRate = Number(stylist.fee_rate) || 0.075;
  const rent = Number(stylist.weekly_rent) || 600;

  // Monthly service-fee cap. Count only invoices already billed
  // (sent/processing/paid) whose week_end falls in the same calendar month.
  const { monthStart, nextMonthStart } = monthRangeContaining(week_end);
  const { data: priorInvoices } = await supabaseAdmin
    .from("invoices")
    .select("service_fee_amount")
    .eq("stylist_id", stylist.id)
    .eq("billing_model", "rent_plus_fee")
    .in("status", ["sent", "processing", "paid"])
    .gte("week_end", monthStart)
    .lt("week_end", nextMonthStart);

  const paidThisMonth = (priorInvoices || []).reduce(
    (sum, r) => sum + Number(r.service_fee_amount),
    0
  );
  const cap = Number(stylist.service_fee_monthly_cap) || 1000;
  const remainingCap = Math.max(0, cap - paidThisMonth);
  const rawFee = Math.round(rev * feeRate * 100) / 100;
  const fee = Math.min(rawFee, remainingCap);
  const capped = fee < rawFee;
  const total = rent + fee;

  const items: Array<{ amount: number; description: string }> = [
    {
      amount: Math.round(rent * 100),
      description: `Weekly chair rental — week of ${weekLabel}`,
    },
  ];

  if (fee > 0) {
    const feePct = (feeRate * 100).toFixed(1).replace(/\.0$/, "");
    items.push({
      amount: Math.round(fee * 100),
      description: capped
        ? `Service fee (capped at $${cap.toFixed(0)}/mo — $${fee.toFixed(2)} of $${rawFee.toFixed(2)} due) — week of ${weekLabel}`
        : `Service fee (${feePct}% of $${rev.toFixed(2)} net services) — week of ${weekLabel}`,
    });
  }

  return {
    rent_amount: rent,
    service_fee_rate: feeRate,
    service_fee_amount: fee,
    total_amount: total,
    minimum_applied: false,
    stripeItems: items,
  };
}

function buildPercentRentLines(
  stylist: any,
  rev: number,
  weekLabel: string
): PreparedLines {
  const feeRate = Number(stylist.fee_rate) || 0.35;
  const minRemit = Number(stylist.minimum_remit) || 600;
  const rawFee = Math.round(rev * feeRate * 100) / 100;
  const minimumApplied = rawFee < minRemit;
  const total = minimumApplied ? minRemit : rawFee;

  const feePct = (feeRate * 100).toFixed(1).replace(/\.0$/, "");
  const description = minimumApplied
    ? `Chair rent — week of ${weekLabel} (${feePct}% of $${rev.toFixed(2)} = $${rawFee.toFixed(2)}; $${minRemit.toFixed(0)} minimum applied)`
    : `Chair rent (${feePct}% of $${rev.toFixed(2)} net services) — week of ${weekLabel}`;

  return {
    rent_amount: 0,
    service_fee_rate: feeRate,
    service_fee_amount: total,
    total_amount: total,
    minimum_applied: minimumApplied,
    stripeItems: [{ amount: Math.round(total * 100), description }],
  };
}
