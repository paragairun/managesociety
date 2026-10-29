import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "@/integrations/supabase/client";
import { resolvePushTarget, PUSH_CHANNEL, type PushRole, type PushTarget } from "@/lib/pushRouting";
import { takePushTarget, onPushTarget } from "@/lib/pushTarget";

/**
 * Push notifications for one dashboard.
 *
 * Does four things:
 *   1. asks for permission and registers the device with FCM,
 *   2. stores the resulting token against the signed-in user so the
 *      send-push-notification function can find it,
 *   3. shows something when a notification arrives while the app is
 *      open — Android delivers those silently to the app instead of to
 *      the tray, so without this they vanish,
 *   4. opens the right section when one is tapped.
 *
 * A no-op in a browser tab: Capacitor.isNativePlatform() is false
 * there, so the same React build serves the website and both apps.
 * Web push would need a service worker and a VAPID key, which is a
 * separate piece of work.
 *
 * WHAT HAPPENS IN THE BACKGROUND is not this hook's business. Android
 * renders tray notifications from the FCM payload itself, so they
 * arrive whether or not the app is running — which is the entire point
 * and the reason the Edge Function sends a `notification` block rather
 * than a data-only message.
 */
export interface PushOptions {
  /**
   * Which dashboard this is, so a payload meant for another role can be
   * ignored. A manager passes "admin": they use the admin dashboard.
   */
  role?: PushRole;
  /** Select a section. Called on tap, and only for a valid target. */
  onOpen?: (target: PushTarget) => void;
  /** Show a foreground notification however this dashboard prefers. */
  onForeground?: (notification: { title: string; body: string; target: PushTarget | null }) => void;
}

export function usePushNotifications(userId: string | undefined, options: PushOptions = {}) {
  // Held in a ref and read inside the listeners rather than captured.
  // The callbacks are usually inline arrow functions, so a new object
  // arrives on every render; depending on them would tear down and
  // re-register the FCM listeners several times a second.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!userId || !Capacitor.isNativePlatform()) return;

    let cancelled = false;

    const setup = async () => {
      // Android 8+ takes sound and importance from the channel, so a
      // message aimed at a channel the app never created lands in a
      // system default with no sound and no banner. Created before
      // registering, so the first notification cannot beat it.
      if (Capacitor.getPlatform() === "android") {
        try {
          await PushNotifications.createChannel(PUSH_CHANNEL);
        } catch (err) {
          // Not fatal: notifications still arrive, just quietly.
          console.warn("Could not create the notification channel:", err);
        }
      }

      const permStatus = await PushNotifications.checkPermissions();
      let granted = permStatus.receive === "granted";

      if (permStatus.receive === "prompt") {
        const req = await PushNotifications.requestPermissions();
        granted = req.receive === "granted";
      }

      if (!granted || cancelled) return;

      await PushNotifications.register();
    };

    const registrationListener = PushNotifications.addListener("registration", async (token) => {
      if (cancelled) return;
      // Capacitor.getPlatform() returns 'ios', 'android' or 'web'. This
      // was hardcoded to "android", which was harmless while Android was
      // the only shell and silently wrong the moment an iPhone
      // registered — send-push-notification would have had no way to
      // tell APNs tokens from FCM ones.
      //
      // device_push_tokens is absent from the generated types.ts, which
      // is behind the schema, so `.from()` narrows it to `never` and
      // every field below becomes a type error. Cast the client rather
      // than the row, the same way evDb.ts and societyLookup.ts do:
      // regenerating types.ts then deletes this and nothing else.
      //
      // The table's definition is supabase/schema/device_push_tokens.sql.
      const db = supabase as unknown as {
        from: (table: string) => {
          upsert: (
            row: Record<string, string | undefined>,
            options: { onConflict: string },
          ) => Promise<{ error: { message: string } | null }>;
        };
      };

      const { error } = await db.from("device_push_tokens").upsert(
        { user_id: userId, token: token.value, platform: Capacitor.getPlatform() },
        { onConflict: "user_id,token" },
      );
      if (error) console.error("Failed to save push token:", error);
    });

    const errorListener = PushNotifications.addListener("registrationError", (err) => {
      console.error("Push registration error:", err);
    });

    // Arrives while the app is in the FOREGROUND. Android hands these
    // to the app rather than the system tray, so a notification that
    // lands while somebody is looking at the dashboard is invisible
    // unless the app shows it itself.
    const receivedListener = PushNotifications.addListener(
      "pushNotificationReceived",
      (notification) => {
        const { role, onForeground } = optionsRef.current;
        if (!onForeground) return;
        onForeground({
          title: notification.title ?? "",
          body: notification.body ?? "",
          target: role ? resolvePushTarget(notification.data, role) : null,
        });
      },
    );

    // NOTE: the TAP is not handled here. It is captured at app
    // bootstrap by startPushTapCapture() and parked in pushTarget,
    // because a tap that launches a closed app fires before this hook
    // — or React itself — exists. See the effect below, and the
    // explanation in src/lib/pushTarget.ts.

    void setup();

    return () => {
      cancelled = true;
      void registrationListener.then((l) => l.remove());
      void errorListener.then((l) => l.remove());
      void receivedListener.then((l) => l.remove());
    };
    // options deliberately absent — see optionsRef above.
  }, [userId]);

  /**
   * Open whatever a tapped notification asked for.
   *
   * Runs on mount to pick up a tap that happened before this dashboard
   * existed — the cold-start case — and stays subscribed for taps that
   * arrive while it is on screen.
   *
   * Not gated on isNativePlatform: a parked target is only ever created
   * by the native listener, so there is nothing to consume on the web
   * and the check would be redundant.
   */
  useEffect(() => {
    const openPending = () => {
      const { role, onOpen } = optionsRef.current;
      if (!role || !onOpen) return;

      const data = takePushTarget();
      if (!data) return;

      const target = resolvePushTarget(data, role);
      // Null for a payload naming another role or an unknown view.
      // Doing nothing leaves the app where it was, which beats
      // selecting a section that does not exist and rendering blank.
      if (target) onOpen(target);
    };

    openPending();
    return onPushTarget(openPending);
  }, [userId]);
}
