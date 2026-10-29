import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Pressable, RefreshControl,
  StyleSheet, Text, View,
} from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import { makeVisitorFlowPorts } from "@core/visitorFlowPorts";
import { checkOutEntry, flowFailed } from "@core/visitorFlow";
import { colors, radius, space, TOUCH, type } from "@/theme";

interface EntryLog {
  id: string;
  vehicle_number: string;
  owner_name: string;
  wing: string;
  flat_number: string;
  entry_type: string;
  entry_time: string;
}

const flatOf = (e: EntryLog) =>
  [e.wing, e.flat_number].filter(Boolean).join("-");

const since = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
};

/**
 * Everyone currently on the premises — every entry with no exit time.
 *
 * This is the one number a guard is actually asked for ("how many
 * vehicles are inside?"), so the count is in the header rather than
 * something you work out by scrolling. How long each has been in is
 * shown too: a visitor at four hours is the thing worth noticing.
 */
const LiveInsideScreen = () => {
  const { societyId, user } = useAuth();
  const [entries, setEntries] = useState<EntryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!societyId) return;
    const { data } = await supabase
      .from("entry_logs")
      .select("id, vehicle_number, owner_name, wing, flat_number, entry_type, entry_time")
      .eq("society_id", societyId)
      .is("exit_time", null)
      .order("entry_time", { ascending: false });
    setEntries((data ?? []) as EntryLog[]);
    setLoading(false);
  }, [societyId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!societyId) return;
    const channel = supabase
      .channel("guard-live-inside")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "entry_logs", filter: `society_id=eq.${societyId}` },
        () => { void load(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [societyId, load]);

  const checkOut = useCallback(async (entry: EntryLog) => {
    if (!societyId) return;
    setBusyId(entry.id);
    const result = await checkOutEntry(
      makeVisitorFlowPorts(supabase, societyId, user?.id ?? null),
      entry.id,
    );
    setBusyId(null);
    if (flowFailed(result)) {
      Alert.alert("Could not check out", result.error);
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
      data={entries}
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
          <Text style={styles.count}>{entries.length}</Text>
          <Text style={styles.countLabel}>
            {entries.length === 1 ? "vehicle inside" : "vehicles inside"}
          </Text>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing inside</Text>
          <Text style={styles.emptyBody}>Entries appear here until they are checked out.</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.flex}>
            <View style={styles.titleRow}>
              <Text style={styles.plate}>{item.vehicle_number}</Text>
              <View style={[
                styles.tag,
                item.entry_type === "visitor" ? styles.tagVisitor : styles.tagResident,
              ]}>
                <Text style={[
                  styles.tagText,
                  item.entry_type === "visitor" ? styles.tagTextVisitor : styles.tagTextResident,
                ]}>
                  {item.entry_type}
                </Text>
              </View>
            </View>
            <Text style={styles.meta}>
              {item.owner_name}
              {flatOf(item) ? ` · ${flatOf(item)}` : ""}
            </Text>
            <Text style={styles.time}>
              In {since(item.entry_time)} · {new Date(item.entry_time).toLocaleTimeString("en-IN", {
                hour: "2-digit", minute: "2-digit",
              })}
            </Text>
          </View>

          <Pressable
            style={({ pressed }) => [styles.out, pressed && styles.pressed]}
            onPress={() => void checkOut(item)}
            disabled={busyId === item.id}
            accessibilityRole="button"
            accessibilityLabel={`Check out ${item.vehicle_number}`}
          >
            {busyId === item.id
              ? <ActivityIndicator color={colors.danger} />
              : <Text style={styles.outText}>OUT</Text>}
          </Pressable>
        </View>
      )}
    />
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  centre: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl, flexGrow: 1 },
  pressed: { opacity: 0.75 },

  header: { alignItems: "center", paddingVertical: space.lg, marginBottom: space.sm },
  count: { color: colors.brand, fontSize: 56, fontWeight: "800", lineHeight: 60 },
  countLabel: { color: colors.textMuted, fontSize: type.label },

  card: {
    flexDirection: "row", alignItems: "center", gap: space.md,
    padding: space.md, minHeight: TOUCH + space.lg,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  plate: { color: colors.text, fontSize: type.heading, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: type.label, marginTop: 2 },
  time: { color: colors.textFaint, fontSize: type.caption, marginTop: 2 },

  tag: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill },
  tagVisitor: { backgroundColor: colors.warningBg },
  tagResident: { backgroundColor: colors.successBg },
  tagText: { fontSize: type.caption, fontWeight: "700" },
  tagTextVisitor: { color: colors.warning },
  tagTextResident: { color: colors.success },

  out: {
    minWidth: 72, minHeight: TOUCH, borderRadius: radius.md,
    borderWidth: 2, borderColor: colors.danger,
    alignItems: "center", justifyContent: "center",
  },
  outText: { color: colors.danger, fontSize: type.body, fontWeight: "800" },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  emptyTitle: { color: colors.text, fontSize: type.heading, fontWeight: "700" },
  emptyBody: { color: colors.textMuted, fontSize: type.label, textAlign: "center" },
});

export default LiveInsideScreen;
