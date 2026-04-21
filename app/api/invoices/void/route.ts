import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { stripe } from "@/lib/stripe";
import { checkAuthOrFail } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const authFail = await checkAuthOrFail();
  if (authFail) return authFail;

  const { invoice_id } = await req.json();
  if (!invoice_id) {
    return NextResponse.json({ error: "invoice_id required" }, { status: 400 });
  }

  const { data: row, error } = await supabaseAdmin
    .from("invoices")
    .select("*")
    .eq("id", invoice_id)
    .single();

  if (error || !row) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  if (!row.stripe_invoice_id) {
    return NextResponse.json({ error: "No Stripe invoice to void" }, { status: 400 });
  }
  if (!["sent", "processing"].includes(row.status)) {
    return NextResponse.json(
      { error: `Cannot void invoice in status '${row.status}'. Only 'sent' or 'processing' can be voided.` },
      { status: 400 }
    );
  }

  try {
    await stripe.invoices.voidInvoice(row.stripe_invoice_id);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Stripe void failed" },
      { status: 500 }
    );
  }

  await supabaseAdmin
    .from("invoices")
    .update({
      status: "void",
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoice_id);

  return NextResponse.json({ ok: true });
}
