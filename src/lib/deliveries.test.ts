import { describe, it, expect } from "vitest";
import {
  DELIVERY_TYPES, deliveryIcon, deliveryLabel, statusDisplay,
  emptyDraft, normalizeMobile, validateDraft, draftToRow,
  minutesLeft, matchesQuery, groupVisits,
  flatMatchFilter, decideDelivery, decisionFailed,
  type DeliveryVisit, type DeliveryDraft,
} from "./deliveries";

const visit = (over: Partial<DeliveryVisit> = {}): DeliveryVisit => ({
  id: "v1",
  mobile: "9876543210",
  photo_base64: null,
  delivery_type: "amazon",
  agent_name: "Rajan",
  wing: "A",
  flat_number: "1201",
  status: "pending_approval",
  entry_time: "2026-10-29T10:00:00.000Z",
  exit_time: null,
  expires_at: "2026-10-29T10:30:00.000Z",
  ...over,
});

const draft = (over: Partial<DeliveryDraft> = {}): DeliveryDraft => ({
  ...emptyDraft(),
  mobile: "9876543210",
  delivery_type: "amazon",
  wing: "A",
  flat_number: "1201",
  ...over,
});

describe("the delivery type catalogue", () => {
  it("has unique values, since they are written to the database", () => {
    const values = DELIVERY_TYPES.map((t) => t.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("gives every type a label and an icon", () => {
    for (const t of DELIVERY_TYPES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.icon.length).toBeGreaterThan(0);
    }
  });

  it("labels a known type", () => {
    expect(deliveryLabel("swiggy")).toBe("Swiggy");
    expect(deliveryIcon("swiggy")).toBe("🛵");
  });

  it("falls back to the raw value for a type it does not know", () => {
    // A type added to the database before an app is updated should still
    // read as itself rather than "Unknown".
    expect(deliveryLabel("dunzo")).toBe("dunzo");
    expect(deliveryIcon("dunzo")).toBe("📬");
  });
});

describe("status wording", () => {
  it("tells the guard what to do, not just what the status is", () => {
    expect(statusDisplay("approved")).toEqual({ label: "Approved — let in", tone: "good" });
    expect(statusDisplay("pending_approval").tone).toBe("waiting");
    expect(statusDisplay("rejected").tone).toBe("bad");
  });

  it("survives an unknown status", () => {
    expect(statusDisplay("cancelled")).toEqual({ label: "cancelled", tone: "done" });
  });
});

describe("the mobile number", () => {
  it("keeps digits only, capped at ten", () => {
    expect(normalizeMobile("98765 43210")).toBe("9876543210");
    expect(normalizeMobile("+91 98765-43210")).toBe("9198765432");
    expect(normalizeMobile("98765432109999")).toBe("9876543210");
  });
});

describe("validating a draft", () => {
  it("accepts a complete draft", () => {
    expect(validateDraft(draft())).toBeNull();
  });

  it("reports one problem at a time, in form order", () => {
    // One message, because a wall of red on a phone at a gate reads as
    // "broken" and gets abandoned.
    expect(validateDraft(emptyDraft())).toBe("Enter the agent's mobile number.");
    expect(validateDraft(draft({ mobile: "98765", delivery_type: "", wing: "" })))
      .toBe("The mobile number needs 10 digits.");
    expect(validateDraft(draft({ delivery_type: "", wing: "" })))
      .toBe("Choose what is being delivered.");
  });

  it("requires a full ten-digit number", () => {
    // A partial number is worse than none: it looks answered, and it is
    // what the resident would call if the parcel goes missing.
    expect(validateDraft(draft({ mobile: "987654321" }))).toBe("The mobile number needs 10 digits.");
  });

  it("requires a flat, because a delivery with no flat notifies nobody", () => {
    expect(validateDraft(draft({ wing: "", flat_number: "" })))
      .toBe("Choose the flat it is going to.");
    expect(validateDraft(draft({ flat_number: "" })))
      .toBe("Choose the flat it is going to.");
  });

  it("does not require an agent name or a photo", () => {
    expect(validateDraft(draft({ agent_name: "", photo_base64: "" }))).toBeNull();
  });
});

describe("turning a draft into a row", () => {
  it("trims and nulls the optional fields", () => {
    expect(draftToRow(draft({ agent_name: "  ", photo_base64: "" }))).toEqual({
      mobile: "9876543210",
      agent_name: null,
      delivery_type: "amazon",
      photo_base64: null,
      wing: "A",
      flat_number: "1201",
    });
  });

  it("keeps a name that was given", () => {
    expect(draftToRow(draft({ agent_name: " Rajan " })).agent_name).toBe("Rajan");
  });

  it("normalises the mobile it stores", () => {
    expect(draftToRow(draft({ mobile: "98765 43210" })).mobile).toBe("9876543210");
  });
});

describe("minutes left", () => {
  const now = new Date("2026-10-29T10:00:00.000Z").getTime();

  it("counts whole minutes", () => {
    expect(minutesLeft("2026-10-29T10:12:00.000Z", now)).toBe(12);
  });

  it("never goes negative on an expired visit", () => {
    expect(minutesLeft("2026-10-29T09:30:00.000Z", now)).toBe(0);
  });
});

describe("searching", () => {
  it("matches everything on an empty query", () => {
    expect(matchesQuery(visit(), "")).toBe(true);
    expect(matchesQuery(visit(), "   ")).toBe(true);
  });

  it("matches mobile, name, flat, wing and type", () => {
    expect(matchesQuery(visit(), "9876")).toBe(true);
    expect(matchesQuery(visit(), "rajan")).toBe(true);
    expect(matchesQuery(visit(), "1201")).toBe(true);
    expect(matchesQuery(visit(), "a")).toBe(true);
    expect(matchesQuery(visit(), "amazon")).toBe(true);
  });

  it("matches the label a guard can actually see", () => {
    // The guard sees "Milk Delivery" on the card, so typing it must work
    // even though the stored value is "milk".
    expect(matchesQuery(visit({ delivery_type: "milk" }), "milk delivery")).toBe(true);
  });

  it("tolerates a missing agent name", () => {
    expect(matchesQuery(visit({ agent_name: null }), "rajan")).toBe(false);
  });

  it("misses what it should miss", () => {
    expect(matchesQuery(visit(), "zomato")).toBe(false);
  });
});

describe("grouping the list", () => {
  const visits = [
    visit({ id: "p1", status: "pending_approval" }),
    visit({ id: "p2", status: "pending_approval", mobile: "9000000000" }),
    visit({ id: "a1", status: "approved" }),
    visit({ id: "r1", status: "rejected" }),
    visit({ id: "c1", status: "completed" }),
  ];

  it("splits into the three sections a guard reads", () => {
    const g = groupVisits(visits);
    expect(g.pending.map((v) => v.id)).toEqual(["p1", "p2"]);
    expect(g.approved.map((v) => v.id)).toEqual(["a1"]);
    expect(g.rejected.map((v) => v.id)).toEqual(["r1"]);
  });

  it("counts everything that matched, including statuses with no section", () => {
    expect(groupVisits(visits).total).toBe(5);
  });

  it("applies the search before grouping", () => {
    const g = groupVisits(visits, "9000000000");
    expect(g.pending.map((v) => v.id)).toEqual(["p2"]);
    expect(g.approved).toEqual([]);
    expect(g.total).toBe(1);
  });
});

describe("matching a resident's flats", () => {
  it("builds an OR of flat pairs", () => {
    expect(flatMatchFilter([{ wing: "A", flat_number: "1201" }]))
      .toBe('and(wing.eq."A",flat_number.eq."1201")');
  });

  it("joins several flats, since a resident may hold more than one", () => {
    expect(flatMatchFilter([
      { wing: "A", flat_number: "1201" },
      { wing: "B", flat_number: "302" },
    ])).toBe('and(wing.eq."A",flat_number.eq."1201"),and(wing.eq."B",flat_number.eq."302")');
  });

  it("returns null for a resident with no flats, rather than an empty filter", () => {
    // An empty `.or()` string is not "match nothing" — PostgREST rejects
    // it, and a caller that ignored the error would fall back to the
    // unfiltered query and show the whole society's deliveries.
    expect(flatMatchFilter([])).toBeNull();
  });

  it("quotes values, so a comma in a wing cannot reshape the query", () => {
    // Society structures are admin-entered free text. Unquoted, this
    // does not fail — it silently becomes a different query.
    const f = flatMatchFilter([{ wing: "A,B", flat_number: "12)01" }]);
    expect(f).toBe('and(wing.eq."A,B",flat_number.eq."12)01")');
  });

  it("escapes a quote inside a value", () => {
    expect(flatMatchFilter([{ wing: 'A"X', flat_number: "1" }]))
      .toBe('and(wing.eq."A""X",flat_number.eq."1")');
  });
});

describe("deciding a delivery", () => {
  it("approves, recording who decided", () => {
    const calls: unknown[][] = [];
    const ports = { setDecision: async (...a: unknown[]) => { calls.push(a); return null; } };
    return decideDelivery(ports as never, "v1", true, "user-9").then((r) => {
      expect(r).toEqual({ ok: true });
      // A flat can have several logins, any of which may answer. "It was
      // approved" with no name is not something anyone can follow up on.
      expect(calls[0]).toEqual(["v1", "approved", "user-9"]);
    });
  });

  it("rejects", async () => {
    const calls: unknown[][] = [];
    const ports = { setDecision: async (...a: unknown[]) => { calls.push(a); return null; } };
    await decideDelivery(ports as never, "v1", false, "user-9");
    expect(calls[0]).toEqual(["v1", "rejected", "user-9"]);
  });

  it("reports a failure rather than claiming success", async () => {
    const ports = { setDecision: async () => "row level security" };
    const r = await decideDelivery(ports as never, "v1", true, null);
    expect(decisionFailed(r)).toBe(true);
    expect(r).toEqual({ ok: false, error: "row level security" });
  });

  it("tolerates an unknown decider", async () => {
    const ports = { setDecision: async () => null };
    expect(await decideDelivery(ports as never, "v1", true, null)).toEqual({ ok: true });
  });
});
