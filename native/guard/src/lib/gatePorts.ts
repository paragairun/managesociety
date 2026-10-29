import { supabase } from "@/lib/supabase";
import { logStaffMovement } from "@core/staffAttendance";
import type { GatePorts } from "@core/gateScan";
import type { StaffCategory } from "@core/staffAttendance";

/**
 * The guard app's half of the gate-scan contract.
 *
 * @core/gateScan decides what a scanned code MEANS; this file is the
 * only place that knows how to ask this database. The split is what
 * lets the rule — is this pass valid, has it been used, what gets
 * logged — be identical here and on the website while each platform
 * keeps its own properly typed client.
 */
export function makeGatePorts(societyId: string, loggedBy: string | null): GatePorts {
  return {
    async findStaffByQr(qr) {
      const { data } = await supabase
        .from("staff_members").select("id, name, staff_type")
        .eq("society_id", societyId).eq("qr_code", qr).maybeSingle();
      return data ? { id: data.id, name: data.name, role: data.staff_type } : null;
    },

    async findHouseHelpByQr(qr) {
      const { data } = await supabase
        .from("house_helps").select("id, name, help_type")
        .eq("society_id", societyId).eq("qr_code", qr).maybeSingle();
      return data ? { id: data.id, name: data.name, role: data.help_type } : null;
    },

    async findVisitorRequest(requestId) {
      const { data } = await supabase
        .from("visitor_requests")
        .select("id, status, visitor_name, phone, vehicle_number, flat_number")
        .eq("id", requestId).maybeSingle();
      return data ?? null;
    },

    /**
     * Conditional on status still being 'guest_pass', and reporting
     * whether a row actually changed. That is the whole single-use
     * guarantee: two guards scanning the same QR at once produce one
     * matching update and one miss, so only one entry is logged. A
     * read-then-write would admit both.
     */
    async claimGuestPass(requestId) {
      const { data } = await supabase
        .from("visitor_requests")
        .update({ status: "entered" })
        .eq("id", requestId)
        .eq("status", "guest_pass")
        .select("id")
        .maybeSingle();
      return !!data;
    },

    async findVehicleByQr(qr) {
      const { data } = await supabase
        .from("vehicles")
        .select("id, vehicle_number, owner_name, wing, flat_number")
        .eq("society_id", societyId).eq("qr_code", qr).maybeSingle();
      return data ?? null;
    },

    async logEntry(draft) {
      const { error } = await supabase.from("entry_logs").insert({
        ...draft,
        society_id: societyId,
        logged_by: loggedBy,
      });
      return error?.message ?? null;
    },

    async logStaffMovement(subjectId: string, category: StaffCategory) {
      // The shared logger, the same one the website's scanner and the
      // always-on fingerprint listener call, so the entry/exit toggle
      // cannot differ between any of the three.
      const result = await logStaffMovement(
        supabase as unknown as Parameters<typeof logStaffMovement>[0],
        { societyId, subjectId, category, loggedBy, method: "qr" },
      );
      return result.ok
        ? { ok: true as const, action: result.action }
        : { ok: false as const, error: result.error };
    },
  };
}
