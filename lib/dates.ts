// Compute the prior Monday-Sunday week relative to a given date (default: today).
export function priorWeekRange(reference: Date = new Date()): { start: string; end: string } {
  const d = new Date(reference);
  d.setHours(0, 0, 0, 0);
  // getDay: 0=Sun, 1=Mon, ..., 6=Sat
  const day = d.getDay();
  // Days since most recent Monday (if today is Mon, that's today)
  const daysSinceMonday = (day + 6) % 7;
  const thisMonday = new Date(d);
  thisMonday.setDate(d.getDate() - daysSinceMonday);
  const priorMonday = new Date(thisMonday);
  priorMonday.setDate(thisMonday.getDate() - 7);
  const priorSunday = new Date(priorMonday);
  priorSunday.setDate(priorMonday.getDate() + 6);
  return {
    start: toISODate(priorMonday),
    end: toISODate(priorSunday),
  };
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatWeekLabel(start: string, end: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", opts)}, ${e.getFullYear()}`;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

// Given any ISO date (YYYY-MM-DD), return [first day of that month, first day of next month]
// as ISO dates. Used for querying invoices that fall in a given month by week_end.
export function monthRangeContaining(isoDate: string): { monthStart: string; nextMonthStart: string } {
  const [y, m] = isoDate.split("-").map(Number);
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const nextMonthStart = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
  return { monthStart, nextMonthStart };
}
