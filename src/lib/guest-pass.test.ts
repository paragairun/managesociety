import { describe, it, expect } from "vitest";
import {
  encodeGuestPass, decodeGuestPass,
  validateGuestPassDraft, emptyGuestPassDraft,
  normalizeGuestPhone, normalizePlate,
  guestPassCreateBody, guestPassStatus,
  type GuestPassPayload, type GuestPassDraft,
} from "./guest-pass";

const payload: GuestPassPayload = {
  type: "guest_pass",
  request_id: "9f95f53b-40ec-4610-b50f-2da13fea3af2",
  visitor_name: "Ramesh Kumar",
  phone: "9876543210",
  vehicle_number: "MH12AB1234",
  purpose: "Dinner",
  flat_number: "1201",
  wing: "A",
  owner_name: "Parag",
};

describe("the QR payload", () => {
  it("survives a round trip", () => {
    // The guard's scanner decodes exactly what the resident's phone
    // encoded. These two functions are the contract between the apps.
    expect(decodeGuestPass(encodeGuestPass(payload))).toEqual(payload);
  });

  it("rejects anything that is not a guest pass", () => {
    expect(decodeGuestPass("STF-abc123")).toBeNull();
    expect(decodeGuestPass("")).toBeNull();
    expect(decodeGuestPass("{]")).toBeNull();
    expect(decodeGuestPass(JSON.stringify({ ...payload, type: "staff" }))).toBeNull();
  });

  it("rejects a pass missing any field the guard needs", () => {
    for (const key of ["request_id", "visitor_name", "phone",
      "vehicle_number", "flat_number", "wing", "owner_name"] as const) {
      expect(decodeGuestPass(JSON.stringify({ ...payload, [key]: "" })), key).toBeNull();
    }
  });

  it("treats a blank purpose as absent", () => {
    expect(decodeGuestPass(JSON.stringify({ ...payload, purpose: "   " }))?.purpose).toBeNull();
    expect(decodeGuestPass(JSON.stringify({ ...payload, purpose: undefined }))?.purpose).toBeNull();
  });
});

describe("creating a guest pass", () => {
  const good = (): GuestPassDraft => ({
    visitor_name: "Ramesh Kumar",
    phone: "9876543210",
    vehicle_number: "MH12AB1234",
    purpose: "",
  });

  it("accepts a complete draft", () => {
    expect(validateGuestPassDraft(good())).toBeNull();
  });

  it("reports one problem at a time, in form order", () => {
    expect(validateGuestPassDraft(emptyGuestPassDraft())).toBe("Who is visiting?");
    expect(validateGuestPassDraft({ ...good(), phone: "", vehicle_number: "" }))
      .toBe("Enter your guest's mobile number.");
    expect(validateGuestPassDraft({ ...good(), phone: "98765", vehicle_number: "" }))
      .toBe("The mobile number needs 10 digits.");
    expect(validateGuestPassDraft({ ...good(), vehicle_number: "" }))
      .toBe("Enter the vehicle number.");
  });

  it("requires a plate, because that is what the guard matches", () => {
    // The pass is scanned against a vehicle at the gate. One with no
    // plate is one the guard cannot check anything against.
    expect(validateGuestPassDraft({ ...good(), vehicle_number: "   " }))
      .toBe("Enter the vehicle number.");
    expect(validateGuestPassDraft({ ...good(), vehicle_number: "-- --" }))
      .toBe("Enter the vehicle number.");
  });

  it("treats purpose as optional", () => {
    expect(validateGuestPassDraft({ ...good(), purpose: "" })).toBeNull();
  });

  it("normalises a phone number", () => {
    expect(normalizeGuestPhone("98765 43210")).toBe("9876543210");
    expect(normalizeGuestPhone("+91 98765-43210")).toBe("9198765432");
    expect(normalizeGuestPhone("98765432109999")).toBe("9876543210");
  });

  it("normalises a plate the way it is read", () => {
    expect(normalizePlate("mh 12 ab 1234")).toBe("MH12AB1234");
    expect(normalizePlate("MH-12-AB-1234")).toBe("MH12AB1234");
    expect(normalizePlate("  ")).toBe("");
  });
});

describe("the create request body", () => {
  const draft: GuestPassDraft = {
    visitor_name: "  Ramesh  ",
    phone: "98765 43210",
    vehicle_number: "mh12ab1234",
    purpose: "  Dinner  ",
  };

  it("trims, normalises and names the action", () => {
    expect(guestPassCreateBody(draft)).toEqual({
      action: "create",
      visitor_name: "Ramesh",
      phone: "9876543210",
      vehicle_number: "MH12AB1234",
      purpose: "Dinner",
    });
  });

  it("sends a null purpose rather than an empty string", () => {
    expect(guestPassCreateBody({ ...draft, purpose: "   " }).purpose).toBeNull();
  });

  it("includes the flat only when one was chosen", () => {
    // A resident with several flats picks; one with a single flat does
    // not, and the edge function defaults to their primary.
    expect(guestPassCreateBody(draft, "flat-7")).toMatchObject({ flat_id: "flat-7" });
    expect("flat_id" in guestPassCreateBody(draft)).toBe(false);
  });
});

describe("what a pass status means to the resident", () => {
  it("marks only an unused pass as scannable", () => {
    expect(guestPassStatus("guest_pass")).toEqual({ label: "Ready to scan", usable: true });
    // The guard's scan flips it to `entered`. That is the single-use
    // guarantee, so the QR must stop being offered as usable.
    expect(guestPassStatus("entered").usable).toBe(false);
    expect(guestPassStatus("rejected").usable).toBe(false);
  });

  it("survives a status it does not know", () => {
    expect(guestPassStatus("cancelled")).toEqual({ label: "cancelled", usable: false });
  });
});
