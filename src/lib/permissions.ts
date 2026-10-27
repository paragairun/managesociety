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
 * Roles a person with no account may request for themselves on the
 * public /register page.
 *
 * Only committee roles. Someone joining a society as a guard or a
 * resident already has a committee who can create them, so there is no
 * reason to let a stranger put their name, email and flat number into
 * that society's queue — or to let them discover which flats exist by
 * watching what the form accepts. Those two are in
 * COMMITTEE_CREATED_ROLES below.
 *
 * registration_requests.requested_role is plain text and the insert
 * used to be WITH CHECK (true), so this list was never a gate on its
 * own — anyone could POST to the REST endpoint naming any role in the
 * enum, super_admin included, which is not society-scoped.
 * supabase/schema/registration_lockdown.sql is what enforces it: anon
 * may insert only these roles, and a committee member may create the
 * member roles for their own society alone.
 *
 * super_admin is absent deliberately and must stay absent.
 */
export const SELF_SERVICE_ROLES: AppRole[] = ["admin", "manager"];

/**
 * Roles a committee creates FOR someone, rather than roles a stranger
 * may ask for. Guards and residents moved here: a public form that
 * accepted them let anyone put a name, an email and a flat number into
 * a society's approval queue uninvited, and probe which flats exist
 * while doing it. The committee adds them from the admin panel, which
 * writes a request and approves it in one step.
 *
 * approve-registration still accepts all four, because it governs what
 * an ADMIN may approve — not what an anonymous visitor may request.
 * Those are different questions and were previously one list.
 */
export const COMMITTEE_CREATED_ROLES: AppRole[] = ["guard", "resident"];

export function isCommitteeCreatedRole(role: string | null | undefined): boolean {
  return !!role && (COMMITTEE_CREATED_ROLES as string[]).includes(role);
}

export function isSelfServiceRole(role: string | null | undefined): boolean {
  return !!role && (SELF_SERVICE_ROLES as string[]).includes(role);
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
