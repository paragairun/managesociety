import { describe, it, expect, vi } from "vitest";
import { FingerprintListener, type AttendanceEvent, type ListenerStatus } from "./fingerprintListener";
import {
  FingerprintError, type Candidate, type CaptureResult,
  type FingerprintDriver, type MatchResult,
} from "./fingerprint";

/**
 * A scriptable driver. `script` is consumed one entry per capture() call,
 * so a test can describe a queue of people walking up to the reader.
 */
type Step =
  | { kind: "finger"; template: string }
  | { kind: "idle" }                      // nobody there
  | { kind: "boom"; message?: string };   // reader fell over

class ScriptedDriver implements FingerprintDriver {
  readonly id = "scripted";
  readonly label = "Scripted";
  captures = 0;
  available = true;

  constructor(private script: Step[], private gallery: Candidate[] = []) {}

  async isAvailable() { return this.available; }

  async capture(): Promise<CaptureResult> {
    this.captures++;
    const step = this.script.shift() ?? { kind: "idle" as const };
    if (step.kind === "idle") throw new FingerprintError("no finger", "no_finger");
    if (step.kind === "boom") throw new FingerprintError(step.message ?? "reader died", "driver_error");
    return { template: step.template, templateFormat: "ISO-19794-2", quality: 80, deviceModel: "TEST" };
  }

  async identify(probe: CaptureResult): Promise<MatchResult | null> {
    const hit = this.gallery.find((c) => c.template === probe.template);
    return hit ? { candidate: hit, score: 90 } : null;
  }
}

const person = (id: string, template: string): Candidate => ({
  enrollmentId: `enr-${id}`, subjectId: id, subjectCategory: "society_staff",
  fingerPosition: 2, template, name: `Person ${id}`, role: "Maid",
});

/** Deterministic clock + sleep so no test waits on real time. */
function harness(driver: FingerprintDriver, gallery: Candidate[], opts = {}) {
  let clock = 0;
  const events: AttendanceEvent[] = [];
  const statuses: ListenerStatus[] = [];
  let unknown = 0;

  const listener = new FingerprintListener(driver, {
    loadGallery: async () => gallery,
    onAttendance: (e) => { events.push(e); },
    onUnknownFinger: () => { unknown++; },
    onStatus: (s) => { statuses.push(s); },
  }, {
    captureTimeoutMs: 10,
    cooldownMs: 1000,
    reconnectMs: 100,
    galleryTtlMs: 5000,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    ...opts,
  });

  return {
    listener, events, statuses,
    get unknown() { return unknown; },
    advance: (ms: number) => { clock += ms; },
    now: () => clock,
  };
}

/** Let the listener's async loop run a bounded number of turns. */
const settle = async (turns = 60) => {
  for (let i = 0; i < turns; i++) await Promise.resolve();
};

describe("always-on behaviour", () => {
  it("logs attendance with no user interaction at all", async () => {
    const gallery = [person("a", "AAA")];
    const driver = new ScriptedDriver([{ kind: "finger", template: "AAA" }], gallery);
    const h = harness(driver, gallery);

    h.listener.start();
    await settle();
    await h.listener.stop();

    expect(h.events).toHaveLength(1);
    expect(h.events[0].candidate.name).toBe("Person a");
  });

  it("keeps reading one person after another without restarting", async () => {
    const gallery = [person("a", "AAA"), person("b", "BBB"), person("c", "CCC")];
    const driver = new ScriptedDriver([
      { kind: "finger", template: "AAA" },
      { kind: "finger", template: "BBB" },
      { kind: "finger", template: "CCC" },
    ], gallery);
    const h = harness(driver, gallery);

    h.listener.start();
    await settle(200);
    await h.listener.stop();

    expect(h.events.map((e) => e.candidate.subjectId)).toEqual(["a", "b", "c"]);
  });

  it("treats an idle reader as normal and keeps polling silently", async () => {
    const gallery = [person("a", "AAA")];
    const driver = new ScriptedDriver([
      { kind: "idle" }, { kind: "idle" }, { kind: "finger", template: "AAA" },
    ], gallery);
    const h = harness(driver, gallery);

    h.listener.start();
    await settle(200);
    await h.listener.stop();

    expect(h.events).toHaveLength(1);
    expect(h.statuses).not.toContain("error");
    expect(driver.captures).toBeGreaterThanOrEqual(3);
  });
});

describe("one touch is one log", () => {
  it("ignores a finger left resting on the platen", async () => {
    const gallery = [person("a", "AAA")];
    // The same finger read five times in a row, as a resting finger would be.
    const driver = new ScriptedDriver(
      Array.from({ length: 5 }, () => ({ kind: "finger" as const, template: "AAA" })),
      gallery,
    );
    const h = harness(driver, gallery);

    h.listener.start();
    await settle(200);
    await h.listener.stop();

    expect(h.events).toHaveLength(1);
  });

  it("logs the same person again once the cooldown has passed", async () => {
    const gallery = [person("a", "AAA")];
    const driver = new ScriptedDriver([{ kind: "finger", template: "AAA" }], gallery);
    const h = harness(driver, gallery);

    h.listener.start();
    await settle();
    expect(h.events).toHaveLength(1);

    h.advance(2000); // past the 1000ms cooldown
    driver["script"].push({ kind: "finger", template: "AAA" });
    await settle(200);
    await h.listener.stop();

    expect(h.events).toHaveLength(2);
  });

  it("does not let one person's cooldown block the next person", async () => {
    const gallery = [person("a", "AAA"), person("b", "BBB")];
    const driver = new ScriptedDriver([
      { kind: "finger", template: "AAA" },
      { kind: "finger", template: "AAA" },
      { kind: "finger", template: "BBB" },
    ], gallery);
    const h = harness(driver, gallery);

    h.listener.start();
    await settle(200);
    await h.listener.stop();

    expect(h.events.map((e) => e.candidate.subjectId)).toEqual(["a", "b"]);
  });
});

describe("unknown fingers", () => {
  it("reports an unrecognised finger without logging attendance", async () => {
    const gallery = [person("a", "AAA")];
    const driver = new ScriptedDriver([{ kind: "finger", template: "ZZZ" }], gallery);
    const h = harness(driver, gallery);

    h.listener.start();
    await settle(200);
    await h.listener.stop();

    expect(h.events).toHaveLength(0);
    expect(h.unknown).toBeGreaterThanOrEqual(1);
  });
});

describe("hardware comes and goes", () => {
  it("waits in 'searching' when no reader is attached", async () => {
    const driver = new ScriptedDriver([], []);
    driver.available = false;
    const h = harness(driver, []);

    h.listener.start();
    await settle(50);

    expect(h.listener.getStatus()).toBe("searching");
    expect(driver.captures).toBe(0);
    await h.listener.stop();
  });

  it("arms itself automatically when the reader is plugged in later", async () => {
    const gallery = [person("a", "AAA")];
    const driver = new ScriptedDriver([{ kind: "finger", template: "AAA" }], gallery);
    driver.available = false;
    const h = harness(driver, gallery);

    h.listener.start();
    await settle(30);
    expect(h.events).toHaveLength(0);

    driver.available = true;     // guard plugs the scanner in
    await settle(200);
    await h.listener.stop();

    expect(h.events).toHaveLength(1);
  });

  it("recovers after the reader throws, instead of dying", async () => {
    const gallery = [person("a", "AAA")];
    const driver = new ScriptedDriver([
      { kind: "boom", message: "USB unplugged" },
      { kind: "finger", template: "AAA" },
    ], gallery);
    const h = harness(driver, gallery);

    h.listener.start();
    await settle(300);
    await h.listener.stop();

    expect(h.statuses).toContain("error");
    expect(h.events).toHaveLength(1);
  });
});

describe("lifecycle", () => {
  it("reports stopped and stops capturing after stop()", async () => {
    const gallery = [person("a", "AAA")];
    const driver = new ScriptedDriver([{ kind: "idle" }], gallery);
    const h = harness(driver, gallery);

    h.listener.start();
    await settle(30);
    await h.listener.stop();
    const capturesAtStop = driver.captures;

    await settle(60);
    expect(driver.captures).toBe(capturesAtStop);
    expect(h.listener.getStatus()).toBe("stopped");
    expect(h.listener.isRunning()).toBe(false);
  });

  it("start() twice does not run two loops", async () => {
    const gallery = [person("a", "AAA")];
    const driver = new ScriptedDriver([], gallery);
    const h = harness(driver, gallery);

    h.listener.start();
    h.listener.start();
    await settle(40);
    await h.listener.stop();
    // Baseline AFTER the stop handshake has drained: the loop legitimately
    // finishes its in-flight cycle while stop() awaits it.
    const afterStop = driver.captures;

    await settle(40);
    expect(driver.captures).toBe(afterStop);
  });

  it("caches the gallery instead of re-reading it every cycle", async () => {
    const gallery = [person("a", "AAA")];
    const loadGallery = vi.fn(async () => gallery);
    let clock = 0;
    const driver = new ScriptedDriver([{ kind: "idle" }, { kind: "idle" }, { kind: "idle" }], gallery);
    const listener = new FingerprintListener(driver, { loadGallery }, {
      captureTimeoutMs: 10, cooldownMs: 1000, reconnectMs: 100, galleryTtlMs: 5000,
      now: () => clock, sleep: async (ms) => { clock += ms; },
    });

    listener.start();
    await settle(100);
    await listener.stop();

    expect(loadGallery).toHaveBeenCalledTimes(1);
    expect(driver.captures).toBeGreaterThan(1);
  });

  it("re-reads the gallery after invalidateGallery(), so new enrolments work", async () => {
    const gallery = [person("a", "AAA")];
    const loadGallery = vi.fn(async () => gallery);
    let clock = 0;
    const driver = new ScriptedDriver([{ kind: "idle" }, { kind: "idle" }], gallery);
    const listener = new FingerprintListener(driver, { loadGallery }, {
      captureTimeoutMs: 10, cooldownMs: 1000, reconnectMs: 100, galleryTtlMs: 5000,
      now: () => clock, sleep: async (ms) => { clock += ms; },
    });

    listener.start();
    await settle(40);
    listener.invalidateGallery();
    await settle(60);
    await listener.stop();

    expect(loadGallery.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
