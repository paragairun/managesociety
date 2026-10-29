/**
 * Society tower/wing/flat structure logic: form-state <-> DB-shape
 * conversion, flat-number generation (including floor-wise numbering math),
 * and validation. Kept separate from SocietyStructureBuilder.tsx (the form
 * component) so it can be unit tested directly, and so that component file
 * only exports the component itself -- mixing component and non-component
 * exports in one file breaks Fast Refresh during dev.
 */

// ─── Editable (string-based, for form state) ────────────────────────────────

export interface WingStructure {
  wing: string;
  flat_from: string;
  /** Used only when floor_wise is false at the society level */
  flat_to: string;
  /** Used only when floor_wise is true at the society level */
  total_floors: string;
}

export interface TowerStructure {
  tower_name: string;
  wings: WingStructure[];
}

// ─── Normalized (number-based, for DB storage) ──────────────────────────────

export interface NormalizedWing {
  wing: string;
  flat_from: number;
  flat_to: number;
  floor_wise: boolean;
  flats_per_floor?: number;
  total_floors?: number;
}

export interface NormalizedTower {
  tower_name: string;
  wings: NormalizedWing[];
}

/** Top-level structure stored in society_structure.structure */
export interface NormalizedStructure {
  floor_wise: boolean;
  flats_per_floor?: number;
  towers: NormalizedTower[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export const emptyWing = (): WingStructure => ({ wing: "", flat_from: "", flat_to: "", total_floors: "" });
export const emptyTower = (): TowerStructure => ({ tower_name: "", wings: [emptyWing()] });

/**
 * Generates the list of flat numbers for a wing.
 * Floor-wise: last 2 digits = unit, prefix increments by its own digit-width power-of-10.
 * e.g. prefix "1" → +1 per floor (101-104, 201-204)
 *      prefix "10" → +10 per floor (1001-1006, 2001-2006)
 */
export const generateFlatNumbers = (wing: NormalizedWing): string[] => {
  if (!wing.floor_wise || !wing.flats_per_floor || !wing.total_floors) {
    const flats: string[] = [];
    for (let n = wing.flat_from; n <= wing.flat_to; n++) flats.push(String(n));
    return flats;
  }
  const floorPrefix = Math.floor(wing.flat_from / 100);
  const startUnit = wing.flat_from % 100;
  const prefixDigits = floorPrefix === 0 ? 1 : Math.floor(Math.log10(floorPrefix)) + 1;
  const prefixStep = Math.pow(10, prefixDigits - 1);
  const flats: string[] = [];
  for (let floor = 0; floor < wing.total_floors; floor++) {
    const currentPrefix = floorPrefix + floor * prefixStep;
    for (let i = 0; i < wing.flats_per_floor; i++) {
      flats.push(String(currentPrefix * 100 + startUnit + i));
    }
  }
  return flats;
};

/** Convert a NormalizedStructure from DB into editable form state. */
export const toEditableState = (normalized: NormalizedStructure): {
  towers: TowerStructure[];
  floorWise: boolean;
  flatsPerFloor: string;
} => {
  const floorWise = normalized.floor_wise ?? false;
  const flatsPerFloor = normalized.flats_per_floor ? String(normalized.flats_per_floor) : "";
  const towers: TowerStructure[] = (normalized.towers ?? []).length > 0
    ? normalized.towers.map((t) => ({
        tower_name: t.tower_name,
        wings: t.wings.length > 0
          ? t.wings.map((w) => ({
              wing: w.wing,
              flat_from: String(w.flat_from),
              flat_to: String(w.flat_to),
              total_floors: w.total_floors ? String(w.total_floors) : "",
            }))
          : [emptyWing()],
      }))
    : [emptyTower()];
  return { towers, floorWise, flatsPerFloor };
};

/** Backward-compat: for callers that previously used toEditableTowers */
export const toEditableTowers = (towers: NormalizedTower[]): TowerStructure[] =>
  toEditableState({ floor_wise: false, towers }).towers;

/**
 * Validate + normalize form state into DB-ready NormalizedStructure.
 * Returns { structure } or { error } string.
 */
export const normalizeStructure = (
  towers: TowerStructure[],
  floorWise: boolean,
  flatsPerFloor: string,
): { structure: NormalizedStructure } | { error: string } => {
  let perFloor = 0;
  if (floorWise) {
    perFloor = Number(flatsPerFloor);
    if (!flatsPerFloor.trim() || !Number.isFinite(perFloor) || perFloor <= 0)
      return { error: "Enter a valid number of flats per floor" };
    if (perFloor > 99)
      return { error: "Flats per floor must be 99 or fewer (2-digit unit numbers)" };
  }

  const normalizedTowers: NormalizedTower[] = [];
  for (const tower of towers) {
    const towerName = tower.tower_name.trim();
    const allEmpty = tower.wings.every(
      (w) => !w.wing.trim() && !w.flat_from.trim() && !w.flat_to.trim() && !w.total_floors.trim(),
    );
    if (!towerName && allEmpty) continue;
    if (!towerName) return { error: "Enter a name for every tower/building" };

    const wings: NormalizedWing[] = [];
    for (const w of tower.wings) {
      const wingName = w.wing.trim().toUpperCase();
      const isEmpty = !wingName && !w.flat_from.trim() && !w.flat_to.trim() && !w.total_floors.trim();
      if (isEmpty) continue;
      if (!wingName) return { error: `Enter a wing name for ${towerName}` };

      const from = Number(w.flat_from);
      if (!w.flat_from.trim() || !Number.isFinite(from) || from <= 0)
        return { error: `Enter a valid starting flat number for ${towerName} - Wing ${wingName}` };

      if (floorWise) {
        const floors = Number(w.total_floors);
        if (!w.total_floors.trim() || !Number.isFinite(floors) || floors <= 0)
          return { error: `Enter a valid number of floors for ${towerName} - Wing ${wingName}` };
        const startUnit = from % 100;
        if (startUnit + perFloor - 1 > 99)
          return { error: `Starting flat # + flats per floor exceeds 99 unit digits for ${towerName} - Wing ${wingName}. Adjust the starting flat number.` };
        const floorPrefix = Math.floor(from / 100);
        const prefixDigits = floorPrefix === 0 ? 1 : Math.floor(Math.log10(floorPrefix)) + 1;
        const prefixStep = Math.pow(10, prefixDigits - 1);
        const lastPrefix = floorPrefix + (floors - 1) * prefixStep;
        const lastFlat = lastPrefix * 100 + startUnit + perFloor - 1;
        wings.push({ wing: wingName, flat_from: from, flat_to: lastFlat, floor_wise: true, flats_per_floor: perFloor, total_floors: floors });
      } else {
        const to = Number(w.flat_to);
        if (!w.flat_to.trim() || !Number.isFinite(to) || to <= 0)
          return { error: `Enter a valid ending flat number for ${towerName} - Wing ${wingName}` };
        if (from > to)
          return { error: `Starting flat # must be \u2264 ending flat # for ${towerName} - Wing ${wingName}` };
        wings.push({ wing: wingName, flat_from: from, flat_to: to, floor_wise: false });
      }
    }
    if (wings.length === 0) return { error: `Add at least one wing for ${towerName}` };
    normalizedTowers.push({ tower_name: towerName, wings });
  }

  return {
    structure: {
      floor_wise: floorWise,
      flats_per_floor: floorWise ? perFloor : undefined,
      towers: normalizedTowers,
    },
  };
};

/** Backward-compat shim for callers that used normalizeTowers(towers) */
export const normalizeTowers = (towers: TowerStructure[]) => {
  const result = normalizeStructure(towers, false, "");
  if ("error" in result) return result;
  return { towers: result.structure.towers };
};

// ─── Reading a stored structure ─────────────────────────────────────────────
//
// These were the body of useSocietyStructure, which cannot be shared with
// the native apps because a hook brings React and the website's Supabase
// client with it. The lookups themselves are pure, so they live here and
// both the hook and the native screens call them with towers they fetched
// however they like.

/**
 * Normalise what is actually stored in society_structure.structure.
 *
 * Two shapes exist in the live data: the current
 * `{ floor_wise, towers }` object, and an older plain array of towers
 * written before the top-level flags were added. Both are read.
 */
export const parseStoredStructure = (
  raw: NormalizedStructure | NormalizedTower[] | null | undefined,
): NormalizedTower[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return raw.towers ?? [];
};

/** The tower a wing belongs to, or undefined if the wing is unknown. */
export const towerForWing = (
  towers: NormalizedTower[],
  wing: string,
): string | undefined =>
  towers.find((t) => t.wings.some((w) => w.wing === wing))?.tower_name;

/**
 * A flat address for display: "Tower 1 • Wing A • 101" when the society
 * has a configured structure, and "A-101" when it does not.
 *
 * Societies onboarded before the structure builder existed have no
 * towers at all, and the fallback is what their guards and residents
 * have always seen — so it is the shape, not a placeholder.
 */
export const formatFlatAddress = (
  towers: NormalizedTower[],
  wing: string,
  flatNumber: string,
): string => {
  const tower = towerForWing(towers, wing);
  return tower ? `${tower} • Wing ${wing} • ${flatNumber}` : `${wing}-${flatNumber}`;
};

/** Every flat number in a wing, or an empty list if the wing is unknown. */
export const flatsForWing = (towers: NormalizedTower[], wing: string): string[] => {
  for (const tower of towers) {
    const w = tower.wings.find((x) => x.wing === wing);
    if (w) return generateFlatNumbers(w);
  }
  return [];
};

/** Every wing across every tower, each carrying its tower's name. */
export const allWings = (
  towers: NormalizedTower[],
): { tower_name: string; wing: string }[] =>
  towers.flatMap((tower) => tower.wings.map((w) => ({ tower_name: tower.tower_name, wing: w.wing })));
