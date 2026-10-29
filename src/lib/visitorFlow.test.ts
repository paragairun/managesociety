import { describe, it, expect, vi } from "vitest";
import {
  approveVisitor, rejectVisitor, checkOutEntry, flowWarning, flowFailed,
  type VisitorFlowPorts,
} from "./visitorFlow";

const visitor = {
  id: "req-1",
  visitor_name: "Amazon Agent",
  vehicle_number: "MH12AB1234",
  flat_number: "101",
};

const ports = (over: Partial<VisitorFlowPorts> = {}): VisitorFlowPorts => ({
  setVisitorStatus: vi.fn(async () => null),
  logEntry: vi.fn(async () => null),
  setExitTime: vi.fn(async () => null),
  ...over,
});

describe("approving a visitor", () => {
  it("records the decision AND logs the entry", async () => {
    // The rule this module exists to protect. Without the entry log the
    // visitor is approved but invisible in Live Inside, so the gate's
    // count of who is on the premises is wrong.
    const setVisitorStatus = vi.fn(async () => null);
    const logEntry = vi.fn(async () => null);
    const result = await approveVisitor(ports({ setVisitorStatus, logEntry }), visitor);

    expect(result).toEqual({ ok: true });
    expect(setVisitorStatus).toHaveBeenCalledWith("req-1", "approved");
    expect(logEntry).toHaveBeenCalledWith({
      vehicle_number: "MH12AB1234",
      owner_name: "Amazon Agent (Visitor)",
      wing: "",
      flat_number: "101",
      entry_type: "visitor",
    });
  });

  it("writes the status before the entry log", async () => {
    const order: string[] = [];
    await approveVisitor(ports({
      setVisitorStatus: vi.fn(async () => { order.push("status"); return null; }),
      logEntry: vi.fn(async () => { order.push("log"); return null; }),
    }), visitor);
    // The status is the answer somebody is waiting on; the log is
    // bookkeeping.
    expect(order).toEqual(["status", "log"]);
  });

  it("does not log an entry when the decision itself failed", async () => {
    const logEntry = vi.fn(async () => null);
    const result = await approveVisitor(ports({
      setVisitorStatus: vi.fn(async () => "permission denied"),
      logEntry,
    }), visitor);

    expect(result).toEqual({ ok: false, error: "permission denied" });
    expect(logEntry).not.toHaveBeenCalled();
  });

  it("warns rather than fails when only the entry log broke", async () => {
    // Reporting "approval failed" here would send the guard to argue
    // with a visitor who has in fact been approved.
    const result = await approveVisitor(ports({
      logEntry: vi.fn(async () => "entry_logs is full"),
    }), visitor);

    expect(result.ok).toBe(true);
    expect(flowFailed(result)).toBe(false);
    expect(flowWarning(result)).toContain("was approved");
    expect(flowWarning(result)).toContain("entry_logs is full");
  });

  it("names the visitor in the entry, so the log reads usefully", async () => {
    const logEntry = vi.fn(async () => null);
    await approveVisitor(ports({ logEntry }), { ...visitor, visitor_name: "Ramesh" });
    expect(logEntry).toHaveBeenCalledWith(
      expect.objectContaining({ owner_name: "Ramesh (Visitor)" }),
    );
  });
});

describe("rejecting a visitor", () => {
  it("sets the status and writes no entry", async () => {
    const logEntry = vi.fn(async () => null);
    const setVisitorStatus = vi.fn(async () => null);
    const result = await rejectVisitor(ports({ setVisitorStatus, logEntry }), "req-1");

    expect(result).toEqual({ ok: true });
    expect(setVisitorStatus).toHaveBeenCalledWith("req-1", "rejected");
    expect(logEntry).not.toHaveBeenCalled();
  });

  it("reports a failure", async () => {
    const result = await rejectVisitor(
      ports({ setVisitorStatus: vi.fn(async () => "offline") }), "req-1");
    expect(flowFailed(result)).toBe(true);
    expect(result).toEqual({ ok: false, error: "offline" });
  });
});

describe("checking a vehicle out", () => {
  it("stamps the exit time it was given", async () => {
    const setExitTime = vi.fn(async () => null);
    const at = new Date("2026-10-29T12:30:00.000Z");
    const result = await checkOutEntry(ports({ setExitTime }), "entry-9", at);

    expect(result).toEqual({ ok: true });
    expect(setExitTime).toHaveBeenCalledWith("entry-9", "2026-10-29T12:30:00.000Z");
  });

  it("defaults to now when no time is given", async () => {
    const setExitTime = vi.fn(async () => null);
    const before = Date.now();
    await checkOutEntry(ports({ setExitTime }), "entry-9");
    const sent = (setExitTime as unknown as { mock: { calls: string[][] } }).mock.calls[0][1];
    expect(new Date(sent).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("reports a failure", async () => {
    const result = await checkOutEntry(
      ports({ setExitTime: vi.fn(async () => "row not found") }), "entry-9");
    expect(result).toEqual({ ok: false, error: "row not found" });
  });
});

describe("result helpers", () => {
  it("distinguishes success, warning and failure", () => {
    expect(flowFailed({ ok: true })).toBe(false);
    expect(flowWarning({ ok: true })).toBeNull();
    expect(flowWarning({ ok: true, warning: "partial" })).toBe("partial");
    expect(flowFailed({ ok: false, error: "nope" })).toBe(true);
    expect(flowWarning({ ok: false, error: "nope" })).toBeNull();
  });
});
