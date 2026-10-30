import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import { colors, radius, space, TOUCH, type } from "@/theme";
import type { Tables } from "@/types/database";

type EntryLog = Tables<"entry_logs">;

export interface HomeScreenProps {
  /** Open one of the other sections. */
  onNavigate: (screen: string) => void;
}

/**
 * The gate's home screen: what needs attention, and the one action the
 * guard performs most.
 *
 * Ported from GuardHome.tsx with the same information in the same
 * order, because guards have learned where things are and a native
 * rewrite is no reason to move them. Scan stays the largest target on
 * the screen; the counts below it are the two numbers a guard is asked
 * about ("anyone waiting?", "how many inside?").
 */
const TILES = [
  { id: "Scan",       title: "Search & Scan",     tint: colors.brand },
  { id: "Approvals",  title: "Pending Approvals", tint: colors.warning },
  { id: "Live",       title: "Live Inside",       tint: colors.success },
  { id: "Barriers",   title: "Boom Barriers",     tint: colors.brand },
  { id: "Deliveries", title: "Deliveries",        tint: colors.success },
] as const;

const HomeScreen = ({ onNavigate }: HomeScreenProps) => {
  const { societyId, societyName } = useAuth();

  const [recent, setRecent] = useState<EntryLog[]>([]);
  const [pending, setPending] = useState(0);
  const [inside, setInside] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!societyId) return;

    const [entries, visitors, live] = await Promise.all([
      supabase.from("entry_logs").select("*")
        .eq("society_id", societyId)
        .order("entry_time", { ascending: false }).limit(5),
      supabase.from("visitor_requests").select("id", { count: "exact", head: true })
        .eq("society_id", societyId).eq("status", "pending"),
      supabase.from("entry_logs").select("id", { count: "exact", head: true })
        .eq("society_id", societyId).is("exit_time", null),
    ]);

    setRecent(entries.data ?? []);
    setPending(visitors.count ?? 0);
    setInside(live.count ?? 0);
    setLoading(false);
  }, [societyId]);

  useEffect(() => { void load(); }, [load]);

  // Pull to refresh rather than a timer. A background poll is what made
  // the website's delivery form dismiss the keyboard every ten seconds,
  // and on a gate device a guard who wants fresh numbers is standing
  // right there and can ask for them.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long",
  });

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.brand} />
      }
    >
      <View>
        <Text style={styles.society}>{societyName ?? "Your Society"}</Text>
        <Text style={styles.date}>{today}</Text>
      </View>

      {/* The guard's most frequent action, and the biggest thing here. */}
      <Pressable
        style={({ pressed }) => [styles.scanCta, pressed && styles.pressed]}
        onPress={() => onNavigate("Scan")}
        accessibilityRole="button"
        accessibilityLabel="Scan a QR code"
      >
        <Text style={styles.scanIcon}>⬚</Text>
        <View style={styles.flex}>
          <Text style={styles.scanTitle}>Scan QR</Text>
          <Text style={styles.scanSub}>Visitor pass, vehicle or staff card</Text>
        </View>
      </Pressable>

      {/* Register Delivery sits directly under Scan, where it was put
          on the website because it is a guard's second-most-used
          action. Same position here. */}
      <Pressable
        style={({ pressed }) => [styles.deliveryCta, pressed && styles.pressed]}
        onPress={() => onNavigate("Deliveries")}
        accessibilityRole="button"
      >
        <Text style={styles.deliveryIcon}>📦</Text>
        <Text style={styles.deliveryText}>Register a Delivery</Text>
      </Pressable>

      <View style={styles.statRow}>
        <Stat label="Waiting approval" value={pending} tint={colors.warning} />
        <Stat label="Inside now" value={inside} tint={colors.success} />
      </View>

      <View style={styles.tileGrid}>
        {TILES.map((tile) => (
          <Pressable
            key={tile.id}
            style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
            onPress={() => onNavigate(tile.id)}
            accessibilityRole="button"
          >
            <View style={[styles.tileDot, { backgroundColor: tile.tint }]} />
            <Text style={styles.tileText}>{tile.title}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionHeading}>Recent Activity</Text>
      {recent.length === 0 ? (
        <Text style={styles.empty}>Nothing logged yet today.</Text>
      ) : (
        <View style={styles.list}>
          {recent.map((e) => (
            <View key={e.id} style={styles.row}>
              <View style={styles.flex}>
                <Text style={styles.rowTitle}>{e.vehicle_number}</Text>
                <Text style={styles.rowSub}>
                  {e.owner_name}
                  {e.wing || e.flat_number ? ` · ${[e.wing, e.flat_number].filter(Boolean).join("-")}` : ""}
                </Text>
              </View>
              <View style={[styles.pill, e.exit_time ? styles.pillOut : styles.pillIn]}>
                <Text style={styles.pillText}>{e.exit_time ? "OUT" : "IN"}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
};

const Stat = ({ label, value, tint }: { label: string; value: number; tint: string }) => (
  <View style={styles.stat}>
    <Text style={[styles.statValue, { color: tint }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  centre: { alignItems: "center", justifyContent: "center" },
  flex: { flex: 1 },
  scroll: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  pressed: { opacity: 0.75 },

  society: { color: colors.text, fontSize: type.title, fontWeight: "700" },
  date: { color: colors.textMuted, fontSize: type.label, marginTop: space.xs },

  scanCta: {
    flexDirection: "row", alignItems: "center", gap: space.lg,
    minHeight: 96, padding: space.lg,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 2, borderColor: colors.brand, borderRadius: radius.lg,
  },
  scanIcon: { fontSize: 40, color: colors.brandInk },
  scanTitle: { color: colors.text, fontSize: type.title, fontWeight: "700" },
  scanSub: { color: colors.textMuted, fontSize: type.label, marginTop: 2 },

  deliveryCta: {
    flexDirection: "row", alignItems: "center", gap: space.md,
    minHeight: TOUCH, paddingHorizontal: space.lg,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  deliveryIcon: { fontSize: 22 },
  deliveryText: { color: colors.text, fontSize: type.heading, fontWeight: "600" },

  statRow: { flexDirection: "row", gap: space.md },
  stat: {
    flex: 1, padding: space.lg,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  statValue: { fontSize: 32, fontWeight: "800" },
  statLabel: { color: colors.textMuted, fontSize: type.caption, marginTop: space.xs },

  tileGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  tile: {
    flexBasis: "47%", flexGrow: 1,
    minHeight: TOUCH, paddingHorizontal: space.md,
    flexDirection: "row", alignItems: "center", gap: space.sm,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  tileDot: { width: 10, height: 10, borderRadius: radius.pill },
  tileText: { color: colors.text, fontSize: type.label, fontWeight: "600", flex: 1 },

  sectionHeading: { color: colors.text, fontSize: type.heading, fontWeight: "700" },
  empty: { color: colors.textFaint, fontSize: type.label },

  list: { gap: space.sm },
  row: {
    flexDirection: "row", alignItems: "center", gap: space.md,
    padding: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  rowTitle: { color: colors.text, fontSize: type.body, fontWeight: "700" },
  rowSub: { color: colors.textMuted, fontSize: type.caption, marginTop: 2 },

  pill: { paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.pill },
  pillIn: { backgroundColor: colors.successBg },
  pillOut: { backgroundColor: colors.surfaceRaised },
  pillText: { color: colors.text, fontSize: type.caption, fontWeight: "700" },
});

export default HomeScreen;
