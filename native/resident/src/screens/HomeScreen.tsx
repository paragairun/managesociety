import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import { sectionsFor } from "@core/residentAccess";
import { colors, radius, space, TOUCH, type } from "@/theme";

interface Props {
  onNavigate: (screen: string) => void;
}

interface EntryLog {
  id: string;
  vehicle_number: string;
  owner_name: string;
  entry_type: string;
  entry_time: string;
}

/**
 * What needs the resident's attention, and the two things they came to
 * do.
 *
 * A resident opens this app for a reason — usually a notification about
 * a delivery, sometimes to pull up a guest pass before someone arrives.
 * So the deliveries waiting on them come first and nothing competes
 * with that; the rest of the sections sit below as a plain grid rather
 * than being summarised, because a summary nobody reads is just a
 * slower menu.
 */
const HomeScreen = ({ onNavigate }: Props) => {
  const { societyId, societyName, user, identity, parentName } = useAuth();

  const [pendingDeliveries, setPendingDeliveries] = useState(0);
  const [recent, setRecent] = useState<EntryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!societyId || !user) return;

    const [deliveries, entries] = await Promise.all([
      supabase
        .from("delivery_visits")
        .select("id", { count: "exact", head: true })
        .eq("society_id", societyId)
        .eq("status", "pending_approval"),
      supabase
        .from("entry_logs")
        .select("id, vehicle_number, owner_name, entry_type, entry_time")
        .eq("society_id", societyId)
        .order("entry_time", { ascending: false })
        .limit(5),
    ]);

    setPendingDeliveries(deliveries.count ?? 0);
    setRecent((entries.data ?? []) as EntryLog[]);
    setLoading(false);
  }, [societyId, user]);

  useEffect(() => { void load(); }, [load]);

  // A delivery agent is standing at the gate while this is pending, so
  // the count has to be live rather than refreshed when the resident
  // happens to pull down.
  useEffect(() => {
    if (!societyId) return;
    const channel = supabase
      .channel("resident-home")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "delivery_visits", filter: `society_id=eq.${societyId}` },
        () => { void load(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [societyId, load]);

  // The same list the drawer is built from, minus Home itself, so a
  // section can never appear in one and not the other.
  const tiles = sectionsFor(identity).filter((s) => s.id !== "home");

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); void load().then(() => setRefreshing(false)); }}
          tintColor={colors.brand}
        />
      }
    >
      <View>
        <Text style={styles.society}>{societyName ?? "Your society"}</Text>
        {identity.isChild ? (
          <Text style={styles.subtitle}>
            {identity.childType === "tenant" ? "Tenant" : "Family"} login
            {parentName ? ` · ${parentName}'s flat` : ""}
          </Text>
        ) : null}
      </View>

      {pendingDeliveries > 0 ? (
        <Pressable
          style={({ pressed }) => [styles.alert, pressed && styles.pressed]}
          onPress={() => onNavigate("Deliveries")}
          accessibilityRole="button"
        >
          <Text style={styles.alertTitle}>
            {pendingDeliveries === 1
              ? "A delivery is waiting for you"
              : `${pendingDeliveries} deliveries are waiting for you`}
          </Text>
          <Text style={styles.alertBody}>
            Someone is at the gate. Tap to approve or turn them away.
          </Text>
        </Pressable>
      ) : null}

      <Pressable
        style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        onPress={() => onNavigate("Guest")}
        accessibilityRole="button"
      >
        <Text style={styles.primaryText}>Create a guest pass</Text>
      </Pressable>

      <View style={styles.tileGrid}>
        {tiles.map((tile) => (
          <Pressable
            key={tile.id}
            style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
            onPress={() => onNavigate(screenFor(tile.id))}
            accessibilityRole="button"
          >
            <Text style={styles.tileText}>{tile.title}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Recent gate activity</Text>
      {recent.length === 0 ? (
        <Text style={styles.note}>Nothing has come through the gate yet today.</Text>
      ) : recent.map((e) => (
        <View key={e.id} style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.rowTitle}>{e.vehicle_number || e.owner_name}</Text>
            <Text style={styles.rowMeta}>
              {e.owner_name}
              {e.entry_type ? ` · ${e.entry_type}` : ""}
            </Text>
          </View>
          <Text style={styles.rowTime}>
            {new Date(e.entry_time).toLocaleTimeString("en-IN", {
              hour: "2-digit", minute: "2-digit",
            })}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
};

/** Section ids are lower case; drawer route names are capitalised. */
function screenFor(sectionId: string): string {
  return sectionId.charAt(0).toUpperCase() + sectionId.slice(1);
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  centre: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  pressed: { opacity: 0.75 },

  society: { color: colors.text, fontSize: type.title, fontWeight: "700" },
  subtitle: { color: colors.textMuted, fontSize: type.label, marginTop: 2 },

  alert: {
    padding: space.lg, gap: space.xs,
    backgroundColor: colors.warningBg,
    borderWidth: 2, borderColor: colors.warning, borderRadius: radius.lg,
  },
  alertTitle: { color: colors.text, fontSize: type.heading, fontWeight: "800" },
  alertBody: { color: colors.textMuted, fontSize: type.label },

  primary: {
    minHeight: TOUCH + 8, borderRadius: radius.lg,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  primaryText: { color: colors.onBrand, fontSize: type.heading, fontWeight: "800" },

  tileGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  tile: {
    flexBasis: "47%", flexGrow: 1,
    minHeight: TOUCH, paddingHorizontal: space.md,
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  tileText: { color: colors.text, fontSize: type.body, fontWeight: "600" },

  sectionTitle: {
    color: colors.text, fontSize: type.heading, fontWeight: "700",
    marginTop: space.md,
  },
  note: { color: colors.textMuted, fontSize: type.label },

  row: {
    flexDirection: "row", alignItems: "center", gap: space.md,
    padding: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  rowTitle: { color: colors.text, fontSize: type.body, fontWeight: "600" },
  rowMeta: { color: colors.textMuted, fontSize: type.caption, marginTop: 2 },
  rowTime: { color: colors.textFaint, fontSize: type.caption },
});

export default HomeScreen;
