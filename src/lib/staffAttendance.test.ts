import { describe, it, expect, vi } from "vitest";
import { nextAction, logStaffMovement } from "./staffAttendance";

/** Minimal fake of the Supabase query builder chain. */
function fakeClient(lastAction: string | null, opts: { readErr?: string; writeErr?: string } = {}) {
  const inserts: Record<string, unknown>[] = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: async () => opts.readErr
                ? { data: null, error: { message: opts.readErr } }
                : { data: lastAction ? { action_type: lastAction } : null, error: null },
            }),
          }),
        }),
      }),
      insert: async (row: Record<string, unknown>) => {
        inserts.push(row);
        return opts.writeErr ? { error: { message: opts.writeErr } } : { error: null };
      },
    }),
  };
  return { client, inserts };
}

const base = {
  societyId: "soc-1", subjectId: "staff-1", category: "society_staff" as const,
  loggedBy: "guard-1", method: "fingerprint" as const,
};

describe("nextAction", () => {
  it.each([
    ["entry", "exit"],
    ["exit", "entry"],
    [null, "entry"],
    [undefined, "entry"],
  ])("after %s comes %s", (last, expected) => {
    expect(nextAction(last as string | null)).toBe(expected);
  });
});

describe("logStaffMovement", () => {
  it("logs an entry for someone with no history", async () => {
    const { client, inserts } = fakeClient(null);
    const res = await logStaffMovement(client, base);
    expect(res).toEqual({ ok: true, action: "entry" });
    expect(inserts[0]).toMatchObject({ action_type: "entry", entry_method: "fingerprint" });
  });

  it("logs an exit when the last action was an entry", async () => {
    const { client, inserts } = fakeClient("entry");
    const res = await logStaffMovement(client, base);
    expect(res).toEqual({ ok: true, action: "exit" });
    expect(inserts[0]).toMatchObject({ action_type: "exit" });
  });

  it("records the match score and device for a fingerprint entry", async () => {
    const { client, inserts } = fakeClient(null);
    await logStaffMovement(client, { ...base, matchScore: 87, deviceModel: "MFS100" });
    expect(inserts[0]).toMatchObject({ match_score: 87, device_model: "MFS100" });
  });

  it("marks a QR entry as qr with no score", async () => {
    const { client, inserts } = fakeClient(null);
    await logStaffMovement(client, { ...base, method: "qr" });
    expect(inserts[0]).toMatchObject({ entry_method: "qr", match_score: null, device_model: null });
  });

  it("surfaces a read failure instead of logging a wrong action", async () => {
    const { client, inserts } = fakeClient("entry", { readErr: "network down" });
    const res = await logStaffMovement(client, base);
    expect(res).toEqual({ ok: false, error: "network down" });
    expect(inserts).toHaveLength(0);
  });

  it("surfaces a write failure", async () => {
    const { client } = fakeClient(null, { writeErr: "rls denied" });
    expect(await logStaffMovement(client, base)).toEqual({ ok: false, error: "rls denied" });
  });

  it("stamps the society, subject and guard on the row", async () => {
    const { client, inserts } = fakeClient(null);
    await logStaffMovement(client, base);
    expect(inserts[0]).toMatchObject({
      society_id: "soc-1", staff_id: "staff-1",
      category: "society_staff", logged_by: "guard-1",
    });
  });
});
