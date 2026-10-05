/**
 * Shared entry/exit logging for staff and house helps.
 *
 * Both the QR scanner and the always-on fingerprint listener call this,
 * so the toggle rule (last action was an entry, therefore this is an
 * exit) can never drift between the two paths.
 */

export type StaffCategory = "society_staff" | "house_help";
export type EntryMethod = "qr" | "fingerprint" | "manual";
export type StaffAction = "entry" | "exit";

/**
 * The slice of the Supabase client this needs, described structurally so
 * tests can pass a fake without dragging in the generated Database types.
 */
interface QueryResult<T> { data: T; error: { message: string } | null }

export interface MinimalClient {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        order: (col: string, opts: { ascending: boolean }) => {
          limit: (n: number) => {
            maybeSingle: () => Promise<QueryResult<{ action_type?: string } | null>>;
          };
        };
      };
    };
    insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
  };
}

export interface LogMovementInput {
  societyId: string;
  subjectId: string;
  category: StaffCategory;
  loggedBy: string | null;
  method: EntryMethod;
  matchScore?: number;
  deviceModel?: string;
}

export type LogMovementResult =
  | { ok: true; action: StaffAction }
  | { ok: false; error: string };

/** An entry follows anything that is not already an entry. */
export function nextAction(lastAction: string | null | undefined): StaffAction {
  return lastAction === "entry" ? "exit" : "entry";
}

export async function logStaffMovement(
  client: MinimalClient,
  input: LogMovementInput,
): Promise<LogMovementResult> {
  const { data: lastLog, error: readErr } = await client
    .from("staff_logs")
    .select("action_type")
    .eq("staff_id", input.subjectId)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (readErr) return { ok: false, error: readErr.message };

  const action = nextAction(lastLog?.action_type);

  const { error: writeErr } = await client.from("staff_logs").insert({
    society_id: input.societyId,
    category: input.category,
    staff_id: input.subjectId,
    action_type: action,
    logged_by: input.loggedBy,
    entry_method: input.method,
    match_score: input.matchScore ?? null,
    device_model: input.deviceModel ?? null,
  });

  if (writeErr) return { ok: false, error: writeErr.message };
  return { ok: true, action };
}
