import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { stripe } from "@/lib/stripe";
import { checkAuthOrFail } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const authFail = await checkAuthOrFail();
  if (authFail) return authFail;

  const { stylist_id } = await req.json();
  if (!stylist_id) {
    return NextResponse.json({ error: "stylist_id required" }, { status: 400 });
  }

  const { data: stylist, error } = await supabaseAdmin
    .from("stylists")
    .select("*")
    .eq("id", stylist_id)
    .single();

  if (error || !stylist) {
    return NextResponse.json({ error: "Stylist not found" }, { status: 404 });
  }
  if (!stylist.stripe_customer_id) {
    return NextResponse.json({ error: "No Stripe customer" }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // Use Stripe Checkout in "setup" mode for ACH - supports Plaid instant
  // verification and microdeposit fallback automatically.
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    customer: stylist.stripe_customer_id,
    payment_method_types: ["us_bank_account"],
    payment_method_options: {
      us_bank_account: {
        financial_connections: { permissions: ["payment_method"] },
        verification_method: "automatic",
      },
    },
    success_url: `${appUrl}/setup/success?sid=${stylist.id}`,
    cancel_url: `${appUrl}/setup/cancel`,
  });

  // Mark as pending
  await supabaseAdmin
    .from("stylists")
    .update({ payment_method_status: "pending", updated_at: new Date().toISOString() })
    .eq("id", stylist.id);

  return NextResponse.json({ url: session.url, session_id: session.id });
}
