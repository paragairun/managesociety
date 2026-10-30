/**
 * What a resident account is allowed to see and do.
 *
 * A flat has one primary resident, who can create additional logins for
 * the people living there — family members and tenants. Those child
 * accounts can do most of what the primary can, but not everything, and
 * the difference is a real access rule rather than a cosmetic one:
 *
 *   - they cannot add or remove the flat's VEHICLES, because a vehicle
 *     registration is what gets a car through the gate and the primary
 *     resident answers for it;
 *   - they cannot manage HOUSE HELPS, for the same reason: a house help
 *     QR opens the gate for a person;
 *   - they cannot add FLATS or create further child accounts, which
 *     would let a tenant quietly extend their own access;
 *   - they cannot DELETE the account, which would take the flat's
 *     primary record with it.
 *
 * The website encoded this as two hand-written navigation arrays, which
 * is easy to get wrong in the other direction — a section hidden from
 * the menu but still reachable, or a button left enabled on a screen a
 * child account can open. Stating it once, as data, means the website
 * and the native app cannot drift, and the rules are testable without a
 * browser.
 */

export type ChildType = "family" | "tenant";

export interface ResidentIdentity {
  /** True when this login was created by another resident. */
  isChild: boolean;
  childType: ChildType | null;
}

export type ResidentSection =
  | "home" | "guest" | "deliveries" | "dues"
  | "amenities" | "vehicles" | "ev" | "helps" | "profile";

export interface SectionSpec {
  id: ResidentSection;
  /** Title for a primary resident. */
  title: string;
  /** Title for a child account, where it differs. */
  childTitle?: string;
  /** Sections a child account does not get at all. */
  primaryOnly?: boolean;
}

/**
 * Every section, in menu order, with the one title that changes.
 *
 * "My Vehicles" reads as "Flat Vehicles" for a child account because
 * they are not the resident's own — they belong to the flat, and the
 * child account can look but not touch.
 */
export const RESIDENT_SECTIONS: SectionSpec[] = [
  { id: "home", title: "Home" },
  { id: "guest", title: "Guest Pass" },
  { id: "deliveries", title: "Deliveries" },
  { id: "dues", title: "My Dues" },
  { id: "amenities", title: "Amenities" },
  { id: "vehicles", title: "My Vehicles", childTitle: "Flat Vehicles" },
  { id: "ev", title: "EV Charging" },
  { id: "helps", title: "House Helps", primaryOnly: true },
  { id: "profile", title: "My Profile" },
];

/** The sections this account may open, in menu order, correctly titled. */
export function sectionsFor(identity: ResidentIdentity): { id: ResidentSection; title: string }[] {
  return RESIDENT_SECTIONS
    .filter((s) => !(s.primaryOnly && identity.isChild))
    .map((s) => ({
      id: s.id,
      title: identity.isChild && s.childTitle ? s.childTitle : s.title,
    }));
}

/** True when this account may open that section at all. */
export function canOpenSection(identity: ResidentIdentity, section: ResidentSection): boolean {
  const spec = RESIDENT_SECTIONS.find((s) => s.id === section);
  if (!spec) return false;
  return !(spec.primaryOnly && identity.isChild);
}

export type ResidentAction =
  /** Request a vehicle be added to the flat. */
  | "manageVehicles"
  /** Register or remove a house help. */
  | "manageHouseHelps"
  /** Add another flat to this login. */
  | "addFlat"
  /** Choose which flat is the primary one. */
  | "setPrimaryFlat"
  /** Create a family or tenant login. */
  | "manageChildAccounts"
  /** Delete this account entirely. */
  | "deleteAccount"
  /** Create a guest pass. */
  | "createGuestPass"
  /** Approve or reject a delivery waiting at the gate. */
  | "decideDelivery"
  /** Book an amenity. */
  | "bookAmenity";

const CHILD_MAY_NOT: ResidentAction[] = [
  "manageVehicles",
  "manageHouseHelps",
  "addFlat",
  "setPrimaryFlat",
  "manageChildAccounts",
  "deleteAccount",
];

/**
 * True when this account may perform that action.
 *
 * Note what a child account CAN do, which is most of it: create guest
 * passes, answer deliveries, book amenities, see the dues. A tenant who
 * cannot let their own guest in would just borrow the primary
 * resident's phone, and the access rule would have bought nothing.
 */
export function can(identity: ResidentIdentity, action: ResidentAction): boolean {
  if (!identity.isChild) return true;
  return !CHILD_MAY_NOT.includes(action);
}

/**
 * Why an action is unavailable, for a message on the screen.
 *
 * Returns null when it IS available. A disabled button with no
 * explanation reads as a broken app, and "the primary resident does
 * this" is the kind of thing a tenant can act on.
 */
export function whyNot(identity: ResidentIdentity, action: ResidentAction): string | null {
  if (can(identity, action)) return null;
  const who = identity.childType === "tenant" ? "tenant" : "family";
  switch (action) {
    case "manageVehicles":
      return `Vehicles are registered by the flat's primary resident. Ask them to add it, or to send you the QR.`;
    case "manageHouseHelps":
      return `House helps are registered by the flat's primary resident.`;
    case "addFlat":
    case "setPrimaryFlat":
      return `Only the flat's primary resident can change which flats this login covers.`;
    case "manageChildAccounts":
      return `Only the flat's primary resident can create logins for others.`;
    case "deleteAccount":
      return `This ${who} login is managed by the flat's primary resident, who can remove it.`;
    default:
      return `The flat's primary resident does this.`;
  }
}
