"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Stylist = {
  id: string;
  name: string;
  email: string;
  stripe_customer_id: string | null;
  payment_method_status: "none" | "pending" | "verified";
  service_fee_monthly_cap: number;
  service_fee_paid_this_month: number;
};

type RecentInvoice = {
  id: string;
  stylist_id: string;
  stylist_name: string;
  week_start: string;
  week_end: string;
  total_amount: number;
  status: string;
  stripe_invoice_url: string | null;
  created_at: string;
};

function priorWeekRange(): { start: string; end: string } {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const daysSinceMonday = (day + 6) % 7;
  const thisMonday = new Date(d);
  thisMonday.setDate(d.getDate() - daysSinceMonday);
  const priorMonday = new Date(thisMonday);
  priorMonday.setDate(thisMonday.getDate() - 7);
  const priorSunday = new Date(priorMonday);
  priorSunday.setDate(priorMonday.getDate() + 6);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { start: iso(priorMonday), end: iso(priorSunday) };
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function HomePage() {
  const [stylists, setStylists] = useState<Stylist[]>([]);
  const [revenue, setRevenue] = useState<Record<string, string>>({});
  const [week, setWeek] = useState(priorWeekRange());
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<
    { stylistId: string; ok: boolean; message: string }[] | null
  >(null);
  const [recent, setRecent] = useState<RecentInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadData(monthRef: string) {
    setLoading(true);
    const [s, r] = await Promise.all([
      fetch(`/api/stylists?month=${monthRef}`).then((r) => r.json()),
      fetch("/api/invoices/recent").then((r) => r.json()),
    ]);
    setStylists(s.stylists || []);
    setRecent(r.invoices || []);
    setLoading(false);
  }

  useEffect(() => {
    loadData(week.end);
  }, [week.end]);

  function setRev(id: string, val: string) {
    setRevenue((prev) => ({ ...prev, [id]: val }));
  }

  function calc(stylist: Stylist) {
    const rev = parseFloat(revenue[stylist.id] || "0") || 0;
    const rawFee = rev * 0.075;
    const cap = stylist.service_fee_monthly_cap ?? 1000;
    const paid = stylist.service_fee_paid_this_month ?? 0;
    const remaining = Math.max(0, cap - paid);
    const serviceFee = Math.min(rawFee, remaining);
    const capped = serviceFee < rawFee;
    const total = 600 + serviceFee;
    return { rev, rawFee, serviceFee, capped, cap, paid, total };
  }

  const grandTotal = stylists.reduce((sum, s) => sum + calc(s).total, 0);
  const readyStylists = stylists.filter(
    (s) => s.payment_method_status === "verified" && (revenue[s.id] || "").trim() !== ""
  );

  async function submitInvoices() {
    if (readyStylists.length === 0) return;
    if (
      !confirm(
        `Email ${readyStylists.length} invoice(s) for the week of ${week.start} – ${week.end}? Stylists will have 2 days to review and pay via ACH.`
      )
    )
      return;
    setSubmitting(true);
    setResults(null);
    const payload = {
      week_start: week.start,
      week_end: week.end,
      entries: readyStylists.map((s) => ({
        stylist_id: s.id,
        net_service_revenue: parseFloat(revenue[s.id]) || 0,
      })),
    };
    const res = await fetch("/api/invoices/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setResults(data.results || []);
    setSubmitting(false);
    setRevenue({});
    loadData(week.end);
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div className="min-h-screen">
      <header className="hairline">
        <div className="max-w-5xl mx-auto px-8 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl leading-none">Flowe Collective</h1>
            <p className="text-[10px] tracking-[0.3em] uppercase text-charcoal-muted mt-1">
              Chair Rental · Invoicing
            </p>
          </div>
          <nav className="flex items-center gap-6 text-xs tracking-[0.15em] uppercase">
            <Link href="/" className="text-charcoal border-b border-gold pb-1">
              Weekly
            </Link>
            <Link href="/settings" className="text-charcoal-muted hover:text-charcoal">
              Settings
            </Link>
            <button onClick={logout} className="text-charcoal-muted hover:text-charcoal">
              Sign out
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-12">
        <section className="mb-12">
          <div className="flex items-end justify-between mb-8">
            <div>
              <h2 className="text-4xl mb-2">Weekly invoicing</h2>
              <p className="text-sm text-charcoal-muted">
                Enter each stylist's net service revenue. Rent ($600) and 7.5% service fee
                (capped at $1,000/month) are calculated automatically. Each stylist receives
                an emailed invoice with 2 days to review and pay via ACH.
              </p>
            </div>
          </div>

          <div className="flex gap-4 items-end mb-8">
            <div>
              <label className="block text-[10px] tracking-[0.2em] uppercase text-charcoal-muted mb-2">
                Week start (Mon)
              </label>
              <input
                type="date"
                value={week.start}
                onChange={(e) => {
                  const start = e.target.value;
                  const s = new Date(start + "T00:00:00");
                  s.setDate(s.getDate() + 6);
                  const end = s.toISOString().slice(0, 10);
                  setWeek({ start, end });
                }}
              />
            </div>
            <div>
              <label className="block text-[10px] tracking-[0.2em] uppercase text-charcoal-muted mb-2">
                Week end (Sun)
              </label>
              <input type="date" value={week.end} readOnly className="opacity-70" />
            </div>
          </div>

          {loading ? (
            <p className="text-charcoal-muted text-sm">Loading…</p>
          ) : stylists.length === 0 ? (
            <div className="border border-charcoal/20 p-8 text-center">
              <p className="text-charcoal-muted mb-4">No stylists configured yet.</p>
              <Link href="/settings" className="btn-secondary inline-block">
                Add stylists
              </Link>
            </div>
          ) : (
            <div className="border border-charcoal/20">
              <table className="w-full">
                <thead>
                  <tr className="hairline text-[10px] tracking-[0.2em] uppercase text-charcoal-muted">
                    <th className="text-left p-4 font-normal">Stylist</th>
                    <th className="text-left p-4 font-normal">Payment method</th>
                    <th className="text-right p-4 font-normal">Net service revenue</th>
                    <th className="text-right p-4 font-normal">Service fee (7.5%)</th>
                    <th className="text-right p-4 font-normal">Rent</th>
                    <th className="text-right p-4 font-normal">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {stylists.map((s) => {
                    const c = calc(s);
                    const ready = s.payment_method_status === "verified";
                    return (
                      <tr key={s.id} className="hairline last:border-b-0">
                        <td className="p-4">
                          <div className="font-medium">{s.name}</div>
                          <div className="text-xs text-charcoal-muted">{s.email}</div>
                          <div className="text-[10px] tracking-[0.15em] uppercase text-charcoal-muted mt-1">
                            Fee this month: {fmtMoney(c.paid)} / {fmtMoney(c.cap)}
                          </div>
                        </td>
                        <td className="p-4 text-xs">
                          <span className={`status-dot status-${s.payment_method_status}`}></span>
                          {s.payment_method_status === "verified" && "Ready"}
                          {s.payment_method_status === "pending" && "Pending verification"}
                          {s.payment_method_status === "none" && "Not set up"}
                        </td>
                        <td className="p-4 text-right">
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={revenue[s.id] || ""}
                            onChange={(e) => setRev(s.id, e.target.value)}
                            className="w-32 text-right"
                            disabled={!ready}
                          />
                        </td>
                        <td className="p-4 text-right tabular-nums text-charcoal-muted">
                          {fmtMoney(c.serviceFee)}
                          {c.capped && (
                            <div className="text-[10px] text-gold mt-1">
                              capped (raw {fmtMoney(c.rawFee)})
                            </div>
                          )}
                        </td>
                        <td className="p-4 text-right tabular-nums text-charcoal-muted">
                          $600.00
                        </td>
                        <td className="p-4 text-right tabular-nums font-medium">
                          {fmtMoney(c.total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="hairline bg-cream-dark/40">
                    <td colSpan={5} className="p-4 text-right text-sm tracking-[0.15em] uppercase text-charcoal-muted">
                      Grand total
                    </td>
                    <td className="p-4 text-right tabular-nums text-lg font-medium">
                      {fmtMoney(grandTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {stylists.length > 0 && (
            <div className="mt-8 flex items-center justify-between">
              <p className="text-sm text-charcoal-muted">
                {readyStylists.length} of {stylists.length} ready to invoice
                {stylists.some((s) => s.payment_method_status !== "verified") && (
                  <span className="ml-2">
                    · <Link href="/settings" className="underline">Send setup links</Link>
                  </span>
                )}
              </p>
              <button
                className="btn-primary"
                onClick={submitInvoices}
                disabled={submitting || readyStylists.length === 0}
              >
                {submitting ? "Processing…" : `Create & send ${readyStylists.length} invoice${readyStylists.length === 1 ? "" : "s"}`}
              </button>
            </div>
          )}

          {results && (
            <div className="mt-8 border border-charcoal/20 p-6">
              <h3 className="text-xl mb-4">Results</h3>
              <ul className="space-y-2 text-sm">
                {results.map((r, i) => {
                  const st = stylists.find((x) => x.id === r.stylistId);
                  return (
                    <li key={i} className="flex gap-3">
                      <span className={r.ok ? "text-[#2D7A4F]" : "text-[#B44545]"}>
                        {r.ok ? "✓" : "✗"}
                      </span>
                      <span className="font-medium">{st?.name || r.stylistId}</span>
                      <span className="text-charcoal-muted">{r.message}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        <section className="mt-16">
          <h2 className="text-2xl mb-6">Recent invoices</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-charcoal-muted">No invoices yet.</p>
          ) : (
            <div className="border border-charcoal/20">
              <table className="w-full text-sm">
                <thead>
                  <tr className="hairline text-[10px] tracking-[0.2em] uppercase text-charcoal-muted">
                    <th className="text-left p-4 font-normal">Stylist</th>
                    <th className="text-left p-4 font-normal">Week</th>
                    <th className="text-right p-4 font-normal">Amount</th>
                    <th className="text-left p-4 font-normal">Status</th>
                    <th className="text-left p-4 font-normal">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((inv) => (
                    <tr key={inv.id} className="hairline last:border-b-0">
                      <td className="p-4">{inv.stylist_name}</td>
                      <td className="p-4 text-charcoal-muted">
                        {inv.week_start} – {inv.week_end}
                      </td>
                      <td className="p-4 text-right tabular-nums">
                        {fmtMoney(inv.total_amount)}
                      </td>
                      <td className="p-4 capitalize">
                        <span className={`status-dot status-${inv.status}`}></span>
                        {inv.status}
                      </td>
                      <td className="p-4">
                        {inv.stripe_invoice_url ? (
                          <a
                            href={inv.stripe_invoice_url}
                            target="_blank"
                            rel="noreferrer"
                            className="underline text-xs"
                          >
                            View
                          </a>
                        ) : (
                          <span className="text-charcoal-muted text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
