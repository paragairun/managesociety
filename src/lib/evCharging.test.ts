import { describe, it, expect } from "vitest";
import {
  energyBudgetKwh, sessionCost, splitWithCredit, validateAmount,
  upiPaymentLink, normaliseUtr, validateUtr, isSessionOpen,
  isChargerAvailable, minutesLeftToPay, chargeProgress,
  formatKwh, formatRupees, type Charger,
} from "./evCharging";

const SETTINGS = { min_amount: 20, max_amount: 1000 };

describe("energy budget", () => {
  it("buys what was paid for at the tariff", () => {
    expect(energyBudgetKwh(100, 10)).toBe(10);
    expect(energyBudgetKwh(50, 10)).toBe(5);
  });

  it("rounds DOWN, never selling more energy than was paid for", () => {
    // 20 / 12.5 = 1.6 exactly; 999 / 7.25 = 137.7931... must not round up.
    expect(energyBudgetKwh(999, 7.25)).toBe(137.793);
  });

  it("matches the database's ev_energy_budget for the same inputs", () => {
    // floor(amount/rate * 1000)/1000. If these diverged, the charger
    // would stop at a different point from the bill.
    const db = (a: number, r: number) => Math.floor((a / r) * 1000) / 1000;
    for (const [a, r] of [[100, 10], [20, 12.5], [999, 7.25], [37, 9.99], [500, 3]]) {
      expect(energyBudgetKwh(a, r)).toBe(db(a, r));
    }
  });

  it("refuses nonsense rather than returning a wrong number", () => {
    expect(energyBudgetKwh(100, 0)).toBeNull();
    expect(energyBudgetKwh(100, -5)).toBeNull();
    expect(energyBudgetKwh(NaN, 10)).toBeNull();
  });
});

describe("session cost", () => {
  it("bills energy at the tariff, to the paisa", () => {
    expect(sessionCost(6.5, 10)).toBe(65);
    expect(sessionCost(7.777, 12.5)).toBe(97.21);
  });
  it("is zero for no energy, not null", () => {
    expect(sessionCost(0, 10)).toBe(0);
  });
});

describe("credit split", () => {
  it("applies credit first and asks for the rest in cash", () => {
    expect(splitWithCredit(100, 35)).toEqual({ creditApplied: 35, cashToPay: 65 });
  });

  it("asks for nothing when credit covers the whole amount", () => {
    expect(splitWithCredit(30, 50)).toEqual({ creditApplied: 30, cashToPay: 0 });
  });

  it("never applies more credit than exists", () => {
    expect(splitWithCredit(100, 0)).toEqual({ creditApplied: 0, cashToPay: 100 });
  });

  it("treats a negative balance as zero rather than inflating the bill", () => {
    expect(splitWithCredit(100, -50)).toEqual({ creditApplied: 0, cashToPay: 100 });
  });

  it("agrees with the database trigger's least(greatest(balance,0), total)", () => {
    const dbSplit = (t: number, b: number) => {
      const use = Math.min(Math.max(b, 0), t);
      return { creditApplied: use, cashToPay: t - use };
    };
    for (const [t, b] of [[100, 35], [30, 50], [100, 0], [100, -5], [20, 20]]) {
      expect(splitWithCredit(t, b)).toEqual(dbSplit(t, b));
    }
  });
});

describe("amount validation", () => {
  it("accepts an amount inside the configured range", () => {
    expect(validateAmount(100, SETTINGS)).toBeNull();
    expect(validateAmount(20, SETTINGS)).toBeNull();
    expect(validateAmount(1000, SETTINGS)).toBeNull();
  });
  it("rejects outside it, naming the limit", () => {
    expect(validateAmount(5, SETTINGS)).toMatch(/Minimum is ₹20/);
    expect(validateAmount(5000, SETTINGS)).toMatch(/Maximum is ₹1000/);
  });
  it("rejects a blank or unparseable amount", () => {
    expect(validateAmount(NaN, SETTINGS)).toBe("Enter an amount");
  });
});

describe("UPI payment link", () => {
  it("puts the payee and the exact amount in the link", () => {
    const link = upiPaymentLink({
      vpa: "triumphtowerschs06@mdcb", payeeName: "Triumph Towers CHS Ltd",
      amount: 65, note: "EV charging",
    })!;
    expect(link.startsWith("upi://pay?")).toBe(true);
    const q = new URLSearchParams(link.split("?")[1]);
    expect(q.get("pa")).toBe("triumphtowerschs06@mdcb");
    expect(q.get("am")).toBe("65.00");
    expect(q.get("cu")).toBe("INR");
    expect(q.get("pn")).toBe("Triumph Towers CHS Ltd");
  });

  it("always sends two decimal places, which some UPI apps require", () => {
    const q = new URLSearchParams(
      upiPaymentLink({ vpa: "society@mdcb", amount: 65 })!.split("?")[1]);
    expect(q.get("am")).toBe("65.00");
  });

  it("strips punctuation from the note that some apps reject", () => {
    const q = new URLSearchParams(
      upiPaymentLink({ vpa: "society@mdcb", amount: 10, note: "EV #42 (A1) — charge!" })!.split("?")[1]);
    expect(q.get("tn")).toBe("EV 42 A1  charge");
  });

  it("returns null when no VPA is configured, so the UI can say so", () => {
    // Rendering a QR that goes nowhere is worse than rendering none.
    expect(upiPaymentLink({ vpa: null, amount: 100 })).toBeNull();
    expect(upiPaymentLink({ vpa: "", amount: 100 })).toBeNull();
    expect(upiPaymentLink({ vpa: "   ", amount: 100 })).toBeNull();
  });

  it("rejects a malformed UPI id rather than encoding it", () => {
    for (const bad of ["notaupiid", "@mdcb", "user@", "user@1", "a b@mdcb"]) {
      expect(upiPaymentLink({ vpa: bad, amount: 100 }), bad).toBeNull();
    }
  });

  it("refuses a zero or negative amount", () => {
    expect(upiPaymentLink({ vpa: "society@mdcb", amount: 0 })).toBeNull();
    expect(upiPaymentLink({ vpa: "society@mdcb", amount: -5 })).toBeNull();
  });
});

describe("UTR handling", () => {
  it("accepts a plain 12-digit reference", () => {
    expect(normaliseUtr("426512345678")).toBe("426512345678");
  });
  it("strips spaces and prefixes people paste in", () => {
    expect(normaliseUtr(" 4265 1234 5678 ")).toBe("426512345678");
    expect(normaliseUtr("UTR: 426512345678")).toBe("UTR426512345678");
  });
  it("rejects something far too short to be a UTR", () => {
    expect(normaliseUtr("123")).toBeNull();
    expect(validateUtr("123")).toMatch(/does not look like/);
  });
  it("asks for one when it is blank", () => {
    expect(validateUtr("")).toMatch(/Enter the UTR/);
    expect(validateUtr("   ")).toMatch(/Enter the UTR/);
  });
  it("accepts a valid one", () => {
    expect(validateUtr("426512345678")).toBeNull();
  });
});

describe("charger availability", () => {
  const charger = (over: Partial<Charger> = {}): Charger => ({
    id: "c1", name: "A1", location: null, vehicle_type: "four_wheeler",
    connector_type: null, power_kw: 7.4, status: "Available",
    last_seen_at: null, is_active: true, ...over,
  });

  it("is available when active and idle", () => {
    expect(isChargerAvailable(charger())).toBe(true);
    expect(isChargerAvailable(charger({ status: "Preparing" }))).toBe(true);
  });

  it("is not available when busy, faulted or deactivated", () => {
    expect(isChargerAvailable(charger({ status: "Charging" }))).toBe(false);
    expect(isChargerAvailable(charger({ status: "Faulted" }))).toBe(false);
    expect(isChargerAvailable(charger({ status: "Unavailable" }))).toBe(false);
    expect(isChargerAvailable(charger({ is_active: false }))).toBe(false);
  });

  it("treats a charger that has never reported as available", () => {
    // A newly registered unit has status Unknown until it boots. Hiding
    // it would make a working charger invisible.
    expect(isChargerAvailable(charger({ status: "Unknown" }))).toBe(true);
  });
});

describe("session state", () => {
  it("knows which statuses are still live", () => {
    for (const s of ["awaiting_payment", "awaiting_approval", "authorized", "charging"] as const) {
      expect(isSessionOpen(s)).toBe(true);
    }
    for (const s of ["completed", "cancelled", "failed"] as const) {
      expect(isSessionOpen(s)).toBe(false);
    }
  });
});

describe("payment window", () => {
  const t0 = Date.parse("2026-10-18T10:00:00Z");
  it("counts down from creation", () => {
    expect(minutesLeftToPay("2026-10-18T10:00:00Z", 15, t0)).toBe(15);
    expect(minutesLeftToPay("2026-10-18T10:00:00Z", 15, t0 + 10 * 60000)).toBe(5);
  });
  it("goes negative once the window has passed", () => {
    expect(minutesLeftToPay("2026-10-18T10:00:00Z", 15, t0 + 20 * 60000)).toBeLessThan(0);
  });
  it("returns null for an unparseable timestamp rather than NaN on screen", () => {
    expect(minutesLeftToPay("rubbish", 15, t0)).toBeNull();
  });
});

describe("progress and formatting", () => {
  it("reports progress through the paid energy", () => {
    expect(chargeProgress(5, 10)).toBe(0.5);
    expect(chargeProgress(0, 10)).toBe(0);
  });
  it("never exceeds 1, even if the meter overshoots", () => {
    expect(chargeProgress(12, 10)).toBe(1);
  });
  it("is 0 rather than NaN when there is nothing to show", () => {
    expect(chargeProgress(null, 10)).toBe(0);
    expect(chargeProgress(5, null)).toBe(0);
    expect(chargeProgress(5, 0)).toBe(0);
  });
  it("formats blanks as a dash rather than NaN or undefined", () => {
    expect(formatKwh(null)).toBe("—");
    expect(formatRupees(undefined)).toBe("—");
    expect(formatKwh(6.5)).toBe("6.50 kWh");
    expect(formatRupees(65)).toBe("₹65.00");
  });
});
