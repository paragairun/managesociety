/**
 * Who may open a dashboard route.
 *
 * Pulled out of ProtectedRoute as a pure function so the rules can be
 * tested exhaustively instead of only being observable by clicking
 * around a browser. ProtectedRoute is now a thin renderer over this.
 *
 * Two holes this closes, both found while auditing a report that one
 * dashboard could be reached from another:
 *
 *  1. SOCIETY SCOPING. The old guard checked only "does this user hold
 *     the required role", never "does this user belong to the society in
 *     the URL". Roles in this schema are not society-scoped — AuthContext
 *     reads user_roles filtered by user_id alone — so anyone holding the
 *     admin role in ANY society could open /<other-society>/admin/dashboard.
 *
 *  2. SLUGLESS LEGACY ROUTES. /admin/dashboard carries no society at all,
 *     so no scoping was possible. A user who lands there is now redirected
 *     to their own society's canonical URL.
 *
 * NOTE, and this matters: this is a client-side guard. It decides what
 * the UI renders, nothing more. Anyone can edit JavaScript in their own
 * browser. The real boundary is RLS in Postgres — this layer only stops
 * honest mistakes and casual URL edits.
 */

import { type AppRole } from "./permissions";
export type { AppRole };

/**
 * Roles that satisfy a route's required role without being it.
 *
 * A manager is an administrator with two powers removed, so they open
 * the same dashboard. What they may do once inside is decided by
 * permissions.ts, not here — this answers only "may you through the
 * door". Kept as data rather than an `||` inside the check so that
 * adding a future role is one line and is covered by the same tests.
 */
const ROLE_SATISFIES: Partial<Record<AppRole, AppRole[]>> = {
  admin: ["manager"],
};

function holdsRequiredRole(roles: AppRole[], required: AppRole): boolean {
  if (roles.includes(required)) return true;
  return (ROLE_SATISFIES[required] || []).some((r) => roles.includes(r));
}

export interface AccessInput {
  loading: boolean;
  /** Is anyone signed in. */
  hasUser: boolean;
  roles: AppRole[];
  requiredRole: AppRole;
  /** Society slug taken from the URL, if the matched route had one. */
  urlSlug?: string | null;
  /** Society slug the signed-in user actually belongs to. */
  userSlug?: string | null;
  /** Route segment used to build paths, e.g. "admin". */
  pathBase: string;
}

export type AccessDecision =
  | { action: "loading" }
  | { action: "redirect"; to: string; reason: "unauthenticated" | "super-admin" | "canonical-society" }
  | { action: "deny"; reason: "wrong-role" | "wrong-society" | "no-society"; message: string }
  | { action: "allow" };

export function decideRouteAccess(input: AccessInput): AccessDecision {
  const { loading, hasUser, roles, requiredRole, urlSlug, userSlug, pathBase } = input;

  if (loading) return { action: "loading" };

  // Not signed in: back to the login page for this society if the URL
  // named one, so a refreshed deep link returns to the right place.
  if (!hasUser) {
    return {
      action: "redirect",
      to: urlSlug ? `/${urlSlug}/${pathBase}` : `/${pathBase}`,
      reason: "unauthenticated",
    };
  }

  // Super admins have no society and belong on their own dashboard.
  if (roles.includes("super_admin")) {
    return { action: "redirect", to: "/super-admin", reason: "super-admin" };
  }

  if (!holdsRequiredRole(roles, requiredRole)) {
    return {
      action: "deny",
      reason: "wrong-role",
      message: "You do not have permission to access this page.",
    };
  }

  // Holding the role is not enough — it must be held in THIS society.
  if (urlSlug) {
    if (!userSlug) {
      return {
        action: "deny",
        reason: "no-society",
        message: "Your account is not linked to a society. Contact your society admin.",
      };
    }
    if (urlSlug !== userSlug) {
      return {
        action: "deny",
        reason: "wrong-society",
        message: "This account does not belong to this society.",
      };
    }
    return { action: "allow" };
  }

  // Slugless legacy route. Send the user to their own society's URL so
  // every dashboard visit is society-scoped and checkable.
  if (userSlug) {
    return {
      action: "redirect",
      to: `/${userSlug}/${pathBase}/dashboard`,
      reason: "canonical-society",
    };
  }

  // No slug anywhere to compare. Role check already passed.
  return { action: "allow" };
}
