import type { PushData } from "./pushRouting";

/**
 * Holds the screen a tapped push notification asked for, until a
 * dashboard exists to open it.
 *
 * WHY THIS IS NEEDED
 * The tap handler used to live inside usePushNotifications, which is
 * mounted by the dashboards. That works only when the app is already
 * open on a dashboard. The important case is the other one:
 *
 *   the app is closed -> a delivery arrives -> the resident taps the
 *   notification -> Android launches the app -> the plugin fires
 *   pushNotificationActionPerformed within milliseconds -> React has
 *   not mounted, auth has not resolved, the route guard has not run,
 *   so no listener exists -> the event is lost -> the resident lands
 *   on Home and has to find the delivery themselves.
 *
 * That is the exact journey a notification exists to serve, and it was
 * the one that did not work.
 *
 * So the listener is registered at app bootstrap instead — see
 * startPushTapCapture(), called from main.tsx before React renders —
 * and what it captures is parked here. Whichever dashboard mounts next
 * consumes it.
 *
 * WHY localStorage AS WELL AS A VARIABLE
 * The module variable covers the usual cold start, where the tap and
 * the dashboard share one JS context. localStorage covers the longer
 * journey: tap -> app opens on the LOGIN screen -> the resident types
 * their password -> only then does a dashboard mount. That can take
 * half a minute and a navigation, and the intent should survive it.
 *
 * It is read once and cleared immediately, so a stale target can never
 * hijack a later launch.
 */

const STORAGE_KEY = "ms.pendingPushTarget";

let pending: PushData = null;

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();

/** Park a tapped notification's data and wake any mounted dashboard. */
export function rememberPushTarget(data: PushData): void {
  if (!data || typeof data !== "object") return;
  pending = data;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Private browsing, blocked site data, a full quota. The module
    // variable still covers the common case, so this is not fatal.
  }
  for (const fn of subscribers) {
    try {
      fn();
    } catch {
      // One bad subscriber must not stop the others being told.
    }
  }
}

/**
 * Take the parked target, if there is one, and clear it.
 *
 * Destructive by design: a target represents one tap and must be acted
 * on once. Leaving it in place would re-open the same screen on the
 * next mount, which looks like the app fighting the user.
 */
export function takePushTarget(): PushData {
  if (pending) {
    const target = pending;
    pending = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
    return target;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    localStorage.removeItem(STORAGE_KEY);
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as PushData) : null;
  } catch {
    return null;
  }
}

/** Notified when a tap arrives while a dashboard is already mounted. */
export function onPushTarget(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** Test seam. Not used by the app. */
export function resetPushTarget(): void {
  pending = null;
  subscribers.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

let captureStarted = false;

/**
 * Register the notification-tap listener as early as the app can.
 *
 * Called from main.tsx at module scope, which is before createRoot
 * renders anything — the earliest point in the app's life where a
 * listener can exist, and the only way to be ahead of a cold start
 * triggered by the tap itself.
 *
 * A no-op in a browser tab: there is no native push channel there, and
 * importing the plugin's listener on web would throw.
 */
export async function startPushTapCapture(): Promise<void> {
  if (captureStarted) return;
  captureStarted = true;

  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return;

    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      rememberPushTarget(action.notification.data as PushData);
    });
  } catch (err) {
    // Never let this stop the app booting. A failure here costs the
    // deep link, not the application.
    console.warn("Could not start push tap capture:", err);
  }
}
