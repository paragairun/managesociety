import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Pressable, RefreshControl,
  StyleSheet, Text, View,
} from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import { colors, radius, space, TOUCH, type } from "@/theme";

interface BarrierDevice {
  id: string;
  name: string;
  location: string | null;
  direction: string;
  last_seen_at: string | null;
}

interface BarrierEvent {
  id: string;
  device_id: string;
  decision: string;
  reason: string | null;
  vehicle_number: string | null;
  created_at: string;
}

/** A barrier counts as online if it checked in within the last minute. */
const ONLINE_WINDOW_MS = 60_000;
const isOnline = (d: BarrierDevice, now: number) =>
  !!d.last_seen_at && now - new Date(d.last_seen_at).getTime() < ONLINE_WINDOW_MS;

const opened = (decision: string) =>
  decision === "opened" || decision === "manual_open";

/**
 * Boom barriers: their state, and the manual override.
 *
 * The override is the reason this screen exists. When the plate reader
 * misses — a muddy plate, a bike with no front plate, an ambulance —
 * the guard opens the barrier from here, and that override is recorded
 * as an event with their user id against it, exactly like an automatic
 * decision. Nothing opens a gate without a name attached to it.
 */
const BarriersScreen = () => {
  const { societyId, user } = useAuth();
  const [devices, setDevices] = useState<BarrierDevice[]>([]);
  const [events, setEvents] = useState<BarrierEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Online/offline is a function of the clock, not of any row changing,
  // so a device that goes quiet has to be re-judged on a timer or the
  // badge would keep claiming "online" indefinitely.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!societyId) return;
    const [d, e] = await Promise.all([
      supabase
        .from("barrier_devices")
        .select("id, name, location, direction, last_seen_at")
        .eq("society_id", societyId)
        .order("name"),
      supabase
        .from("barrier_events")
        .select("id, device_id, decision, reason, vehicle_number, created_at")
        .eq("society_id", societyId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    setDevices((d.data ?? []) as BarrierDevice[]);
    setEvents((e.data ?? []) as BarrierEvent[]);
    setNow(Date.now());
    setLoading(false);
  }, [societyId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!societyId) return;
    const channel = supabase
      .channel("guard-barrier-events")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "barrier_events", filter: `society_id=eq.${societyId}` },
        () => { void load(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [societyId, load]);

  const override = useCallback(async (
    device: BarrierDevice,
    decision: "manual_open" | "manual_close",
  ) => {
    if (!societyId) {
      Alert.alert("Society not loaded", "Sign out and back in, then try again.");
      return;
    }
    setBusyId(device.id);
    const { error } = await supabase.from("barrier_events").insert({
      device_id: device.id,
      decision,
      reason: "guard_override",
      actor_user_id: user?.id ?? null,
      society_id: societyId,
    });
    setBusyId(null);
    if (error) {
      Alert.alert(decision === "manual_open" ? "Could not open" : "Could not close", error.message);
      return;
    }
    await load();
  }, [societyId, user?.id, load]);

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.fill}
      contentContainerStyle={styles.scroll}
      data={events}
      keyExtractor={(e) => e.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); void load().then(() => setRefreshing(false)); }}
          tintColor={colors.brand}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.sectionTitle}>Barriers ({devices.length})</Text>

          {devices.length === 0 ? (
            <Text style={styles.note}>
              No barrier devices configured. An admin adds these from the website.
            </Text>
          ) : devices.map((d) => (
            <View key={d.id} style={styles.device}>
              <View style={styles.titleRow}>
                <Text style={styles.deviceName}>{d.name}</Text>
                <View style={[
                  styles.tag,
                  isOnline(d, now) ? styles.tagOnline : styles.tagOffline,
                ]}>
                  <Text style={[
                    styles.tagText,
                    isOnline(d, now) ? styles.tagTextOnline : styles.tagTextOffline,
                  ]}>
                    {isOnline(d, now) ? "online" : "offline"}
                  </Text>
                </View>
              </View>
              <Text style={styles.deviceMeta}>
                {d.location ?? "—"} · {d.direction}
              </Text>

              <View style={styles.actions}>
                <Pressable
                  style={({ pressed }) => [styles.open, pressed && styles.pressed]}
                  onPress={() => void override(d, "manual_open")}
                  disabled={busyId === d.id}
                  accessibilityRole="button"
                >
                  {busyId === d.id
                    ? <ActivityIndicator color={colors.onBrand} />
                    : <Text style={styles.openText}>Open</Text>}
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.close, pressed && styles.pressed]}
                  onPress={() => void override(d, "manual_close")}
                  disabled={busyId === d.id}
                  accessibilityRole="button"
                >
                  <Text style={styles.closeText}>Close</Text>
                </Pressable>
              </View>
            </View>
          ))}

          <Text style={[styles.sectionTitle, styles.sectionSpaced]}>Recent gate activity</Text>
        </View>
      }
      ListEmptyComponent={<Text style={styles.note}>No gate events yet.</Text>}
      renderItem={({ item }) => (
        <View style={styles.event}>
          <View style={[styles.dot, opened(item.decision) ? styles.dotOpen : styles.dotShut]} />
          <View style={styles.flex}>
            <Text style={styles.eventTitle}>
              {item.vehicle_number ?? "—"} · {item.decision.replace(/_/g, " ")}
            </Text>
            <Text style={styles.eventMeta}>
              {item.reason ? `${item.reason.replace(/_/g, " ")} · ` : ""}
              {new Date(item.created_at).toLocaleString("en-IN", {
                day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
              })}
            </Text>
          </View>
        </View>
      )}
    />
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  centre: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  pressed: { opacity: 0.75 },

  header: { gap: space.md, marginBottom: space.sm },
  sectionTitle: { color: colors.text, fontSize: type.heading, fontWeight: "700" },
  sectionSpaced: { marginTop: space.lg },
  note: { color: colors.textMuted, fontSize: type.label, textAlign: "center", paddingVertical: space.lg },

  device: {
    padding: space.lg, gap: space.xs,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  deviceName: { color: colors.text, fontSize: type.body, fontWeight: "700", flexShrink: 1 },
  deviceMeta: { color: colors.textMuted, fontSize: type.caption },

  tag: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill },
  tagOnline: { backgroundColor: colors.successBg },
  tagOffline: { backgroundColor: colors.surfaceRaised },
  tagText: { fontSize: type.caption, fontWeight: "700" },
  tagTextOnline: { color: colors.success },
  tagTextOffline: { color: colors.textMuted },

  actions: { flexDirection: "row", gap: space.md, marginTop: space.md },
  open: {
    flex: 1, minHeight: TOUCH, borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  openText: { color: colors.onBrand, fontSize: type.heading, fontWeight: "800" },
  close: {
    flex: 1, minHeight: TOUCH, borderRadius: radius.md,
    borderWidth: 2, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  closeText: { color: colors.text, fontSize: type.heading, fontWeight: "700" },

  event: {
    flexDirection: "row", alignItems: "center", gap: space.md,
    padding: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  dot: { width: 10, height: 10, borderRadius: radius.pill },
  dotOpen: { backgroundColor: colors.success },
  dotShut: { backgroundColor: colors.danger },
  eventTitle: { color: colors.text, fontSize: type.label, fontWeight: "600" },
  eventMeta: { color: colors.textFaint, fontSize: type.caption, marginTop: 2 },
});

export default BarriersScreen;
