// Money and date helpers used everywhere in the app.
// Currency: INR with Indian digit grouping (₹1,23,456.50).
// Dates: DD-MM-YYYY, timezone Asia/Kolkata.

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatINR(amount: number | string | null | undefined): string {
  const n = Number(amount ?? 0);
  return inr.format(Number.isFinite(n) ? n : 0);
}

// Compact form without paise for dashboards: ₹1,23,456
export function formatINRShort(amount: number | string | null | undefined): string {
  const n = Number(amount ?? 0);
  return "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(
    Number.isFinite(n) ? n : 0
  );
}

// "2026-07-08" or a Date → "08-07-2026"
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  // Plain calendar dates ("YYYY-MM-DD") are timezone-free: just reorder
  // the parts instead of parsing, so the day never shifts.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}-${m}-${y}`;
  }
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")}`;
}

// Timestamp → "08-07-2026, 3:45 pm" in shop's timezone.
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d).replace(",", ",");
}

// Today's date in Asia/Kolkata as "YYYY-MM-DD" (for DB queries and <input type=date>).
export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

// First day of the current month in Asia/Kolkata as "YYYY-MM-DD".
export function monthStartISO(): string {
  return todayISO().slice(0, 8) + "01";
}
