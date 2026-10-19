import { describe, it, expect } from "vitest";
import {
  can, capabilitiesOf, canOpenAdminPanel, isManagerOnly,
  SELF_SERVICE_ROLES, isSelfServiceRole, ROLE_LABEL, ROLE_BLURB,
  type AppRole, type Capability,
} from "./permissions";

describe("manager is an admin minus members and admins", () => {
  it("can do the operational work", () => {
    for (const c of [
      "staff.manage", "attendance.view", "guards.manage", "vehicles.manage",
      "barriers.manage", "amenities.manage", "billing.manage",
      "accesslogs.view", "stats.view", "ev.manage", "ev.settings",
      "registrations.approve",
    ] as Capability[]) {
      expect(can(["manager"], c), `manager should have ${c}`).toBe(true);
    }
  });

  it("cannot modify members, as specified", () => {
    expect(can(["manager"], "members.edit")).toBe(false);
    expect(can(["manager"], "members.delete")).toBe(false);
  });

  it("cannot modify admin profiles, as specified", () => {
    expect(can(["manager"], "admins.edit")).toBe(false);
  });

  it("can still SEE members and admins, which the job requires", () => {
    expect(can(["manager"], "members.view")).toBe(true);
    expect(can(["manager"], "admins.view")).toBe(true);
  });

  it("differs from admin in exactly three capabilities and no others", () => {
    // Pins the subtraction. If someone widens or narrows the manager
    // role later, this fails and says precisely what changed.
    const admin = new Set(capabilitiesOf(["admin"]));
    const manager = new Set(capabilitiesOf(["manager"]));
    const missing = [...admin].filter((c) => !manager.has(c)).sort();
    const extra = [...manager].filter((c) => !admin.has(c));

    expect(missing).toEqual(["admins.edit", "members.delete", "members.edit"]);
    expect(extra).toEqual([]);
  });
});

describe("other roles", () => {
  it("admin has everything a manager has", () => {
    for (const c of capabilitiesOf(["manager"])) {
      expect(can(["admin"], c), `admin should have ${c}`).toBe(true);
    }
  });

  it("residents and visitors hold no admin capability", () => {
    for (const role of ["resident", "visitor"] as AppRole[]) {
      expect(capabilitiesOf([role])).toEqual([]);
      expect(can([role], "members.view")).toBe(false);
      expect(can([role], "ev.settings")).toBe(false);
    }
  });

  it("a guard can see attendance and logs but manage nothing", () => {
    expect(can(["guard"], "attendance.view")).toBe(true);
    expect(can(["guard"], "accesslogs.view")).toBe(true);
    expect(can(["guard"], "staff.manage")).toBe(false);
    expect(can(["guard"], "members.edit")).toBe(false);
  });

  it("combines capabilities across several roles", () => {
    // Someone holding both gets the union, so an admin who is also
    // recorded as a manager keeps full admin powers.
    expect(can(["manager", "admin"], "members.edit")).toBe(true);
  });
});

describe("edge cases that must not throw", () => {
  it("handles no roles, undefined and null", () => {
    expect(can([], "members.view")).toBe(false);
    expect(can(undefined, "members.view")).toBe(false);
    expect(can(null, "members.view")).toBe(false);
    expect(capabilitiesOf(undefined)).toEqual([]);
  });

  it("ignores a role string the table does not know", () => {
    // A role added to the database before this table is updated must
    // grant nothing rather than crash the panel.
    expect(can(["treasurer" as AppRole], "billing.manage")).toBe(false);
    expect(() => capabilitiesOf(["treasurer" as AppRole])).not.toThrow();
  });
});

describe("who may open the admin panel", () => {
  it("admins and managers may, nobody else", () => {
    expect(canOpenAdminPanel(["admin"])).toBe(true);
    expect(canOpenAdminPanel(["manager"])).toBe(true);
    expect(canOpenAdminPanel(["guard"])).toBe(false);
    expect(canOpenAdminPanel(["resident"])).toBe(false);
    expect(canOpenAdminPanel([])).toBe(false);
  });
});

describe("isManagerOnly", () => {
  it("is true for a plain manager", () => {
    expect(isManagerOnly(["manager"])).toBe(true);
  });

  it("is false when they also hold admin", () => {
    // Used to decide whether to show the "ask an admin" note. Someone
    // who is both should not be told they lack permission.
    expect(isManagerOnly(["manager", "admin"])).toBe(false);
    expect(isManagerOnly(["manager", "super_admin"])).toBe(false);
  });

  it("is false for everyone else", () => {
    expect(isManagerOnly(["admin"])).toBe(false);
    expect(isManagerOnly([])).toBe(false);
  });
});

describe("self-service roles on the public register page", () => {
  it("offers the four roles a person may request", () => {
    expect([...SELF_SERVICE_ROLES].sort()).toEqual(["admin", "guard", "manager", "resident"]);
  });

  it("never offers super_admin", () => {
    // super_admin is not society-scoped. Granting it through a public
    // form would hand someone every society in the database.
    expect(SELF_SERVICE_ROLES).not.toContain("super_admin");
    expect(isSelfServiceRole("super_admin")).toBe(false);
  });

  it("rejects anything not on the list", () => {
    for (const r of ["super_admin", "visitor", "", null, undefined, "ADMIN", "owner"]) {
      expect(isSelfServiceRole(r as string), String(r)).toBe(false);
    }
  });

  it("accepts each listed role", () => {
    for (const r of SELF_SERVICE_ROLES) expect(isSelfServiceRole(r)).toBe(true);
  });

  it("has a label and a blurb for every role it offers", () => {
    // A role with no label renders as a blank option on the form.
    for (const r of SELF_SERVICE_ROLES) {
      expect(ROLE_LABEL[r], `no label for ${r}`).toBeTruthy();
      expect(ROLE_BLURB[r], `no blurb for ${r}`).toBeTruthy();
    }
  });
});
