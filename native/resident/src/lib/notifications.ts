import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { supabase } from "@/lib/supabase";
import { resolvePushTarget, PUSH_CHANNEL, GATE_CHANNEL, GATE_SOUND } from "@core/pushRouting";

/**
 * Push registration and the delivery alert.
 *
 * THE ONE THING THIS HAS TO GET RIGHT: a delivery agent is standing at
 * the gate and the resident's phone is in their pocket. Everything else
 * here is ordinary plumbing around that.
 *
 * On Android 8 and later a notification's importance, sound and
 * vibration come from its CHANNEL, not from the message. A channel's
 * settings are also fixed at creation — changing them in code later
 * does nothing until the app is reinstalled — so the delivery channel
 * is created once, at MAX importance, and deliberately separate from
 * everything else the app might say. A maintenance notice and someone
 * waiting at the gate should not sound the same, and a resident who
 * mutes the first must not lose the second.
 */

// Both ids come from @core/pushRouting, which send-push-notification
// addresses its messages to. A channel the app never created means a
// notification lands in a system default with none of these settings.
const DELIVERY_CHANNEL = GATE_CHANNEL.id;
const GENERAL_CHANNEL = PUSH_CHANNEL.id;

/**
 * Shown while the app is in the foreground too.
 *
 * The default is to suppress it, on the reasoning that the user is
 * already looking — which is wrong here, because the resident may be on
 * any screen in the app when a delivery arrives, and the banner is how
 * they find out without watching the deliveries tab.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function ensureChannels() {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync(DELIVERY_CHANNEL, {
    name: GATE_CHANNEL.name,
    description: GATE_CHANNEL.description,
    importance: Notifications.AndroidImportance.MAX,
    // Long enough to be felt through a pocket, and distinct from the
    // single buzz of an ordinary notice.
    vibrationPattern: [0, 400, 200, 400, 200, 400],
    enableVibrate: true,
    // Our own tone, not the device default — which is also every
    // message, email and app update the resident gets. A short
    // ascending bell, so "someone is at your gate" is recognisable
    // without looking at the phone.
    sound: GATE_SOUND.file,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: false,
  });

  await Notifications.setNotificationChannelAsync(GENERAL_CHANNEL, {
    name: PUSH_CHANNEL.name,
    description: PUSH_CHANNEL.description,
    importance: Notifications.AndroidImportance.DEFAULT,
    enableVibrate: true,
    sound: "default",
  });
}

/**
 * Registers this device for push and keeps the token on the profile.
 *
 * Returns quietly on a simulator or when permission is refused: a
 * resident who says no to notifications gets an app that still works,
 * just one that cannot reach them at the gate.
 */
async function registerForPush(userId: string): Promise<void> {
  await ensureChannels();

  if (!Device.isDevice) return;

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted && existing.canAskAgain) {
    const asked = await Notifications.requestPermissionsAsync();
    granted = asked.granted;
  }
  if (!granted) return;

  // The FCM token, not an Expo push token: the backend
  // (send-push-notification) talks to FCM HTTP v1 directly, as the
  // Capacitor apps did, so the device_push_tokens rows stay compatible
  // with what is already there.
  const token = (await Notifications.getDevicePushTokenAsync()).data;
  if (typeof token !== "string" || !token) return;

  // device_push_tokens is absent from the generated types.ts, which is
  // behind the schema, so `.from()` narrows it to `never` and every
  // field becomes a type error. Cast the CLIENT rather than the row,
  // the same way the website's usePushNotifications.ts does:
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

  // Conflict on (user_id, token), matching the unique index: one person
  // may have a phone and a tablet, and both should receive.
  const { error } = await db.from("device_push_tokens").upsert(
    { user_id: userId, token, platform: Platform.OS },
    { onConflict: "user_id,token" },
  );
  if (error) console.error("Could not save the push token:", error.message);
}

interface Options {
  /** Open a section of the app, by drawer route name. */
  onOpen: (screen: string) => void;
}

/**
 * Registers for push, and routes a tapped notification to the right
 * screen.
 *
 * The tap listener is mounted HERE, at the app shell, rather than in a
 * screen. A notification tapped from a cold start delivers its response
 * before any screen has mounted; a listener living inside the
 * deliveries tab would never hear about the tap that was supposed to
 * open the deliveries tab. That was the bug on the web build.
 */
export function usePushNotifications(userId: string | undefined, { onOpen }: Options) {
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    if (!userId) return;
    void registerForPush(userId);
  }, [userId]);

  useEffect(() => {
    // A tap that launched the app from cold. getLastNotificationResponse
    // returns it even though it happened before this component existed.
    let cancelled = false;
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (cancelled || !response) return;
      const target = resolvePushTarget(response.notification.request.content.data, "resident");
      if (target) onOpenRef.current(routeFor(target.view));
    });

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const target = resolvePushTarget(response.notification.request.content.data, "resident");
      if (target) onOpenRef.current(routeFor(target.view));
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);
}

/** Section ids are lower case; drawer route names are capitalised. */
function routeFor(view: string): string {
  return view.charAt(0).toUpperCase() + view.slice(1);
}
