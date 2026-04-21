import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { stripe } from "@/lib/stripe";
import { checkAuthOrFail } from "@/lib/auth";
import { sendMail } from "@/lib/mailer";

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
        // "ownership" lets Stripe pull the account holder's name from the
        // bank, populating billing_details.name on the payment method.
        // Without it, ACH PMs can land in a state where they can't be set
        // as the customer's default invoice payment method.
        financial_connections: { permissions: ["payment_method", "ownership"] },
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

  let emailed = false;
  let emailError: string | null = null;
  if (session.url && stylist.email) {
    try {
      await sendMail({
        to: stylist.email,
        subject: "Connect your bank — Flowe Collective",
        text: buildEmailText(stylist.name, session.url),
        html: buildEmailHtml(stylist.name, session.url),
      });
      emailed = true;
    } catch (err: any) {
      emailError = err?.message || "Email send failed";
      console.error("Setup-link email failed:", err);
    }
  }

  return NextResponse.json({
    url: session.url,
    session_id: session.id,
    emailed,
    email_error: emailError,
  });
}

function buildEmailText(name: string, url: string): string {
  return `Hi ${name},

Flowe Collective uses Stripe to collect your weekly chair rental via ACH. To get set up, follow this link to connect your bank account (Plaid-powered, secure):

${url}

After connecting, you'll be ready to receive and pay weekly invoices with one click. The link is single-use per setup attempt — if you run into issues, just let us know.

Thanks,
Flowe Collective
`;
}

function buildEmailHtml(name: string, url: string): string {
  // Simple, email-client-safe HTML (inline styles, no external assets).
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#FAF6F0;font-family:Helvetica,Arial,sans-serif;color:#1A1A1A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF6F0;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FAF6F0;">
          <tr>
            <td style="padding-bottom:28px;border-bottom:1px solid rgba(26,26,26,0.12);">
              <h1 style="margin:0;font-family:Georgia,serif;font-weight:400;font-size:28px;letter-spacing:-0.01em;">Flowe Collective</h1>
              <div style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#6B6B6B;margin-top:6px;">Chair Rental · Invoicing</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 0 16px 0;font-size:16px;line-height:1.55;">
              Hi ${escapeHtml(name)},
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 24px 0;font-size:15px;line-height:1.6;color:#333;">
              Flowe Collective uses Stripe to collect your weekly chair rental via ACH. To get set up, connect your bank account below — it takes about a minute and is secured by Stripe's Plaid integration.
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 28px 0;">
              <a href="${url}" style="display:inline-block;background:#1A1A1A;color:#FAF6F0;padding:14px 28px;font-size:14px;font-weight:500;text-transform:uppercase;letter-spacing:0.08em;text-decoration:none;">
                Connect your bank
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 24px 0;font-size:13px;line-height:1.55;color:#6B6B6B;">
              After connecting, you'll receive weekly invoices and can pay each with one click. If the button above doesn't work, paste this link into your browser:
              <br><br>
              <span style="font-family:Menlo,Monaco,monospace;font-size:12px;word-break:break-all;color:#333;">${escapeHtml(url)}</span>
            </td>
          </tr>
          <tr>
            <td style="padding-top:24px;border-top:1px solid rgba(26,26,26,0.12);font-size:12px;color:#6B6B6B;">
              Questions? Reply to this email.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
