import {
  logStaffMovement, type StaffCategory, type MinimalClient, type LogMovementResult,
} from "./staffAttendance";
import type { GatePorts, StaffLogResult } from "./gateScan";
// `import type` only — these are erased at build time, so the native
// app's Metro never has to resolve a path outside src/lib. A runtime
// import from ../integrations would need the watchFolder widened.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types";

/**
 * The database half of the gate-scan contract, for both apps.
 *
 * @core/gateScan decides what a scanned code MEANS. This file is the
 * only place that knows how to ask, and it takes the client as an
 * argument so the website and the native guard app can share it while
 * each keeps its own differently configured client — localStorage on
 * the web, AsyncStorage on the phone.
 */
/**
 * Same reason as staffLogFailed in gateScan.ts: strict is false in
 * tsconfig.app.json, so strictNullChecks is off and TypeScript will
 * not narrow a discriminated union by its discriminant. A predicate
 * does it regardless.
 */
const movementFailed = (r: LogMovementResult): r is { ok: false; error: string } => !r.ok;

export function makeGatePorts(
  client: SupabaseClient<Database>,
  societyId: string,
  loggedBy: string | null,
): GatePorts {
  return {
    async findStaffByQr(qr) {
      const { data } = await client
        .from("staff_members").select("id, name, staff_type")
        .eq("society_id", societyId).eq("qr_code", qr).maybeSingle();
      return data ? { id: data.id, name: data.name, role: data.staff_type } : null;
    },

    async findHouseHelpByQr(qr) {
      const { data } = await client
        .from("house_helps").select("id, name, help_type")
        .eq("society_id", societyId).eq("qr_code", qr).maybeSingle();
      return data ? { id: data.id, name: data.name, role: data.help_type } : null;
    },

    async findVisitorRequest(requestId) {
      const { data } = await client
        .from("visitor_requests")
        .select("id, status, visitor_name, phone, vehicle_number, flat_number")
        .eq("id", requestId).maybeSingle();
      return data ?? null;
    },

    /**
     * Conditional on the status still being 'guest_pass', and reporting
     * whether a row actually changed.
     *
     * That is the entire single-use guarantee. Two guards scanning the
     * same QR at the same moment produce one update that matches and
     * one that does not, so only one entry is logged. Reading the
     * status and then writing it would let both through.
     */
    async claimGuestPass(requestId) {
      const { data } = await client
        .from("visitor_requests")
        .update({ status: "entered" })
        .eq("id", requestId)
        .eq("status", "guest_pass")
        .select("id")
        .maybeSingle();
      return !!data;
    },

    /**
     * Looked up by qr_code rather than searched in a preloaded list.
     *
     * The web dashboard used to scan `vehicles.find(v => v.qr_code ===
     * result)` against an array refreshed every 5 seconds, so a vehicle
     * registered moments earlier read as unknown at the gate. A query
     * cannot be stale.
     */
    async findVehicleByQr(qr) {
      const { data } = await client
        .from("vehicles")
        .select("id, vehicle_number, owner_name, wing, flat_number")
        .eq("society_id", societyId).eq("qr_code", qr).maybeSingle();
      return data ?? null;
    },

    async logEntry(draft) {
      const { error } = await client.from("entry_logs").insert({
        ...draft,
        society_id: societyId,
        logged_by: loggedBy,
      });
      return error?.message ?? null;
    },

    async logStaffMovement(subjectId: string, category: StaffCategory): Promise<StaffLogResult> {
      // The shared logger, the same one the fingerprint listener uses,
      // so the entry/exit toggle cannot drift between the two paths.
      //
      // The cast is the pre-existing MinimalClient problem: a real
      // SupabaseClient does not structurally match the hand-written
      // interface staffAttendance declares, which is already a type
      // error at GuardDashboard.tsx:153. Narrowed to one place here
      // rather than repeated at every call site.
      const result = await logStaffMovement(client as unknown as MinimalClient, {
        societyId, subjectId, category, loggedBy, method: "qr",
      });
      if (movementFailed(result)) return { ok: false, error: result.error };
      return { ok: true, action: result.action };
    },
  };
}
