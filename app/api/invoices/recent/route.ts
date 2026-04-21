import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { checkAuthOrFail } from "@/lib/auth";

export async function GET() {
  const authFail = await checkAuthOrFail();
  if (authFail) return authFail;

  const { data, error } = await supabaseAdmin
    .from("invoices")
    .select("*, stylists(name)")
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const invoices = (data || []).map((row: any) => ({
    id: row.id,
    stylist_id: row.stylist_id,
    stylist_name: row.stylists?.name || "—",
    week_start: row.week_start,
    week_end: row.week_end,
    total_amount: Number(row.total_amount),
    status: row.status,
    stripe_invoice_url: row.stripe_invoice_url,
    created_at: row.created_at,
  }));

  return NextResponse.json({ invoices });
}
