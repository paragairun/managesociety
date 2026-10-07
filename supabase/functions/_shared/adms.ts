/**
 * ADMS / iClock push protocol — the parts that are pure logic.
 *
 * eSSL terminals (K90 Pro, X990, uFace, AiFace...) are rebadged ZKTeco
 * hardware and speak the same push protocol. The device identifies the
 * person ON THE DEVICE and then reports who punched; it never sends a
 * fingerprint image or template to us. So this is attendance ingestion,
 * not biometric matching.
 *
 * The terminal appends its own paths to the server address you configure:
 *
 *   GET  /iclock/cdata?SN=..&options=all&pushver=..   handshake, wants config
 *   POST /iclock/cdata?SN=..&table=ATTLOG             punches, wants "OK"
 *   GET  /iclock/getrequest?SN=..                     asks for commands
 *   POST /iclock/devicecmd?SN=..                      reports command results
 *
 * Some eSSL firmware appends ".aspx" to those paths, so routing tolerates
 * both. Everything here is dependency-free and runs under both Deno and
 * Node, which is what lets the test suite exercise it without hardware.
 */

export type AdmsEndpoint = "cdata" | "getrequest" | "devicecmd" | "ping" | "unknown";

/** Which protocol endpoint a request path refers to. */
export function routeEndpoint(pathname: string): AdmsEndpoint {
  // Strip any prefix the deployment adds (e.g. /functions/v1/essl-push)
  // and the optional .aspx suffix some eSSL firmware uses.
  const m = pathname.toLowerCase().match(/\/iclock\/([a-z]+)(?:\.aspx)?\/?$/);
  if (!m) return "unknown";
  switch (m[1]) {
    case "cdata": return "cdata";
    case "getrequest": return "getrequest";
    case "devicecmd": return "devicecmd";
    case "ping": return "ping";
    default: return "unknown";
  }
}

export interface AttendanceRecord {
  /** Device user id, as enrolled on the terminal. */
  pin: string;
  /** ISO 8601 UTC. */
  timestamp: string;
  /** Raw device status code (0 = check-in, 1 = check-out, and so on). */
  status: number;
  /** Verify mode: 1 = fingerprint, 3 = password, 4 = card. */
  verifyMode: number;
  /** The original line, kept for the audit trail. */
  raw: string;
}

export interface ParseResult {
  records: AttendanceRecord[];
  /** Lines that could not be parsed, with the reason. */
  skipped: { line: string; reason: string }[];
}

/**
 * Parse an ATTLOG body.
 *
 * Two shapes are seen in the wild and both appear here:
 *   positional:  1001\t2026-08-10 10:00:00\t0\t1
 *   keyed:       PIN=1001\tDateTime=2026-08-10 10:00:00\tStatus=0\tVerified=1
 *
 * Device clocks are local time with no offset, so a timezone must be
 * supplied to convert correctly. Guessing UTC would shift every punch by
 * 5.5 hours in India, which is the difference between a morning shift and
 * the previous evening.
 */
export function parseAttlog(body: string, tzOffsetMinutes: number): ParseResult {
  const records: AttendanceRecord[] = [];
  const skipped: { line: string; reason: string }[] = [];

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const cells = rawLine.split("\t").map((c) => c.trim()).filter((c) => c !== "");
    if (cells.length < 2) {
      skipped.push({ line, reason: "fewer than 2 fields" });
      continue;
    }

    const keyed = cells.some((c) => /^[A-Za-z]+=/.test(c));
    let pin: string | undefined;
    let dt: string | undefined;
    let status = 0;
    let verify = 0;

    if (keyed) {
      const map = new Map<string, string>();
      for (const c of cells) {
        const eq = c.indexOf("=");
        if (eq > 0) map.set(c.slice(0, eq).trim().toLowerCase(), c.slice(eq + 1).trim());
      }
      pin = map.get("pin");
      dt = map.get("datetime") ?? map.get("time");
      status = Number(map.get("status") ?? 0);
      verify = Number(map.get("verified") ?? map.get("verify") ?? 0);
    } else {
      pin = cells[0];
      dt = cells[1];
      status = Number(cells[2] ?? 0);
      verify = Number(cells[3] ?? 0);
    }

    if (!pin) { skipped.push({ line, reason: "no PIN" }); continue; }
    if (!dt)  { skipped.push({ line, reason: "no timestamp" }); continue; }

    const iso = deviceTimeToIso(dt, tzOffsetMinutes);
    if (!iso) { skipped.push({ line, reason: `unparseable timestamp "${dt}"` }); continue; }

    records.push({
      pin: String(pin),
      timestamp: iso,
      status: Number.isFinite(status) ? status : 0,
      verifyMode: Number.isFinite(verify) ? verify : 0,
      raw: line,
    });
  }

  return { records, skipped };
}

/**
 * "2026-08-10 10:00:00" in device-local time -> ISO 8601 UTC.
 * Returns null rather than an invalid Date, so a malformed line is
 * skipped and reported instead of silently becoming 1970.
 */
export function deviceTimeToIso(value: string, tzOffsetMinutes: number): string | null {
  const m = value.trim().match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const year = +y, month = +mo, day = +d, hour = +h, minute = +mi, sec = +(s ?? 0);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || sec > 59) return null;

  const utcMs = Date.UTC(year, month - 1, day, hour, minute, sec) - tzOffsetMinutes * 60000;
  const dt = new Date(utcMs);
  if (Number.isNaN(dt.getTime())) return null;

  // Reject dates that rolled over, e.g. 31 February.
  const check = new Date(utcMs + tzOffsetMinutes * 60000);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;

  return dt.toISOString();
}

export interface HandshakeOptions {
  serialNumber: string;
  /** Device timezone in hours, e.g. 5.5 for IST. */
  timezoneHours: number;
  /** Seconds between polls when idle. */
  delaySeconds?: number;
  /** Seconds to wait after an error before retrying. */
  errorDelaySeconds?: number;
  /** 1 = push each punch immediately rather than batching. */
  realtime?: boolean;
}

/**
 * The config block a terminal expects from GET /iclock/cdata?options=all.
 * Field names are fixed by the protocol. The device parses this literally,
 * so the trailing newline and CRLF-free formatting matter.
 */
export function buildHandshakeResponse(opts: HandshakeOptions): string {
  const {
    serialNumber, timezoneHours,
    delaySeconds = 10, errorDelaySeconds = 30, realtime = true,
  } = opts;

  return [
    `GET OPTION FROM: ${serialNumber}`,
    `Stamp=${Math.floor(Date.now() / 1000)}`,
    `OpStamp=${Math.floor(Date.now() / 1000)}`,
    `ErrorDelay=${errorDelaySeconds}`,
    `Delay=${delaySeconds}`,
    `TransTimes=00:00;14:05`,
    `TransInterval=1`,
    `TransFlag=TransData AttLog OpLog AttPhoto EnrollUser ChgUser EnrollFP ChgFP UserPic`,
    `TimeZone=${timezoneHours}`,
    `Realtime=${realtime ? 1 : 0}`,
    `Encrypt=0`,
    "",
  ].join("\n");
}

/** The device treats any body other than this as a failure and retries. */
export function okResponse(count?: number): string {
  return count === undefined ? "OK" : `OK: ${count}`;
}

/** Device status code -> what it means for our entry/exit log. */
export type PunchDirection = "entry" | "exit" | "unknown";

export function directionFromStatus(status: number): PunchDirection {
  // 0 = check-in, 1 = check-out. 4/5 are overtime in/out on some firmware.
  switch (status) {
    case 0: case 4: return "entry";
    case 1: case 5: return "exit";
    default: return "unknown";
  }
}

export function verifyModeLabel(mode: number): string {
  switch (mode) {
    case 1: return "fingerprint";
    case 3: return "password";
    case 4: return "card";
    case 15: return "face";
    default: return "other";
  }
}

/**
 * Deduplication key. Terminals re-send a batch whenever they do not get a
 * clean "OK", so the same punch arrives repeatedly and must be idempotent.
 */
export function punchKey(serialNumber: string, r: AttendanceRecord): string {
  return `${serialNumber}:${r.pin}:${r.timestamp}:${r.status}`;
}
