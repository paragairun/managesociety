import { describe, it, expect } from "vitest";
import {
  normalizeUnitTypes, toUnitTypeDrafts, sizesFor, sizeLabel, unitLabel,
  isKnownUnit, allSizes, emptyUnitType,
  type UnitType, type UnitTypeDraft,
} from "./societyUnits";

const draft = (name: string, sizes: (string | [string, string])[]): UnitTypeDraft => ({
  name,
  sizes: sizes.map((s) => (Array.isArray(s)
    ? { sqft: s[0], label: s[1] }
    : { sqft: s, label: "" })),
});

const catalogue: UnitType[] = [
  { name: "2BHK", sizes: [{ sqft: 500 }, { sqft: 535 }, { sqft: 542 }] },
  { name: "3BHK", sizes: [{ sqft: 1000 }, { sqft: 1050 }, { sqft: 1100, label: "corner" }] },
];

describe("normalising a typed catalogue", () => {
  it("accepts a society's real shape", () => {
    const result = normalizeUnitTypes([
      draft("2BHK", ["500", "535", "542"]),
      draft("3BHK", ["1000", "1050", ["1100", "corner"]]),
    ]);
    expect(result).toEqual({ unitTypes: catalogue });
  });

  it("sorts sizes ascending, however they were typed", () => {
    const result = normalizeUnitTypes([draft("3BHK", ["1100", "1000", "1050"])]);
    expect("unitTypes" in result && result.unitTypes[0].sizes.map((s) => s.sqft))
      .toEqual([1000, 1050, 1100]);
  });

  it("ignores a blank size row, which is one being added", () => {
    const result = normalizeUnitTypes([draft("2BHK", ["500", "", "535"])]);
    expect("unitTypes" in result && result.unitTypes[0].sizes).toHaveLength(2);
  });

  it("drops an empty label rather than storing one", () => {
    const result = normalizeUnitTypes([draft("2BHK", [["500", "  "]])]);
    expect("unitTypes" in result && result.unitTypes[0].sizes[0]).toEqual({ sqft: 500 });
  });

  it("needs a name", () => {
    expect(normalizeUnitTypes([draft("", ["500"])]))
      .toEqual({ error: "Give every unit type a name, or remove it." });
  });

  it("needs at least one size", () => {
    expect(normalizeUnitTypes([draft("2BHK", [])]))
      .toEqual({ error: "Add at least one size for 2BHK, or remove the unit type." });
    expect(normalizeUnitTypes([draft("2BHK", ["  "])]))
      .toEqual({ error: "Add at least one size for 2BHK, or remove the unit type." });
  });

  it("refuses a duplicate unit type, naming it", () => {
    // Two "3BHK" entries would split the same flats across two
    // catalogue rows and bill them differently.
    const result = normalizeUnitTypes([draft("3BHK", ["1000"]), draft("3bhk", ["1050"])]);
    expect("error" in result && result.error).toContain("3bhk");
    expect("error" in result && result.error).toContain("twice");
  });

  it("refuses a duplicate size within a type", () => {
    expect(normalizeUnitTypes([draft("2BHK", ["500", "500"])]))
      .toEqual({ error: "2BHK has 500 sq ft listed twice." });
  });

  it("rejects a size that is not a number", () => {
    // "1O50" with a letter O is the classic one.
    const result = normalizeUnitTypes([draft("3BHK", ["1O50"])]);
    expect("error" in result && result.error).toContain("not a size");
  });

  it("rejects zero, negative and absurd sizes", () => {
    expect("error" in normalizeUnitTypes([draft("2BHK", ["0"])])).toBe(true);
    expect("error" in normalizeUnitTypes([draft("2BHK", ["-500"])])).toBe(true);
    const huge = normalizeUnitTypes([draft("2BHK", ["500000"])]);
    expect("error" in huge && huge.error).toContain("typo");
  });

  it("accepts an empty catalogue, for a society that has not set one up", () => {
    expect(normalizeUnitTypes([])).toEqual({ unitTypes: [] });
  });
});

describe("round-tripping through the form", () => {
  it("survives normalise and back", () => {
    const drafts = toUnitTypeDrafts(catalogue);
    expect(normalizeUnitTypes(drafts)).toEqual({ unitTypes: catalogue });
  });

  it("offers one blank row when there is nothing yet", () => {
    expect(toUnitTypeDrafts([])).toEqual([emptyUnitType()]);
  });

  it("offers a blank size row for a type that somehow has none", () => {
    expect(toUnitTypeDrafts([{ name: "Shop", sizes: [] }])[0].sizes).toHaveLength(1);
  });
});

describe("reading the catalogue", () => {
  it("lists the sizes a type comes in", () => {
    expect(sizesFor(catalogue, "2BHK").map((s) => s.sqft)).toEqual([500, 535, 542]);
  });

  it("returns nothing for a type the society does not have", () => {
    expect(sizesFor(catalogue, "4BHK")).toEqual([]);
  });

  it("labels a size the way a resident would say it", () => {
    expect(sizeLabel({ sqft: 1050 })).toBe("1050 sq ft");
    expect(sizeLabel({ sqft: 1100, label: "corner" })).toBe("1100 sq ft · corner");
  });

  it("labels a flat's unit, tolerating a missing half", () => {
    expect(unitLabel("3BHK", 1050)).toBe("3BHK · 1050 sq ft");
    expect(unitLabel("3BHK", null)).toBe("3BHK");
    expect(unitLabel(null, 1050)).toBe("1050 sq ft");
    expect(unitLabel(null, null)).toBe("");
  });

  it("collects every distinct size across types, ascending", () => {
    expect(allSizes(catalogue)).toEqual([500, 535, 542, 1000, 1050, 1100]);
    expect(allSizes([
      { name: "A", sizes: [{ sqft: 600 }] },
      { name: "B", sizes: [{ sqft: 600 }] },
    ])).toEqual([600]);
  });
});

describe("checking a flat's unit is one the society has", () => {
  it("accepts a real pairing", () => {
    expect(isKnownUnit(catalogue, "3BHK", 1050)).toBe(true);
  });

  it("refuses a size that type does not come in", () => {
    // The failure this prevents: a flat stamped 3BHK/1075 falls out of
    // every per-size charge, and nobody notices until the bills are
    // short.
    expect(isKnownUnit(catalogue, "3BHK", 1075)).toBe(false);
  });

  it("refuses a size belonging to a different type", () => {
    expect(isKnownUnit(catalogue, "2BHK", 1050)).toBe(false);
  });

  it("refuses a half-filled unit", () => {
    expect(isKnownUnit(catalogue, "3BHK", null)).toBe(false);
    expect(isKnownUnit(catalogue, null, 1050)).toBe(false);
    expect(isKnownUnit(catalogue, "", 0)).toBe(false);
  });
});
