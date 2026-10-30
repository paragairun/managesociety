import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  resolvePushTarget, isPushRole, PUSH_VIEWS,
  PUSH_CHANNEL, GATE_CHANNEL, channelForEvent, soundForEvent, GATE_SOUND,
} from "./pushRouting";

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
    // The function now picks a channel per event rather than hardcoding
    // one, so what has to match is the two channel IDS and the event
    // list behind them. An edge function cannot import from src/, so the
    // copy there is deliberate and this is what keeps it honest.
    const fn = read("supabase", "functions", "send-push-notification", "index.ts");
    expect(fn).toContain(`"${PUSH_CHANNEL.id}"`);
    expect(fn).toContain(`"${GATE_CHANNEL.id}"`);
    expect(fn).toContain("channel_id: channelForEvent(row.event_key)");

    // Every event the shared mapping sends to the gate channel must
    // appear in the function's own copy of the list.
    for (const key of ["delivery.at_gate", "visitor.at_gate", "gate.unregistered_vehicle"]) {
      expect(channelForEvent(key)).toBe(GATE_CHANNEL.id);
      expect(fn).toContain(`"${key}"`);
    }
  });

  it("reserves the heads-up banner for someone actually waiting", () => {
    // This used to assert PUSH_CHANNEL.importance === 5, back when one
    // channel carried everything. Splitting them is the point: a bill
    // should not shove a banner over whatever the resident is doing,
    // and a delivery agent at the gate should.
    expect(GATE_CHANNEL.importance).toBe(5);
    expect(PUSH_CHANNEL.importance).toBe(4);
  });
});

describe("choosing a notification channel", () => {
  it("sends someone waiting at the gate to the loud channel", () => {
    expect(channelForEvent("delivery.at_gate")).toBe(GATE_CHANNEL.id);
    expect(channelForEvent("visitor.at_gate")).toBe(GATE_CHANNEL.id);
    expect(channelForEvent("gate.unregistered_vehicle")).toBe(GATE_CHANNEL.id);
  });

  it("does NOT treat a decision as an interruption", () => {
    // "delivery.reviewed" tells a guard the resident answered. Useful,
    // but nobody is standing anywhere waiting on it.
    expect(channelForEvent("delivery.reviewed")).toBe(PUSH_CHANNEL.id);
    expect(channelForEvent("visitor.reviewed")).toBe(PUSH_CHANNEL.id);
  });

  it("puts ordinary notices on the default channel", () => {
    for (const key of ["bill.issued", "bill.overdue", "payment.recorded",
      "amenity_booking.created", "staff.qr_issued", "test.manual"]) {
      expect(channelForEvent(key)).toBe(PUSH_CHANNEL.id);
    }
  });

  it("falls back to the default for an unknown or missing key", () => {
    expect(channelForEvent("something.new")).toBe(PUSH_CHANNEL.id);
    expect(channelForEvent(null)).toBe(PUSH_CHANNEL.id);
    expect(channelForEvent(undefined)).toBe(PUSH_CHANNEL.id);
    expect(channelForEvent("")).toBe(PUSH_CHANNEL.id);
  });

  it("keeps the two channels distinct", () => {
    // Same id would silently merge them, and the gate alert would
    // inherit whichever settings were registered first.
    expect(GATE_CHANNEL.id).not.toBe(PUSH_CHANNEL.id);
    expect(GATE_CHANNEL.importance).toBeGreaterThan(PUSH_CHANNEL.importance);
  });
});

describe("the gate alert tone", () => {
  it("plays the custom tone only for someone actually waiting", () => {
    expect(soundForEvent("delivery.at_gate")).toEqual({
      android: GATE_SOUND.android, ios: GATE_SOUND.file,
    });
    expect(soundForEvent("visitor.at_gate").android).toBe(GATE_SOUND.android);
    // A bill does not get a distinct tone: a resident who hears the gate
    // sound should know what it means without looking.
    expect(soundForEvent("bill.issued")).toEqual({ android: "default", ios: "default" });
    expect(soundForEvent("delivery.reviewed")).toEqual({ android: "default", ios: "default" });
    expect(soundForEvent(null)).toEqual({ android: "default", ios: "default" });
  });

  it("spells the file the way each platform needs", () => {
    // Android wants the res/raw resource name with NO extension; iOS
    // wants the bundled filename WITH one. Getting this backwards gives
    // a silent notification on one platform and no error anywhere.
    expect(GATE_SOUND.android).toBe("gate_alert");
    expect(GATE_SOUND.file).toBe("gate_alert.wav");
    expect(GATE_SOUND.file.startsWith(GATE_SOUND.android)).toBe(true);
  });

  it("uses an Android-legal resource name", () => {
    // res/raw names must be lowercase a-z, 0-9 and underscore, and may
    // not start with a digit. The config plugin asserts this at prebuild
    // time, which is a 15-minute build away from here.
    expect(GATE_SOUND.android).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("ships the sound file in both apps", () => {
    // A channel naming a sound that is not in res/raw falls back to
    // silence. Nothing would report it: not the build, not the device.
    for (const app of ["resident", "guard"]) {
      const file = join(process.cwd(), "native", app, "assets", "sounds", GATE_SOUND.file);
      expect(existsSync(file), `missing ${file}`).toBe(true);

      // A RIFF/WAVE header, not merely a file of the right name.
      const head = readFileSync(file).subarray(0, 12);
      expect(head.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(head.subarray(8, 12).toString("ascii")).toBe("WAVE");
    }
  });

  it("registers the sound with the config plugin in both apps", () => {
    // Without this entry the file never reaches res/raw, however
    // correctly the channel names it.
    for (const app of ["resident", "guard"]) {
      const cfg = readFileSync(join(process.cwd(), "native", app, "app.json"), "utf8");
      expect(cfg).toContain("expo-notifications");
      expect(cfg).toContain(`assets/sounds/${GATE_SOUND.file}`);
    }
  });

  it("agrees with the edge function about both spellings", () => {
    const fn = read("supabase", "functions", "send-push-notification", "index.ts");
    expect(fn).toContain(`"${GATE_SOUND.android}"`);
    expect(fn).toContain(`"${GATE_SOUND.file}"`);
  });
});
