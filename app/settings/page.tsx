"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Stylist = {
  id: string;
  name: string;
  email: string;
  stripe_customer_id: string | null;
  payment_method_status: "none" | "pending" | "verified";
};

export default function SettingsPage() {
  const [stylists, setStylists] = useState<Stylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [linkModal, setLinkModal] = useState<{ name: string; url: string } | null>(null);

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
    if (!newName.trim() || !newEmail.trim()) return;
    setAdding(true);
    setMsg(null);
    const res = await fetch("/api/stylists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), email: newEmail.trim() }),
    });
    const data = await res.json();
    setAdding(false);
    if (res.ok) {
      setNewName("");
      setNewEmail("");
      setMsg({ type: "ok", text: `Added ${data.stylist.name}` });
      load();
    } else {
      setMsg({ type: "err", text: data.error || "Failed" });
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

  async function sendSetupLink(stylist: Stylist) {
    const res = await fetch("/api/stripe/setup-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stylist_id: stylist.id }),
    });
    const data = await res.json();
    if (res.ok && data.url) {
      setLinkModal({ name: stylist.name, url: data.url });
      load();
    } else {
      setMsg({ type: "err", text: data.error || "Failed to generate link" });
    }
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
            <Link href="/settings" className="text-charcoal border-b border-gold pb-1">
              Settings
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-12">
        <h2 className="text-4xl mb-2">Stylists</h2>
        <p className="text-sm text-charcoal-muted mb-10">
          Add renters, send ACH setup links, and manage active roster.
        </p>

        {/* Add form */}
        <section className="mb-12 border border-charcoal/20 p-6">
          <h3 className="text-xl mb-4">Add stylist</h3>
          <form onSubmit={addStylist} className="flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-[10px] tracking-[0.2em] uppercase text-charcoal-muted mb-2">
                Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
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
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="stylist@example.com"
                className="w-full"
              />
            </div>
            <button type="submit" className="btn-primary" disabled={adding}>
              {adding ? "Adding…" : "Add"}
            </button>
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
            <div className="border border-charcoal/20">
              <table className="w-full">
                <thead>
                  <tr className="hairline text-[10px] tracking-[0.2em] uppercase text-charcoal-muted">
                    <th className="text-left p-4 font-normal">Stylist</th>
                    <th className="text-left p-4 font-normal">Bank</th>
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
                      <td className="p-4 text-right">
                        <div className="flex gap-2 justify-end">
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
          className="fixed inset-0 bg-charcoal/60 flex items-center justify-center p-6 z-50"
          onClick={() => setLinkModal(null)}
        >
          <div
            className="bg-cream border border-charcoal/30 p-8 max-w-lg w-full"
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
    </div>
  );
}
