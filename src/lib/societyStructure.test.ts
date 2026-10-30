import { describe, it, expect } from "vitest";
import {
  generateFlatNumbers, normalizeStructure, toEditableState, normalizeTowers,
  emptyWing, emptyTower,
  parseStoredStructure, towerForWing, formatFlatAddress, flatsForWing, allWings,
  structureFields, addressFor,
  type NormalizedWing, type NormalizedTower, type TowerStructure,
} from "@/lib/societyStructure";

describe("generateFlatNumbers", () => {
  it("generates a simple range for non-floor-wise wings", () => {
    const wing: NormalizedWing = { wing: "A", flat_from: 101, flat_to: 105, floor_wise: false };
    expect(generateFlatNumbers(wing)).toEqual(["101", "102", "103", "104", "105"]);
  });

  it("returns a single flat when from === to", () => {
    const wing: NormalizedWing = { wing: "A", flat_from: 101, flat_to: 101, floor_wise: false };
    expect(generateFlatNumbers(wing)).toEqual(["101"]);
  });

  it("returns an empty array when the range is invalid (from > to)", () => {
    const wing: NormalizedWing = { wing: "A", flat_from: 105, flat_to: 101, floor_wise: false };
    expect(generateFlatNumbers(wing)).toEqual([]);
  });

  it("generates floor-wise numbers with a 3-digit prefix (101-104, 201-204 style)", () => {
    const wing: NormalizedWing = { wing: "A", flat_from: 101, flat_to: 0, floor_wise: true, flats_per_floor: 4, total_floors: 3 };
    expect(generateFlatNumbers(wing)).toEqual([
      "101", "102", "103", "104",
      "201", "202", "203", "204",
      "301", "302", "303", "304",
    ]);
  });

  it("generates floor-wise numbers with a 4-digit prefix (1001-1006, 2001-2006 style)", () => {
    const wing: NormalizedWing = { wing: "A", flat_from: 1001, flat_to: 0, floor_wise: true, flats_per_floor: 6, total_floors: 2 };
    expect(generateFlatNumbers(wing)).toEqual([
      "1001", "1002", "1003", "1004", "1005", "1006",
      "2001", "2002", "2003", "2004", "2005", "2006",
    ]);
  });

  it("respects a non-zero starting unit within a floor (e.g. starting at 3rd flat)", () => {
    const wing: NormalizedWing = { wing: "A", flat_from: 103, flat_to: 0, floor_wise: true, flats_per_floor: 2, total_floors: 2 };
    // start unit = 03, so each floor produces 2 flats starting from unit 3
    expect(generateFlatNumbers(wing)).toEqual(["103", "104", "203", "204"]);
  });

  it("falls back to a simple range if floor-wise fields are incomplete", () => {
    const wing: NormalizedWing = { wing: "A", flat_from: 1, flat_to: 3, floor_wise: true }; // missing flats_per_floor/total_floors
    expect(generateFlatNumbers(wing)).toEqual(["1", "2", "3"]);
  });
});

describe("normalizeStructure", () => {
  const validTower = (): TowerStructure => ({
    tower_name: "Tower 1",
    wings: [{ wing: "A", flat_from: "101", flat_to: "110", total_floors: "" }],
  });

  it("normalizes a valid non-floor-wise tower/wing", () => {
    const result = normalizeStructure([validTower()], false, "");
    expect("error" in result).toBe(false);
    if ("structure" in result) {
      expect(result.structure.towers).toEqual([
        { tower_name: "Tower 1", wings: [{ wing: "A", flat_from: 101, flat_to: 110, floor_wise: false }] },
      ]);
    }
  });

  it("uppercases wing names and trims tower names", () => {
    const tower: TowerStructure = { tower_name: "  Tower 1  ", wings: [{ wing: "  a  ", flat_from: "1", flat_to: "2", total_floors: "" }] };
    const result = normalizeStructure([tower], false, "");
    if ("structure" in result) {
      expect(result.structure.towers[0].tower_name).toBe("Tower 1");
      expect(result.structure.towers[0].wings[0].wing).toBe("A");
    } else {
      expect.fail("expected a valid structure, got error: " + result.error);
    }
  });

  it("silently skips a fully-empty tower row (e.g. an unused extra row in the form)", () => {
    const emptyRow: TowerStructure = emptyTower();
    const result = normalizeStructure([validTower(), emptyRow], false, "");
    if ("structure" in result) {
      expect(result.structure.towers.length).toBe(1);
    } else {
      expect.fail("expected a valid structure, got error: " + result.error);
    }
  });

  it("errors when a tower has no name but has wing data", () => {
    const tower: TowerStructure = { tower_name: "", wings: [{ wing: "A", flat_from: "1", flat_to: "2", total_floors: "" }] };
    const result = normalizeStructure([tower], false, "");
    expect("error" in result).toBe(true);
  });

  it("errors when starting flat number is missing or invalid", () => {
    const tower: TowerStructure = { tower_name: "Tower 1", wings: [{ wing: "A", flat_from: "", flat_to: "10", total_floors: "" }] };
    const result = normalizeStructure([tower], false, "");
    expect("error" in result).toBe(true);
  });

  it("errors when starting flat number exceeds ending flat number", () => {
    const tower: TowerStructure = { tower_name: "Tower 1", wings: [{ wing: "A", flat_from: "110", flat_to: "101", total_floors: "" }] };
    const result = normalizeStructure([tower], false, "");
    expect("error" in result).toBe(true);
  });

  it("errors when a tower ends up with zero wings after skipping empties", () => {
    const tower: TowerStructure = { tower_name: "Tower 1", wings: [emptyWing()] };
    const result = normalizeStructure([tower], false, "");
    expect("error" in result).toBe(true);
  });

  describe("floor-wise mode", () => {
    it("normalizes a valid floor-wise tower, computing the correct flat_to", () => {
      const tower: TowerStructure = { tower_name: "Tower 1", wings: [{ wing: "A", flat_from: "101", flat_to: "", total_floors: "3" }] };
      const result = normalizeStructure([tower], true, "4");
      if ("structure" in result) {
        expect(result.structure.towers[0].wings[0]).toEqual({
          wing: "A", flat_from: 101, flat_to: 304, floor_wise: true, flats_per_floor: 4, total_floors: 3,
        });
      } else {
        expect.fail("expected a valid structure, got error: " + result.error);
      }
    });

    it("errors when flats-per-floor is missing", () => {
      const tower: TowerStructure = { tower_name: "Tower 1", wings: [{ wing: "A", flat_from: "101", flat_to: "", total_floors: "3" }] };
      const result = normalizeStructure([tower], true, "");
      expect("error" in result).toBe(true);
    });

    it("errors when flats-per-floor exceeds 99 (can't fit in 2-digit unit)", () => {
      const tower: TowerStructure = { tower_name: "Tower 1", wings: [{ wing: "A", flat_from: "101", flat_to: "", total_floors: "3" }] };
      const result = normalizeStructure([tower], true, "100");
      expect("error" in result).toBe(true);
    });

    it("errors when starting unit + flats-per-floor would exceed 99 (overflow into next floor's numbering)", () => {
      // starting at unit 95, 10 flats per floor -> would need units 95-104, overflowing 2-digit space
      const tower: TowerStructure = { tower_name: "Tower 1", wings: [{ wing: "A", flat_from: "195", flat_to: "", total_floors: "2" }] };
      const result = normalizeStructure([tower], true, "10");
      expect("error" in result).toBe(true);
    });

    it("errors when total_floors is missing", () => {
      const tower: TowerStructure = { tower_name: "Tower 1", wings: [{ wing: "A", flat_from: "101", flat_to: "", total_floors: "" }] };
      const result = normalizeStructure([tower], true, "4");
      expect("error" in result).toBe(true);
    });
  });
});

describe("toEditableState / normalizeStructure round-trip", () => {
  it("round-trips a structure through normalize -> toEditableState -> normalize without data loss", () => {
    const tower: TowerStructure = { tower_name: "Tower 1", wings: [{ wing: "A", flat_from: "101", flat_to: "110", total_floors: "" }] };
    const first = normalizeStructure([tower], false, "");
    if (!("structure" in first)) return expect.fail("expected valid structure");

    const editable = toEditableState(first.structure);
    const second = normalizeStructure(editable.towers, editable.floorWise, editable.flatsPerFloor);
    if (!("structure" in second)) return expect.fail("expected valid structure on second pass");

    expect(second.structure).toEqual(first.structure);
  });

  it("returns a single empty tower/wing when given a structure with no towers", () => {
    const editable = toEditableState({ floor_wise: false, towers: [] });
    expect(editable.towers).toEqual([emptyTower()]);
  });
});

describe("normalizeTowers (backward-compat shim)", () => {
  it("normalizes non-floor-wise towers and returns just the towers array", () => {
    const tower: TowerStructure = { tower_name: "Tower 1", wings: [{ wing: "A", flat_from: "1", flat_to: "5", total_floors: "" }] };
    const result = normalizeTowers([tower]);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.towers[0].tower_name).toBe("Tower 1");
    }
  });

  it("propagates validation errors the same way normalizeStructure does", () => {
    const tower: TowerStructure = { tower_name: "", wings: [{ wing: "A", flat_from: "1", flat_to: "5", total_floors: "" }] };
    const result = normalizeTowers([tower]);
    expect("error" in result).toBe(true);
  });
});

// ─── Reading a stored structure ─────────────────────────────────────────────

const TOWERS: NormalizedTower[] = [
  {
    tower_name: "Tower 1",
    wings: [
      { wing: "A", flat_from: 101, flat_to: 103, floor_wise: false },
      { wing: "B", flat_from: 201, flat_to: 202, floor_wise: false },
    ],
  },
  {
    tower_name: "Tower 2",
    wings: [{ wing: "C", flat_from: 301, flat_to: 301, floor_wise: false }],
  },
];

describe("parseStoredStructure", () => {
  it("reads the current { floor_wise, towers } shape", () => {
    expect(parseStoredStructure({ floor_wise: false, towers: TOWERS })).toEqual(TOWERS);
  });

  it("reads the older plain-array shape still present in live data", () => {
    expect(parseStoredStructure(TOWERS)).toEqual(TOWERS);
  });

  it("treats a missing or empty structure as no structure", () => {
    expect(parseStoredStructure(null)).toEqual([]);
    expect(parseStoredStructure(undefined)).toEqual([]);
    expect(parseStoredStructure({ floor_wise: false, towers: undefined as never })).toEqual([]);
  });
});

describe("towerForWing", () => {
  it("finds the tower a wing belongs to", () => {
    expect(towerForWing(TOWERS, "B")).toBe("Tower 1");
    expect(towerForWing(TOWERS, "C")).toBe("Tower 2");
  });

  it("returns undefined for an unknown wing", () => {
    expect(towerForWing(TOWERS, "Z")).toBeUndefined();
    expect(towerForWing([], "A")).toBeUndefined();
  });
});

describe("formatFlatAddress", () => {
  it("names the tower when the society has a structure", () => {
    expect(formatFlatAddress(TOWERS, "A", "101")).toBe("Tower 1 • Wing A • 101");
  });

  it("falls back to wing-flat for societies with no structure", () => {
    // Societies onboarded before the structure builder existed have no
    // towers, and this is what their guards have always seen.
    expect(formatFlatAddress([], "A", "101")).toBe("A-101");
  });

  it("falls back for a wing missing from the structure", () => {
    expect(formatFlatAddress(TOWERS, "Z", "901")).toBe("Z-901");
  });
});

describe("flatsForWing", () => {
  it("generates the wing's flat numbers", () => {
    expect(flatsForWing(TOWERS, "A")).toEqual(["101", "102", "103"]);
  });

  it("returns nothing for an unknown wing", () => {
    expect(flatsForWing(TOWERS, "Z")).toEqual([]);
  });
});

describe("allWings", () => {
  it("flattens every wing with its tower name", () => {
    expect(allWings(TOWERS)).toEqual([
      { tower_name: "Tower 1", wing: "A" },
      { tower_name: "Tower 1", wing: "B" },
      { tower_name: "Tower 2", wing: "C" },
    ]);
  });

  it("is empty with no towers", () => {
    expect(allWings([])).toEqual([]);
  });
});

// ─── Optional address fields ───────────────────────────────────────────────

describe("structureFields", () => {
  const towers = (spec: [string, string[]][]): NormalizedTower[] =>
    spec.map(([tower_name, wings]) => ({
      tower_name,
      wings: wings.map((wing) => ({ wing, flat_from: 101, flat_to: 104, floor_wise: false })),
    }));

  it("shows both when a society really has both", () => {
    expect(structureFields(towers([["Tower 1", ["A", "B"]], ["Tower 2", ["C"]]])))
      .toEqual({ tower: true, wing: true });
  });

  it("hides a single tower, which tells nobody anything", () => {
    // One tower named "Tower 1" is a dropdown with one option that a
    // guard taps past at every gate entry.
    expect(structureFields(towers([["Tower 1", ["A", "B"]]])))
      .toEqual({ tower: false, wing: true });
  });

  it("hides a single wing", () => {
    expect(structureFields(towers([["Tower 1", ["A"]], ["Tower 2", ["A"]]])))
      .toEqual({ tower: true, wing: false });
  });

  it("hides both in a single standalone building", () => {
    expect(structureFields(towers([["Main", ["A"]]])))
      .toEqual({ tower: false, wing: false });
  });

  it("counts DISTINCT values, not entries", () => {
    // Three wings all called "A" is one wing with a data-entry problem.
    // Offering a guard three identical options helps nobody.
    expect(structureFields(towers([["T", ["A", "A", "A"]]])).wing).toBe(false);
    expect(structureFields(towers([["T", ["A", "B", "A"]]])).wing).toBe(true);
  });

  it("ignores blank and whitespace names", () => {
    expect(structureFields(towers([["", ["A", " "]], ["  ", ["A"]]])))
      .toEqual({ tower: false, wing: false });
  });

  it("hides both for a society with no structure at all", () => {
    expect(structureFields([])).toEqual({ tower: false, wing: false });
  });
});

describe("addressFor", () => {
  const multi: NormalizedTower[] = [
    { tower_name: "Tower 1", wings: [{ wing: "A", flat_from: 101, flat_to: 104, floor_wise: false }] },
    { tower_name: "Tower 2", wings: [{ wing: "B", flat_from: 101, flat_to: 104, floor_wise: false }] },
  ];
  const oneWing: NormalizedTower[] = [
    { tower_name: "Main", wings: [{ wing: "A", flat_from: 101, flat_to: 104, floor_wise: false }] },
  ];
  const wingsOnly: NormalizedTower[] = [
    { tower_name: "Main", wings: [
      { wing: "A", flat_from: 101, flat_to: 104, floor_wise: false },
      { wing: "B", flat_from: 201, flat_to: 204, floor_wise: false },
    ] },
  ];

  it("names both where both matter", () => {
    // Two towers and two distinct wings, so both fields earn their place.
    expect(addressFor(multi, "B", "1201")).toBe("Tower 2 · Wing B · 1201");
  });

  it("names the tower alone when every tower has one wing of the same name", () => {
    const sameWing: NormalizedTower[] = [
      { tower_name: "Tower 1", wings: [{ wing: "A", flat_from: 101, flat_to: 104, floor_wise: false }] },
      { tower_name: "Tower 2", wings: [{ wing: "A", flat_from: 101, flat_to: 104, floor_wise: false }] },
    ];
    expect(addressFor(sameWing, "A", "1201")).toBe("Tower 1 · 1201");
  });

  it("drops the tower where there is only one", () => {
    expect(addressFor(wingsOnly, "B", "1201")).toBe("B-1201");
  });

  it("is a bare flat number in a single-wing building", () => {
    // Which is what the residents there call it anyway.
    expect(addressFor(oneWing, "A", "1201")).toBe("1201");
  });

  it("falls back to the flat number with no structure at all", () => {
    expect(addressFor([], "A", "1201")).toBe("1201");
  });
});

describe("wing names are unique across the whole society", () => {
  // Everything downstream resolves a wing by name alone, so a repeat
  // silently collapses into the first one found: the guard sees the
  // wrong flat list, and the floor plan stamps one tower's unit types
  // onto another tower's flats and bills them for it.
  const wing = (name: string, from = "101", floors = "2") =>
    ({ wing: name, flat_from: from, flat_to: "", total_floors: floors });

  it("rejects the same wing name in two different towers", () => {
    const result = normalizeStructure([
      { tower_name: "T1", wings: [wing("A")] },
      { tower_name: "T2", wings: [wing("A")] },
    ], true, "4");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("T1");
      expect(result.error).toContain("T2");
      expect(result.error).toContain("A");
    }
  });

  it("rejects the same wing name twice in one tower", () => {
    const result = normalizeStructure([
      { tower_name: "T1", wings: [wing("A"), wing("A")] },
    ], true, "4");
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("two wings called A");
  });

  it("catches a repeat that differs only by case or spacing", () => {
    const result = normalizeStructure([
      { tower_name: "T1", wings: [wing("A")] },
      { tower_name: "T2", wings: [wing(" a ")] },
    ], true, "4");
    expect("error" in result).toBe(true);
  });

  it("still accepts distinct wing names across towers", () => {
    const result = normalizeStructure([
      { tower_name: "T1", wings: [wing("A")] },
      { tower_name: "T2", wings: [wing("B")] },
    ], true, "4");
    expect("error" in result).toBe(false);
  });

  it("the suggested fix in the message is itself valid", () => {
    // The error tells them to try T1-A and T2-A. That had better work.
    const result = normalizeStructure([
      { tower_name: "T1", wings: [wing("T1-A")] },
      { tower_name: "T2", wings: [wing("T2-A")] },
    ], true, "4");
    expect("error" in result).toBe(false);
  });
});
