import type { VisitorFlowPorts } from "./visitorFlow";
// `import type` only, for the same reason as gatePorts: erased at build
// time, so the native app's Metro never resolves a path outside src/lib.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types";

/**
 * The database half of the visitor-decision contract, for both apps.
 *
 * @core/visitorFlow decides what approving, rejecting and checking out
 * MEAN — in particular that an approval also writes an entry log. This
 * file is the only place that knows how to perform them, and it takes
 * the client as an argument so the website and the native guard app can
 * share it while each keeps its own differently configured client:
 * localStorage on the web, AsyncStorage on the phone.
 */
export function makeVisitorFlowPorts(
  client: SupabaseClient<Database>,
  societyId: string,
  loggedBy: string | null,
): VisitorFlowPorts {
  return {
    async setVisitorStatus(id, status) {
      // Scoped to the society as well as the id. The id alone is enough
      // to find the row, but not enough to prove it belongs to this
      // guard's society — and a gate device should not be able to answer
      // another society's request even if it somehow learned an id.
      const { error } = await client
        .from("visitor_requests")
        .update({ status })
        .eq("id", id)
        .eq("society_id", societyId);
      return error?.message ?? null;
    },

    async logEntry(draft) {
      const { error } = await client.from("entry_logs").insert({
        ...draft,
        society_id: societyId,
        logged_by: loggedBy,
      });
      return error?.message ?? null;
    },

    async setExitTime(entryId, isoTime) {
      const { error } = await client
        .from("entry_logs")
        .update({ exit_time: isoTime })
        .eq("id", entryId)
        .eq("society_id", societyId);
      return error?.message ?? null;
    },
  };
}
