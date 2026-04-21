import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { stripe } from "@/lib/stripe";
import { checkAuthOrFail } from "@/lib/auth";
import { monthRangeContaining } from "@/lib/dates";

export async function GET(req: NextRequest) {
  const authFail = await checkAuthOrFail();
  if (authFail) return authFail;

  const { data: stylists, error } = await supabaseAdmin
    .from("stylists")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Optional: ?month=YYYY-MM-DD (any date inside the target month)
  // Returns service_fee_paid_this_month per stylist based on week_end month.
  const monthParam = req.nextUrl.searchParams.get("month");
  const paidByStylist: Record<string, number> = {};
  if (monthParam && stylists && stylists.length > 0) {
    const { monthStart, nextMonthStart } = monthRangeContaining(monthParam);
    const { data: invoices } = await supabaseAdmin
      .from("invoices")
      .select("stylist_id, service_fee_amount")
      .in("status", ["sent", "processing", "paid"])
      .gte("week_end", monthStart)
      .lt("week_end", nextMonthStart);

    for (const row of invoices || []) {
      const id = row.stylist_id as string;
      paidByStylist[id] = (paidByStylist[id] || 0) + Number(row.service_fee_amount);
    }
  }

  const enriched = (stylists || []).map((s) => ({
    ...s,
    service_fee_paid_this_month: paidByStylist[s.id] || 0,
  }));

  return NextResponse.json({ stylists: enriched });
}

export async function POST(req: NextRequest) {
  const authFail = await checkAuthOrFail();
  if (authFail) return authFail;

  const body = await req.json();
  const { name, email, billing_model, fee_rate, weekly_rent, minimum_remit } = body;
  if (!name || !email) {
    return NextResponse.json({ error: "Name and email required" }, { status: 400 });
  }

  const model = billing_model === "percent_rent" ? "percent_rent" : "rent_plus_fee";
  const resolvedFeeRate =
    fee_rate != null ? Number(fee_rate) : model === "percent_rent" ? 0.35 : 0.075;
  const resolvedRent = weekly_rent != null ? Number(weekly_rent) : 600;
  const resolvedMin =
    model === "percent_rent"
      ? minimum_remit != null
        ? Number(minimum_remit)
        : 600
      : null;

  // Create Stripe customer
  const customer = await stripe.customers.create({
    name,
    email,
    metadata: { source: "rent.flowecollective.com" },
  });

  const { data, error } = await supabaseAdmin
    .from("stylists")
    .insert({
      name,
      email,
      stripe_customer_id: customer.id,
      payment_method_status: "none",
      billing_model: model,
      fee_rate: resolvedFeeRate,
      weekly_rent: resolvedRent,
      minimum_remit: resolvedMin,
    })
    .select()
    .single();

  if (error) {
    // Rollback Stripe customer if DB insert fails
    await stripe.customers.del(customer.id).catch(() => {});
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ stylist: data });
}

export async function PATCH(req: NextRequest) {
  const authFail = await checkAuthOrFail();
  if (authFail) return authFail;

  const body = await req.json();
  const { id, name, email, billing_model, fee_rate, weekly_rent, minimum_remit } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data: existing } = await supabaseAdmin
    .from("stylists")
    .select("stripe_customer_id")
    .eq("id", id)
    .single();

  if (existing?.stripe_customer_id && (name !== undefined || email !== undefined)) {
    await stripe.customers.update(existing.stripe_customer_id, { name, email });
  }

  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (name !== undefined) updates.name = name;
  if (email !== undefined) updates.email = email;
  if (billing_model !== undefined) {
    updates.billing_model =
      billing_model === "percent_rent" ? "percent_rent" : "rent_plus_fee";
    // When switching to rent_plus_fee, clear the minimum; when to percent_rent, default if unset
    if (updates.billing_model === "rent_plus_fee") updates.minimum_remit = null;
  }
  if (fee_rate !== undefined) updates.fee_rate = Number(fee_rate);
  if (weekly_rent !== undefined) updates.weekly_rent = Number(weekly_rent);
  if (minimum_remit !== undefined) {
    updates.minimum_remit = minimum_remit === null ? null : Number(minimum_remit);
  }

  const { data, error } = await supabaseAdmin
    .from("stylists")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ stylist: data });
}

export async function DELETE(req: NextRequest) {
  const authFail = await checkAuthOrFail();
  if (authFail) return authFail;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data: existing } = await supabaseAdmin
    .from("stylists")
    .select("stripe_customer_id")
    .eq("id", id)
    .single();

  // We don't delete the Stripe customer (keeps invoice history intact),
  // but we remove the stylist from our system.
  const { error } = await supabaseAdmin.from("stylists").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
