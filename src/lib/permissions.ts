/**
 * What each role is allowed to do. One table, consulted everywhere.
 *
 * WHY THIS IS A SEPARATE MODULE
 * The manager role is defined by subtraction — "an admin who cannot
 * touch members or other admins". Expressing that as scattered
 * `roles.includes("admin") || roles.includes("manager")` checks guarantees
 * it drifts: the day someone adds a screen and writes only the admin
 * check, managers lose access for no stated reason, and the day someone
 * writes the manager check too broadly, they gain it. The capability
 * table below is the single place that answers the question.
 *
 * SAFE BY DEFAULT
 * A manager holds ONLY the 'manager' role, never 'admin'. Every existing
 * RLS policy and every Edge Function already gates on has_role(admin),
 * so a manager is refused by all of them until explicitly granted. The
 * failure mode of forgetting something is therefore "manager cannot do
 * it", never "manager can do something they should not".
 *
 * THIS IS NOT THE SECURITY BOUNDARY
 * Same caveat as routeAccess.ts: this decides what the UI offers.
 * Anyone can edit JavaScript in their own browser. The real boundary is
 * RLS in Postgres and the role checks inside the Edge Functions — see
 * supabase/schema/manager_role.sql, which mirrors this table.
 */

export type AppRole =
  | "guard" | "resident" | "admin" | "visitor" | "super_admin" | "manager";

/**
 * Capabilities are named for the thing and the verb, so a reader can
 * tell at a glance what is being asked. "view" means read-only.
 */
export type Capability =
  // Residents and their accounts
  | "members.view"
  | "members.edit"
  | "members.delete"
  | "registrations.approve"
  // Other administrators
  | "admins.view"
  | "admins.edit"
  // Day-to-day society operations
  | "staff.manage"
  | "attendance.view"
  | "guards.manage"
  | "vehicles.manage"
  | "barriers.manage"
  | "amenities.manage"
  | "billing.manage"
  | "accesslogs.view"
  | "stats.view"
  // The society's own shape: its unit types and sizes, and how vehicles
  // get through the gate. Separate from billing.manage because getting
  // it wrong is worse than getting a rate wrong — the unit catalogue is
  // what every per-unit charge is computed against, and the gate mode
  // decides what a guard's app even shows.
  | "society.settings"
  // EV charging
  | "ev.manage"
  | "ev.settings";

/** Everything an administrator may do. */
const ADMIN: Capability[] = [
  "members.view", "members.edit", "members.delete", "registrations.approve",
  "admins.view", "admins.edit",
  "staff.manage", "attendance.view", "guards.manage",
  "vehicles.manage", "barriers.manage", "amenities.manage",
  "billing.manage", "accesslogs.view", "stats.view",
  "society.settings",
  "ev.manage", "ev.settings",
];

/**
 * A manager is an administrator minus two things, exactly as specified:
 * they may not modify registered members or their profiles, and they may
 * not modify or delete any admin profile. They keep read access to both,
 * because approving a booking or chasing a maintenance bill means being
 * able to look a resident up.
 */
const MANAGER_DENIED: Capability[] = [
  "members.edit", "members.delete", "admins.edit",
];

const MANAGER: Capability[] = ADMIN.filter((c) => !MANAGER_DENIED.includes(c));

const CAPABILITIES: Record<AppRole, Capability[]> = {
  super_admin: ADMIN,
  admin: ADMIN,
  manager: MANAGER,
  guard: ["attendance.view", "accesslogs.view"],
  resident: [],
  visitor: [],
};

/** Does any role the user holds grant this capability? */
export function can(roles: AppRole[] | undefined | null, capability: Capability): boolean {
  if (!roles || roles.length === 0) return false;
  return roles.some((r) => (CAPABILITIES[r] || []).includes(capability));
}

/** Every capability the user has, across all their roles. */
export function capabilitiesOf(roles: AppRole[] | undefined | null): Capability[] {
  const out = new Set<Capability>();
  for (const r of roles || []) for (const c of CAPABILITIES[r] || []) out.add(c);
  return [...out];
}

/**
 * Roles that may open the admin dashboard at all.
 *
 * Kept as a list rather than a capability because it answers a different
 * question — "which door may you walk through" rather than "what may you
 * do once inside".
 */
export const ADMIN_PANEL_ROLES: AppRole[] = ["admin", "manager"];

/**
 * Roles that satisfy a required role without being it.
 *
 * A manager is an administrator with two powers removed, so they use
 * the admin login page and the admin dashboard; what they may do once
 * inside is decided by the capability table above, not here.
 *
 * This lived privately inside routeAccess.ts, which guards the
 * dashboard route — while RoleLoginPage kept its own separate
 * `roles.includes(roleKey)` check. The result was a manager who passed
 * the route guard but was refused by the login page before ever
 * reaching it. One table now answers the question for both.
 */
export const ROLE_SATISFIES: Partial<Record<AppRole, AppRole[]>> = {
  admin: ["manager"],
};

/** Does the user hold the required role, or one that stands in for it? */
export function roleSatisfies(
  roles: AppRole[] | undefined | null,
  required: AppRole,
): boolean {
  const held = roles || [];
  if (held.includes(required)) return true;
  return (ROLE_SATISFIES[required] || []).some((r) => held.includes(r));
}

export function canOpenAdminPanel(roles: AppRole[] | undefined | null): boolean {
  return (roles || []).some((r) => ADMIN_PANEL_ROLES.includes(r));
}

/** True when the user is a manager and not also a full admin. */
export function isManagerOnly(roles: AppRole[] | undefined | null): boolean {
  const r = roles || [];
  return r.includes("manager") && !r.includes("admin") && !r.includes("super_admin");
}

/**
 * Roles a person with no account may request for themselves.
 *
 * NONE. There is no public registration any more.
 *
 * A society joins through /register-society, which a super admin
 * reviews; approving it creates the society, the first admin's auth
 * user, their profile and their admin role in one step. Everybody
 * after that is created from inside the admin panel. So no door was
 * needed here, and the one that existed let a stranger who knew a
 * society's slug drop an ADMIN request into its queue, where a busy
 * reviewer might approve it.
 *
 * Kept as an empty list rather than deleted, so that adding a role
 * back is a deliberate edit against a test that pins it empty, and so
 * the reasoning above stays attached to the decision.
 *
 * Enforced by supabase/schema/registration_public_close.sql: anon has
 * no INSERT on registration_requests at all. This list is only what
 * the UI would offer, and the UI is not a control.
 */
export const SELF_SERVICE_ROLES: AppRole[] = [];

export function isSelfServiceRole(role: string | null | undefined): boolean {
  return !!role && (SELF_SERVICE_ROLES as string[]).includes(role);
}

/**
 * Who may create whom, from inside the admin panel.
 *
 * Derived from the capability model rather than invented beside it: a
 * manager is denied members.edit and admins.edit and granted
 * guards.manage, so a manager may add guards and nothing else. An
 * admin may add anyone, including another admin.
 *
 * This matters more than a disabled dropdown suggests. The approval
 * step returns a temporary password to whoever triggered it, so a
 * manager who could create an admin could simply sign in as one. The
 * first version of registration_lockdown.sql allowed exactly that;
 * registration_public_close.sql fixes it, and this mirrors the fix so
 * the form does not offer what the database will refuse.
 *
 * super_admin is never creatable here. It is not society-scoped.
 */
export function rolesCreatableBy(roles: AppRole[] | null | undefined): AppRole[] {
  const held = roles ?? [];
  if (held.includes("admin") || held.includes("super_admin")) {
    return ["admin", "manager", "guard", "resident"];
  }
  if (held.includes("manager")) return ["guard"];
  return [];
}

export function canCreateRole(
  roles: AppRole[] | null | undefined,
  target: string | null | undefined,
): boolean {
  return !!target && (rolesCreatableBy(roles) as string[]).includes(target);
}

/** What the register page calls each role. */
export const ROLE_LABEL: Record<string, string> = {
  admin: "Administrator",
  manager: "Manager",
  guard: "Security Guard",
  resident: "Resident",
};

/** One line saying what the role can do, shown beside the choice. */
export const ROLE_BLURB: Record<string, string> = {
  admin: "Full access, including members and other admins",
  manager: "Runs the society day to day, but cannot change members or admins",
  guard: "Gate duty: visitors, vehicles and staff attendance",
  resident: "Flat owner or tenant",
};

/**
 * The label shown next to a restricted control, so a manager is told why
 * something is unavailable instead of finding a dead button.
 */
export const MANAGER_RESTRICTION_NOTE =
  "Managers can view members and admins but cannot change them. Ask an admin.";
