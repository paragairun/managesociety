/**
 * Turning raw entry/exit rows into the per-day attendance table.
 *
 * Pulled out of StaffAttendanceLog.tsx so the date arithmetic can be
 * tested. It is all timezone work, and timezone bugs do not announce
 * themselves on screen — they just put a row on the wrong day.
 *
 * staff_logs.timestamp is stored in UTC. Everyone reading this dashboard
 * is on Indian time, and the receiver already decides entry and exit
 * against the Indian day, so the dashboard has to group by the same
 * boundary or the two disagree about what "today" means.
 */

/** +05:30. The same constant the receiver and the database use. */
export const IST_OFFSET_MINUTES = 330;

/**
 * A night shift's day starts at 09:00 and runs to 09:00, so a shift
 * worked 22:00 Monday to 06:00 Tuesday is reported under Monday. Matches
 * _night_start in public.shift_day_start().
 */
export const NIGHT_SHIFT_START_HOUR = 9;

export type StaffShift = "day" | "night";

export interface StaffLogRow {
  id: string;
  staff_id: string;
  category: "society_staff" | "house_help";
  action_type: "entry" | "exit";
  timestamp: string;
}

export interface DaySummary {
  date: string;              // YYYY-MM-DD in Indian time
  staff_id: string;
  staff_name: string;
  staff_role: string;
  shift: StaffShift;
  first_entry: string | null;
  last_exit: string | null;
  hours_worked: number | null;
}

/**
 * Which Indian calendar day a UTC instant belongs to.
 *
 * This replaces `timestamp.slice(0, 10)`, which reads the date straight
 * off the UTC string. Anything punched between 00:00 and 05:29 Indian
 * time is the previous day in UTC, so a maid arriving at 05:00 was being
 * filed under yesterday — and with her exit that evening landing on
 * today, both days showed a single half of the pair and no hours at all.
 */
export function istDateKey(iso: string, offsetMinutes = IST_OFFSET_MINUTES): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t + offsetMinutes * 60000).toISOString().slice(0, 10);
}

/**
 * Which shift day a moment belongs to, as a YYYY-MM-DD key.
 *
 * Day shift: the Indian calendar date. Night shift: the date the
 * 09:00-to-09:00 window began, so 02:00 on the 13th reports under the
 * 12th. This is the TypeScript twin of public.shift_day_start(); the two
 * are checked against each other by a test that walks every hour of a
 * two-day span.
 */
export function shiftDayKey(
  iso: string,
  shift: StaffShift,
  offsetMinutes = IST_OFFSET_MINUTES,
): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  let local = t + offsetMinutes * 60000;
  if (shift === "night" && new Date(local).getUTCHours() < NIGHT_SHIFT_START_HOUR) {
    // Anything before 09:00 belongs to the window that opened yesterday.
    local -= 86400000;
  }
  return new Date(local).toISOString().slice(0, 10);
}

/**
 * The UTC instants bounding an Indian calendar month, for the query.
 *
 * The previous version built these with `new Date(year, month, 1)`,
 * which uses whatever timezone the BROWSER is set to. On a phone set to
 * another zone — or a Capacitor build on a traveller's handset — the
 * month window slid and the first or last day of the month dropped out.
 * `end` is exclusive, so there is no 23:59:59 gap to lose a punch in.
 */
export function istMonthRange(
  year: number,
  month: number, // 0-11
  offsetMinutes = IST_OFFSET_MINUTES,
): { start: string; end: string } {
  const off = offsetMinutes * 60000;
  return {
    start: new Date(Date.UTC(year, month, 1) - off).toISOString(),
    end: new Date(Date.UTC(year, month + 1, 1) - off).toISOString(),
  };
}

/** Render an Indian date key as "11 Oct" without going back through UTC. */
export function formatIstDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", timeZone: "UTC",
  });
}

/** Render a stored UTC instant as an Indian clock time. */
export function formatIstTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
  });
}

export interface PersonInfo { name: string; role: string; shift?: StaffShift }
export type NameMap = Record<string, PersonInfo>;

/**
 * Group rows into one line per person per shift.
 *
 * Rows are walked oldest-first and paired: an entry opens a shift, the
 * next exit closes it. The shift is filed under the shift day of its
 * ENTRY, never its exit.
 *
 * That last point is the whole reason this is a walk rather than a
 * group-by. A night guard in at 22:00 on the 13th and out at 10:30 on
 * the 14th has an exit that falls past the 09:00 boundary, so keying
 * each row by its own timestamp filed the pair under two different days
 * and showed half a shift on each. Anchoring on the entry keeps the
 * shift whole, which is the point of the night-shift carry-over.
 *
 * An exit with no open entry before it (the guard logged someone out by
 * QR, or history starts mid-shift) still gets a row of its own so the
 * punch is never silently dropped.
 *
 * "In" is the first entry of the shift and "Out" the last exit, so hours
 * span any mid-shift break.
 */
export function summarizeAttendance(
  logs: StaffLogRow[],
  nameMap: NameMap,
  offsetMinutes = IST_OFFSET_MINUTES,
): DaySummary[] {
  const byPerson = new Map<string, StaffLogRow[]>();
  for (const l of logs) {
    if (!Date.parse(l.timestamp)) continue; // unparseable, never file under 1970
    const list = byPerson.get(l.staff_id);
    if (list) list.push(l);
    else byPerson.set(l.staff_id, [l]);
  }

  const result: DaySummary[] = [];

  for (const [staffId, rows] of byPerson) {
    const info = nameMap[staffId];
    const shift: StaffShift = info?.shift === "night" ? "night" : "day";
    rows.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    // One bucket per shift, keyed by the entry's shift day. A second
    // entry on the same shift day (a split shift) joins the same bucket.
    const buckets = new Map<string, { entries: string[]; exits: string[] }>();
    let openKey: string | null = null;

    const bucket = (key: string) => {
      let b = buckets.get(key);
      if (!b) { b = { entries: [], exits: [] }; buckets.set(key, b); }
      return b;
    };

    for (const r of rows) {
      if (r.action_type === "entry") {
        openKey = shiftDayKey(r.timestamp, shift, offsetMinutes);
        bucket(openKey).entries.push(r.timestamp);
      } else {
        // Closes the open shift if there is one; otherwise it stands on
        // its own day rather than vanishing.
        const key = openKey ?? shiftDayKey(r.timestamp, shift, offsetMinutes);
        bucket(key).exits.push(r.timestamp);
        openKey = null;
      }
    }

    for (const [date, b] of buckets) {
      const first_entry = b.entries.length ? b.entries[0] : null;
      const last_exit = b.exits.length ? b.exits[b.exits.length - 1] : null;

      let hours_worked: number | null = null;
      if (first_entry && last_exit && last_exit > first_entry) {
        hours_worked = Math.round(
          (new Date(last_exit).getTime() - new Date(first_entry).getTime()) / 36000,
        ) / 100;
      }

      result.push({
        date,
        staff_id: staffId,
        staff_name: info?.name ?? "Unknown",
        staff_role: info?.role ?? "",
        shift,
        first_entry,
        last_exit,
        hours_worked,
      });
    }
  }

  // Newest shift day first, then by name so the table is stable.
  return result.sort(
    (a, b) => b.date.localeCompare(a.date) || a.staff_name.localeCompare(b.staff_name),
  );
}
