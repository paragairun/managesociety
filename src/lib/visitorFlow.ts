import type { EntryLogDraft } from "./gateScan";

/**
 * What happens when a guard answers a visitor request, or sends a
 * vehicle out.
 *
 * Small, but shared for one specific reason: **approving a visitor also
 * writes an entry log.** Miss that and the visitor is marked approved
 * and never appears in Live Inside — so the gate's count of who is on
 * the premises is quietly wrong, which is the one number a guard is
 * actually asked for. Two apps answering the same request must not
 * disagree about it.
 *
 * Ports-injected like gateScan, for the same reasons: pure, testable
 * with a fake, and no client type to wrestle with.
 */

export interface VisitorToDecide {
  id: string;
  visitor_name: string;
  vehicle_number: string;
  flat_number: string;
}

export interface VisitorFlowPorts {
  setVisitorStatus(id: string, status: "approved" | "rejected"): Promise<string | null>;
  logEntry(draft: EntryLogDraft): Promise<string | null>;
  setExitTime(entryId: string, isoTime: string): Promise<string | null>;
}

export type FlowResult =
  | { ok: true }
  /** The decision was saved but the entry log was not — see below. */
  | { ok: true; warning: string }
  | { ok: false; error: string };

/**
 * Approve a visitor: record the decision, then log them in.
 *
 * ORDER MATTERS, and so does what happens when the second step fails.
 * The status is written first because it is the answer the resident and
 * the visitor are waiting on; the entry log is bookkeeping. If the log
 * fails after the status succeeded, this reports a WARNING rather than
 * an error — telling the guard "approval failed" when the visitor has
 * in fact been approved would send them to argue with someone already
 * holding a valid approval.
 */
export async function approveVisitor(
  ports: VisitorFlowPorts,
  visitor: VisitorToDecide,
): Promise<FlowResult> {
  const statusError = await ports.setVisitorStatus(visitor.id, "approved");
  if (statusError) return { ok: false, error: statusError };

  const logError = await ports.logEntry({
    vehicle_number: visitor.vehicle_number,
    owner_name: `${visitor.visitor_name} (Visitor)`,
    // visitor_requests carries a flat number and no wing; the column is
    // NOT NULL on entry_logs, so it gets an empty string rather than a
    // guess. Matches what the website has always written.
    wing: "",
    flat_number: visitor.flat_number,
    entry_type: "visitor",
  });

  if (logError) {
    return {
      ok: true,
      warning: `${visitor.visitor_name} was approved, but the gate entry could not be logged: ${logError}`,
    };
  }

  return { ok: true };
}

export async function rejectVisitor(
  ports: VisitorFlowPorts,
  visitorId: string,
): Promise<FlowResult> {
  const error = await ports.setVisitorStatus(visitorId, "rejected");
  return error ? { ok: false, error } : { ok: true };
}

/**
 * Send a vehicle out: stamp the exit time on its open entry.
 *
 * The time is passed in rather than read from the clock here, so a test
 * can assert the exact value and a caller could record a checkout that
 * happened a moment ago.
 */
export async function checkOutEntry(
  ports: VisitorFlowPorts,
  entryId: string,
  at: Date = new Date(),
): Promise<FlowResult> {
  const error = await ports.setExitTime(entryId, at.toISOString());
  return error ? { ok: false, error } : { ok: true };
}

/** True when the flow succeeded but something non-critical did not. */
export function flowWarning(result: FlowResult): string | null {
  return "warning" in result && typeof result.warning === "string" ? result.warning : null;
}

/** True when nothing was saved at all. */
export function flowFailed(result: FlowResult): result is { ok: false; error: string } {
  return !result.ok;
}
