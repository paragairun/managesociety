/**
 * Where a tapped notification should take you.
 *
 * Every notification carries a small `data` payload built in SQL by
 * queue_notification() — see supabase/schema/push_notifications.sql:
 *
 *   { role: 'resident' | 'guard' | 'admin', view: '<nav id>', id: '<uuid>' }
 *
 * The three dashboards are single pages that switch an internal view id
 * rather than navigating, so "open the booking" means "select the
 * amenities section of the resident dashboard". This module turns the
 * payload into that decision, and is pure so it can be tested without a
 * phone.
 *
 * WHY THE VIEW IS VALIDATED AGAINST A LIST
 * The payload arrives from outside the app. Handing an unknown id
 * straight to setActiveView renders a dashboard with every section
 * false — a blank screen with a working sidebar, which looks exactly
 * like a crash. An unrecognised view is therefore dropped and the
 * notification just opens the app where it was.
 *
 * These lists must match the NAV arrays in the three dashboard pages.
 * A test pins them, so renaming a nav id without updating this file
 * fails the suite rather than producing a dead notification tap.
 */

export type PushRole = "resident" | "guard" | "admin";

export const PUSH_VIEWS: Record<PushRole, readonly string[]> = {
  // src/pages/ResidentPortal.tsx — PRIMARY_NAV plus CHILD_NAV
  resident: ["home", "guest", "deliveries", "dues", "amenities", "vehicles", "ev", "helps", "profile"],
  // src/pages/GuardDashboard.tsx
  guard: ["home", "scan", "approvals", "live", "barriers", "delivery"],
  // src/pages/AdminPanel.tsx — NAV, plus the two sections reachable
  // only from the Home tiles ("guards", "device-pins").
  admin: [
    "home", "stats", "vehicle-management", "users", "staff",
    "amenity-management", "accounts-maintenance", "ev-charging", "profile",
    "guards", "device-pins",
  ],
} as const;

/** The `data` block as FCM delivers it: string values only. */
export type PushData = Record<string, unknown> | null | undefined;

export interface PushTarget {
  /** The dashboard view to select. */
  view: string;
  /** The row the notification was about, when it named one. */
  id?: string;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function isPushRole(value: unknown): value is PushRole {
  return value === "resident" || value === "guard" || value === "admin";
}

/**
 * Decide what a tap should do, given the payload and which dashboard is
 * open.
 *
 * Returns null when there is nothing sensible to do, which is the right
 * answer more often than it looks:
 *
 *  - no view in the payload
 *  - a view this role does not have
 *  - a payload addressed to a different role
 *
 * That last case is not hypothetical. One person can hold two roles,
 * and a guard who is also a resident of the same society will receive
 * both kinds. Switching the guard dashboard to the resident's "dues"
 * section would be worse than doing nothing.
 */
export function resolvePushTarget(data: PushData, currentRole: PushRole): PushTarget | null {
  if (!data) return null;

  const view = str(data.view);
  if (!view) return null;

  // A payload with NO role is accepted on whichever dashboard is open.
  // A payload that carries one must match. Note the distinction between
  // absent and malformed: `{ role: 7 }` is not "no role given", it is a
  // payload this app did not produce, and treating it as role-agnostic
  // would let a junk value through to the view check.
  if (data.role !== undefined && data.role !== null) {
    const role = str(data.role);
    if (role === undefined || role !== currentRole) return null;
  }

  if (!PUSH_VIEWS[currentRole].includes(view)) return null;

  return { view, id: str(data.id) };
}

/**
 * The Android notification channel.
 *
 * Android 8 and later ignore per-notification sound and importance and
 * take them from the channel, so a message sent to a channel the app
 * never created lands silently in a system-made default. The id here
 * must match the `channel_id` in send-push-notification.
 */
export const PUSH_CHANNEL = {
  id: "managesociety-default",
  name: "Society alerts",
  description: "Visitors, deliveries, approvals and bills",
  // 5 is IMPORTANCE_HIGH: a heads-up banner with sound. A visitor
  // waiting at the gate is worth interrupting for.
  importance: 5 as const,
  visibility: 1 as const,
};
