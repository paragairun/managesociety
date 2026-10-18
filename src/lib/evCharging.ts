/**
 * EV charging: the arithmetic and the payment link.
 *
 * Pure functions only, so the money logic can be tested without a
 * browser, a charger or a database. The database holds the same rules
 * in ev_energy_budget() and the session triggers; a test asserts the
 * two agree, because a disagreement means the charger stops at a
 * different point from the one the bill is calculated against.
 */

export type VehicleType = "four_wheeler" | "two_wheeler";

export type SessionStatus =
  | "awaiting_payment"
  | "awaiting_approval"
  | "authorized"
  | "charging"
  | "completed"
  | "cancelled"
  | "failed";

export interface EvSettings {
  rate_per_kwh: number;
  min_amount: number;
  max_amount: number;
  payment_window_mins: number;
  auto_confirm_enabled: boolean;
  require_charger_auth: boolean;
  upi_vpa?: string | null;
  upi_payee_name?: string | null;
}

export interface Charger {
  id: string;
  name: string;
  location: string | null;
  vehicle_type: VehicleType;
  connector_type: string | null;
  power_kw: number | null;
  status: string;
  last_seen_at: string | null;
  is_active: boolean;
  is_secured?: boolean;
}

export const VEHICLE_LABEL: Record<VehicleType, string> = {
  four_wheeler: "4-wheeler",
  two_wheeler: "2-wheeler",
};

/**
 * Energy a given spend buys, in kWh.
 *
 * Rounded DOWN to the watt-hour, matching public.ev_energy_budget().
 * Rounding up would sell marginally more energy than was paid for, and
 * the charger would be stopped by a figure the bill never charged for.
 */
export function energyBudgetKwh(amount: number, ratePerKwh: number): number | null {
  if (!Number.isFinite(amount) || !Number.isFinite(ratePerKwh) || ratePerKwh <= 0) return null;
  return Math.floor((amount / ratePerKwh) * 1000) / 1000;
}

/** Cost of energy delivered, matching public.ev_session_cost(). */
export function sessionCost(kwh: number, ratePerKwh: number): number | null {
  if (!Number.isFinite(kwh) || !Number.isFinite(ratePerKwh)) return null;
  return Math.round(kwh * ratePerKwh * 100) / 100;
}

/**
 * How a chosen spend splits between credit and cash.
 *
 * The resident picks a total. Credit is applied first, automatically.
 * This mirrors the ev_guard_resident_session_insert() trigger, which
 * is the authority — the client shows the split, the database decides
 * it. Shown here so the resident knows what they will be asked to pay
 * before they commit.
 */
export function splitWithCredit(total: number, creditBalance: number): {
  creditApplied: number; cashToPay: number;
} {
  const t = Number.isFinite(total) ? Math.max(0, total) : 0;
  const b = Number.isFinite(creditBalance) ? Math.max(0, creditBalance) : 0;
  const creditApplied = Math.min(b, t);
  return {
    creditApplied: Math.round(creditApplied * 100) / 100,
    cashToPay: Math.round((t - creditApplied) * 100) / 100,
  };
}

/** Why an amount is not acceptable, or null when it is. */
export function validateAmount(amount: number, settings: Pick<EvSettings, "min_amount" | "max_amount">): string | null {
  if (!Number.isFinite(amount)) return "Enter an amount";
  if (amount < settings.min_amount) return `Minimum is ₹${settings.min_amount}`;
  if (amount > settings.max_amount) return `Maximum is ₹${settings.max_amount}`;
  return null;
}

/**
 * A UPI payment link with the amount already filled in.
 *
 * Scanning this opens the resident's UPI app with the payee and the
 * exact amount set, so they cannot mistype it. It is NOT a payment
 * gateway: UPI gives no callback, so the session is still confirmed by
 * matching the UTR against the bank's credit alert, or by a guard
 * approving it. All this removes is the wrong-amount class of error.
 *
 * Returns null when no VPA is configured, so the UI can say "ask the
 * admin to set the UPI ID" instead of rendering a QR that goes nowhere.
 */
export function upiPaymentLink(opts: {
  vpa: string | null | undefined;
  payeeName?: string | null;
  amount: number;
  note?: string;
}): string | null {
  const vpa = (opts.vpa || "").trim();
  // A UPI id is user@handle. Refusing an obviously malformed one is
  // better than generating a QR that silently fails at the bank.
  if (!/^[\w.\-_]{2,}@[a-zA-Z]{2,}$/.test(vpa)) return null;
  if (!Number.isFinite(opts.amount) || opts.amount <= 0) return null;

  const params = new URLSearchParams();
  params.set("pa", vpa);
  if (opts.payeeName) params.set("pn", opts.payeeName.trim());
  params.set("am", opts.amount.toFixed(2));
  params.set("cu", "INR");
  if (opts.note) {
    // UPI remark fields are short and reject punctuation on some apps.
    params.set("tn", opts.note.replace(/[^\w \-]/g, "").slice(0, 50));
  }
  return `upi://pay?${params.toString()}`;
}

/**
 * A UTR is the bank's reference for one transfer. Twelve digits is the
 * NPCI format; some apps show it with spaces or an "UTR:" prefix.
 */
export function normaliseUtr(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (cleaned.length < 10 || cleaned.length > 22) return null;
  return cleaned;
}

export function validateUtr(raw: string): string | null {
  if (!raw || !raw.trim()) return "Enter the UTR from your payment app";
  if (!normaliseUtr(raw)) return "That does not look like a UTR — it is usually 12 digits";
  return null;
}

/** What the resident is told a session is doing. */
export const STATUS_LABEL: Record<SessionStatus, string> = {
  awaiting_payment: "Waiting for payment",
  awaiting_approval: "Checking your payment",
  authorized: "Ready — plug in",
  charging: "Charging",
  completed: "Finished",
  cancelled: "Cancelled",
  failed: "Failed",
};

export function isSessionOpen(status: SessionStatus): boolean {
  return ["awaiting_payment", "awaiting_approval", "authorized", "charging"].includes(status);
}

/** Can a resident still start a session on this charger? */
export function isChargerAvailable(c: Charger): boolean {
  if (!c.is_active) return false;
  return ["Available", "Preparing", "Unknown"].includes(c.status);
}

/**
 * Minutes until an unpaid session is abandoned, or null once it no
 * longer applies. Negative means the window has passed.
 */
export function minutesLeftToPay(
  createdAt: string, windowMins: number, now: number = Date.now(),
): number | null {
  const t = Date.parse(createdAt);
  if (Number.isNaN(t) || !Number.isFinite(windowMins)) return null;
  return Math.ceil((t + windowMins * 60000 - now) / 60000);
}

/** Progress through the paid-for energy, 0..1. */
export function chargeProgress(kwhConsumed: number | null, budgetKwh: number | null): number {
  if (!Number.isFinite(kwhConsumed as number) || !Number.isFinite(budgetKwh as number)) return 0;
  const b = budgetKwh as number;
  if (b <= 0) return 0;
  return Math.min(1, Math.max(0, (kwhConsumed as number) / b));
}

export const formatKwh = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${Number(v).toFixed(2)} kWh`;

export const formatRupees = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `₹${Number(v).toFixed(2)}`;
