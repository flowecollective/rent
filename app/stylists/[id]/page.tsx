"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

type Stylist = {
  id: string;
  name: string;
  email: string;
  stripe_customer_id: string | null;
  payment_method_status: "none" | "pending" | "verified";
  service_fee_monthly_cap: number;
  billing_model: "rent_plus_fee" | "percent_rent";
  fee_rate: number;
  weekly_rent: number;
  minimum_remit: number | null;
};

type Invoice = {
  id: string;
  week_start: string;
  week_end: string;
  net_service_revenue: number;
  rent_amount: number;
  service_fee_amount: number;
  total_amount: number;
  status: string;
  billing_model: "rent_plus_fee" | "percent_rent";
  minimum_applied: boolean;
  stripe_invoice_url: string | null;
  created_at: string;
};

type Stats = {
  lifetime_settled: number;
  lifetime_pending: number;
  service_fee_this_month: number;
  total_invoices: number;
};

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function StylistDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [stylist, setStylist] = useState<Stylist | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [voiding, setVoiding] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/stylists/${params.id}`);
    if (res.status === 404) {
      router.push("/settings");
      return;
    }
    const data = await res.json();
    setStylist(data.stylist);
    setInvoices(data.invoices || []);
    setStats(data.stats || null);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [params.id]);

  async function voidInvoice(id: string) {
    if (!confirm("Void this invoice? The stylist will no longer be able to pay it.")) return;
    setVoiding(id);
    const res = await fetch("/api/invoices/void", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoice_id: id }),
    });
    setVoiding(null);
    if (!res.ok) {
      const d = await res.json();
      alert(d.error || "Void failed");
      return;
    }
    load();
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
            <Link href="/" className="text-charcoal-muted hover:text-charcoal">
              Weekly
            </Link>
            <Link href="/settings" className="text-charcoal-muted hover:text-charcoal">
              Settings
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-12">
        <Link href="/settings" className="text-xs text-charcoal-muted hover:text-charcoal tracking-[0.15em] uppercase">
          ← Back to stylists
        </Link>

        {loading ? (
          <p className="text-charcoal-muted text-sm mt-8">Loading…</p>
        ) : !stylist ? (
          <p className="text-charcoal-muted text-sm mt-8">Stylist not found.</p>
        ) : (
          <>
            <div className="mt-4 mb-10">
              <h2 className="text-4xl mb-2">{stylist.name}</h2>
              <p className="text-sm text-charcoal-muted">{stylist.email}</p>
              <p className="text-xs text-charcoal-muted mt-2">
                <span className={`status-dot status-${stylist.payment_method_status}`}></span>
                Bank {stylist.payment_method_status === "verified" && "connected"}
                {stylist.payment_method_status === "pending" && "pending"}
                {stylist.payment_method_status === "none" && "not connected"}
              </p>
            </div>

            {stats && (
              <>
                <div className="mb-6 text-xs text-charcoal-muted">
                  Billing model:{" "}
                  <span className="text-charcoal">
                    {stylist.billing_model === "percent_rent"
                      ? `${((Number(stylist.fee_rate) || 0) * 100).toFixed(1).replace(/\.0$/, "")}% chair rent · min ${fmtMoney(Number(stylist.minimum_remit) || 0)}`
                      : `$${(Number(stylist.weekly_rent) || 0).toFixed(0)}/wk + ${((Number(stylist.fee_rate) || 0) * 100).toFixed(1).replace(/\.0$/, "")}% service fee`}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-4 mb-12">
                  <div className="border border-charcoal/20 p-4">
                    <div className="text-[10px] tracking-[0.2em] uppercase text-charcoal-muted">
                      Lifetime settled
                    </div>
                    <div className="text-2xl mt-1 tabular-nums">
                      {fmtMoney(stats.lifetime_settled)}
                    </div>
                  </div>
                  <div className="border border-charcoal/20 p-4">
                    <div className="text-[10px] tracking-[0.2em] uppercase text-charcoal-muted">
                      Pending
                    </div>
                    <div className="text-2xl mt-1 tabular-nums">
                      {fmtMoney(stats.lifetime_pending)}
                    </div>
                  </div>
                  {stylist.billing_model === "rent_plus_fee" ? (
                    <div className="border border-charcoal/20 p-4">
                      <div className="text-[10px] tracking-[0.2em] uppercase text-charcoal-muted">
                        Service fee this month
                      </div>
                      <div className="text-2xl mt-1 tabular-nums">
                        {fmtMoney(stats.service_fee_this_month)}
                        <span className="text-sm text-charcoal-muted ml-1">
                          / {fmtMoney(stylist.service_fee_monthly_cap)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="border border-charcoal/20 p-4">
                      <div className="text-[10px] tracking-[0.2em] uppercase text-charcoal-muted">
                        Chair rent this month
                      </div>
                      <div className="text-2xl mt-1 tabular-nums">
                        {fmtMoney(stats.service_fee_this_month)}
                      </div>
                    </div>
                  )}
                  <div className="border border-charcoal/20 p-4">
                    <div className="text-[10px] tracking-[0.2em] uppercase text-charcoal-muted">
                      Total invoices
                    </div>
                    <div className="text-2xl mt-1 tabular-nums">{stats.total_invoices}</div>
                  </div>
                </div>
              </>
            )}

            <h3 className="text-xl mb-4">Invoice history</h3>
            {invoices.length === 0 ? (
              <p className="text-sm text-charcoal-muted">No invoices yet.</p>
            ) : (
              <div className="border border-charcoal/20 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="hairline text-[10px] tracking-[0.2em] uppercase text-charcoal-muted">
                      <th className="text-left p-3 font-normal">Week</th>
                      <th className="text-right p-3 font-normal">Revenue</th>
                      <th className="text-right p-3 font-normal">Rent</th>
                      <th className="text-right p-3 font-normal">Service fee</th>
                      <th className="text-right p-3 font-normal">Total</th>
                      <th className="text-left p-3 font-normal">Status</th>
                      <th className="text-left p-3 font-normal">Link</th>
                      <th className="text-right p-3 font-normal">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => {
                      const canVoid = inv.status === "sent" || inv.status === "processing";
                      return (
                        <tr key={inv.id} className="hairline last:border-b-0">
                          <td className="p-3 text-charcoal-muted">
                            {inv.week_start} – {inv.week_end}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {fmtMoney(Number(inv.net_service_revenue))}
                          </td>
                          <td className="p-3 text-right tabular-nums text-charcoal-muted">
                            {fmtMoney(Number(inv.rent_amount))}
                          </td>
                          <td className="p-3 text-right tabular-nums text-charcoal-muted">
                            {fmtMoney(Number(inv.service_fee_amount))}
                            {inv.minimum_applied && (
                              <div className="text-[10px] text-gold mt-1">min applied</div>
                            )}
                          </td>
                          <td className="p-3 text-right tabular-nums font-medium">
                            {fmtMoney(Number(inv.total_amount))}
                          </td>
                          <td className="p-3 capitalize">
                            <span className={`status-dot status-${inv.status}`}></span>
                            {inv.status === "sent" ? "pending" : inv.status}
                          </td>
                          <td className="p-3">
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
                          <td className="p-3 text-right">
                            {canVoid ? (
                              <button
                                onClick={() => voidInvoice(inv.id)}
                                disabled={voiding === inv.id}
                                className="btn-secondary text-xs"
                              >
                                {voiding === inv.id ? "…" : "Void"}
                              </button>
                            ) : (
                              <span className="text-charcoal-muted text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
