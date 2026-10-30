import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Pressable, RefreshControl,
  StyleSheet, Text, View,
} from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import { makeVisitorFlowPorts } from "@core/visitorFlowPorts";
import { approveVisitor, rejectVisitor, flowFailed, flowWarning } from "@core/visitorFlow";
import { colors, radius, space, TOUCH, type } from "@/theme";

interface VisitorRequest {
  id: string;
  visitor_name: string;
  phone: string;
  vehicle_number: string;
  flat_number: string;
  purpose: string | null;
  status: string;
  created_at: string;
}

/**
 * Visitors waiting at the gate for a yes or no.
 *
 * The most time-critical screen in the app: somebody is standing in
 * front of the guard while this is open. So the two buttons are large,
 * far apart, and the destructive one is not where a thumb rests.
 *
 * What an approval MEANS — set the status and log the entry — comes
 * from @core/visitorFlow, shared with the website.
 */
const ApprovalsScreen = () => {
  const { societyId, user } = useAuth();
  const [requests, setRequests] = useState<VisitorRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!societyId) return;
    const { data } = await supabase
      .from("visitor_requests")
      .select("id, visitor_name, phone, vehicle_number, flat_number, purpose, status, created_at")
      .eq("society_id", societyId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    setRequests((data ?? []) as VisitorRequest[]);
    setLoading(false);
  }, [societyId]);

  useEffect(() => { void load(); }, [load]);

  // A live subscription rather than a poll. The guard is waiting on
  // this specific table, and a visitor form submitted at the gate
  // should appear without anyone pulling anything.
  useEffect(() => {
    if (!societyId) return;
    const channel = supabase
      .channel("guard-visitor-approvals")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "visitor_requests", filter: `society_id=eq.${societyId}` },
        () => { void load(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [societyId, load]);

  const decide = useCallback(async (v: VisitorRequest, approve: boolean) => {
    if (!societyId) return;
    setBusyId(v.id);
    const ports = makeVisitorFlowPorts(supabase, societyId, user?.id ?? null);
    const result = approve
      ? await approveVisitor(ports, v)
      : await rejectVisitor(ports, v.id);
    setBusyId(null);

    if (flowFailed(result)) {
      Alert.alert(approve ? "Could not approve" : "Could not reject", result.error);
      return;
    }
    const warning = flowWarning(result);
    if (warning) Alert.alert("Approved, with a problem", warning);

    await load();
  }, [societyId, user?.id, load]);

  const confirmReject = (v: VisitorRequest) => {
    // Turning somebody away is the one action here that cannot be
    // undone from this screen, so it asks first.
    Alert.alert(
      "Deny entry?",
      `${v.visitor_name} will be refused entry to flat ${v.flat_number}.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Deny", style: "destructive", onPress: () => void decide(v, false) },
      ],
    );
  };

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
      data={requests}
      keyExtractor={(v) => v.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); void load().then(() => setRefreshing(false)); }}
          tintColor={colors.brand}
        />
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>✓</Text>
          <Text style={styles.emptyTitle}>Nobody waiting</Text>
          <Text style={styles.emptyBody}>New visitor requests appear here as they arrive.</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.name}>{item.visitor_name}</Text>
          <Text style={styles.meta}>
            Flat {item.flat_number}
            {item.vehicle_number ? ` · ${item.vehicle_number}` : ""}
          </Text>
          {item.phone ? <Text style={styles.meta}>{item.phone}</Text> : null}
          {item.purpose ? <Text style={styles.purpose}>{item.purpose}</Text> : null}
          <Text style={styles.waiting}>
            Waiting since {new Date(item.created_at).toLocaleTimeString("en-IN", {
              hour: "2-digit", minute: "2-digit",
            })}
          </Text>

          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.deny, pressed && styles.pressed]}
              onPress={() => confirmReject(item)}
              disabled={busyId === item.id}
              accessibilityRole="button"
            >
              <Text style={styles.denyText}>Deny</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.allow, pressed && styles.pressed]}
              onPress={() => void decide(item, true)}
              disabled={busyId === item.id}
              accessibilityRole="button"
            >
              {busyId === item.id
                ? <ActivityIndicator color={colors.onBrand} />
                : <Text style={styles.allowText}>Allow In</Text>}
            </Pressable>
          </View>
        </View>
      )}
    />
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  centre: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: space.lg, gap: space.md, paddingBottom: space.xxl, flexGrow: 1 },
  pressed: { opacity: 0.75 },

  card: {
    padding: space.lg, gap: space.xs,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.warning, borderRadius: radius.lg,
  },
  name: { color: colors.text, fontSize: type.title, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: type.label },
  purpose: { color: colors.text, fontSize: type.label, marginTop: space.xs },
  waiting: { color: colors.textFaint, fontSize: type.caption, marginTop: space.xs },

  // Far apart, and Deny is on the left where a right thumb does not
  // land by accident.
  actions: { flexDirection: "row", gap: space.lg, marginTop: space.md },
  deny: {
    flex: 1, minHeight: TOUCH, borderRadius: radius.md,
    borderWidth: 2, borderColor: colors.danger,
    alignItems: "center", justifyContent: "center",
  },
  denyText: { color: colors.dangerInk, fontSize: type.heading, fontWeight: "700" },
  allow: {
    flex: 2, minHeight: TOUCH, borderRadius: radius.md,
    backgroundColor: colors.success,
    alignItems: "center", justifyContent: "center",
  },
  allowText: { color: colors.onSuccess, fontSize: type.heading, fontWeight: "800" },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  emptyIcon: { color: colors.successInk, fontSize: 48 },
  emptyTitle: { color: colors.text, fontSize: type.heading, fontWeight: "700" },
  emptyBody: { color: colors.textMuted, fontSize: type.label, textAlign: "center" },
});

export default ApprovalsScreen;
