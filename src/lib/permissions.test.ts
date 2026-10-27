import { describe, it, expect } from "vitest";
import {
  can, capabilitiesOf, canOpenAdminPanel, isManagerOnly,
  SELF_SERVICE_ROLES, isSelfServiceRole, ROLE_LABEL, ROLE_BLURB, roleSatisfies,
  rolesCreatableBy, canCreateRole,
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

describe("nobody registers themselves", () => {
  it("offers no self-service role at all", () => {
    expect(SELF_SERVICE_ROLES).toEqual([]);
  });

  it("refuses every role, including the committee ones", () => {
    // admin and manager were the last pair still allowed. A stranger
    // who knew a society's slug could drop an ADMIN request into its
    // queue, and a busy reviewer approving it handed over full access.
    // A new society arrives through /register-society instead, which a
    // super admin reviews.
    for (const r of ["admin", "manager", "guard", "resident", "super_admin", "", null, undefined]) {
      expect(isSelfServiceRole(r as string), String(r)).toBe(false);
    }
  });
});

describe("who may create whom from the admin panel", () => {
  it("an admin may create every member role", () => {
    expect([...rolesCreatableBy(["admin"])].sort()).toEqual(["admin", "guard", "manager", "resident"]);
  });

  it("a manager may create guards and nothing else", () => {
    // Follows from the capability model rather than being invented
    // beside it: a manager is denied members.edit and admins.edit, and
    // granted guards.manage.
    expect(rolesCreatableBy(["manager"])).toEqual(["guard"]);
  });

  it("a MANAGER CANNOT create an admin", () => {
    // The escalation that shipped in the first version of
    // registration_lockdown.sql. Creation returns a temporary password
    // to whoever triggered it, so a manager who could create an admin
    // could simply sign in as one.
    expect(canCreateRole(["manager"], "admin")).toBe(false);
    expect(canCreateRole(["manager"], "manager")).toBe(false);
    expect(canCreateRole(["manager"], "resident")).toBe(false);
    expect(canCreateRole(["manager"], "guard")).toBe(true);
  });

  it("someone holding both admin and manager gets the admin set", () => {
    expect([...rolesCreatableBy(["manager", "admin"])].sort())
      .toEqual(["admin", "guard", "manager", "resident"]);
  });

  it("guards, residents and nobody can create anyone", () => {
    for (const roles of [["guard"], ["resident"], ["visitor"], [], undefined, null]) {
      expect(rolesCreatableBy(roles as AppRole[]), String(roles)).toEqual([]);
    }
  });

  it("super_admin is never a creatable target", () => {
    // It is not society-scoped, so granting it here would hand someone
    // every society in the database.
    for (const actor of [["admin"], ["super_admin"], ["manager"]]) {
      expect(rolesCreatableBy(actor as AppRole[])).not.toContain("super_admin");
      expect(canCreateRole(actor as AppRole[], "super_admin")).toBe(false);
    }
  });

  it("every creatable role has a label, so the dropdown is never blank", () => {
    for (const r of rolesCreatableBy(["admin"])) {
      expect(ROLE_LABEL[r], `no label for ${r}`).toBeTruthy();
    }
  });
});

describe("roleSatisfies — the login page and the route guard must agree", () => {
  it("lets a manager satisfy an admin requirement", () => {
    // This is the bug that stopped a manager signing in: the route
    // guard accepted them, the login page refused them, so they were
    // told they had the wrong role on the page meant for them.
    expect(roleSatisfies(["manager"], "admin")).toBe(true);
  });

  it("still accepts an actual admin", () => {
    expect(roleSatisfies(["admin"], "admin")).toBe(true);
  });

  it("does not let an admin requirement be met by anyone else", () => {
    expect(roleSatisfies(["resident"], "admin")).toBe(false);
    expect(roleSatisfies(["guard"], "admin")).toBe(false);
    expect(roleSatisfies([], "admin")).toBe(false);
    expect(roleSatisfies(undefined, "admin")).toBe(false);
  });

  it("does NOT let a manager satisfy guard or resident", () => {
    // The stand-in is one-directional and only for the admin page.
    expect(roleSatisfies(["manager"], "guard")).toBe(false);
    expect(roleSatisfies(["manager"], "resident")).toBe(false);
  });

  it("is not symmetric — an admin does not become a manager", () => {
    expect(roleSatisfies(["admin"], "manager")).toBe(false);
  });

  it("agrees with canOpenAdminPanel", () => {
    // Two functions answering nearly the same question must not drift.
    for (const roles of [["admin"], ["manager"], ["guard"], ["resident"], []] as AppRole[][]) {
      expect(roleSatisfies(roles, "admin")).toBe(canOpenAdminPanel(roles));
    }
  });
});
