"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type BillingModel = "rent_plus_fee" | "percent_rent";

type Stylist = {
  id: string;
  name: string;
  email: string;
  stripe_customer_id: string | null;
  payment_method_status: "none" | "pending" | "verified";
  billing_model: BillingModel;
  fee_rate: number;
  weekly_rent: number;
  minimum_remit: number | null;
};

type AddForm = {
  name: string;
  email: string;
  billing_model: BillingModel;
  fee_rate_pct: string; // percentage string, e.g. "35" or "7.5"
  weekly_rent: string;
  minimum_remit: string;
};

type EditForm = {
  id: string;
  name: string;
  email: string;
  billing_model: BillingModel;
  fee_rate_pct: string;
  weekly_rent: string;
  minimum_remit: string;
};

function defaultAdd(): AddForm {
  return {
    name: "",
    email: "",
    billing_model: "rent_plus_fee",
    fee_rate_pct: "7.5",
    weekly_rent: "600",
    minimum_remit: "600",
  };
}

function defaultsForModel(m: BillingModel): { fee_rate_pct: string; weekly_rent: string; minimum_remit: string } {
  if (m === "percent_rent") return { fee_rate_pct: "35", weekly_rent: "600", minimum_remit: "600" };
  return { fee_rate_pct: "7.5", weekly_rent: "600", minimum_remit: "600" };
}

export default function SettingsPage() {
  const [stylists, setStylists] = useState<Stylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<AddForm>(defaultAdd());
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [linkModal, setLinkModal] = useState<{ name: string; url: string } | null>(null);
  const [editing, setEditing] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/stylists");
    const data = await res.json();
    setStylists(data.stylists || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function addStylist(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return;
    setAdding(true);
    setMsg(null);
    const body: any = {
      name: form.name.trim(),
      email: form.email.trim(),
      billing_model: form.billing_model,
    };

    const rate = parseFloat(form.fee_rate_pct) / 100;
    if (!Number.isFinite(rate) || rate <= 0 || rate > 1) {
      setAdding(false);
      setMsg({ type: "err", text: "Fee rate must be between 0 and 100%" });
      return;
    }
    body.fee_rate = rate;

    if (form.billing_model === "percent_rent") {
      const min = parseFloat(form.minimum_remit);
      if (!Number.isFinite(min) || min < 0) {
        setAdding(false);
        setMsg({ type: "err", text: "Weekly minimum must be non-negative" });
        return;
      }
      body.minimum_remit = min;
    } else {
      const rent = parseFloat(form.weekly_rent);
      if (!Number.isFinite(rent) || rent < 0) {
        setAdding(false);
        setMsg({ type: "err", text: "Weekly rent must be non-negative" });
        return;
      }
      body.weekly_rent = rent;
    }

    const res = await fetch("/api/stylists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setAdding(false);
    if (res.ok) {
      setForm(defaultAdd());
      setMsg({ type: "ok", text: `Added ${data.stylist.name}` });
      load();
    } else {
      setMsg({ type: "err", text: data.error || "Failed" });
    }
  }

  function openEdit(s: Stylist) {
    setEditing({
      id: s.id,
      name: s.name,
      email: s.email,
      billing_model: s.billing_model,
      fee_rate_pct: ((Number(s.fee_rate) || 0) * 100).toString(),
      weekly_rent: (Number(s.weekly_rent) || 0).toString(),
      minimum_remit: s.minimum_remit != null ? String(s.minimum_remit) : "600",
    });
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    const body: any = {
      id: editing.id,
      name: editing.name.trim(),
      email: editing.email.trim(),
      billing_model: editing.billing_model,
    };
    const rate = parseFloat(editing.fee_rate_pct) / 100;
    if (Number.isFinite(rate) && rate > 0 && rate <= 1) body.fee_rate = rate;
    const rent = parseFloat(editing.weekly_rent);
    if (Number.isFinite(rent) && rent >= 0) body.weekly_rent = rent;
    if (editing.billing_model === "percent_rent") {
      const min = parseFloat(editing.minimum_remit);
      if (Number.isFinite(min) && min >= 0) body.minimum_remit = min;
    } else {
      body.minimum_remit = null;
    }
    const res = await fetch("/api/stylists", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) {
      setEditing(null);
      setMsg({ type: "ok", text: "Saved" });
      load();
    } else {
      const d = await res.json();
      setMsg({ type: "err", text: d.error || "Save failed" });
    }
  }

  async function removeStylist(id: string, name: string) {
    if (!confirm(`Remove ${name}? Invoice history will be kept.`)) return;
    const res = await fetch("/api/stylists", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) load();
  }

  async function refreshStatus(stylist: Stylist) {
    const res = await fetch(`/api/stylists/${stylist.id}/refresh-status`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg({ type: "err", text: data.error || "Refresh failed" });
      return;
    }
    setMsg({
      type: "ok",
      text: `${stylist.name}: ${data.detail || `status now ${data.new_status}`}`,
    });
    load();
  }

  async function sendSetupLink(stylist: Stylist) {
    const res = await fetch("/api/stripe/setup-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stylist_id: stylist.id }),
    });
    const data = await res.json();
    if (!res.ok || !data.url) {
      setMsg({ type: "err", text: data.error || "Failed to generate link" });
      return;
    }
    if (data.emailed) {
      setMsg({ type: "ok", text: `Setup link emailed to ${stylist.email}` });
      load();
      return;
    }
    // Fall back to copy/paste modal if email send failed
    setMsg({
      type: "err",
      text: `Email to ${stylist.email} failed${data.email_error ? `: ${data.email_error}` : ""}. Copy the link below and send manually.`,
    });
    setLinkModal({ name: stylist.name, url: data.url });
    load();
  }

  function modelLabel(m: BillingModel) {
    return m === "percent_rent" ? "% chair rent" : "rent + fee";
  }

  function modelSummary(s: Stylist) {
    const pct = ((Number(s.fee_rate) || 0) * 100).toFixed(1).replace(/\.0$/, "");
    if (s.billing_model === "percent_rent") {
      const min = s.minimum_remit != null ? `$${Number(s.minimum_remit).toFixed(0)}` : "—";
      return `${pct}% · min ${min}`;
    }
    const rent = Number(s.weekly_rent) || 0;
    return `$${rent.toFixed(0)}/wk + ${pct}%`;
  }

  return (
    <div className="min-h-screen">
      <header className="hairline">
        <div className="max-w-5xl mx-auto px-4 md:px-8 py-4 md:py-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl leading-none">Flowe Collective</h1>
            <p className="text-[9px] md:text-[10px] tracking-[0.3em] uppercase text-charcoal-muted mt-1">
              Chair Rental · Invoicing
            </p>
          </div>
          <nav className="flex items-center gap-3 md:gap-6 text-[11px] md:text-xs tracking-[0.15em] uppercase">
            <Link href="/" className="text-charcoal-muted hover:text-charcoal">
              Weekly
            </Link>
            <Link href="/settings" className="text-charcoal border-b border-gold pb-1">
              Settings
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 md:px-8 py-8 md:py-12">
        <h2 className="text-3xl md:text-4xl mb-2">Stylists</h2>
        <p className="text-sm text-charcoal-muted mb-8 md:mb-10">
          Add renters, send ACH setup links, and manage active roster.
        </p>

        {/* Add form */}
        <section className="mb-10 md:mb-12 border border-charcoal/20 p-4 md:p-6">
          <h3 className="text-xl mb-4">Add stylist</h3>
          <form onSubmit={addStylist} className="space-y-4">
            <div className="flex gap-3 flex-wrap">
              <div className="flex-1 min-w-[180px]">
                <label className="block text-[10px] tracking-[0.2em] uppercase text-charcoal-muted mb-2">
                  Name
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Full name"
                  className="w-full"
                />
              </div>
              <div className="flex-1 min-w-[220px]">
                <label className="block text-[10px] tracking-[0.2em] uppercase text-charcoal-muted mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="stylist@example.com"
                  className="w-full"
                />
              </div>
            </div>

            <div className="flex gap-3 flex-wrap items-end">
              <div className="min-w-[220px]">
                <label className="block text-[10px] tracking-[0.2em] uppercase text-charcoal-muted mb-2">
                  Billing model
                </label>
                <select
                  value={form.billing_model}
                  onChange={(e) => {
                    const next = e.target.value as BillingModel;
                    setForm({ ...form, billing_model: next, ...defaultsForModel(next) });
                  }}
                  className="w-full"
                >
                  <option value="rent_plus_fee">rent + fee</option>
                  <option value="percent_rent">% chair rent (with minimum)</option>
                </select>
              </div>

              <div className="min-w-[140px]">
                <label className="block text-[10px] tracking-[0.2em] uppercase text-charcoal-muted mb-2">
                  Fee rate (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={form.fee_rate_pct}
                  onChange={(e) => setForm({ ...form, fee_rate_pct: e.target.value })}
                  className="w-full"
                />
              </div>

              {form.billing_model === "rent_plus_fee" ? (
                <div className="min-w-[140px]">
                  <label className="block text-[10px] tracking-[0.2em] uppercase text-charcoal-muted mb-2">
                    Weekly rent ($)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={form.weekly_rent}
                    onChange={(e) => setForm({ ...form, weekly_rent: e.target.value })}
                    className="w-full"
                  />
                </div>
              ) : (
                <div className="min-w-[140px]">
                  <label className="block text-[10px] tracking-[0.2em] uppercase text-charcoal-muted mb-2">
                    Weekly minimum ($)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={form.minimum_remit}
                    onChange={(e) => setForm({ ...form, minimum_remit: e.target.value })}
                    className="w-full"
                  />
                </div>
              )}
              <button type="submit" className="btn-primary" disabled={adding}>
                {adding ? "Adding…" : "Add"}
              </button>
            </div>
          </form>
          {msg && (
            <p className={`mt-4 text-sm ${msg.type === "ok" ? "text-[#2D7A4F]" : "text-[#B44545]"}`}>
              {msg.text}
            </p>
          )}
        </section>

        {/* Roster */}
        <section>
          <h3 className="text-xl mb-4">Active Roster</h3>
          {loading ? (
            <p className="text-charcoal-muted text-sm">Loading…</p>
          ) : stylists.length === 0 ? (
            <p className="text-sm text-charcoal-muted">No stylists yet.</p>
          ) : (
            <div className="border border-charcoal/20 overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="hairline text-[10px] tracking-[0.2em] uppercase text-charcoal-muted">
                    <th className="text-left p-4 font-normal">Stylist</th>
                    <th className="text-left p-4 font-normal">Bank</th>
                    <th className="text-left p-4 font-normal">Billing</th>
                    <th className="text-right p-4 font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {stylists.map((s) => (
                    <tr key={s.id} className="hairline last:border-b-0">
                      <td className="p-4">
                        <Link href={`/stylists/${s.id}`} className="font-medium hover:underline">
                          {s.name}
                        </Link>
                        <div className="text-xs text-charcoal-muted">{s.email}</div>
                      </td>
                      <td className="p-4 text-sm">
                        <span className={`status-dot status-${s.payment_method_status}`}></span>
                        {s.payment_method_status === "verified" && "Connected"}
                        {s.payment_method_status === "pending" && "Pending"}
                        {s.payment_method_status === "none" && "Not connected"}
                      </td>
                      <td className="p-4 text-sm">
                        <div>{modelLabel(s.billing_model)}</div>
                        <div className="text-[10px] text-charcoal-muted mt-1">
                          {modelSummary(s)}
                        </div>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex gap-2 justify-end flex-wrap">
                          <button
                            onClick={() => openEdit(s)}
                            className="btn-secondary text-xs"
                          >
                            Edit
                          </button>
                          <Link
                            href={`/stylists/${s.id}`}
                            className="btn-secondary text-xs"
                          >
                            History
                          </Link>
                          <button
                            onClick={() => sendSetupLink(s)}
                            className="btn-secondary text-xs"
                          >
                            {s.payment_method_status === "verified"
                              ? "Resend setup"
                              : "Send setup link"}
                          </button>
                          {s.payment_method_status !== "verified" && (
                            <button
                              onClick={() => refreshStatus(s)}
                              className="btn-secondary text-xs"
                            >
                              Refresh
                            </button>
                          )}
                          <button
                            onClick={() => removeStylist(s.id, s.name)}
                            className="btn-secondary text-xs"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* Setup link modal */}
      {linkModal && (
        <div
          className="fixed inset-0 bg-charcoal/60 flex items-center justify-center p-4 md:p-6 z-50 overflow-y-auto"
          onClick={() => setLinkModal(null)}
        >
          <div
            className="bg-cream border border-charcoal/30 p-6 md:p-8 max-w-lg w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-2xl mb-3">Setup link for {linkModal.name}</h3>
            <p className="text-sm text-charcoal-muted mb-4">
              Text or email this link to the stylist. They'll connect their bank via Stripe
              (Plaid-powered). Once connected, they'll be able to pay future invoices with one click.
            </p>
            <div className="bg-cream-dark border border-charcoal/20 p-3 text-xs break-all mb-4 font-mono">
              {linkModal.url}
            </div>
            <div className="flex gap-3">
              <button
                className="btn-primary"
                onClick={() => {
                  navigator.clipboard.writeText(linkModal.url);
                  setMsg({ type: "ok", text: "Link copied to clipboard" });
                }}
              >
                Copy link
              </button>
              <button className="btn-secondary" onClick={() => setLinkModal(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div
          className="fixed inset-0 bg-charcoal/60 flex items-center justify-center p-4 md:p-6 z-50 overflow-y-auto"
          onClick={() => setEditing(null)}
        >
          <div
            className="bg-cream border border-charcoal/30 p-6 md:p-8 max-w-lg w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-2xl mb-5">Edit stylist</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] tracking-[0.2em] uppercase text-charcoal-muted mb-2">
                  Name
                </label>
                <input
                  type="text"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-[10px] tracking-[0.2em] uppercase text-charcoal-muted mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={editing.email}
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-[10px] tracking-[0.2em] uppercase text-charcoal-muted mb-2">
                  Billing model
                </label>
                <select
                  value={editing.billing_model}
                  onChange={(e) =>
                    setEditing({ ...editing, billing_model: e.target.value as BillingModel })
                  }
                  className="w-full"
                >
                  <option value="rent_plus_fee">rent + fee</option>
                  <option value="percent_rent">% chair rent (with minimum)</option>
                </select>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-[10px] tracking-[0.2em] uppercase text-charcoal-muted mb-2">
                    Fee rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={editing.fee_rate_pct}
                    onChange={(e) => setEditing({ ...editing, fee_rate_pct: e.target.value })}
                    className="w-full"
                  />
                </div>
                {editing.billing_model === "rent_plus_fee" ? (
                  <div className="flex-1">
                    <label className="block text-[10px] tracking-[0.2em] uppercase text-charcoal-muted mb-2">
                      Weekly rent ($)
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={editing.weekly_rent}
                      onChange={(e) => setEditing({ ...editing, weekly_rent: e.target.value })}
                      className="w-full"
                    />
                  </div>
                ) : (
                  <div className="flex-1">
                    <label className="block text-[10px] tracking-[0.2em] uppercase text-charcoal-muted mb-2">
                      Weekly minimum ($)
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={editing.minimum_remit}
                      onChange={(e) => setEditing({ ...editing, minimum_remit: e.target.value })}
                      className="w-full"
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button className="btn-primary" onClick={saveEdit} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button className="btn-secondary" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
