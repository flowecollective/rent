import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { checkAuthOrFail } from "@/lib/auth";
import { monthRangeContaining, toISODate } from "@/lib/dates";

export async function GET(
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

  const { data: invoices } = await supabaseAdmin
    .from("invoices")
    .select("*")
    .eq("stylist_id", id)
    .order("week_end", { ascending: false });

  const today = toISODate(new Date());
  const { monthStart, nextMonthStart } = monthRangeContaining(today);

  let lifetimeSettled = 0;
  let lifetimePending = 0;
  let serviceFeeThisMonth = 0;
  for (const inv of invoices || []) {
    const amt = Number(inv.total_amount);
    const fee = Number(inv.service_fee_amount);
    if (inv.status === "paid") lifetimeSettled += amt;
    if (inv.status === "sent" || inv.status === "processing") lifetimePending += amt;
    if (
      ["sent", "processing", "paid"].includes(inv.status) &&
      inv.week_end >= monthStart &&
      inv.week_end < nextMonthStart
    ) {
      serviceFeeThisMonth += fee;
    }
  }

  return NextResponse.json({
    stylist,
    invoices: invoices || [],
    stats: {
      lifetime_settled: lifetimeSettled,
      lifetime_pending: lifetimePending,
      service_fee_this_month: serviceFeeThisMonth,
      total_invoices: (invoices || []).length,
    },
  });
}
