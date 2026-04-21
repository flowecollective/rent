import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { stripe } from "@/lib/stripe";
import { checkAuthOrFail } from "@/lib/auth";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authFail = await checkAuthOrFail();
  if (authFail) return authFail;

  const { id } = await params;

  const { data: stylist, error: sErr } = await supabaseAdmin
    .from("stylists")
    .select("*")
    .eq("id", id)
    .single();

  if (sErr || !stylist) {
    return NextResponse.json({ error: "Stylist not found" }, { status: 404 });
  }
  if (!stylist.stripe_customer_id) {
    return NextResponse.json({ error: "No Stripe customer" }, { status: 400 });
  }

  // Find the latest setup intent for this customer and use its status
  const intents = await stripe.setupIntents.list({
    customer: stylist.stripe_customer_id,
    limit: 10,
  });

  if (!intents.data.length) {
    return NextResponse.json({
      updated: false,
      previous_status: stylist.payment_method_status,
      new_status: stylist.payment_method_status,
      detail: "No setup intents found for this customer",
    });
  }

  // Most recent first (Stripe returns sorted by created desc by default)
  const latest = intents.data[0];
  const paymentMethodId =
    typeof latest.payment_method === "string"
      ? latest.payment_method
      : latest.payment_method?.id || null;

  // Always attempt to set the saved payment method as the customer's default
  // (so future invoices use it). Stripe accepts this even when the PM is
  // still pending microdeposit verification.
  let defaultSet = false;
  if (paymentMethodId) {
    try {
      await stripe.customers.update(stylist.stripe_customer_id, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
      defaultSet = true;
    } catch (_e) {
      // Some PM states can reject default assignment; ignore silently.
    }
  }

  let newStatus: "none" | "pending" | "verified";
  let detail = "";

  if (latest.status === "succeeded") {
    newStatus = "verified";
    detail = "Setup intent succeeded — bank verified.";
  } else if (
    latest.status === "requires_action" ||
    latest.status === "processing" ||
    latest.status === "requires_confirmation" ||
    latest.status === "requires_payment_method"
  ) {
    newStatus = "pending";
    detail =
      latest.status === "requires_action"
        ? "Awaiting microdeposit verification — stylist needs to check their email for Stripe's verify link."
        : `Setup intent in '${latest.status}' — still in flight.`;
  } else {
    // canceled or anything else
    newStatus = "none";
    detail = `Setup intent is '${latest.status}'. Stylist may need a new setup link.`;
  }

  if (paymentMethodId && defaultSet) {
    detail += ` (Default payment method updated on Stripe customer.)`;
  }

  const updates: Record<string, any> = {
    payment_method_status: newStatus,
    updated_at: new Date().toISOString(),
  };
  if (paymentMethodId) updates.payment_method_id = paymentMethodId;

  await supabaseAdmin.from("stylists").update(updates).eq("id", id);

  return NextResponse.json({
    updated: newStatus !== stylist.payment_method_status,
    previous_status: stylist.payment_method_status,
    new_status: newStatus,
    stripe_setup_intent_status: latest.status,
    detail,
  });
}
