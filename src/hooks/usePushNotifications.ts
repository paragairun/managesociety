import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "@/integrations/supabase/client";

/**
 * Registers this device for push notifications when the app is running
 * inside a native wrapper (Capacitor), on iOS or Android -- a no-op in a
 * regular browser tab, since there's no native push channel there.
 *
 * Capacitor.isNativePlatform() is the guard that makes this safe to call
 * unconditionally: in a browser it returns false and the effect does
 * nothing, so the same React build serves the website and both apps.
 *
 * On success, upserts the FCM device token against the current user so the
 * send-push-notification edge function can look it up later. Call this once
 * per dashboard, after the user is confirmed logged in (needs a real user id
 * to attach the token to).
 */
export function usePushNotifications(userId: string | undefined) {
  useEffect(() => {
    if (!userId || !Capacitor.isNativePlatform()) return;

    let cancelled = false;

    const setup = async () => {
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
      // device_push_tokens is absent from the generated types.ts, which
      // is behind the schema, so `.from()` narrows it to `never` and
      // every field below becomes a type error. Cast the client rather
      // than the row, the same way evDb.ts and societyLookup.ts do:
      // regenerating types.ts then deletes this and nothing else.
      //
      // The table's definition is supabase/schema/device_push_tokens.sql
      // — it had no migration at all until that file.
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
        { onConflict: "user_id,token" }
      );
      if (error) console.error("Failed to save push token:", error);
    });

    const errorListener = PushNotifications.addListener("registrationError", (err) => {
      console.error("Push registration error:", err);
    });

    void setup();

    return () => {
      cancelled = true;
      void registrationListener.then((l) => l.remove());
      void errorListener.then((l) => l.remove());
    };
  }, [userId]);
}
