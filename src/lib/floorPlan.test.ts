import { describe, it, expect } from "vitest";
import {
  unitKeyOf, parseUnitKey, positionsIn, positionLabels, positionOf,
  plannedUnitFor, plannedFlats, planCoverage, normalizeUnitPlan, toPlanDrafts,
  duplicateWings,
  type UnitPlan,
} from "./floorPlan";
import { generateFlatNumbers, type NormalizedTower, type NormalizedWing } from "./societyStructure";
import type { UnitType } from "./societyUnits";

const wingA: NormalizedWing = {
  wing: "A", flat_from: 101, flat_to: 304,
  floor_wise: true, flats_per_floor: 4, total_floors: 3,
};
/** A wide prefix: 1001-1006, 2001-2006. */
const wingB: NormalizedWing = {
  wing: "B", flat_from: 1001, flat_to: 2006,
  floor_wise: true, flats_per_floor: 6, total_floors: 2,
};
/** No floors at all — a plain range. */
const wingC: NormalizedWing = {
  wing: "C", flat_from: 1, flat_to: 12, floor_wise: false,
};

const towers: NormalizedTower[] = [
  { tower_name: "T1", wings: [wingA, wingB] },
  { tower_name: "T2", wings: [wingC] },
];

const catalogue: UnitType[] = [
  { name: "2BHK", sizes: [{ sqft: 950 }, { sqft: 980 }] },
  { name: "3BHK", sizes: [{ sqft: 1100 }, { sqft: 1150, label: "corner" }] },
];

const planA: UnitPlan = {
  A: ["2BHK|950", "3BHK|1100", "3BHK|1100", "2BHK|950"],
};

describe("unit keys", () => {
  it("round-trips a type and size", () => {
    expect(parseUnitKey(unitKeyOf("3BHK", 1100))).toEqual({ flat_type: "3BHK", area_sqft: 1100 });
  });

  it("rejects what is not a unit key", () => {
    for (const bad of ["", null, undefined, "3BHK", "3BHK|", "|1100", "3BHK|abc", "3BHK|0", "3BHK|-5"]) {
      expect(parseUnitKey(bad)).toBeNull();
    }
  });
});

describe("positions on a floor", () => {
  it("counts the flats on one floor", () => {
    expect(positionsIn(wingA)).toBe(4);
    expect(positionsIn(wingB)).toBe(6);
  });

  it("gives no plate for a wing entered as a plain range", () => {
    // There is no floor to describe, and guessing where the floors
    // break would put flats on the wrong plate.
    expect(positionsIn(wingC)).toBeNull();
    expect(positionLabels(wingC)).toEqual([]);
  });

  it("labels positions with the first floor's real flat numbers", () => {
    expect(positionLabels(wingA)).toEqual(["101", "102", "103", "104"]);
    expect(positionLabels(wingB)).toEqual(["1001", "1002", "1003", "1004", "1005", "1006"]);
  });
});

describe("positionOf agrees with generateFlatNumbers", () => {
  // The two must agree exactly. A drift of one puts every 2BHK on a
  // 3BHK's bill, for every flat in the society, silently.
  it.each([
    ["A", wingA],
    ["B", wingB],
  ])("recovers the position of every generated flat in wing %s", (_name, wing) => {
    const flats = generateFlatNumbers(wing);
    const perFloor = positionsIn(wing)!;
    flats.forEach((flatNumber, index) => {
      expect(positionOf(wing, flatNumber)).toBe(index % perFloor);
    });
  });

  it("puts the same position on every floor", () => {
    expect(positionOf(wingA, "101")).toBe(0);
    expect(positionOf(wingA, "201")).toBe(0);
    expect(positionOf(wingA, "301")).toBe(0);
    expect(positionOf(wingA, "103")).toBe(2);
    expect(positionOf(wingA, "303")).toBe(2);
  });

  it("returns null for a flat outside the plate", () => {
    expect(positionOf(wingA, "105")).toBeNull();   // past the last position
    expect(positionOf(wingA, "100")).toBeNull();   // before the first
    expect(positionOf(wingA, "abc")).toBeNull();
    expect(positionOf(wingC, "5")).toBeNull();     // no plate at all
  });

  it("handles a wing that does not start at 01", () => {
    const wing: NormalizedWing = {
      wing: "D", flat_from: 105, flat_to: 207,
      floor_wise: true, flats_per_floor: 3, total_floors: 2,
    };
    expect(positionLabels(wing)).toEqual(["105", "106", "107"]);
    expect(positionOf(wing, "105")).toBe(0);
    expect(positionOf(wing, "207")).toBe(2);
    expect(positionOf(wing, "104")).toBeNull();
    expect(positionOf(wing, "208")).toBeNull();
  });
});

describe("plannedUnitFor", () => {
  it("gives every floor the unit its column was given", () => {
    for (const flat of ["102", "202", "302"]) {
      expect(plannedUnitFor(wingA, planA, flat)).toEqual({ flat_type: "3BHK", area_sqft: 1100 });
    }
  });

  it("is silent where the plan is blank", () => {
    const partial: UnitPlan = { A: ["2BHK|950", null, null, null] };
    expect(plannedUnitFor(wingA, partial, "101")).toEqual({ flat_type: "2BHK", area_sqft: 950 });
    expect(plannedUnitFor(wingA, partial, "202")).toBeNull();
  });

  it("is silent for a wing with no plan", () => {
    expect(plannedUnitFor(wingB, planA, "1001")).toBeNull();
  });
});

describe("plannedFlats", () => {
  it("stamps every floor from one floor's plan", () => {
    const flats = plannedFlats(towers, planA);
    // 4 positions x 3 floors
    expect(flats).toHaveLength(12);
    expect(flats[0]).toEqual({ wing: "A", flat_number: "101", flat_type: "2BHK", area_sqft: 950 });
    expect(flats.find((f) => f.flat_number === "303")).toEqual({
      wing: "A", flat_number: "303", flat_type: "3BHK", area_sqft: 1100,
    });
  });

  it("leaves out flats whose position is blank rather than returning a null unit", () => {
    // A row saying "this flat is nothing" is worse than no row: it
    // looks deliberate.
    const partial: UnitPlan = { A: ["2BHK|950", null, null, null] };
    const flats = plannedFlats(towers, partial);
    expect(flats).toHaveLength(3);               // one per floor
    expect(flats.every((f) => f.flat_number.endsWith("01"))).toBe(true);
  });

  it("covers several wings at once", () => {
    const plan: UnitPlan = {
      ...planA,
      B: ["2BHK|980", "2BHK|980", "3BHK|1150", "3BHK|1150", "2BHK|980", "2BHK|980"],
    };
    // A: 4x3 = 12, B: 6x2 = 12
    expect(plannedFlats(towers, plan)).toHaveLength(24);
  });

  it("ignores a wing with no floor plate", () => {
    const plan: UnitPlan = { C: ["2BHK|950"] };
    expect(plannedFlats(towers, plan)).toHaveLength(0);
  });

  it("returns nothing for an empty plan", () => {
    expect(plannedFlats(towers, {})).toEqual([]);
  });
});

describe("planCoverage", () => {
  it("reports a half-filled plan as half filled", () => {
    // The dangerous state: it looks done, applies cleanly, and leaves
    // part of the society unstamped and unbilled.
    const partial: UnitPlan = { A: ["2BHK|950", "3BHK|1100", null, null] };
    const c = planCoverage(towers, partial);
    expect(c.total).toBe(10);        // A 4 + B 6
    expect(c.filled).toBe(2);
    expect(c.flatsCovered).toBe(6);  // 2 positions x 3 floors
  });

  it("names wings that have no plate to plan", () => {
    expect(planCoverage(towers, {}).wingsWithoutFloors).toEqual(["C"]);
  });

  it("counts a complete plan as complete", () => {
    const plan: UnitPlan = {
      ...planA,
      B: Array(6).fill("2BHK|980"),
    };
    const c = planCoverage(towers, plan);
    expect(c.filled).toBe(c.total);
    expect(c.flatsCovered).toBe(24);
  });
});

describe("normalizeUnitPlan", () => {
  it("accepts a plan drawn from the catalogue", () => {
    const result = normalizeUnitPlan(towers, planA, catalogue);
    expect("plan" in result && result.plan.A).toEqual(["2BHK|950", "3BHK|1100", "3BHK|1100", "2BHK|950"]);
  });

  it("refuses a size the society does not have, naming the flat", () => {
    // The catalogue is the authority. A plan naming an unknown size
    // would stamp flats that then fall out of every per-unit charge —
    // the exact failure the catalogue exists to prevent.
    const result = normalizeUnitPlan(towers, { A: ["2BHK|999", null, null, null] }, catalogue);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("999");
      expect(result.error).toContain("101");   // the flat, not "position 1"
      expect(result.error).toContain("A");
    }
  });

  it("refuses a type the society does not have", () => {
    const result = normalizeUnitPlan(towers, { A: ["5BHK|1100", null, null, null] }, catalogue);
    expect("error" in result).toBe(true);
  });

  it("refuses a malformed entry", () => {
    const result = normalizeUnitPlan(towers, { A: ["nonsense", null, null, null] }, catalogue);
    expect("error" in result).toBe(true);
  });

  it("trims entries past the end of a narrowed floor plate", () => {
    // Kept, they are invisible rows that reappear as surprise
    // assignments if the plate is ever widened again.
    const result = normalizeUnitPlan(
      towers,
      { A: ["2BHK|950", "2BHK|950", "2BHK|950", "2BHK|950", "3BHK|1100", "3BHK|1100"] },
      catalogue,
    );
    expect("plan" in result && result.plan.A).toHaveLength(4);
  });

  it("drops a wing the structure no longer has", () => {
    const result = normalizeUnitPlan(towers, { Z: ["2BHK|950"] }, catalogue);
    expect("plan" in result && Object.keys(result.plan)).toEqual([]);
  });

  it("drops a wing with no floor plate", () => {
    const result = normalizeUnitPlan(towers, { C: ["2BHK|950"] }, catalogue);
    expect("plan" in result && result.plan.C).toBeUndefined();
  });

  it("stores nothing for a wing left entirely blank", () => {
    const result = normalizeUnitPlan(towers, { A: [null, null, null, null] }, catalogue);
    expect("plan" in result && Object.keys(result.plan)).toEqual([]);
  });

  it("keeps a partly filled wing, padded to its full width", () => {
    const result = normalizeUnitPlan(towers, { A: ["2BHK|950"] }, catalogue);
    expect("plan" in result && result.plan.A).toEqual(["2BHK|950", null, null, null]);
  });

  it("an empty plan is valid, not an error", () => {
    const result = normalizeUnitPlan(towers, {}, catalogue);
    expect("plan" in result && result.plan).toEqual({});
  });
});

describe("toPlanDrafts", () => {
  it("gives every floor-wise wing a full-width row", () => {
    const drafts = toPlanDrafts(towers, {});
    expect(drafts.A).toEqual([null, null, null, null]);
    expect(drafts.B).toHaveLength(6);
  });

  it("widens a short stored plan without losing what it holds", () => {
    const drafts = toPlanDrafts(towers, { A: ["3BHK|1100"] });
    expect(drafts.A).toEqual(["3BHK|1100", null, null, null]);
  });

  it("leaves out a wing with no floor plate", () => {
    expect(toPlanDrafts(towers, {}).C).toBeUndefined();
  });
});

describe("the round trip a committee actually makes", () => {
  it("plans one floor, applies it, and every flat has a billable unit", () => {
    const normalized = normalizeUnitPlan(towers, toPlanDrafts(towers, planA), catalogue);
    expect("plan" in normalized).toBe(true);
    if (!("plan" in normalized)) return;

    const flats = plannedFlats(towers, normalized.plan);
    expect(flats).toHaveLength(12);
    // Every stamped flat is one the catalogue knows, which is what
    // keeps it inside the per-unit charges.
    for (const f of flats) {
      const sizes = catalogue.find((t) => t.name === f.flat_type)?.sizes ?? [];
      expect(sizes.some((s) => s.sqft === f.area_sqft)).toBe(true);
    }
  });
});

describe("a wing name that appears in more than one tower", () => {
  // normalizeStructure refuses to create these now, but a structure
  // saved before that rule is read straight out of the database. The
  // plan is keyed by wing name, so a repeat would stamp one tower's
  // unit types onto another tower's flats and bill them for it.
  const ambiguous: NormalizedTower[] = [
    { tower_name: "T1", wings: [{ ...wingA }] },
    { tower_name: "T2", wings: [{ ...wingA, total_floors: 9 }] },
  ];

  it("is detected", () => {
    expect(duplicateWings(ambiguous)).toEqual(["A"]);
    expect(duplicateWings(towers)).toEqual([]);
  });

  it("is refused by normalizeUnitPlan, naming the wing", () => {
    const result = normalizeUnitPlan(ambiguous, planA, catalogue);
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("A");
  });

  it("stamps nothing, rather than stamping the wrong tower", () => {
    expect(plannedFlats(ambiguous, planA)).toEqual([]);
  });
});
