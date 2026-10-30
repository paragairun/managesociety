import { describe, it, expect } from "vitest";
import { qrMatrix, isDark, darkRuns, QR_MARGIN } from "./qrMatrix";

describe("encoding a QR matrix", () => {
  it("produces a square grid of the declared size", () => {
    const m = qrMatrix("STF-abc123");
    expect(m.size).toBeGreaterThan(0);
    expect(m.modules).toHaveLength(m.size * m.size);
    expect(m.margin).toBe(QR_MARGIN);
  });

  it("is deterministic, so the two platforms draw the same code", () => {
    // The whole reason this module exists: a guard's scanner reads
    // these, and the website and the app must encode identically.
    const a = qrMatrix("VEH-MH12AB1234");
    const b = qrMatrix("VEH-MH12AB1234");
    expect(a).toEqual(b);
  });

  it("grows with the payload rather than truncating it", () => {
    const small = qrMatrix("A");
    const big = qrMatrix(JSON.stringify({
      request_id: "9f95f53b-40ec-4610-b50f-2da13fea3af2",
      visitor_name: "A rather long visitor name here",
      flat: "A-1201", issued: "2026-10-30T10:00:00.000Z",
    }));
    expect(big.size).toBeGreaterThan(small.size);
  });

  it("refuses an empty payload instead of encoding nothing", () => {
    expect(() => qrMatrix("")).toThrow(/empty/i);
  });

  it("has the three finder patterns every QR needs", () => {
    // A 7x7 finder sits in three corners: dark outer ring, light inner
    // ring, dark 3x3 core. If these are missing the matrix is not a QR
    // code, whatever else it looks like.
    const m = qrMatrix("hello");
    const finder = (top: number, left: number) => {
      for (let r = 0; r < 7; r += 1) {
        for (let c = 0; c < 7; c += 1) {
          const ring = r === 0 || r === 6 || c === 0 || c === 6;
          const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          if (isDark(m, top + r, left + c) !== (ring || core)) return false;
        }
      }
      return true;
    };

    expect(finder(0, 0)).toBe(true);
    expect(finder(0, m.size - 7)).toBe(true);
    expect(finder(m.size - 7, 0)).toBe(true);

    // The fourth corner carries data, not a finder. Checking a single
    // module there proves nothing — it can legitimately be dark — so
    // this asserts the whole 7x7 is not a finder.
    expect(finder(m.size - 7, m.size - 7)).toBe(false);
  });

  it("has both dark and light modules", () => {
    const m = qrMatrix("STF-abc123");
    expect(m.modules.some(Boolean)).toBe(true);
    expect(m.modules.some((x) => !x)).toBe(true);
  });
});

describe("reading a module", () => {
  it("reads outside the grid as light rather than throwing", () => {
    // Callers draw a quiet zone around the code, so they index past the
    // edges as a matter of course.
    const m = qrMatrix("hello");
    expect(isDark(m, -1, 0)).toBe(false);
    expect(isDark(m, 0, -1)).toBe(false);
    expect(isDark(m, m.size, 0)).toBe(false);
    expect(isDark(m, 0, m.size)).toBe(false);
  });
});

describe("collapsing to runs", () => {
  const m = qrMatrix("STF-abc123");

  it("covers exactly the dark modules, no more and no less", () => {
    const painted = new Set<string>();
    for (const run of darkRuns(m)) {
      for (let i = 0; i < run.length; i += 1) painted.add(`${run.row},${run.col + i}`);
    }
    let darkCount = 0;
    for (let row = 0; row < m.size; row += 1) {
      for (let col = 0; col < m.size; col += 1) {
        if (isDark(m, row, col)) {
          darkCount += 1;
          expect(painted.has(`${row},${col}`)).toBe(true);
        } else {
          expect(painted.has(`${row},${col}`)).toBe(false);
        }
      }
    }
    expect(painted.size).toBe(darkCount);
  });

  it("roughly halves the rectangle count", () => {
    // Measured, not hoped for. QR data is high-entropy by design, so
    // the average run is about two modules and half is the realistic
    // ceiling — 117 runs for 222 dark modules here. If this assertion
    // ever tightens dramatically, suspect the encoder changed rather
    // than celebrating.
    const runs = darkRuns(m);
    const darkCount = m.modules.filter(Boolean).length;
    expect(runs.length).toBeLessThan(darkCount);
    expect(runs.length).toBeLessThanOrEqual(darkCount * 0.6);
    expect(runs.length).toBeGreaterThan(darkCount * 0.3);
  });

  it("never emits a zero-length run", () => {
    for (const run of darkRuns(m)) expect(run.length).toBeGreaterThan(0);
  });

  it("never runs past the edge of a row", () => {
    for (const run of darkRuns(m)) {
      expect(run.col).toBeGreaterThanOrEqual(0);
      expect(run.col + run.length).toBeLessThanOrEqual(m.size);
    }
  });

  it("closes a run that reaches the last column", () => {
    // The loop runs one past the end on purpose to flush an open run;
    // without that, a code whose row ends dark would lose its last run.
    const runs = darkRuns(m);
    const touching = runs.filter((r) => r.col + r.length === m.size);
    for (const run of touching) expect(isDark(m, run.row, m.size - 1)).toBe(true);
  });
});
