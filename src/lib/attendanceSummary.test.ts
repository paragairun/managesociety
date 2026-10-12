import { describe, it, expect } from "vitest";
import {
  istDateKey, istMonthRange, formatIstDate, summarizeAttendance,
  shiftDayKey, type StaffLogRow, type NameMap,
} from "./attendanceSummary";

const NAMES: NameMap = {
  "staff-1": { name: "Soniya", role: "Housekeeping", shift: "day" },
  "help-1": { name: "Lata Devi", role: "Maid", shift: "day" },
  "guard-1": { name: "Night Guard", role: "Security", shift: "night" },
};

const row = (staff_id: string, action_type: "entry" | "exit", timestamp: string): StaffLogRow =>
  ({ id: `${staff_id}-${timestamp}`, staff_id, category: "society_staff", action_type, timestamp });

describe("istDateKey", () => {
  it("keeps a daytime punch on its own date", () => {
    // 08:43 IST = 03:13 UTC, same date either way.
    expect(istDateKey("2026-10-11T03:13:00.000Z")).toBe("2026-10-11");
  });

  it("files an early-morning punch under the Indian day, not the UTC one", () => {
    // 05:00 IST on the 11th is 23:30 UTC on the 10th. Reading the date
    // off the UTC string gives "2026-10-10" and splits the shift in two.
    expect("2026-10-10T23:30:00.000Z".slice(0, 10)).toBe("2026-10-10");
    expect(istDateKey("2026-10-10T23:30:00.000Z")).toBe("2026-10-11");
  });

  it("files a 00:15 IST punch under the new day", () => {
    expect(istDateKey("2026-10-10T18:45:00.000Z")).toBe("2026-10-11");
  });

  it("keeps 23:59 IST on the day that is ending", () => {
    expect(istDateKey("2026-10-11T18:29:00.000Z")).toBe("2026-10-11");
  });

  it("returns empty for an unparseable value instead of 1970", () => {
    expect(istDateKey("not a date")).toBe("");
  });
});

describe("istMonthRange", () => {
  it("spans the Indian month, not the browser's", () => {
    const { start, end } = istMonthRange(2026, 9); // October
    expect(start).toBe("2026-09-30T18:30:00.000Z"); // 1 Oct 00:00 IST
    expect(end).toBe("2026-10-31T18:30:00.000Z");   // 1 Nov 00:00 IST
  });

  it("is independent of the machine's timezone", () => {
    // The old code used new Date(y, m, 1), which reads process.env.TZ.
    const tz = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      const a = istMonthRange(2026, 9);
      process.env.TZ = "Asia/Kolkata";
      const b = istMonthRange(2026, 9);
      expect(a).toEqual(b);
    } finally {
      process.env.TZ = tz;
    }
  });

  it("includes the last punch of the month, which an inclusive 23:59:59 bound could miss", () => {
    const { end } = istMonthRange(2026, 9);
    const lastPunch = "2026-10-31T18:29:59.500Z"; // 23:59:59.5 IST on the 31st
    expect(lastPunch < end).toBe(true);
  });

  it("rolls the year over in December", () => {
    expect(istMonthRange(2026, 11).end).toBe("2026-12-31T18:30:00.000Z");
  });
});

describe("formatIstDate", () => {
  it("renders the key it was given", () => {
    expect(formatIstDate("2026-10-11")).toBe("11 Oct");
  });
  it("passes a malformed key through rather than showing Invalid Date", () => {
    expect(formatIstDate("rubbish")).toBe("rubbish");
  });
});

describe("summarizeAttendance", () => {
  it("pairs an entry and exit into one day with hours", () => {
    const out = summarizeAttendance([
      row("staff-1", "entry", "2026-10-11T03:13:00.000Z"), // 08:43 IST
      row("staff-1", "exit", "2026-10-11T12:30:00.000Z"),  // 18:00 IST
    ], NAMES);

    expect(out).toHaveLength(1);
    expect(out[0].staff_name).toBe("Soniya");
    expect(out[0].date).toBe("2026-10-11");
    expect(out[0].hours_worked).toBeCloseTo(9.28, 2);
  });

  it("keeps an early-morning shift on one row", () => {
    // Arrives 05:00 IST, leaves 13:00 IST. Grouping by the UTC date put
    // the arrival on the 10th and the departure on the 11th, so both days
    // showed half a pair and no hours.
    const out = summarizeAttendance([
      row("help-1", "entry", "2026-10-10T23:30:00.000Z"),
      row("help-1", "exit", "2026-10-11T07:30:00.000Z"),
    ], NAMES);

    expect(out).toHaveLength(1);
    expect(out[0].date).toBe("2026-10-11");
    expect(out[0].hours_worked).toBe(8);
  });

  it("shows first in and last out across a split shift", () => {
    const out = summarizeAttendance([
      row("staff-1", "entry", "2026-10-11T03:13:00.000Z"), // 08:43
      row("staff-1", "exit", "2026-10-11T07:15:00.000Z"),  // 12:45
      row("staff-1", "entry", "2026-10-11T11:30:00.000Z"), // 17:00
      row("staff-1", "exit", "2026-10-11T15:00:00.000Z"),  // 20:30
    ], NAMES);

    expect(out).toHaveLength(1);
    expect(out[0].first_entry).toBe("2026-10-11T03:13:00.000Z");
    expect(out[0].last_exit).toBe("2026-10-11T15:00:00.000Z");
  });

  it("leaves hours blank when someone never punched out", () => {
    const out = summarizeAttendance(
      [row("staff-1", "entry", "2026-10-11T03:13:00.000Z")], NAMES);
    expect(out[0].last_exit).toBeNull();
    expect(out[0].hours_worked).toBeNull();
  });

  it("separates people and days, newest day first", () => {
    const out = summarizeAttendance([
      row("staff-1", "entry", "2026-10-11T03:13:00.000Z"),
      row("help-1", "entry", "2026-10-11T03:20:00.000Z"),
      row("staff-1", "entry", "2026-10-10T03:13:00.000Z"),
    ], NAMES);

    expect(out).toHaveLength(3);
    expect(out[0].date).toBe("2026-10-11");
    expect(out[out.length - 1].date).toBe("2026-10-10");
  });

  it("labels a staff_id with no profile rather than dropping the row", () => {
    const out = summarizeAttendance(
      [row("ghost", "entry", "2026-10-11T03:13:00.000Z")], NAMES);
    expect(out[0].staff_name).toBe("Unknown");
  });

  it("drops an unparseable timestamp instead of filing it under 1970", () => {
    const out = summarizeAttendance([
      row("staff-1", "entry", "garbage"),
      row("staff-1", "entry", "2026-10-11T03:13:00.000Z"),
    ], NAMES);
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe("2026-10-11");
  });
});

describe("shiftDayKey", () => {
  it("files a day-shift punch under its own Indian date", () => {
    expect(shiftDayKey("2026-10-12T03:13:00.000Z", "day")).toBe("2026-10-12"); // 08:43 IST
  });

  it("files a night-shift punch before 09:00 under the previous day", () => {
    // 02:00 IST on the 13th = 20:30 UTC on the 12th.
    expect(shiftDayKey("2026-10-12T20:30:00.000Z", "night")).toBe("2026-10-12");
    // 06:00 IST on the 13th
    expect(shiftDayKey("2026-10-13T00:30:00.000Z", "night")).toBe("2026-10-12");
    // 08:30 IST on the 13th - the case Deepak asked about
    expect(shiftDayKey("2026-10-13T03:00:00.000Z", "night")).toBe("2026-10-12");
  });

  it("rolls the night shift day over at 09:00 exactly", () => {
    expect(shiftDayKey("2026-10-13T03:29:59.000Z", "night")).toBe("2026-10-12"); // 08:59:59
    expect(shiftDayKey("2026-10-13T03:30:00.000Z", "night")).toBe("2026-10-13"); // 09:00:00
  });

  it("files a night-shift evening punch under that evening's date", () => {
    expect(shiftDayKey("2026-10-12T16:30:00.000Z", "night")).toBe("2026-10-12"); // 22:00 IST
  });

  it("agrees with the day boundary for a day shift at every hour of two days", () => {
    for (let h = 0; h < 48; h++) {
      const iso = new Date(Date.UTC(2026, 9, 12, 0, 0, 0) + h * 3600000).toISOString();
      expect(shiftDayKey(iso, "day")).toBe(istDateKey(iso));
    }
  });
});

describe("summarizeAttendance - night shift", () => {
  const row = (staff_id: string, action_type: "entry" | "exit", timestamp: string): StaffLogRow =>
    ({ id: `${staff_id}-${timestamp}`, staff_id, category: "society_staff", action_type, timestamp });

  it("keeps an overnight shift on one row, under the date it started", () => {
    const out = summarizeAttendance([
      row("guard-1", "entry", "2026-10-12T16:30:00.000Z"), // 22:00 IST 12th
      row("guard-1", "exit", "2026-10-13T00:30:00.000Z"),  // 06:00 IST 13th
    ], NAMES);

    expect(out).toHaveLength(1);
    expect(out[0].date).toBe("2026-10-12");
    expect(out[0].shift).toBe("night");
    expect(out[0].hours_worked).toBe(8);
  });

  it("keeps the shift whole when the exit falls past 09:00", () => {
    // This is the case that exposed the bug: keying each row by its own
    // timestamp put the entry under the 13th and the exit under the
    // 14th, showing half a shift on each day.
    const out = summarizeAttendance([
      row("guard-1", "entry", "2026-10-13T16:30:00.000Z"), // 22:00 IST 13th
      row("guard-1", "exit", "2026-10-14T05:00:00.000Z"),  // 10:30 IST 14th
    ], NAMES);

    expect(out).toHaveLength(1);
    expect(out[0].date).toBe("2026-10-13");
    expect(out[0].hours_worked).toBe(12.5);
  });

  it("shows an abandoned shift with no exit and blank hours", () => {
    const out = summarizeAttendance([
      row("guard-1", "entry", "2026-10-12T16:30:00.000Z"), // 22:00 IST 12th
      row("guard-1", "entry", "2026-10-13T16:30:00.000Z"), // 22:00 IST 13th, never closed the first
      row("guard-1", "exit", "2026-10-14T00:30:00.000Z"),  // 06:00 IST 14th
    ], NAMES);

    expect(out).toHaveLength(2);
    const twelfth = out.find((d) => d.date === "2026-10-12")!;
    const thirteenth = out.find((d) => d.date === "2026-10-13")!;
    expect(twelfth.last_exit).toBeNull();
    expect(twelfth.hours_worked).toBeNull();
    expect(thirteenth.hours_worked).toBe(8);
  });

  it("treats a person with no shift recorded as day shift", () => {
    const out = summarizeAttendance(
      [row("nobody", "entry", "2026-10-12T20:30:00.000Z")], {});
    expect(out[0].shift).toBe("day");
    expect(out[0].date).toBe("2026-10-13"); // 02:00 IST, a day-shift date
  });

  it("keeps an orphan exit rather than dropping it", () => {
    const out = summarizeAttendance(
      [row("guard-1", "exit", "2026-10-13T00:30:00.000Z")], NAMES);
    expect(out).toHaveLength(1);
    expect(out[0].first_entry).toBeNull();
    expect(out[0].last_exit).not.toBeNull();
  });

  it("does not mix two people's shifts", () => {
    const out = summarizeAttendance([
      row("guard-1", "entry", "2026-10-12T16:30:00.000Z"),
      row("staff-1", "entry", "2026-10-12T03:13:00.000Z"),
      row("guard-1", "exit", "2026-10-13T00:30:00.000Z"),
      row("staff-1", "exit", "2026-10-12T12:30:00.000Z"),
    ], NAMES);
    expect(out).toHaveLength(2);
    expect(out.find((d) => d.staff_id === "guard-1")!.hours_worked).toBe(8);
    expect(out.find((d) => d.staff_id === "staff-1")!.hours_worked).toBeCloseTo(9.28, 2);
  });
});
