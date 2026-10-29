import { decodeGuestPass } from "./guest-pass";
import type { StaffCategory, StaffAction } from "./staffAttendance";

/**
 * What a scanned QR code means, and what should be written down.
 *
 * WHY THIS IS ITS OWN MODULE
 * This logic lived inside GuardDashboard.tsx, which is a web component.
 * The native guard app needs the identical behaviour, and the one thing
 * that must never differ between two apps pointed at the same gate is
 * what a pass means. Copying ~120 lines of "is this pass valid, has it
 * been used, what gets logged" into a second codebase guarantees they
 * diverge — and the half that drifts silently is the half that decides
 * whether somebody gets through a gate.
 *
 * It also fixes a bug the original had. The staff branch did its work
 * and then fell through — no early return — so after correctly logging
 * a staff entry, execution continued to the guest-pass check (not JSON,
 * so no match) and then the vehicle lookup (no match), which overwrote
 * the success message with "Unknown QR code. Vehicle not registered."
 * and raised an error toast. Every staff and house-help card scan
 * reported failure while quietly succeeding. Here each branch returns.
 *
 * DEPENDENCIES ARE INVERTED, not injected as a client. The caller
 * supplies a handful of small typed functions (GatePorts) instead of a
 * Supabase client. Three reasons: this file stays pure and exhaustively
 * testable with a fake; the web and native apps each keep their own
 * properly typed client; and it sidesteps the structural-typing problem
 * that already makes `logStaffMovement(supabase, ...)` a type error in
 * GuardDashboard.tsx, where a real SupabaseClient will not match a
 * hand-written MinimalClient.
 */

export interface ScannedPerson {
  id: string;
  name: string;
  /** staff_type or help_type — what the guard sees on the card. */
  role: string;
}

export interface ScannedVehicle {
  id: string;
  vehicle_number: string;
  owner_name: string;
  wing: string;
  flat_number: string;
}

export interface VisitorRequestRow {
  id: string;
  status: string;
  visitor_name: string;
  phone: string;
  vehicle_number: string;
  flat_number: string;
}

export interface EntryLogDraft {
  vehicle_number: string;
  owner_name: string;
  wing: string;
  flat_number: string;
  entry_type: "resident" | "visitor";
}

export type StaffLogResult =
  | { ok: true; action: StaffAction }
  | { ok: false; error: string };

/**
 * `if (!result.ok)` would be the obvious way to read a StaffLogResult,
 * and it does not work in this project: tsconfig.app.json sets
 * strict: false, which turns strictNullChecks off, and without that
 * TypeScript declines to narrow a discriminated union by its
 * discriminant. The same limitation already produces an error in
 * routeAccess.test.ts, where `.to` is read off an AccessDecision.
 *
 * A user-defined type predicate narrows either way, so the union stays
 * as the honest description of the result instead of being flattened
 * into optional fields to appease the compiler.
 */
const staffLogFailed = (r: StaffLogResult): r is { ok: false; error: string } => !r.ok;

/** Everything resolveGateScan needs from the outside world. */
export interface GatePorts {
  findStaffByQr(qr: string): Promise<ScannedPerson | null>;
  findHouseHelpByQr(qr: string): Promise<ScannedPerson | null>;
  findVisitorRequest(requestId: string): Promise<VisitorRequestRow | null>;
  /**
   * Flip a pass from 'guest_pass' to 'entered', conditionally.
   *
   * MUST be a conditional update — `.eq("status","guest_pass")` — and
   * must report whether it actually changed a row. That is what makes a
   * guest pass single-use when two guards scan the same QR at the same
   * moment: one update matches, the other does not, and only one entry
   * is logged. A read-then-write would let both through.
   */
  claimGuestPass(requestId: string): Promise<boolean>;
  findVehicleByQr(qr: string): Promise<ScannedVehicle | null>;
  /** Returns an error message, or null on success. */
  logEntry(draft: EntryLogDraft): Promise<string | null>;
  logStaffMovement(subjectId: string, category: StaffCategory): Promise<StaffLogResult>;
}

export type GateScanOutcome =
  | { kind: "staff"; name: string; role: string; category: StaffCategory; action: StaffAction }
  | { kind: "guest"; visitorName: string; host: string; flat: string }
  | { kind: "vehicle"; vehicleNumber: string; flat: string; ownerName: string }
  | { kind: "rejected"; reason: "already-used" | "mismatch" | "not-found"; message: string }
  | { kind: "unknown"; message: string }
  | { kind: "error"; message: string };

const STAFF_PREFIX = "STF-";
const HELP_PREFIX = "HLP-";

const flatLabel = (wing: string | null | undefined, flat: string) =>
  wing && wing.length > 0 ? `${wing}-${flat}` : flat;

/**
 * Work out what was scanned and record it.
 *
 * Checked in order of certainty: the prefixed staff cards are
 * unambiguous, a guest pass is self-describing JSON, and a vehicle QR
 * is an opaque token that needs a lookup. Each branch returns, so a
 * match is never second-guessed by a later check.
 */
export async function resolveGateScan(
  ports: GatePorts,
  raw: string,
): Promise<GateScanOutcome> {
  const value = raw.trim();
  if (!value) return { kind: "unknown", message: "Nothing was scanned." };

  // ── 1. Staff or house-help ID card ──────────────────────────
  if (value.startsWith(STAFF_PREFIX) || value.startsWith(HELP_PREFIX)) {
    const category: StaffCategory =
      value.startsWith(STAFF_PREFIX) ? "society_staff" : "house_help";

    const person = category === "society_staff"
      ? await ports.findStaffByQr(value)
      : await ports.findHouseHelpByQr(value);

    if (!person) {
      return { kind: "rejected", reason: "not-found", message: "Unknown ID card — not registered." };
    }

    const logged = await ports.logStaffMovement(person.id, category);
    if (staffLogFailed(logged)) return { kind: "error", message: logged.error };

    return {
      kind: "staff",
      name: person.name,
      role: person.role,
      category,
      action: logged.action,
    };
  }

  // ── 2. Guest pass ───────────────────────────────────────────
  const pass = decodeGuestPass(value);
  if (pass) {
    const request = await ports.findVisitorRequest(pass.request_id);
    if (!request) {
      return { kind: "rejected", reason: "not-found", message: "Guest pass not found." };
    }

    // The QR carries its own copy of the visitor's details. They must
    // still match the saved request, or a pass has been edited.
    const expectedFlat = `${pass.wing}-${pass.flat_number}`;
    const matches =
      request.status !== "rejected" &&
      request.visitor_name === pass.visitor_name &&
      request.phone === pass.phone &&
      request.vehicle_number === pass.vehicle_number &&
      request.flat_number === expectedFlat;

    if (!matches) {
      return {
        kind: "rejected",
        reason: "mismatch",
        message: "Guest pass details do not match the saved pass.",
      };
    }

    if (request.status === "entered" || request.status === "used") {
      return {
        kind: "rejected",
        reason: "already-used",
        message: `${request.visitor_name}'s pass is single-use and has already been scanned.`,
      };
    }

    // Single-use, enforced by the database rather than by this check.
    const claimed = await ports.claimGuestPass(request.id);
    if (!claimed) {
      return {
        kind: "rejected",
        reason: "already-used",
        message: "Single-use pass — already scanned.",
      };
    }

    const error = await ports.logEntry({
      vehicle_number: request.vehicle_number,
      owner_name: `${request.visitor_name} (Guest of ${pass.owner_name})`,
      wing: pass.wing,
      flat_number: pass.flat_number,
      entry_type: "visitor",
    });
    if (error) return { kind: "error", message: error };

    return {
      kind: "guest",
      visitorName: request.visitor_name,
      host: pass.owner_name,
      flat: flatLabel(pass.wing, pass.flat_number),
    };
  }

  // ── 3. Vehicle QR ───────────────────────────────────────────
  const vehicle = await ports.findVehicleByQr(value);
  if (vehicle) {
    const error = await ports.logEntry({
      vehicle_number: vehicle.vehicle_number,
      owner_name: vehicle.owner_name,
      wing: vehicle.wing,
      flat_number: vehicle.flat_number,
      entry_type: "resident",
    });
    if (error) return { kind: "error", message: error };

    return {
      kind: "vehicle",
      vehicleNumber: vehicle.vehicle_number,
      flat: flatLabel(vehicle.wing, vehicle.flat_number),
      ownerName: vehicle.owner_name,
    };
  }

  return { kind: "unknown", message: "Unknown QR code — not registered." };
}

/** One line for the guard, from any outcome. */
export function describeOutcome(outcome: GateScanOutcome): string {
  switch (outcome.kind) {
    case "staff":
      return `${outcome.action === "entry" ? "Entry" : "Exit"} logged — ${outcome.name} (${outcome.role})`;
    case "guest":
      return `${outcome.visitorName} — guest of ${outcome.host} — ${outcome.flat}`;
    case "vehicle":
      return `${outcome.flat} — ${outcome.vehicleNumber}`;
    case "rejected":
    case "unknown":
    case "error":
      return outcome.message;
  }
}
