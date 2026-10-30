/**
 * Which unit type sits at each position on a floor.
 *
 * A building's floor plate repeats. The flat at the end of the corridor
 * is a 3BHK of 1100 sq ft on the second floor and on the eleventh,
 * because the builder poured the same slab eleven times. So the
 * committee describes one floor — 101 is a 2BHK, 102 a 3BHK, 103 a
 * 3BHK, 104 a 2BHK — and every floor above it follows.
 *
 * That is the last connection the structure was missing. Until now a
 * society had towers, wings and flat numbers on one side, and a
 * catalogue of unit types and sizes on the other, with nothing joining
 * them: somebody had to open two hundred flats and set each one by
 * hand, which nobody does, so the flats stayed unstamped and every
 * per-unit charge quietly skipped them.
 *
 * WHAT THIS DELIBERATELY DOES NOT MODEL
 *
 * Exceptions. A ground floor of shops, a penthouse that swallows two
 * units, the flat someone merged with next door. Encoding those here
 * would mean a per-floor override table and an editor to match, for
 * the handful of flats where the plate does not hold.
 *
 * The plan fills those in like any other flat and the committee then
 * corrects them on the flats table, where single and bulk editing
 * already exist. That is the right split: the plate covers the ninety
 * per cent in one pass, and the exceptions stay visible as exceptions
 * rather than being buried in a second structure nobody maintains.
 */

import {
  generateFlatNumbers, type NormalizedTower, type NormalizedWing,
} from "./societyStructure";
import { isKnownUnit, type UnitType } from "./societyUnits";

/**
 * Wing name → the unit at each position on a floor, left to right.
 *
 * A position holds a unit key ("3BHK|1050"), or null where the
 * committee has not said. Keyed by wing rather than nested in the
 * structure so that an admin can edit it without unlocking the
 * structure itself, which only the platform team may change.
 */
export type UnitPlan = Record<string, (string | null)[]>;

/** "3BHK|1050" — the same key the flats editor uses for one control. */
export const unitKeyOf = (typeName: string, sqft: number): string =>
  `${typeName}|${sqft}`;

export interface ParsedUnitKey { flat_type: string; area_sqft: number }

export function parseUnitKey(key: string | null | undefined): ParsedUnitKey | null {
  if (!key) return null;
  const [name, sqft] = key.split("|");
  const area = Number(sqft);
  if (!name || !Number.isFinite(area) || area <= 0) return null;
  return { flat_type: name, area_sqft: area };
}

/**
 * How many flats sit on one floor of this wing, or null if the wing is
 * not floor-wise.
 *
 * A wing entered as a plain range — flats 1 to 40, no floors — has no
 * floor plate to describe, and inventing one would mean guessing where
 * the floors break. Those wings are set from the flats table instead.
 */
export function positionsIn(wing: NormalizedWing): number | null {
  if (!wing.floor_wise || !wing.flats_per_floor || !wing.total_floors) return null;
  return wing.flats_per_floor;
}

/**
 * The first floor's flat numbers, to label the editor.
 *
 * The committee thinks in flat numbers, not in "position 3". Showing
 * 101, 102, 103, 104 and noting that each stands for its column on
 * every floor is the difference between a form they can fill in and
 * one they have to decode.
 */
export function positionLabels(wing: NormalizedWing): string[] {
  const count = positionsIn(wing);
  if (count === null) return [];
  return generateFlatNumbers(wing).slice(0, count);
}

/**
 * Which position on its floor a flat number occupies, or null if it
 * does not belong to this wing's plate.
 *
 * The last two digits are the unit within the floor — the same rule
 * generateFlatNumbers uses to build them, read backwards. Verified
 * against that generator across prefix widths, because the two must
 * agree exactly: a drift of one puts every 2BHK on a 3BHK's bill.
 */
export function positionOf(wing: NormalizedWing, flatNumber: string): number | null {
  const count = positionsIn(wing);
  if (count === null) return null;
  const n = Number(flatNumber);
  if (!Number.isFinite(n)) return null;
  const startUnit = wing.flat_from % 100;
  const position = (n % 100) - startUnit;
  if (position < 0 || position >= count) return null;
  return position;
}

/** The unit planned for one flat, or null where the plan is silent. */
export function plannedUnitFor(
  wing: NormalizedWing,
  plan: UnitPlan,
  flatNumber: string,
): ParsedUnitKey | null {
  const position = positionOf(wing, flatNumber);
  if (position === null) return null;
  return parseUnitKey(plan[wing.wing]?.[position]);
}

/**
 * Wing names that appear more than once across the society.
 *
 * normalizeStructure refuses to create these, but a structure saved
 * before that rule existed is read straight out of the database
 * without passing through it. The plan is keyed by wing name, so a
 * repeat would put one tower's unit types onto another tower's flats
 * — and then bill them for it. Those wings are refused rather than
 * guessed at, and the committee is sent to the platform team, who are
 * the only people who can rename a locked wing.
 */
export function duplicateWings(towers: NormalizedTower[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const tower of towers) {
    for (const wing of tower.wings) {
      if (seen.has(wing.wing)) dupes.add(wing.wing);
      seen.add(wing.wing);
    }
  }
  return [...dupes];
}

export interface PlannedFlat {
  wing: string;
  flat_number: string;
  flat_type: string;
  area_sqft: number;
}

/**
 * Every flat the structure says exists, with the unit its floor plate
 * gives it.
 *
 * Flats whose position the plan leaves blank are left out rather than
 * returned with a null unit: the caller is writing these to the flats
 * table, and a row that says "this flat is nothing" is worse than no
 * row, because it looks deliberate.
 */
export function plannedFlats(towers: NormalizedTower[], plan: UnitPlan): PlannedFlat[] {
  const out: PlannedFlat[] = [];
  const ambiguous = new Set(duplicateWings(towers));
  for (const tower of towers) {
    for (const wing of tower.wings) {
      // Stamping an ambiguous wing would bill one tower at another
      // tower's rates. Nothing is better than wrong here.
      if (ambiguous.has(wing.wing)) continue;
      const positions = plan[wing.wing];
      if (!positions || positionsIn(wing) === null) continue;
      for (const flatNumber of generateFlatNumbers(wing)) {
        const unit = plannedUnitFor(wing, plan, flatNumber);
        if (!unit) continue;
        out.push({
          wing: wing.wing,
          flat_number: flatNumber,
          flat_type: unit.flat_type,
          area_sqft: unit.area_sqft,
        });
      }
    }
  }
  return out;
}

/**
 * How complete the plan is, for the admin screen.
 *
 * A plan half filled in is the dangerous state: it looks done, applies
 * cleanly, and leaves a third of the society unstamped and unbilled.
 * The count is what makes that visible before the apply rather than
 * after the bills.
 */
export interface PlanCoverage {
  /** Positions across all floor-wise wings. */
  total: number;
  /** Positions the committee has filled in. */
  filled: number;
  /** Wings with no plate to plan — entered as a plain flat range. */
  wingsWithoutFloors: string[];
  /** Flats the plan would stamp, if applied now. */
  flatsCovered: number;
}

export function planCoverage(towers: NormalizedTower[], plan: UnitPlan): PlanCoverage {
  let total = 0;
  let filled = 0;
  const wingsWithoutFloors: string[] = [];

  for (const tower of towers) {
    for (const wing of tower.wings) {
      const count = positionsIn(wing);
      if (count === null) { wingsWithoutFloors.push(wing.wing); continue; }
      total += count;
      const positions = plan[wing.wing] ?? [];
      for (let i = 0; i < count; i++) if (parseUnitKey(positions[i])) filled++;
    }
  }

  return {
    total, filled, wingsWithoutFloors,
    flatsCovered: plannedFlats(towers, plan).length,
  };
}

/**
 * Check a plan against the catalogue and the structure, and tidy it.
 *
 * Returns the plan trimmed to the wings and positions that currently
 * exist. A wing renamed or a floor plate narrowed leaves entries behind
 * that no flat maps to; kept, they are invisible rows that reappear as
 * surprise assignments if the wing is ever renamed back.
 */
export function normalizeUnitPlan(
  towers: NormalizedTower[],
  plan: UnitPlan,
  unitTypes: UnitType[],
): { plan: UnitPlan } | { error: string } {
  const ambiguous = duplicateWings(towers);
  if (ambiguous.length > 0) {
    return {
      error: `Wing ${ambiguous.join(", ")} appears in more than one tower, so a floor plan cannot say which one it means. Ask the platform team to give each wing its own name first.`,
    };
  }

  const out: UnitPlan = {};

  for (const tower of towers) {
    for (const wing of tower.wings) {
      const count = positionsIn(wing);
      if (count === null) continue;

      const given = plan[wing.wing] ?? [];
      const positions: (string | null)[] = [];

      for (let i = 0; i < count; i++) {
        const key = given[i];
        if (!key) { positions.push(null); continue; }

        const unit = parseUnitKey(key);
        if (!unit) {
          return { error: `"${key}" is not a unit. Pick one from the list for ${wing.wing}.` };
        }
        // The catalogue is the authority. A plan entry naming a size
        // the society does not have would stamp flats that then fall
        // out of every per-unit charge — the exact failure the
        // catalogue exists to prevent, reintroduced one level up.
        if (!isKnownUnit(unitTypes, unit.flat_type, unit.area_sqft)) {
          const label = positionLabels(wing)[i] ?? `position ${i + 1}`;
          return {
            error: `${unit.flat_type} at ${unit.area_sqft} sq ft is not a unit your society has. Check flat ${label} in wing ${wing.wing}, or add that size under Unit Types.`,
          };
        }
        positions.push(unitKeyOf(unit.flat_type, unit.area_sqft));
      }

      // Only keep a wing that says something, so an untouched society
      // stores {} rather than a map of nulls.
      if (positions.some((p) => p !== null)) out[wing.wing] = positions;
    }
  }

  return { plan: out };
}

/**
 * The stored plan widened to the current structure, for the editor.
 *
 * Every floor-wise wing gets an array of exactly its own length, so the
 * editor can render a row per position without each caller doing the
 * same padding.
 */
export function toPlanDrafts(towers: NormalizedTower[], plan: UnitPlan): UnitPlan {
  const out: UnitPlan = {};
  for (const tower of towers) {
    for (const wing of tower.wings) {
      const count = positionsIn(wing);
      if (count === null) continue;
      const given = plan[wing.wing] ?? [];
      out[wing.wing] = Array.from({ length: count }, (_, i) => given[i] ?? null);
    }
  }
  return out;
}
