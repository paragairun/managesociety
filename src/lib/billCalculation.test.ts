import { describe, it, expect } from "vitest";
import {
  billForFlat, billRun, describeCharge,
  type ChargeHead, type FlatForBilling,
} from "./billCalculation";

const heads: ChargeHead[] = [
  { id: "h1", name: "Lift & security", calculation_type: "per_unit_type", rate: 0,
    unit_rates: { "2BHK": 1200, "3BHK": 1800 } },
  { id: "h2", name: "Sinking fund", calculation_type: "per_sqft", rate: 2 },
  { id: "h3", name: "Festival fund", calculation_type: "fixed", rate: 250 },
];

const flat = (over: Partial<FlatForBilling> = {}): FlatForBilling => ({
  id: "f1", flat_number: "1201", wing: "A", flat_type: "3BHK", area_sqft: 1050, ...over,
});

describe("one flat's bill", () => {
  it("adds all three kinds of charge", () => {
    const bill = billForFlat(flat(), heads);
    expect(bill.lines.map((l) => l.amount)).toEqual([1800, 2100, 250]);
    expect(bill.total).toBe(4150);
    expect(bill.skipped).toEqual([]);
  });

  it("charges a 2BHK its own rate, not the 3BHK one", () => {
    // The whole point of the unit catalogue.
    const bill = billForFlat(flat({ flat_type: "2BHK", area_sqft: 535 }), heads);
    expect(bill.lines[0].amount).toBe(1200);
    expect(bill.lines[1].amount).toBe(1070);
    expect(bill.total).toBe(2520);
  });

  it("shows the working in each line", () => {
    // A resident disputing a bill is disputing these lines, and
    // "₹2,100" with no explanation invites a phone call.
    const bill = billForFlat(flat(), heads);
    expect(bill.lines[0].description).toBe("Lift & security (3BHK)");
    expect(bill.lines[1].description).toBe("Sinking fund (1050 sq ft × ₹2)");
    expect(bill.lines[2].description).toBe("Festival fund");
  });

  it("skips inactive heads entirely", () => {
    const bill = billForFlat(flat(), [...heads, {
      id: "h4", name: "Old levy", calculation_type: "fixed", rate: 999, is_active: false,
    }]);
    expect(bill.total).toBe(4150);
    expect(bill.skipped).toEqual([]);
  });

  it("includes a zero rate as a line rather than omitting it", () => {
    // "Security: ₹0" is information. A missing line is a question.
    const bill = billForFlat(flat(), [
      { id: "z", name: "Security", calculation_type: "fixed", rate: 0 },
    ]);
    expect(bill.lines).toHaveLength(1);
    expect(bill.lines[0].amount).toBe(0);
  });
});

describe("what cannot be charged is REPORTED, not dropped", () => {
  it("flags a flat with no unit type", () => {
    // On a 200-flat society this is a hole in the month's collection
    // that is invisible in a total.
    const bill = billForFlat(flat({ flat_type: null }), heads);
    expect(bill.skipped).toEqual([
      { head_id: "h1", head_name: "Lift & security", reason: "no unit type assigned to this flat" },
    ]);
    // The other two still apply.
    expect(bill.total).toBe(2350);
  });

  it("flags a flat with no area", () => {
    const bill = billForFlat(flat({ area_sqft: 0 }), heads);
    expect(bill.skipped[0].reason).toBe("no area recorded for this flat");
    expect(bill.total).toBe(2050);
  });

  it("flags a unit type with no rate, without treating it as an error", () => {
    // A lift charge may genuinely not apply to a ground-floor shop. The
    // committee says so by leaving it out of the map — but it is still
    // reported, so the one that was an oversight is visible too.
    const bill = billForFlat(flat({ flat_type: "Shop", area_sqft: 400 }), heads);
    expect(bill.skipped[0].reason).toBe("no rate set for Shop");
    expect(bill.total).toBe(1050);
  });

  it("flags a rate that is not a number", () => {
    const bill = billForFlat(flat(), [{
      id: "bad", name: "Broken", calculation_type: "per_unit_type", rate: 0,
      unit_rates: { "3BHK": Number.NaN },
    }]);
    expect(bill.skipped[0].reason).toContain("not a number");
  });

  it("tolerates a per_unit_type head with no rate map at all", () => {
    const bill = billForFlat(flat(), [{
      id: "empty", name: "Unset", calculation_type: "per_unit_type", rate: 0,
    }]);
    expect(bill.lines).toEqual([]);
    expect(bill.skipped[0].reason).toContain("no rate set");
  });
});

describe("a whole run", () => {
  const flats: FlatForBilling[] = [
    flat({ id: "a", flat_number: "101", flat_type: "2BHK", area_sqft: 500 }),
    flat({ id: "b", flat_number: "102", flat_type: "3BHK", area_sqft: 1000 }),
    flat({ id: "c", flat_number: "103", flat_type: null, area_sqft: 1000 }),
  ];

  it("totals every flat", () => {
    const run = billRun(flats, heads);
    // 2BHK: 1200 + 1000 + 250 = 2450
    // 3BHK: 1800 + 2000 + 250 = 4050
    // no unit:       2000 + 250 = 2250
    expect(run.bills.map((b) => b.total)).toEqual([2450, 4050, 2250]);
    expect(run.total).toBe(8750);
  });

  it("names the flats that did not add up, for a pre-issue check", () => {
    const run = billRun(flats, heads);
    expect(run.withProblems).toEqual([
      { flat_id: "c", flat_label: "A-103",
        reasons: ["Lift & security: no unit type assigned to this flat"] },
    ]);
  });

  it("reports nothing when every flat is complete", () => {
    expect(billRun(flats.slice(0, 2), heads).withProblems).toEqual([]);
  });

  it("de-duplicates repeated reasons on one flat", () => {
    const twoUnitHeads: ChargeHead[] = [
      { id: "x", name: "A", calculation_type: "per_unit_type", rate: 0, unit_rates: {} },
      { id: "y", name: "B", calculation_type: "per_unit_type", rate: 0, unit_rates: {} },
    ];
    const run = billRun([flat({ flat_type: null })], twoUnitHeads);
    expect(run.withProblems[0].reasons).toHaveLength(2);
  });

  it("handles a society with no flats or no heads", () => {
    expect(billRun([], heads).total).toBe(0);
    expect(billRun(flats, []).total).toBe(0);
  });
});

describe("describing a charge for the admin form", () => {
  it("says how each kind is worked out", () => {
    expect(describeCharge(heads[0])).toBe("2BHK ₹1200 · 3BHK ₹1800");
    expect(describeCharge(heads[1])).toBe("₹2 per sq ft");
    expect(describeCharge(heads[2])).toBe("₹250 for every flat");
  });

  it("says so when no rates are set yet", () => {
    expect(describeCharge({
      id: "n", name: "New", calculation_type: "per_unit_type", rate: 0, unit_rates: {},
    })).toBe("No rates set yet");
  });
});
