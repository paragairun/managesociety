/**
 * Creating a member account on the committee's behalf.
 *
 * This is now the ONLY way a guard account comes into existence —
 * guards and residents can no longer register themselves — so the
 * failure modes matter more than they did when it was one branch of a
 * bulk importer. In particular a half-done create (request written,
 * approval failed) must be reported, not swallowed, or the committee
 * hands out an account that cannot be signed into.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const single = vi.fn();
const insert = vi.fn(() => ({ select: () => ({ single }) }));
const from = vi.fn(() => ({ insert }));
const invoke = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...a: unknown[]) => from(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));

const { onboardMember } = await import("./memberOnboarding");

const SOCIETY = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  [single, insert, from, invoke].forEach((m) => m.mockReset());
  insert.mockImplementation(() => ({ select: () => ({ single }) }));
  from.mockImplementation(() => ({ insert }));
  single.mockResolvedValue({ data: { id: "req-1" }, error: null });
  invoke.mockResolvedValue({ data: { temp_password: "hunter2" }, error: null });
});

describe("creating a guard", () => {
  it("writes the request and approves it in one go", async () => {
    const r = await onboardMember({
      societyId: SOCIETY, role: "guard",
      displayName: "Ramesh Patil", email: "ramesh@example.com",
    });

    expect(r).toEqual({ ok: true, tempPassword: "hunter2" });
    expect(from).toHaveBeenCalledWith("registration_requests");
    expect(invoke).toHaveBeenCalledWith("approve-registration", {
      body: { request_id: "req-1", action: "approve" },
    });
  });

  it("stamps the caller's society onto the request", async () => {
    // The RLS policy compares this to the caller's own society, so a
    // missing or wrong value is refused rather than quietly accepted.
    await onboardMember({
      societyId: SOCIETY, role: "guard",
      displayName: "Ramesh", email: "r@example.com",
    });
    expect(insert.mock.calls[0][0]).toMatchObject({
      society_id: SOCIETY, requested_role: "guard", status: "pending",
    });
  });

  it("never attaches flat details to a guard", async () => {
    await onboardMember({
      societyId: SOCIETY, role: "guard",
      displayName: "Ramesh", email: "r@example.com",
      wing: "A", flatNumber: "101",
    });
    expect(insert.mock.calls[0][0]).toMatchObject({ wing: null, flat_number: null });
  });

  it("lower-cases and trims the email", async () => {
    await onboardMember({
      societyId: SOCIETY, role: "guard",
      displayName: "  Ramesh  ", email: "  Ramesh@Example.COM  ",
    });
    expect(insert.mock.calls[0][0]).toMatchObject({
      email: "ramesh@example.com", display_name: "Ramesh",
    });
  });
});

describe("creating a resident", () => {
  it("keeps the flat details", async () => {
    await onboardMember({
      societyId: SOCIETY, role: "resident",
      displayName: "Asha", email: "asha@example.com",
      wing: "B", flatNumber: "402",
    });
    expect(insert.mock.calls[0][0]).toMatchObject({
      requested_role: "resident", wing: "B", flat_number: "402",
    });
  });
});

describe("refusing bad input before touching the network", () => {
  it.each([
    ["no society", { societyId: "", displayName: "A", email: "a@b.co" }],
    ["no name", { societyId: SOCIETY, displayName: "   ", email: "a@b.co" }],
    ["not an email", { societyId: SOCIETY, displayName: "A", email: "not-an-email" }],
    ["empty email", { societyId: SOCIETY, displayName: "A", email: "" }],
  ])("%s", async (_label, partial) => {
    const r = await onboardMember({ role: "guard", ...partial } as Parameters<typeof onboardMember>[0]);

    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(from).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("failures are reported, not swallowed", () => {
  it("reports a refused insert and never calls approve", async () => {
    single.mockResolvedValue({ data: null, error: { message: "new row violates row-level security policy" } });

    const r = await onboardMember({
      societyId: SOCIETY, role: "guard", displayName: "A", email: "a@b.co",
    });

    expect(r.ok).toBe(false);
    expect(r.error).toContain("row-level security");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reports a failed approval, so no one is told an unusable account exists", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "boom" } });

    const r = await onboardMember({
      societyId: SOCIETY, role: "guard", displayName: "A", email: "a@b.co",
    });

    expect(r).toEqual({ ok: false, error: "boom" });
  });

  it("reports a business error returned in the body, not just a transport error", async () => {
    // The function answers 200 with { error } for its own refusals.
    invoke.mockResolvedValue({ data: { error: "Email already registered" }, error: null });

    const r = await onboardMember({
      societyId: SOCIETY, role: "guard", displayName: "A", email: "a@b.co",
    });

    expect(r.ok).toBe(false);
    expect(r.error).toBe("Email already registered");
  });

  it("succeeds without a password when the function does not return one", async () => {
    invoke.mockResolvedValue({ data: {}, error: null });

    const r = await onboardMember({
      societyId: SOCIETY, role: "guard", displayName: "A", email: "a@b.co",
    });

    expect(r).toEqual({ ok: true, tempPassword: null });
  });
});
