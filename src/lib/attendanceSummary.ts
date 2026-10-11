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

/** +05:30. The same constant the receiver uses. */
export const IST_OFFSET_MINUTES = 330;

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

export type NameMap = Record<string, { name: string; role: string }>;

/**
 * Group rows into one line per person per Indian day.
 *
 * "In" is the first entry of the day and "Out" the last exit, so hours
 * worked spans the whole day including any mid-day break. With the
 * 3-hour rule now producing entry/exit/entry/exit for a split shift,
 * that overstates time actually on site — worth deciding separately
 * rather than changing the meaning of an existing report here.
 */
export function summarizeAttendance(
  logs: StaffLogRow[],
  nameMap: NameMap,
  offsetMinutes = IST_OFFSET_MINUTES,
): DaySummary[] {
  const byDayStaff: Record<string, Record<string, StaffLogRow[]>> = {};

  for (const l of logs) {
    const day = istDateKey(l.timestamp, offsetMinutes);
    if (!day) continue; // unparseable, drop rather than file under 1970
    if (!byDayStaff[day]) byDayStaff[day] = {};
    if (!byDayStaff[day][l.staff_id]) byDayStaff[day][l.staff_id] = [];
    byDayStaff[day][l.staff_id].push(l);
  }

  const result: DaySummary[] = [];
  for (const [date, staffMap] of Object.entries(byDayStaff).sort(
    (a, b) => b[0].localeCompare(a[0]),
  )) {
    for (const [staffId, entries] of Object.entries(staffMap)) {
      const info = nameMap[staffId];
      const entryTimes = entries
        .filter((e) => e.action_type === "entry").map((e) => e.timestamp).sort();
      const exitTimes = entries
        .filter((e) => e.action_type === "exit").map((e) => e.timestamp).sort().reverse();

      const first_entry = entryTimes[0] ?? null;
      const last_exit = exitTimes[0] ?? null;

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
        first_entry,
        last_exit,
        hours_worked,
      });
    }
  }
  return result;
}
