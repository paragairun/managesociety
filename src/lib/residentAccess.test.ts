import { describe, it, expect } from "vitest";
import {
  RESIDENT_SECTIONS, sectionsFor, canOpenSection, can, whyNot,
  type ResidentIdentity, type ResidentAction,
} from "./residentAccess";

const primary: ResidentIdentity = { isChild: false, childType: null };
const family: ResidentIdentity = { isChild: true, childType: "family" };
const tenant: ResidentIdentity = { isChild: true, childType: "tenant" };

describe("the section list", () => {
  it("gives a primary resident everything", () => {
    expect(sectionsFor(primary).map((s) => s.id)).toEqual([
      "home", "guest", "deliveries", "dues", "amenities", "vehicles", "ev", "helps", "profile",
    ]);
  });

  it("withholds house helps from a child account", () => {
    // A house help QR opens the gate for a person, so registering one is
    // the primary resident's call.
    const ids = sectionsFor(family).map((s) => s.id);
    expect(ids).not.toContain("helps");
    expect(ids).toEqual([
      "home", "guest", "deliveries", "dues", "amenities", "vehicles", "ev", "profile",
    ]);
  });

  it("keeps the menu order", () => {
    const order = RESIDENT_SECTIONS.map((s) => s.id);
    for (const identity of [primary, family, tenant]) {
      const got = sectionsFor(identity).map((s) => s.id);
      expect(got).toEqual(order.filter((id) => got.includes(id)));
    }
  });

  it("retitles the vehicles section for a child account", () => {
    expect(sectionsFor(primary).find((s) => s.id === "vehicles")?.title).toBe("My Vehicles");
    // Not theirs — the flat's. They can look but not touch.
    expect(sectionsFor(family).find((s) => s.id === "vehicles")?.title).toBe("Flat Vehicles");
    expect(sectionsFor(tenant).find((s) => s.id === "vehicles")?.title).toBe("Flat Vehicles");
  });

  it("treats family and tenant the same for sections", () => {
    expect(sectionsFor(family)).toEqual(sectionsFor(tenant));
  });

  it("gives every section a title", () => {
    for (const s of RESIDENT_SECTIONS) expect(s.title.length).toBeGreaterThan(0);
  });
});

describe("opening a section directly", () => {
  it("agrees with the menu, so a hidden section is not merely hidden", () => {
    // The bug this guards: a section dropped from the menu but still
    // reachable by a deep link or a stale notification tap.
    for (const identity of [primary, family, tenant]) {
      const visible = new Set(sectionsFor(identity).map((s) => s.id));
      for (const spec of RESIDENT_SECTIONS) {
        expect(canOpenSection(identity, spec.id)).toBe(visible.has(spec.id));
      }
    }
  });

  it("refuses an unknown section", () => {
    expect(canOpenSection(primary, "nonsense" as never)).toBe(false);
  });
});

describe("actions", () => {
  const all: ResidentAction[] = [
    "manageVehicles", "manageHouseHelps", "addFlat", "setPrimaryFlat",
    "manageChildAccounts", "deleteAccount", "createGuestPass",
    "decideDelivery", "bookAmenity",
  ];

  it("lets a primary resident do everything", () => {
    for (const a of all) expect(can(primary, a)).toBe(true);
  });

  it("stops a child account changing who gets through the gate", () => {
    expect(can(family, "manageVehicles")).toBe(false);
    expect(can(family, "manageHouseHelps")).toBe(false);
  });

  it("stops a child account widening its own access", () => {
    expect(can(tenant, "addFlat")).toBe(false);
    expect(can(tenant, "setPrimaryFlat")).toBe(false);
    expect(can(tenant, "manageChildAccounts")).toBe(false);
    expect(can(tenant, "deleteAccount")).toBe(false);
  });

  it("still lets a child account run its own day", () => {
    // The point of the rule is not to hobble a tenant. One who cannot
    // let their own guest in would borrow the primary resident's phone,
    // and the restriction would have bought nothing.
    expect(can(family, "createGuestPass")).toBe(true);
    expect(can(family, "decideDelivery")).toBe(true);
    expect(can(family, "bookAmenity")).toBe(true);
    expect(can(tenant, "createGuestPass")).toBe(true);
    expect(can(tenant, "decideDelivery")).toBe(true);
  });

  it("treats family and tenant the same", () => {
    for (const a of all) expect(can(family, a)).toBe(can(tenant, a));
  });
});

describe("explaining a refusal", () => {
  it("says nothing when the action is allowed", () => {
    expect(whyNot(primary, "manageVehicles")).toBeNull();
    expect(whyNot(family, "createGuestPass")).toBeNull();
  });

  it("explains every refusal, so no button is dead without a reason", () => {
    for (const a of ["manageVehicles", "manageHouseHelps", "addFlat",
      "setPrimaryFlat", "manageChildAccounts", "deleteAccount"] as ResidentAction[]) {
      const msg = whyNot(family, a);
      expect(msg).toBeTruthy();
      expect(msg!.length).toBeGreaterThan(20);
    }
  });

  it("points at who can actually do it", () => {
    expect(whyNot(tenant, "manageVehicles")).toContain("primary resident");
    expect(whyNot(tenant, "manageHouseHelps")).toContain("primary resident");
  });

  it("names the login type when removing the account", () => {
    expect(whyNot(tenant, "deleteAccount")).toContain("tenant");
    expect(whyNot(family, "deleteAccount")).toContain("family");
  });
});
