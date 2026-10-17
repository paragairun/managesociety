/**
 * The two kinds of person the society tracks, and the job roles each
 * can hold. One definition, used by the admin screen, the resident
 * screen and the spreadsheet importer.
 *
 * WHY ONE MODULE
 * These lists lived in two components, as two array literals. Adding
 * "Gym Trainer" meant knowing to edit SocietyStaffManager and knowing
 * not to edit HouseHelpsManager, and the importer accepted any string
 * at all, so a spreadsheet could introduce a role the dropdowns had
 * never heard of. One list, consulted everywhere, removes the question.
 *
 * WHY TWO TABLES REMAIN
 * Society staff and house helps are stored separately on purpose:
 * a house help belongs to a resident and is linked to their flat
 * (house_help_flats), with RLS giving the resident control of their own.
 * Society staff belong to the society and are the admin's. Merging the
 * tables would mean migrating those flat links, the attendance pipeline
 * and the biometric PIN mapping, for no gain the admin can see. The
 * admin screen presents one combined list over both, tagged by
 * category, which is the part that was actually missing.
 */

export type StaffCategory = "society_staff" | "house_help";

export const CATEGORY_LABEL: Record<StaffCategory, string> = {
  society_staff: "Staff",
  house_help: "House help",
};

/** Which table a category lives in. */
export const CATEGORY_TABLE: Record<StaffCategory, "staff_members" | "house_helps"> = {
  society_staff: "staff_members",
  house_help: "house_helps",
};

/** Which column on that table holds the job role. */
export const CATEGORY_ROLE_COLUMN: Record<StaffCategory, "staff_type" | "help_type"> = {
  society_staff: "staff_type",
  house_help: "help_type",
};

/**
 * Society staff roles. Gym Trainer, Lifeguard and Society Manager added
 * as requested; the rest are the existing list, unchanged so no stored
 * record stops matching its dropdown.
 */
export const STAFF_TYPES = [
  "Security",
  "Housekeeping",
  "Accountant",
  "Facility Manager",
  "Society Manager",
  "Electrician",
  "Plumber",
  "Gardener",
  "Lift Operator",
  "Gym Trainer",
  "Lifeguard",
  "Swimming Pool Cleaner",
  "Clubhouse Attendant",
  "Driver",
  "Pest Control",
  "Other",
] as const;

/** House help roles, as engaged by an individual resident. */
export const HELP_TYPES = [
  "Maid",
  "Driver",
  "Cook",
  "Nurse",
  "Nanny",
  "Personal Security",
  "Tutor",
  "Elderly Care",
  "Other",
] as const;

export function rolesFor(category: StaffCategory): readonly string[] {
  return category === "house_help" ? HELP_TYPES : STAFF_TYPES;
}

/**
 * Match a role typed into a spreadsheet against the known list,
 * case- and spacing-insensitively, so "gym trainer", "Gym  Trainer" and
 * "GYM TRAINER" all land on the same stored value.
 *
 * Returns null when there is no match. The caller decides whether that
 * is an error or should fall through to "Other" — the importer reports
 * it rather than guessing, because a silently mis-filed role is worse
 * than a rejected row.
 */
export function normaliseRole(
  category: StaffCategory,
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  const hit = rolesFor(category).find((r) => r.toLowerCase() === key);
  return hit ?? null;
}

/** Is this a role the dropdowns offer for that category? */
export function isKnownRole(category: StaffCategory, raw: string): boolean {
  return normaliseRole(category, raw) !== null;
}

/**
 * Every role either kind of person can hold, for a filter control that
 * spans the combined list. Deduplicated, since Driver and Other appear
 * on both sides.
 */
export function allRoles(): string[] {
  return [...new Set<string>([...STAFF_TYPES, ...HELP_TYPES])].sort();
}
