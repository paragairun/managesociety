/**
 * Unit types and their sizes — what shapes of flat a society actually
 * has.
 *
 * A society does not have "flats of arbitrary square footage". It has a
 * handful of unit types — 1BHK, 2BHK, 3BHK — and each type comes in a
 * few specific sizes, because the building was built that way: the
 * 3BHKs are 1000, 1050 and 1100 sq ft and nothing in between.
 *
 * Recording that is what makes maintenance billing tractable. Most
 * charge heads apply by unit type or by area, so once each flat is
 * stamped with its type and size, a bill is arithmetic rather than a
 * spreadsheet. The committee defines the catalogue once; every flat
 * then picks from it, which is also what stops someone typing 1O50 and
 * creating a size nobody can bill against.
 */

export interface UnitSize {
  /** Carpet or built-up area in square feet, as the society counts it. */
  sqft: number;
  /** Optional label where a size has a name residents use ("corner"). */
  label?: string;
}

export interface UnitType {
  /** "1BHK", "2BHK", "3BHK", "Shop", "Penthouse" — the society's own word. */
  name: string;
  /** The sizes this type actually exists in, ascending. */
  sizes: UnitSize[];
}

export const emptyUnitSize = (): { sqft: string; label: string } => ({ sqft: "", label: "" });
export const emptyUnitType = (): { name: string; sizes: { sqft: string; label: string }[] } =>
  ({ name: "", sizes: [emptyUnitSize()] });

/** Form state, where numbers are still strings being typed. */
export interface UnitTypeDraft {
  name: string;
  sizes: { sqft: string; label: string }[];
}

/**
 * Validate and normalise the catalogue a committee has typed.
 *
 * Returns either the clean structure or the first problem, in the order
 * the form shows them.
 */
export function normalizeUnitTypes(
  drafts: UnitTypeDraft[],
): { unitTypes: UnitType[] } | { error: string } {
  const out: UnitType[] = [];
  const seenNames = new Set<string>();

  for (const draft of drafts) {
    const name = draft.name.trim();
    if (!name) return { error: "Give every unit type a name, or remove it." };

    const key = name.toLowerCase();
    if (seenNames.has(key)) {
      return { error: `"${name}" is listed twice. Each unit type needs one entry, with all its sizes under it.` };
    }
    seenNames.add(key);

    const sizes: UnitSize[] = [];
    const seenSqft = new Set<number>();

    for (const s of draft.sizes) {
      const raw = s.sqft.trim();
      if (!raw) continue;                    // a blank row is one being added
      const sqft = Number(raw);
      if (!Number.isFinite(sqft) || sqft <= 0) {
        return { error: `"${raw}" is not a size. Enter the area in square feet, like 1050.` };
      }
      if (sqft > 100000) {
        return { error: `${sqft} sq ft looks like a typo. Check the area for ${name}.` };
      }
      if (seenSqft.has(sqft)) {
        return { error: `${name} has ${sqft} sq ft listed twice.` };
      }
      seenSqft.add(sqft);
      const label = s.label.trim();
      sizes.push(label ? { sqft, label } : { sqft });
    }

    if (sizes.length === 0) {
      return { error: `Add at least one size for ${name}, or remove the unit type.` };
    }

    sizes.sort((a, b) => a.sqft - b.sqft);
    out.push({ name, sizes });
  }

  return { unitTypes: out };
}

/** The stored catalogue back into editable form state. */
export function toUnitTypeDrafts(unitTypes: UnitType[]): UnitTypeDraft[] {
  if (unitTypes.length === 0) return [emptyUnitType()];
  return unitTypes.map((t) => ({
    name: t.name,
    sizes: t.sizes.length > 0
      ? t.sizes.map((s) => ({ sqft: String(s.sqft), label: s.label ?? "" }))
      : [emptyUnitSize()],
  }));
}

/** Every size a given unit type comes in; empty if the type is unknown. */
export function sizesFor(unitTypes: UnitType[], typeName: string): UnitSize[] {
  return unitTypes.find((t) => t.name === typeName)?.sizes ?? [];
}

/**
 * How a size reads on a screen: "1050 sq ft" or "1050 sq ft · corner".
 */
export function sizeLabel(size: UnitSize): string {
  return size.label ? `${size.sqft} sq ft · ${size.label}` : `${size.sqft} sq ft`;
}

/** A flat's unit, as one line: "3BHK · 1050 sq ft". */
export function unitLabel(typeName: string | null, sqft: number | null): string {
  if (typeName && sqft) return `${typeName} · ${sqft} sq ft`;
  if (typeName) return typeName;
  if (sqft) return `${sqft} sq ft`;
  return "";
}

/**
 * True when this type-and-size pair is one the society actually has.
 *
 * Used before saving a flat. A flat stamped with a size outside the
 * catalogue is one that silently falls out of every per-size charge,
 * and nobody notices until the bills are short.
 */
export function isKnownUnit(
  unitTypes: UnitType[],
  typeName: string | null | undefined,
  sqft: number | null | undefined,
): boolean {
  if (!typeName || !sqft) return false;
  return sizesFor(unitTypes, typeName).some((s) => s.sqft === sqft);
}

/** Every distinct size across every type, ascending — for a per-sqft summary. */
export function allSizes(unitTypes: UnitType[]): number[] {
  const set = new Set<number>();
  for (const t of unitTypes) for (const s of t.sizes) set.add(s.sqft);
  return [...set].sort((a, b) => a - b);
}
