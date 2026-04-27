import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase";
import Stripe from "stripe";

// Webhooks need raw body for signature verification.
export const config = {
  api: { bodyParser: false },
};

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err: any) {
    return NextResponse.json({ error: `Signature: ${err.message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "setup" && session.customer) {
          const setupIntentId = session.setup_intent as string;
          const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
          const paymentMethodId = setupIntent.payment_method as string | null;

          if (paymentMethodId) {
            // Set as default invoice payment method on the customer
            await stripe.customers.update(session.customer as string, {
              invoice_settings: { default_payment_method: paymentMethodId },
            });

            const status =
              setupIntent.status === "succeeded" ? "verified" : "pending";

            await supabaseAdmin
              .from("stylists")
              .update({
                payment_method_id: paymentMethodId,
                payment_method_status: status,
                updated_at: new Date().toISOString(),
              })
              .eq("stripe_customer_id", session.customer);
          }
        }
        break;
      }

      case "setup_intent.succeeded": {
        const si = event.data.object as Stripe.SetupIntent;
        const customerId =
          typeof si.customer === "string" ? si.customer : si.customer?.id;
        const paymentMethodId =
          typeof si.payment_method === "string"
            ? si.payment_method
            : si.payment_method?.id;

        if (customerId && paymentMethodId) {
          await stripe.customers.update(customerId, {
            invoice_settings: { default_payment_method: paymentMethodId },
          });
          await supabaseAdmin
            .from("stylists")
            .update({
              payment_method_id: paymentMethodId,
              payment_method_status: "verified",
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_customer_id", customerId);
        }
        break;
      }

      case "invoice.paid": {
        const inv = event.data.object as Stripe.Invoice;
        await supabaseAdmin
          .from("invoices")
          .update({ status: "paid", updated_at: new Date().toISOString() })
          .eq("stripe_invoice_id", inv.id);

        // Stylist successfully paid → they have a working bank linked.
        // Promote their status to verified so future invoices show "Bank linked".
        const customerId =
          typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
        if (customerId) {
          await supabaseAdmin
            .from("stylists")
            .update({
              payment_method_status: "verified",
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_customer_id", customerId);
        }
        break;
      }

      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        await supabaseAdmin
          .from("invoices")
          .update({
            status: "failed",
            error_message: inv.last_finalization_error?.message || "ACH payment failed",
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_invoice_id", inv.id);
        break;
      }

      case "invoice.voided": {
        const inv = event.data.object as Stripe.Invoice;
        await supabaseAdmin
          .from("invoices")
          .update({ status: "void", updated_at: new Date().toISOString() })
          .eq("stripe_invoice_id", inv.id);
        break;
      }

      default:
        // Ignore other events
        break;
    }
  } catch (err: any) {
    console.error("Webhook handler error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
