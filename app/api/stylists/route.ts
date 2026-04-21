import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { stripe } from "@/lib/stripe";
import { checkAuthOrFail } from "@/lib/auth";

export async function GET() {
  const authFail = await checkAuthOrFail();
  if (authFail) return authFail;

  const { data, error } = await supabaseAdmin
    .from("stylists")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ stylists: data });
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
