import { describe, it, expect } from "vitest";
import {
  routeEndpoint, parseAttlog, deviceTimeToIso, buildHandshakeResponse,
  okResponse, directionFromStatus, verifyModeLabel, punchKey,
} from "../../supabase/functions/_shared/adms";

const IST = 330; // +05:30 in minutes

describe("routing the device's own paths", () => {
  it.each([
    ["/iclock/cdata", "cdata"],
    ["/iclock/getrequest", "getrequest"],
    ["/iclock/devicecmd", "devicecmd"],
    ["/iclock/ping", "ping"],
  ])("routes %s", (path, expected) => {
    expect(routeEndpoint(path)).toBe(expected);
  });

  it("tolerates the .aspx suffix some eSSL firmware appends", () => {
    expect(routeEndpoint("/iclock/cdata.aspx")).toBe("cdata");
    expect(routeEndpoint("/iclock/getrequest.aspx")).toBe("getrequest");
  });

  it("works behind a deployment path prefix", () => {
    expect(routeEndpoint("/functions/v1/essl-push/iclock/cdata")).toBe("cdata");
  });

  it("is case-insensitive", () => {
    expect(routeEndpoint("/iClock/CData")).toBe("cdata");
  });

  it("ignores a trailing slash", () => {
    expect(routeEndpoint("/iclock/cdata/")).toBe("cdata");
  });

  it("rejects anything else", () => {
    expect(routeEndpoint("/")).toBe("unknown");
    expect(routeEndpoint("/iclock/")).toBe("unknown");
    expect(routeEndpoint("/admin/cdata")).toBe("unknown");
  });
});

describe("device time conversion", () => {
  it("treats device time as IST and returns UTC", () => {
    // 10:00 IST is 04:30 UTC. Getting this wrong shifts every punch.
    expect(deviceTimeToIso("2026-08-10 10:00:00", IST)).toBe("2026-08-10T04:30:00.000Z");
  });

  it("handles a punch just after midnight, which rolls back a day in UTC", () => {
    expect(deviceTimeToIso("2026-08-10 00:15:00", IST)).toBe("2026-08-09T18:45:00.000Z");
  });

  it("accepts a missing seconds field", () => {
    expect(deviceTimeToIso("2026-08-10 10:00", IST)).toBe("2026-08-10T04:30:00.000Z");
  });

  it("accepts the T separator", () => {
    expect(deviceTimeToIso("2026-08-10T10:00:00", IST)).toBe("2026-08-10T04:30:00.000Z");
  });

  it("works at UTC offset zero", () => {
    expect(deviceTimeToIso("2026-08-10 10:00:00", 0)).toBe("2026-08-10T10:00:00.000Z");
  });

  it("rejects an impossible date instead of silently rolling over", () => {
    expect(deviceTimeToIso("2026-02-31 10:00:00", IST)).toBe(null);
  });

  it("rejects an impossible time", () => {
    expect(deviceTimeToIso("2026-08-10 25:00:00", IST)).toBe(null);
  });

  it("rejects junk", () => {
    expect(deviceTimeToIso("not a date", IST)).toBe(null);
    expect(deviceTimeToIso("", IST)).toBe(null);
  });
});

describe("parsing ATTLOG bodies", () => {
  it("parses the positional format", () => {
    const { records, skipped } = parseAttlog("1001\t2026-08-10 10:00:00\t0\t1", IST);
    expect(skipped).toEqual([]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      pin: "1001", timestamp: "2026-08-10T04:30:00.000Z", status: 0, verifyMode: 1,
    });
  });

  it("parses the keyed format", () => {
    const body = "PIN=1001\tDateTime=2026-08-10 14:32:11\tVerified=1\tStatus=0";
    const { records, skipped } = parseAttlog(body, IST);
    expect(skipped).toEqual([]);
    expect(records[0]).toMatchObject({ pin: "1001", status: 0, verifyMode: 1 });
  });

  it("parses a multi-line batch", () => {
    const body = [
      "1001\t2026-08-10 09:00:00\t0\t1",
      "1002\t2026-08-10 09:01:30\t0\t1",
      "1003\t2026-08-10 18:05:00\t1\t4",
    ].join("\n");
    const { records } = parseAttlog(body, IST);
    expect(records.map((r) => r.pin)).toEqual(["1001", "1002", "1003"]);
    expect(records[2].verifyMode).toBe(4);
  });

  it("handles CRLF line endings", () => {
    const { records } = parseAttlog("1001\t2026-08-10 09:00:00\t0\t1\r\n", IST);
    expect(records).toHaveLength(1);
  });

  it("keeps good lines and reports bad ones rather than failing the batch", () => {
    // A rejected batch is re-sent forever, so one bad line must not poison it.
    const body = [
      "1001\t2026-08-10 09:00:00\t0\t1",
      "garbage",
      "1002\tnot-a-date\t0\t1",
      "1003\t2026-08-10 09:02:00\t0\t1",
    ].join("\n");
    const { records, skipped } = parseAttlog(body, IST);
    expect(records.map((r) => r.pin)).toEqual(["1001", "1003"]);
    expect(skipped).toHaveLength(2);
    expect(skipped[1].reason).toMatch(/unparseable timestamp/);
  });

  it("returns nothing for an empty body without throwing", () => {
    expect(parseAttlog("", IST)).toEqual({ records: [], skipped: [] });
    expect(parseAttlog("\n\n", IST)).toEqual({ records: [], skipped: [] });
  });

  it("defaults status and verify when the device omits them", () => {
    const { records } = parseAttlog("1001\t2026-08-10 09:00:00", IST);
    expect(records[0]).toMatchObject({ status: 0, verifyMode: 0 });
  });

  it("keeps the raw line for the audit trail", () => {
    const { records } = parseAttlog("1001\t2026-08-10 09:00:00\t0\t1", IST);
    expect(records[0].raw).toContain("1001");
  });

  it("preserves leading zeros in the PIN", () => {
    const { records } = parseAttlog("0042\t2026-08-10 09:00:00\t0\t1", IST);
    expect(records[0].pin).toBe("0042");
  });
});

describe("handshake response", () => {
  const res = buildHandshakeResponse({ serialNumber: "BOCK200961014", timezoneHours: 5.5 });

  it("opens with the exact header the device expects", () => {
    expect(res.startsWith("GET OPTION FROM: BOCK200961014")).toBe(true);
  });

  it("declares the device timezone", () => {
    expect(res).toContain("TimeZone=5.5");
  });

  it("enables realtime push by default", () => {
    expect(res).toContain("Realtime=1");
  });

  it("can disable realtime", () => {
    expect(buildHandshakeResponse({ serialNumber: "X", timezoneHours: 5.5, realtime: false }))
      .toContain("Realtime=0");
  });

  it("includes the delays and transfer flags", () => {
    expect(res).toMatch(/Delay=10/);
    expect(res).toMatch(/ErrorDelay=30/);
    expect(res).toMatch(/TransFlag=TransData/);
  });

  it("uses bare newlines and ends with one", () => {
    expect(res).not.toContain("\r");
    expect(res.endsWith("\n")).toBe(true);
  });
});

describe("acknowledgements", () => {
  it("returns bare OK", () => {
    expect(okResponse()).toBe("OK");
  });

  it("returns a counted OK for a batch", () => {
    expect(okResponse(3)).toBe("OK: 3");
  });

  it("counts zero explicitly rather than falling back to bare OK", () => {
    expect(okResponse(0)).toBe("OK: 0");
  });
});

describe("interpreting punches", () => {
  it.each([[0, "entry"], [4, "entry"], [1, "exit"], [5, "exit"], [2, "unknown"], [99, "unknown"]])(
    "maps status %i to %s", (status, expected) => {
      expect(directionFromStatus(status as number)).toBe(expected);
    });

  it.each([[1, "fingerprint"], [3, "password"], [4, "card"], [15, "face"], [7, "other"]])(
    "labels verify mode %i", (mode, expected) => {
      expect(verifyModeLabel(mode as number)).toBe(expected);
    });
});

describe("deduplication", () => {
  const rec = {
    pin: "1001", timestamp: "2026-08-10T04:30:00.000Z",
    status: 0, verifyMode: 1, raw: "x",
  };

  it("gives the same punch the same key, so a resend is idempotent", () => {
    expect(punchKey("SN1", rec)).toBe(punchKey("SN1", { ...rec, raw: "different raw" }));
  });

  it("separates the same PIN on two different devices", () => {
    expect(punchKey("SN1", rec)).not.toBe(punchKey("SN2", rec));
  });

  it("separates an entry from an exit at the same instant", () => {
    expect(punchKey("SN1", rec)).not.toBe(punchKey("SN1", { ...rec, status: 1 }));
  });
});
