import { describe, it, expect } from "vitest";
import { money, outstanding, totalOutstanding, billState, periodLabel, dueLabel } from "./dues";

describe("money", () => {
  it("groups the Indian way", () => {
    // 1,50,000 — not 150,000. A resident reading a figure in the wrong
    // grouping has to stop and count digits.
    expect(money(150000)).toBe("₹1,50,000");
    expect(money(2500)).toBe("₹2,500");
  });

  it("shows paise only when there are any", () => {
    expect(money(2500)).toBe("₹2,500");
    expect(money(2500.5)).toBe("₹2,500.5");
    expect(money(2500.75)).toBe("₹2,500.75");
  });

  it("handles zero", () => {
    expect(money(0)).toBe("₹0");
  });
});

describe("outstanding", () => {
  it("is what is left to pay", () => {
    expect(outstanding({ total_amount: 2500, amount_paid: 1000 })).toBe(1500);
    expect(outstanding({ total_amount: 2500, amount_paid: 2500 })).toBe(0);
  });

  it("never goes negative on an overpayment", () => {
    // A resident rounding up, or a double transfer. A negative here
    // would subtract from the other bills in the total and quietly
    // understate what is actually due.
    expect(outstanding({ total_amount: 2500, amount_paid: 3000 })).toBe(0);
  });

  it("sums across bills without letting one overpayment hide another", () => {
    expect(totalOutstanding([
      { total_amount: 2500, amount_paid: 3000 },  // overpaid by 500
      { total_amount: 2500, amount_paid: 0 },     // fully due
    ])).toBe(2500);
  });

  it("is zero for no bills", () => {
    expect(totalOutstanding([])).toBe(0);
  });
});

describe("billState", () => {
  const bill = (status: string) => ({ status, total_amount: 2500, amount_paid: 0 });

  it("names each state the resident can be in", () => {
    expect(billState(bill("paid"))).toEqual({ label: "Paid", tone: "paid" });
    expect(billState(bill("partial"))).toEqual({ label: "Part paid", tone: "partial" });
    expect(billState(bill("overdue"))).toEqual({ label: "Overdue", tone: "late" });
    expect(billState(bill("unpaid"))).toEqual({ label: "Due", tone: "due" });
  });

  it("takes overdue from the row, not from the clock", () => {
    // The database decides when a bill turns overdue. A phone with a
    // wrong clock, or one in another timezone, must not disagree with
    // the committee's ledger about whether somebody is late.
    expect(billState(bill("unpaid")).tone).toBe("due");
    expect(billState(bill("overdue")).tone).toBe("late");
  });

  it("renders a status it does not know rather than nothing", () => {
    expect(billState(bill("written_off"))).toEqual({ label: "written_off", tone: "due" });
  });
});

describe("periodLabel", () => {
  it("collapses a single month", () => {
    expect(periodLabel({
      billing_period_start: "2026-04-01", billing_period_end: "2026-04-30",
    })).toBe("Apr 2026");
  });

  it("shows a range inside one year", () => {
    expect(periodLabel({
      billing_period_start: "2026-04-01", billing_period_end: "2026-06-30",
    })).toBe("Apr – Jun 2026");
  });

  it("names both years when a period crosses one", () => {
    expect(periodLabel({
      billing_period_start: "2025-12-01", billing_period_end: "2026-02-28",
    })).toBe("Dec 2025 – Feb 2026");
  });

  it("returns empty rather than 'Invalid Date'", () => {
    expect(periodLabel({ billing_period_start: "", billing_period_end: "" })).toBe("");
    expect(periodLabel({ billing_period_start: "nonsense", billing_period_end: "2026-04-30" })).toBe("");
  });
});

describe("dueLabel", () => {
  it("reads as a date a person would say", () => {
    expect(dueLabel({ due_date: "2026-04-15" })).toBe("due 15 Apr");
  });

  it("returns empty rather than 'Invalid Date'", () => {
    expect(dueLabel({ due_date: "" })).toBe("");
  });
});
