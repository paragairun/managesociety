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
  guard: ["home", "visitor", "scan", "approvals", "live", "barriers", "delivery"],
  // src/pages/AdminPanel.tsx — NAV, plus the two sections reachable
  // only from the Home tiles ("guards", "device-pins").
  admin: [
    "home", "stats", "vehicle-management", "users", "staff",
    "amenity-management", "accounts-maintenance", "society-setup",
    "ev-charging", "profile",
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
  name: "Society notices",
  description: "Bills, announcements, approvals and everything else",
  // 4 is IMPORTANCE_DEFAULT: it makes a sound and appears in the
  // shade, but does not shove a banner over whatever the person is
  // doing. A bill being issued does not warrant that.
  importance: 4 as const,
  visibility: 1 as const,
};

/**
 * The channel for someone physically waiting at the gate.
 *
 * Separate from PUSH_CHANNEL on purpose, for two reasons.
 *
 * It is louder: MAX importance, a long double-buzz pattern meant to be
 * felt through a pocket. A delivery agent standing at the gate for two
 * minutes is a different kind of message from a maintenance notice, and
 * it was the one that kept being missed.
 *
 * And it is separately MUTEABLE. Android lets people silence a channel
 * individually, so a resident who is tired of bill reminders can mute
 * those without also losing the thing their neighbours will be annoyed
 * about them missing. One channel for everything makes that an
 * all-or-nothing choice, and people choose nothing.
 *
 * A channel's importance, sound and vibration are fixed when it is
 * created — changing them in code later does nothing until the app is
 * reinstalled — so these values are effectively permanent once shipped.
 */
export const GATE_CHANNEL = {
  id: "managesociety-gate",
  name: "Someone at the gate",
  description: "A delivery or visitor waiting for you to answer",
  // 5 is IMPORTANCE_HIGH/MAX: a heads-up banner with sound.
  importance: 5 as const,
  visibility: 1 as const,
};

/**
 * Event keys that mean a person is standing at a gate, waiting.
 *
 * Deliberately a short, explicit list rather than a pattern match on
 * the key. "delivery.reviewed" and "visitor.reviewed" are about the
 * same subjects and must NOT be in it: those tell a guard that an
 * answer arrived, which is useful but is not worth a maximum-priority
 * interruption.
 */
const GATE_EVENTS = new Set([
  "delivery.at_gate",
  "visitor.at_gate",
  "gate.unregistered_vehicle",
]);

/**
 * The alert tone for someone waiting at a gate.
 *
 * A custom sound rather than the device default, because the default is
 * also every message, email and app update the resident gets. This one
 * is a short ascending three-note bell, synthesised for the app — the
 * file lives at native/<app>/assets/sounds/gate_alert.wav and the
 * expo-notifications config plugin copies it into res/raw on Android
 * and into the bundle on iOS.
 *
 * Android wants the resource name WITHOUT an extension in an FCM
 * payload; iOS wants the filename WITH one. Hence two constants for
 * one file, which is a trap worth naming rather than rediscovering.
 *
 * NOTE: a channel's sound is fixed when the channel is first created.
 * Changing this string later will not reach a phone that already has
 * the app — that needs a new channel id.
 */
export const GATE_SOUND = {
  /** For setNotificationChannelAsync and APNs. */
  file: "gate_alert.wav",
  /** For FCM's android.notification.sound. */
  android: "gate_alert",
} as const;

/**
 * The sound an event should play, by platform.
 *
 * Ordinary notices keep the device default: a bill arriving does not
 * deserve a distinct tone, and a resident who hears the gate sound
 * should know what it means without looking.
 */
export function soundForEvent(eventKey: string | null | undefined): {
  android: string;
  ios: string;
} {
  return channelForEvent(eventKey) === GATE_CHANNEL.id
    ? { android: GATE_SOUND.android, ios: GATE_SOUND.file }
    : { android: "default", ios: "default" };
}

/**
 * Which Android channel an event belongs in.
 *
 * Shared by the apps, which create the channels, and by
 * send-push-notification, which addresses messages to them. A message
 * sent to a channel the app never created lands in a system-made
 * default with none of these settings — so the two sides agreeing is
 * the whole point of putting this here.
 */
export function channelForEvent(eventKey: string | null | undefined): string {
  return eventKey && GATE_EVENTS.has(eventKey) ? GATE_CHANNEL.id : PUSH_CHANNEL.id;
}
