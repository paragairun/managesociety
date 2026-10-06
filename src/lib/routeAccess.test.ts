import { describe, it, expect } from "vitest";
import { decideRouteAccess, type AccessInput, type AppRole } from "./routeAccess";

const input = (over: Partial<AccessInput> = {}): AccessInput => ({
  loading: false,
  hasUser: true,
  roles: ["guard"] as AppRole[],
  requiredRole: "guard",
  urlSlug: "triumph-towers-chsl",
  userSlug: "triumph-towers-chsl",
  pathBase: "guard",
  ...over,
});

describe("the reported scenario: guard typing the admin dashboard URL", () => {
  it("denies a guard-only account the admin dashboard", () => {
    const d = decideRouteAccess(input({
      roles: ["guard"], requiredRole: "admin", pathBase: "admin",
    }));
    expect(d).toEqual({
      action: "deny",
      reason: "wrong-role",
      message: "You do not have permission to access this page.",
    });
  });

  it("denies a resident the admin dashboard", () => {
    expect(decideRouteAccess(input({
      roles: ["resident"], requiredRole: "admin", pathBase: "admin",
    })).action).toBe("deny");
  });

  it("denies a guard the resident dashboard", () => {
    expect(decideRouteAccess(input({
      roles: ["guard"], requiredRole: "resident", pathBase: "resident",
    })).action).toBe("deny");
  });

  it("ALLOWS an account that genuinely holds both roles — the likely explanation", () => {
    // user_roles is keyed on user_id alone, so one account can hold
    // several roles at once. That is not a bypass; it is the account
    // actually being an admin.
    const d = decideRouteAccess(input({
      roles: ["guard", "admin"], requiredRole: "admin", pathBase: "admin",
    }));
    expect(d.action).toBe("allow");
  });
});

describe("unauthenticated access", () => {
  it("never allows a signed-out visitor through", () => {
    for (const role of ["guard", "resident", "admin"] as AppRole[]) {
      const d = decideRouteAccess(input({ hasUser: false, roles: [], requiredRole: role, pathBase: role }));
      expect(d.action).toBe("redirect");
    }
  });

  it("sends them to the society-scoped login page", () => {
    expect(decideRouteAccess(input({
      hasUser: false, roles: [], requiredRole: "admin", pathBase: "admin",
    }))).toEqual({
      action: "redirect", to: "/triumph-towers-chsl/admin", reason: "unauthenticated",
    });
  });

  it("falls back to the slugless login page when the URL had no society", () => {
    expect(decideRouteAccess(input({
      hasUser: false, roles: [], requiredRole: "admin", urlSlug: null, pathBase: "admin",
    })).to).toBe("/admin");
  });

  it("waits rather than deciding while auth is still loading", () => {
    expect(decideRouteAccess(input({ loading: true, hasUser: false, roles: [] })))
      .toEqual({ action: "loading" });
  });

  it("does not redirect to login during the loading window", () => {
    // Roles arrive after the user object. Deciding early would bounce a
    // legitimate admin back to the login page on every refresh.
    expect(decideRouteAccess(input({
      loading: true, hasUser: true, roles: [], requiredRole: "admin",
    })).action).toBe("loading");
  });
});

describe("cross-society access", () => {
  it("denies an admin of one society the admin dashboard of another", () => {
    const d = decideRouteAccess(input({
      roles: ["admin"], requiredRole: "admin", pathBase: "admin",
      urlSlug: "some-other-society", userSlug: "triumph-towers-chsl",
    }));
    expect(d).toMatchObject({ action: "deny", reason: "wrong-society" });
  });

  it("allows an admin into their own society", () => {
    expect(decideRouteAccess(input({
      roles: ["admin"], requiredRole: "admin", pathBase: "admin",
      urlSlug: "triumph-towers-chsl", userSlug: "triumph-towers-chsl",
    })).action).toBe("allow");
  });

  it("denies when the account is linked to no society at all", () => {
    expect(decideRouteAccess(input({
      roles: ["admin"], requiredRole: "admin", pathBase: "admin", userSlug: null,
    }))).toMatchObject({ action: "deny", reason: "no-society" });
  });

  it("treats slug comparison as exact, not prefix", () => {
    expect(decideRouteAccess(input({
      roles: ["admin"], requiredRole: "admin", pathBase: "admin",
      urlSlug: "triumph-towers-chsl-2", userSlug: "triumph-towers-chsl",
    })).action).toBe("deny");
  });
});

describe("slugless legacy routes", () => {
  it("redirects to the user's own society URL", () => {
    expect(decideRouteAccess(input({
      roles: ["admin"], requiredRole: "admin", pathBase: "admin",
      urlSlug: null, userSlug: "triumph-towers-chsl",
    }))).toEqual({
      action: "redirect",
      to: "/triumph-towers-chsl/admin/dashboard",
      reason: "canonical-society",
    });
  });

  it("still checks the role before redirecting", () => {
    expect(decideRouteAccess(input({
      roles: ["guard"], requiredRole: "admin", pathBase: "admin",
      urlSlug: null, userSlug: "triumph-towers-chsl",
    })).action).toBe("deny");
  });

  it("allows when there is no slug on either side", () => {
    expect(decideRouteAccess(input({
      roles: ["admin"], requiredRole: "admin", pathBase: "admin",
      urlSlug: null, userSlug: null,
    })).action).toBe("allow");
  });
});

describe("super admins", () => {
  it("is redirected off society dashboards to its own", () => {
    expect(decideRouteAccess(input({
      roles: ["super_admin"], requiredRole: "admin", pathBase: "admin",
    }))).toEqual({ action: "redirect", to: "/super-admin", reason: "super-admin" });
  });

  it("takes precedence over a society mismatch", () => {
    expect(decideRouteAccess(input({
      roles: ["super_admin"], requiredRole: "admin", pathBase: "admin",
      urlSlug: "another-society",
    })).action).toBe("redirect");
  });
});

describe("no combination of inputs lets an unauthenticated user in", () => {
  it("holds across the whole input space", () => {
    const roleSets: AppRole[][] = [[], ["guard"], ["admin"], ["resident"], ["super_admin"], ["guard", "admin"]];
    const required: AppRole[] = ["guard", "resident", "admin"];
    const slugs = [null, "a", "b"];

    for (const roles of roleSets) {
      for (const requiredRole of required) {
        for (const urlSlug of slugs) {
          for (const userSlug of slugs) {
            const d = decideRouteAccess({
              loading: false, hasUser: false, roles, requiredRole,
              urlSlug, userSlug, pathBase: requiredRole,
            });
            expect(d.action).toBe("redirect");
            if (d.action === "redirect") expect(d.reason).toBe("unauthenticated");
          }
        }
      }
    }
  });

  it("never allows a role the user does not hold", () => {
    const required: AppRole[] = ["guard", "resident", "admin"];
    for (const requiredRole of required) {
      for (const held of required.filter((r) => r !== requiredRole)) {
        const d = decideRouteAccess({
          loading: false, hasUser: true, roles: [held], requiredRole,
          urlSlug: "s", userSlug: "s", pathBase: requiredRole,
        });
        expect(d.action).toBe("deny");
      }
    }
  });
});
