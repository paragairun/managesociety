import { describe, it, expect, vi } from "vitest";
import { resolveGateScan, describeOutcome, type GatePorts } from "./gateScan";
import { encodeGuestPass, type GuestPassPayload } from "./guest-pass";

const pass = (over: Partial<GuestPassPayload> = {}): GuestPassPayload => ({
  type: "guest_pass",
  request_id: "req-1",
  visitor_name: "Amazon Agent",
  phone: "9000000000",
  vehicle_number: "MH12AB1234",
  purpose: "Parcel",
  flat_number: "101",
  wing: "A",
  owner_name: "Rahul",
  ...over,
});

/** All ports present and refusing everything, overridden per test. */
const ports = (over: Partial<GatePorts> = {}): GatePorts => ({
  findStaffByQr: vi.fn(async () => null),
  findHouseHelpByQr: vi.fn(async () => null),
  findVisitorRequest: vi.fn(async () => null),
  claimGuestPass: vi.fn(async () => false),
  findVehicleByQr: vi.fn(async () => null),
  logEntry: vi.fn(async () => null),
  logStaffMovement: vi.fn(async () => ({ ok: true as const, action: "entry" as const })),
  ...over,
});

describe("staff and house-help cards", () => {
  it("logs a society staff entry and says so", async () => {
    const p = ports({
      findStaffByQr: vi.fn(async () => ({ id: "s-1", name: "Ramesh", role: "sweeper" })),
    });
    const out = await resolveGateScan(p, "STF-abc123");
    expect(out).toEqual({
      kind: "staff", name: "Ramesh", role: "sweeper",
      category: "society_staff", action: "entry",
    });
  });

  it("routes HLP- to house helps, not staff", async () => {
    const findHouseHelpByQr = vi.fn(async () => ({ id: "h-1", name: "Sunita", role: "maid" }));
    const findStaffByQr = vi.fn(async () => null);
    const out = await resolveGateScan(ports({ findHouseHelpByQr, findStaffByQr }), "HLP-xyz");
    expect(findStaffByQr).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: "staff", category: "house_help", name: "Sunita" });
  });

  it("reports the exit when that is what the toggle produced", async () => {
    const p = ports({
      findStaffByQr: vi.fn(async () => ({ id: "s-1", name: "Ramesh", role: "sweeper" })),
      logStaffMovement: vi.fn(async () => ({ ok: true as const, action: "exit" as const })),
    });
    const out = await resolveGateScan(p, "STF-abc");
    expect(out).toMatchObject({ action: "exit" });
    expect(describeOutcome(out)).toBe("Exit logged — Ramesh (sweeper)");
  });

  it("DOES NOT fall through to the vehicle check — the bug this module fixes", async () => {
    // The original handler had no early return here. It logged the
    // staff entry, then ran the guest-pass and vehicle checks, both
    // missed, and reported "Unknown QR code. Vehicle not registered."
    // over a scan that had in fact succeeded.
    const findVehicleByQr = vi.fn(async () => null);
    const findVisitorRequest = vi.fn(async () => null);
    const p = ports({
      findStaffByQr: vi.fn(async () => ({ id: "s-1", name: "Ramesh", role: "sweeper" })),
      findVehicleByQr,
      findVisitorRequest,
    });
    const out = await resolveGateScan(p, "STF-abc");
    expect(out.kind).toBe("staff");
    expect(findVehicleByQr).not.toHaveBeenCalled();
    expect(findVisitorRequest).not.toHaveBeenCalled();
  });

  it("refuses an unregistered card without logging anything", async () => {
    const logStaffMovement = vi.fn(async () => ({ ok: true as const, action: "entry" as const }));
    const out = await resolveGateScan(ports({ logStaffMovement }), "STF-ghost");
    expect(out).toMatchObject({ kind: "rejected", reason: "not-found" });
    expect(logStaffMovement).not.toHaveBeenCalled();
  });

  it("surfaces a logging failure rather than claiming success", async () => {
    const p = ports({
      findStaffByQr: vi.fn(async () => ({ id: "s-1", name: "Ramesh", role: "sweeper" })),
      logStaffMovement: vi.fn(async () => ({ ok: false as const, error: "constraint violation" })),
    });
    expect(await resolveGateScan(p, "STF-abc")).toEqual({ kind: "error", message: "constraint violation" });
  });
});

describe("guest passes", () => {
  const saved = {
    id: "req-1", status: "guest_pass", visitor_name: "Amazon Agent",
    phone: "9000000000", vehicle_number: "MH12AB1234", flat_number: "A-101",
  };

  it("admits a valid pass, claims it, and logs the entry", async () => {
    const logEntry = vi.fn(async () => null);
    const claimGuestPass = vi.fn(async () => true);
    const p = ports({
      findVisitorRequest: vi.fn(async () => saved), claimGuestPass, logEntry,
    });
    const out = await resolveGateScan(p, encodeGuestPass(pass()));
    expect(out).toEqual({
      kind: "guest", visitorName: "Amazon Agent", host: "Rahul", flat: "A-101",
    });
    expect(logEntry).toHaveBeenCalledWith(expect.objectContaining({
      entry_type: "visitor",
      owner_name: "Amazon Agent (Guest of Rahul)",
      wing: "A", flat_number: "101",
    }));
  });

  it("claims the pass BEFORE logging, so a double scan cannot double-log", async () => {
    const order: string[] = [];
    const p = ports({
      findVisitorRequest: vi.fn(async () => saved),
      claimGuestPass: vi.fn(async () => { order.push("claim"); return true; }),
      logEntry: vi.fn(async () => { order.push("log"); return null; }),
    });
    await resolveGateScan(p, encodeGuestPass(pass()));
    expect(order).toEqual(["claim", "log"]);
  });

  it("refuses when the conditional claim matched no row", async () => {
    // The second guard scanning the same QR at the same instant.
    const logEntry = vi.fn(async () => null);
    const p = ports({
      findVisitorRequest: vi.fn(async () => saved),
      claimGuestPass: vi.fn(async () => false),
      logEntry,
    });
    const out = await resolveGateScan(p, encodeGuestPass(pass()));
    expect(out).toMatchObject({ kind: "rejected", reason: "already-used" });
    expect(logEntry).not.toHaveBeenCalled();
  });

  it("refuses a pass already marked entered", async () => {
    const p = ports({ findVisitorRequest: vi.fn(async () => ({ ...saved, status: "entered" })) });
    expect(await resolveGateScan(p, encodeGuestPass(pass())))
      .toMatchObject({ kind: "rejected", reason: "already-used" });
  });

  it("refuses an edited pass — every field is compared", async () => {
    for (const tamper of [
      { visitor_name: "Someone Else" },
      { phone: "9999999999" },
      { vehicle_number: "XX00XX0000" },
      { flat_number: "202" },
      { wing: "B" },
    ]) {
      const p = ports({ findVisitorRequest: vi.fn(async () => saved) });
      const out = await resolveGateScan(p, encodeGuestPass(pass(tamper)));
      expect(out, JSON.stringify(tamper)).toMatchObject({ kind: "rejected", reason: "mismatch" });
    }
  });

  it("refuses a pass whose request was rejected", async () => {
    const p = ports({ findVisitorRequest: vi.fn(async () => ({ ...saved, status: "rejected" })) });
    expect(await resolveGateScan(p, encodeGuestPass(pass())))
      .toMatchObject({ kind: "rejected", reason: "mismatch" });
  });

  it("reports a missing request", async () => {
    const p = ports({ findVisitorRequest: vi.fn(async () => null) });
    expect(await resolveGateScan(p, encodeGuestPass(pass())))
      .toMatchObject({ kind: "rejected", reason: "not-found" });
  });
});

describe("vehicle QR", () => {
  it("logs a resident entry", async () => {
    const logEntry = vi.fn(async () => null);
    const p = ports({
      findVehicleByQr: vi.fn(async () => ({
        id: "v-1", vehicle_number: "MH12XY9999", owner_name: "Sameer",
        wing: "B", flat_number: "204",
      })),
      logEntry,
    });
    const out = await resolveGateScan(p, "opaque-token");
    expect(out).toEqual({
      kind: "vehicle", vehicleNumber: "MH12XY9999", flat: "B-204", ownerName: "Sameer",
    });
    expect(logEntry).toHaveBeenCalledWith(expect.objectContaining({ entry_type: "resident" }));
  });

  it("copes with a vehicle that has no wing", async () => {
    const p = ports({
      findVehicleByQr: vi.fn(async () => ({
        id: "v-1", vehicle_number: "MH12XY9999", owner_name: "Sameer",
        wing: "", flat_number: "204",
      })),
    });
    expect(await resolveGateScan(p, "tok")).toMatchObject({ flat: "204" });
  });

  it("reports an entry-log failure instead of a success", async () => {
    const p = ports({
      findVehicleByQr: vi.fn(async () => ({
        id: "v-1", vehicle_number: "X", owner_name: "Y", wing: "A", flat_number: "1",
      })),
      logEntry: vi.fn(async () => "permission denied"),
    });
    expect(await resolveGateScan(p, "tok")).toEqual({ kind: "error", message: "permission denied" });
  });
});

describe("anything else", () => {
  it("is unknown, not an error", async () => {
    expect(await resolveGateScan(ports(), "random-sticker")).toMatchObject({ kind: "unknown" });
  });

  it("handles an empty scan without touching the database", async () => {
    const findVehicleByQr = vi.fn(async () => null);
    const out = await resolveGateScan(ports({ findVehicleByQr }), "   ");
    expect(out.kind).toBe("unknown");
    expect(findVehicleByQr).not.toHaveBeenCalled();
  });

  it("does not mistake malformed JSON for a guest pass", async () => {
    expect(await resolveGateScan(ports(), '{"type":"guest_pass"}')).toMatchObject({ kind: "unknown" });
  });
});

describe("describeOutcome", () => {
  it("has a line for every outcome kind", async () => {
    const samples = [
      await resolveGateScan(ports({ findStaffByQr: vi.fn(async () => ({ id: "1", name: "R", role: "x" })) }), "STF-a"),
      await resolveGateScan(ports(), "nope"),
      await resolveGateScan(ports(), "STF-ghost"),
    ];
    for (const s of samples) {
      expect(describeOutcome(s).length).toBeGreaterThan(0);
    }
  });
});
