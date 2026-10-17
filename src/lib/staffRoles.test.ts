import { describe, it, expect } from "vitest";
import {
  STAFF_TYPES, HELP_TYPES, CATEGORY_LABEL, CATEGORY_TABLE, CATEGORY_ROLE_COLUMN,
  rolesFor, normaliseRole, isKnownRole, allRoles, type StaffCategory,
} from "./staffRoles";

describe("the roles that were asked for exist", () => {
  it("includes Gym Trainer, Lifeguard and Society Manager", () => {
    for (const r of ["Gym Trainer", "Lifeguard", "Society Manager"]) {
      expect(STAFF_TYPES).toContain(r);
    }
  });

  it("keeps every role that was already there", () => {
    // Removing one would orphan existing records: a stored staff_type
    // with no matching dropdown entry shows as blank on edit.
    for (const r of ["Security", "Housekeeping", "Accountant", "Facility Manager",
                     "Electrician", "Plumber", "Gardener", "Lift Operator", "Other"]) {
      expect(STAFF_TYPES).toContain(r);
    }
    for (const r of ["Maid", "Driver", "Cook", "Nurse", "Nanny", "Personal Security", "Other"]) {
      expect(HELP_TYPES).toContain(r);
    }
  });

  it("has no duplicates within a list", () => {
    for (const list of [STAFF_TYPES, HELP_TYPES]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("ends each list with Other, so the catch-all stays last in the dropdown", () => {
    expect(STAFF_TYPES[STAFF_TYPES.length - 1]).toBe("Other");
    expect(HELP_TYPES[HELP_TYPES.length - 1]).toBe("Other");
  });
});

describe("category maps are complete", () => {
  const categories: StaffCategory[] = ["society_staff", "house_help"];

  it("every category has a label, a table and a role column", () => {
    for (const c of categories) {
      expect(CATEGORY_LABEL[c]).toBeTruthy();
      expect(CATEGORY_TABLE[c]).toBeTruthy();
      expect(CATEGORY_ROLE_COLUMN[c]).toBeTruthy();
    }
  });

  it("points each category at the right table and column", () => {
    expect(CATEGORY_TABLE.society_staff).toBe("staff_members");
    expect(CATEGORY_TABLE.house_help).toBe("house_helps");
    expect(CATEGORY_ROLE_COLUMN.society_staff).toBe("staff_type");
    expect(CATEGORY_ROLE_COLUMN.house_help).toBe("help_type");
  });

  it("serves the right role list per category", () => {
    expect(rolesFor("society_staff")).toContain("Lifeguard");
    expect(rolesFor("society_staff")).not.toContain("Maid");
    expect(rolesFor("house_help")).toContain("Maid");
    expect(rolesFor("house_help")).not.toContain("Lifeguard");
  });
});

describe("normaliseRole", () => {
  it("matches regardless of case and spacing", () => {
    expect(normaliseRole("society_staff", "gym trainer")).toBe("Gym Trainer");
    expect(normaliseRole("society_staff", "  GYM   TRAINER ")).toBe("Gym Trainer");
    expect(normaliseRole("house_help", "maid")).toBe("Maid");
  });

  it("returns null for a role the category does not have", () => {
    // Lifeguard is staff, not house help. Quietly accepting it would
    // put a role in a dropdown that cannot display it.
    expect(normaliseRole("house_help", "Lifeguard")).toBeNull();
    expect(normaliseRole("society_staff", "Nanny")).toBeNull();
  });

  it("returns null for blanks rather than guessing", () => {
    expect(normaliseRole("society_staff", "")).toBeNull();
    expect(normaliseRole("society_staff", "   ")).toBeNull();
    expect(normaliseRole("society_staff", null)).toBeNull();
    expect(normaliseRole("society_staff", undefined)).toBeNull();
  });

  it("does not partially match", () => {
    expect(normaliseRole("society_staff", "Gym")).toBeNull();
    expect(normaliseRole("society_staff", "Head Lifeguard")).toBeNull();
  });

  it("isKnownRole agrees with it", () => {
    expect(isKnownRole("society_staff", "lifeguard")).toBe(true);
    expect(isKnownRole("society_staff", "Astronaut")).toBe(false);
  });
});

describe("allRoles", () => {
  it("merges both lists without duplicating the shared ones", () => {
    const all = allRoles();
    expect(new Set(all).size).toBe(all.length);
    // Driver and Other are on both sides.
    expect(all.filter((r) => r === "Driver")).toHaveLength(1);
    expect(all.filter((r) => r === "Other")).toHaveLength(1);
  });

  it("covers every role from both lists", () => {
    const all = new Set(allRoles());
    for (const r of [...STAFF_TYPES, ...HELP_TYPES]) expect(all.has(r)).toBe(true);
  });

  it("is sorted, so the filter dropdown is predictable", () => {
    const all = allRoles();
    expect(all).toEqual([...all].sort());
  });
});
