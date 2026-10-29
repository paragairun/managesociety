import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  rememberPushTarget, takePushTarget, onPushTarget, resetPushTarget,
} from "./pushTarget";

const KEY = "ms.pendingPushTarget";

beforeEach(() => {
  resetPushTarget();
  localStorage.clear();
});

describe("parking and consuming a tap", () => {
  it("hands back what was parked", () => {
    rememberPushTarget({ role: "resident", view: "deliveries", id: "d-1" });
    expect(takePushTarget()).toEqual({ role: "resident", view: "deliveries", id: "d-1" });
  });

  it("is consumed exactly once", () => {
    // A target is one tap. Returning it twice would re-open the screen
    // on the next mount and feel like the app fighting the user.
    rememberPushTarget({ role: "guard", view: "approvals" });
    expect(takePushTarget()).not.toBeNull();
    expect(takePushTarget()).toBeNull();
  });

  it("returns null when nothing was parked", () => {
    expect(takePushTarget()).toBeNull();
  });

  it("keeps only the most recent tap", () => {
    rememberPushTarget({ view: "dues" });
    rememberPushTarget({ view: "amenities" });
    expect(takePushTarget()).toEqual({ view: "amenities" });
  });

  it("ignores junk rather than parking it", () => {
    rememberPushTarget(null);
    rememberPushTarget(undefined);
    expect(takePushTarget()).toBeNull();
  });
});

describe("surviving a login in between", () => {
  it("reads a target written to storage by an earlier JS context", () => {
    // tap -> app opens on the login screen -> resident signs in -> a
    // dashboard finally mounts. The module variable may be gone; the
    // intent should not be.
    localStorage.setItem(KEY, JSON.stringify({ role: "resident", view: "deliveries" }));
    expect(takePushTarget()).toEqual({ role: "resident", view: "deliveries" });
  });

  it("clears storage once taken, so a stale tap cannot hijack a later launch", () => {
    localStorage.setItem(KEY, JSON.stringify({ view: "home" }));
    takePushTarget();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("survives unparseable storage", () => {
    localStorage.setItem(KEY, "not json{");
    expect(takePushTarget()).toBeNull();
  });

  it("works when storage throws, which it does in private windows", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => { throw new Error("blocked"); });
    // Must not propagate: the in-memory path still serves a cold start.
    expect(() => rememberPushTarget({ view: "dues" })).not.toThrow();
    expect(takePushTarget()).toEqual({ view: "dues" });
    setItem.mockRestore();
  });
});

describe("waking a mounted dashboard", () => {
  it("notifies subscribers when a tap arrives", () => {
    const seen: unknown[] = [];
    onPushTarget(() => seen.push(takePushTarget()));
    rememberPushTarget({ role: "admin", view: "vehicle-management" });
    expect(seen).toEqual([{ role: "admin", view: "vehicle-management" }]);
  });

  it("stops notifying after unsubscribe", () => {
    const fn = vi.fn();
    const off = onPushTarget(fn);
    off();
    rememberPushTarget({ view: "home" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("tells every subscriber even if one throws", () => {
    const good = vi.fn();
    onPushTarget(() => { throw new Error("bad subscriber"); });
    onPushTarget(good);
    expect(() => rememberPushTarget({ view: "home" })).not.toThrow();
    expect(good).toHaveBeenCalled();
  });
});
