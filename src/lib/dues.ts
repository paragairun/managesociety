/**
 * Maintenance bills, from the resident's side.
 *
 * Money arithmetic and the wording around it, shared between the
 * website and the native app. Small, but the kind of small that is
 * worth having in one place: two apps disagreeing by a rupee about what
 * somebody owes is the sort of thing that reaches a committee meeting.
 */

export interface Bill {
  id: string;
  total_amount: number;
  amount_paid: number;
  status: string;
  due_date: string;
  billing_period_start: string;
  billing_period_end: string;
  wing: string;
  flat_number: string;
}

/**
 * Rupees, in Indian digit grouping.
 *
 * Paise are shown only when there are any — a bill of exactly 2,500
 * reads as "₹2,500" rather than "₹2,500.00", which is how anyone would
 * write it down, and the decimals only appear where they carry
 * information.
 */
export function money(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * What is still owed on one bill.
 *
 * Floored at zero. An overpayment — a resident rounding up, or a
 * double transfer — leaves amount_paid above total_amount, and a
 * negative "outstanding" would subtract from the other bills in the
 * total and quietly understate what is actually due.
 */
export function outstanding(bill: Pick<Bill, "total_amount" | "amount_paid">): number {
  return Math.max(0, bill.total_amount - bill.amount_paid);
}

/** What is owed across every bill. */
export function totalOutstanding(bills: Pick<Bill, "total_amount" | "amount_paid">[]): number {
  return bills.reduce((sum, b) => sum + outstanding(b), 0);
}

export type DueTone = "paid" | "due" | "late" | "partial";

/**
 * What a bill's state means to the resident, and how urgent it is.
 *
 * `overdue` is taken from the row rather than computed from the due
 * date here. The database decides when a bill turns overdue — there is
 * a job that does it — and a phone with a wrong clock, or one in
 * another timezone, must not disagree with the committee's ledger
 * about whether somebody is late.
 */
export function billState(bill: Pick<Bill, "status" | "total_amount" | "amount_paid">): {
  label: string;
  tone: DueTone;
} {
  switch (bill.status) {
    case "paid":
      return { label: "Paid", tone: "paid" };
    case "partial":
      return { label: "Part paid", tone: "partial" };
    case "overdue":
      return { label: "Overdue", tone: "late" };
    case "unpaid":
      return { label: "Due", tone: "due" };
    default:
      // A status this build does not know still has to render. Showing
      // the raw value beats showing nothing, and beats guessing.
      return { label: bill.status, tone: "due" };
  }
}

/** The billing period as one line: "Apr 2026" or "Apr – Jun 2026". */
export function periodLabel(bill: Pick<Bill, "billing_period_start" | "billing_period_end">): string {
  const start = new Date(bill.billing_period_start);
  const end = new Date(bill.billing_period_end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";

  const month = (d: Date) => d.toLocaleDateString("en-IN", { month: "short" });
  const year = (d: Date) => d.getFullYear();

  if (year(start) === year(end) && month(start) === month(end)) {
    return `${month(start)} ${year(start)}`;
  }
  if (year(start) === year(end)) {
    return `${month(start)} – ${month(end)} ${year(start)}`;
  }
  return `${month(start)} ${year(start)} – ${month(end)} ${year(end)}`;
}

/** Due date as "due 15 Apr", or "" if the date is unreadable. */
export function dueLabel(bill: Pick<Bill, "due_date">): string {
  const d = new Date(bill.due_date);
  if (Number.isNaN(d.getTime())) return "";
  return `due ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
}
