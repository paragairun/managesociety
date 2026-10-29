import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePushTarget, isPushRole, PUSH_VIEWS, PUSH_CHANNEL } from "./pushRouting";

// vitest runs from the project root, so resolve from there rather than
// from import.meta.url, which does not give a usable filesystem path
// under this config. Same approach as app-url.test.ts.
const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

describe("resolvePushTarget", () => {
  it("selects the view a matching payload names", () => {
    expect(resolvePushTarget({ role: "resident", view: "dues", id: "abc" }, "resident"))
      .toEqual({ view: "dues", id: "abc" });
  });

  it("carries the row id through when there is one", () => {
    const t = resolvePushTarget({ role: "admin", view: "vehicle-management", id: "u-1" }, "admin");
    expect(t?.id).toBe("u-1");
  });

  it("omits the id when the payload has none", () => {
    expect(resolvePushTarget({ role: "guard", view: "approvals" }, "guard"))
      .toEqual({ view: "approvals", id: undefined });
  });

  it("ignores a payload addressed to a different role", () => {
    // A guard who is also a resident of the same society receives both
    // kinds. Switching the guard dashboard to 'dues' would be worse
    // than doing nothing.
    expect(resolvePushTarget({ role: "resident", view: "dues" }, "guard")).toBeNull();
  });

  it("accepts a payload with no role on whichever dashboard is open", () => {
    expect(resolvePushTarget({ view: "home" }, "guard")).toEqual({ view: "home", id: undefined });
  });

  it("rejects a view the current role does not have", () => {
    // 'dues' is a resident section; an admin has no such view and
    // selecting it would render a blank dashboard.
    expect(resolvePushTarget({ role: "admin", view: "dues" }, "admin")).toBeNull();
    expect(resolvePushTarget({ view: "barriers" }, "resident")).toBeNull();
  });

  it("rejects an unknown view outright", () => {
    expect(resolvePushTarget({ role: "admin", view: "../../etc/passwd" }, "admin")).toBeNull();
    expect(resolvePushTarget({ role: "admin", view: "" }, "admin")).toBeNull();
  });

  it("survives junk, since the payload comes from outside the app", () => {
    expect(resolvePushTarget(null, "admin")).toBeNull();
    expect(resolvePushTarget(undefined, "admin")).toBeNull();
    expect(resolvePushTarget({}, "admin")).toBeNull();
    expect(resolvePushTarget({ view: 42 }, "admin")).toBeNull();
    expect(resolvePushTarget({ view: ["dues"] }, "resident")).toBeNull();
    expect(resolvePushTarget({ role: 7, view: "home" }, "admin")).toBeNull();
  });
});

describe("isPushRole", () => {
  it("accepts the three dashboard roles", () => {
    expect(isPushRole("resident")).toBe(true);
    expect(isPushRole("guard")).toBe(true);
    expect(isPushRole("admin")).toBe(true);
  });

  it("rejects everything else, manager and super_admin included", () => {
    // A manager uses the admin dashboard, so callers map them to
    // 'admin' before they get here rather than adding a fourth list.
    expect(isPushRole("manager")).toBe(false);
    expect(isPushRole("super_admin")).toBe(false);
    expect(isPushRole(undefined)).toBe(false);
    expect(isPushRole("")).toBe(false);
  });
});

describe("the view lists match the dashboards", () => {
  // These pin PUSH_VIEWS against the actual NAV arrays. A renamed nav
  // id otherwise produces a notification that taps to a blank screen,
  // which nothing else in the suite would catch.
  const navIds = (file: string) => {
    const src = read("src", "pages", file);
    return [...src.matchAll(/\{\s*id:\s*"([a-z-]+)"/g)].map((m) => m[1]);
  };

  it("resident", () => {
    for (const id of new Set(navIds("ResidentPortal.tsx"))) {
      expect(PUSH_VIEWS.resident, `resident nav id "${id}"`).toContain(id);
    }
  });

  it("guard", () => {
    for (const id of new Set(navIds("GuardDashboard.tsx"))) {
      expect(PUSH_VIEWS.guard, `guard nav id "${id}"`).toContain(id);
    }
  });

  it("admin", () => {
    for (const id of new Set(navIds("AdminPanel.tsx"))) {
      expect(PUSH_VIEWS.admin, `admin nav id "${id}"`).toContain(id);
    }
  });

  it("every view the database can send is a real view", () => {
    // The other direction: what queue_notification() puts in the
    // payload must exist in the app.
    const sql = read("supabase", "schema", "push_notifications.sql");
    const pairs = [...sql.matchAll(/'role','([a-z]+)','view','([a-z-]+)'/g)];
    expect(pairs.length).toBeGreaterThan(10);
    for (const [, role, view] of pairs) {
      expect(isPushRole(role), `role "${role}" in the SQL`).toBe(true);
      expect(PUSH_VIEWS[role as "admin"], `"${view}" sent to ${role}`).toContain(view);
    }
  });
});

describe("PUSH_CHANNEL", () => {
  it("matches the channel_id the edge function sends to", () => {
    // Android 8+ takes sound and importance from the channel, so a
    // mismatch here means every notification arrives silently.
    const fn = read("supabase", "functions", "send-push-notification", "index.ts");
    expect(fn).toContain(`channel_id: "${PUSH_CHANNEL.id}"`);
  });

  it("asks for a heads-up banner", () => {
    expect(PUSH_CHANNEL.importance).toBe(5);
  });
});
