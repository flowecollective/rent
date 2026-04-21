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

  const { name, email } = await req.json();
  if (!name || !email) {
    return NextResponse.json({ error: "Name and email required" }, { status: 400 });
  }

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

  const { id, name, email } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data: existing } = await supabaseAdmin
    .from("stylists")
    .select("stripe_customer_id")
    .eq("id", id)
    .single();

  if (existing?.stripe_customer_id) {
    await stripe.customers.update(existing.stripe_customer_id, { name, email });
  }

  const { data, error } = await supabaseAdmin
    .from("stylists")
    .update({ name, email, updated_at: new Date().toISOString() })
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
