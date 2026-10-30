import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput,
  useWindowDimensions, View,
} from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import QrCode from "@/components/QrCode";
import { normalizePlate } from "@core/guest-pass";
import { can, whyNot } from "@core/residentAccess";
import { colors, radius, space, TOUCH, type } from "@/theme";

interface Vehicle {
  id: string;
  vehicle_number: string;
  vehicle_type: string;
  owner_name: string;
  wing: string;
  flat_number: string;
  qr_code: string;
}

interface ChangeRequest {
  id: string;
  request_type: string;
  vehicle_number: string;
  vehicle_type: string;
  status: string;
  notes: string | null;
  created_at: string;
}

interface ResidentFlat {
  id: string;
  wing: string;
  flat_number: string;
  is_primary: boolean;
  flat_label: string;
}

const VEHICLE_TYPES = [
  { value: "car", label: "Car" },
  { value: "bike", label: "Bike" },
  { value: "scooter", label: "Scooter" },
  { value: "bicycle", label: "Bicycle" },
  { value: "other", label: "Other" },
];

const requestState = (status: string): { label: string; color: string } => {
  switch (status) {
    case "pending": return { label: "Waiting for the committee", color: colors.warningInk };
    case "approved": return { label: "Approved", color: colors.successInk };
    case "rejected": return { label: "Rejected", color: colors.dangerInk };
    default: return { label: status, color: colors.textMuted };
  }
};

/**
 * The flat's vehicles, and their gate stickers.
 *
 * A resident cannot add or remove a vehicle directly — both go to the
 * committee as a request, because a registered vehicle is one the
 * barrier opens for. That is not a restriction the app invented; it is
 * what vehicle_change_requests exists for.
 *
 * A family or tenant login can see the vehicles and show their QR —
 * they have to, they drive them — but cannot request changes. The rule
 * and its explanation both come from @core/residentAccess, so this
 * screen never has to decide who may do what.
 */
const VehiclesScreen = () => {
  const { user, societyId, identity } = useAuth();
  const { width } = useWindowDimensions();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [flats, setFlats] = useState<ResidentFlat[]>([]);
  const [activeFlatId, setActiveFlatId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showing, setShowing] = useState<Vehicle | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [plate, setPlate] = useState("");
  const [vehicleType, setVehicleType] = useState("car");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const qrSize = Math.min(width - space.xl * 2, 420);

  const load = useCallback(async () => {
    if (!user) return;

    const { data: flatRows } = await supabase
      .from("resident_flats")
      .select("id, wing, flat_number, is_primary")
      .eq("user_id", user.id)
      .order("is_primary", { ascending: false });

    const myFlats = ((flatRows ?? []) as Omit<ResidentFlat, "flat_label">[]).map((f) => ({
      ...f,
      flat_label: [f.wing, f.flat_number].filter(Boolean).join("-"),
    }));
    setFlats(myFlats);

    const active = myFlats.find((f) => f.id === activeFlatId)
      ?? myFlats.find((f) => f.is_primary)
      ?? myFlats[0];
    setActiveFlatId(active?.id ?? "");

    if (active) {
      const { data } = await supabase
        .from("vehicles")
        .select("id, vehicle_number, vehicle_type, owner_name, wing, flat_number, qr_code")
        .eq("wing", active.wing)
        .eq("flat_number", active.flat_number)
        .order("created_at", { ascending: false });
      setVehicles((data ?? []) as Vehicle[]);
    } else {
      setVehicles([]);
    }

    const { data: reqs } = await supabase
      .from("vehicle_change_requests")
      .select("id, request_type, vehicle_number, vehicle_type, status, notes, created_at")
      .eq("requested_by", user.id)
      .order("created_at", { ascending: false })
      .limit(10);
    setRequests((reqs ?? []) as ChangeRequest[]);

    setLoading(false);
  }, [user, activeFlatId]);

  useEffect(() => { void load(); }, [load]);

  const activeFlat = flats.find((f) => f.id === activeFlatId) ?? flats[0];

  const requestAdd = useCallback(async () => {
    const number = normalizePlate(plate);
    if (!number) { Alert.alert("Enter the vehicle number"); return; }
    if (!activeFlat || !user || !societyId) return;

    // The owner name on the sticker. Taken from the profile rather than
    // typed, so a flat's vehicles read consistently at the gate.
    const { data: profile } = await supabase
      .from("profiles").select("display_name").eq("user_id", user.id).maybeSingle();
    const ownerName = (profile?.display_name ?? "").trim();
    if (!ownerName) {
      Alert.alert("Set your name first", "My Profile needs a name before a vehicle can be registered to you.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("vehicle_change_requests").insert({
      request_type: "add",
      requested_by: user.id,
      wing: activeFlat.wing,
      flat_number: activeFlat.flat_number,
      owner_name: ownerName,
      vehicle_number: number,
      vehicle_type: vehicleType,
      society_id: societyId,
    });
    setSaving(false);

    if (error) { Alert.alert("Could not send the request", error.message); return; }
    setPlate("");
    setVehicleType("car");
    setShowForm(false);
    Alert.alert("Sent", "Your committee will review it and the sticker appears here once approved.");
    await load();
  }, [plate, vehicleType, activeFlat, user, societyId, load]);

  const requestRemove = useCallback((vehicle: Vehicle) => {
    Alert.alert(
      "Ask to remove this vehicle?",
      `${vehicle.vehicle_number} would stop opening the barrier once the committee approves.`,
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Request removal",
          style: "destructive",
          onPress: async () => {
            if (!user || !societyId) return;
            setBusyId(vehicle.id);
            const { error } = await supabase.from("vehicle_change_requests").insert({
              request_type: "remove",
              requested_by: user.id,
              wing: vehicle.wing,
              flat_number: vehicle.flat_number,
              owner_name: vehicle.owner_name,
              vehicle_number: vehicle.vehicle_number,
              vehicle_type: vehicle.vehicle_type,
              target_vehicle_id: vehicle.id,
              society_id: societyId,
            });
            setBusyId(null);
            if (error) { Alert.alert("Could not send the request", error.message); return; }
            await load();
          },
        },
      ],
    );
  }, [user, societyId, load]);

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  const mayManage = can(identity, "manageVehicles");
  const refusal = whyNot(identity, "manageVehicles");

  return (
    <View style={styles.fill}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); void load().then(() => setRefreshing(false)); }}
            tintColor={colors.brand}
          />
        }
      >
        {mayManage ? (
          <Pressable
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            onPress={() => setShowForm(true)}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>Register a vehicle</Text>
          </Pressable>
        ) : refusal ? (
          // Not a disabled button with no explanation: that reads as a
          // broken app, where "the primary resident does this" is
          // something a tenant can act on.
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{refusal}</Text>
          </View>
        ) : null}

        {flats.length > 1 ? (
          <View style={styles.chips}>
            {flats.map((f) => (
              <Pressable
                key={f.id}
                style={({ pressed }) => [
                  styles.chip, f.id === activeFlatId && styles.chipOn, pressed && styles.pressed,
                ]}
                onPress={() => setActiveFlatId(f.id)}
                accessibilityRole="button"
              >
                <Text style={[styles.chipText, f.id === activeFlatId && styles.chipTextOn]}>
                  {f.flat_label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {vehicles.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No vehicles registered</Text>
            <Text style={styles.emptyBody}>
              A registered vehicle gets a QR sticker that opens the barrier.
            </Text>
          </View>
        ) : vehicles.map((v) => (
          <View key={v.id} style={styles.card}>
            <Pressable
              style={({ pressed }) => [styles.cardHead, pressed && styles.pressed]}
              onPress={() => setShowing(v)}
              accessibilityRole="button"
            >
              <View style={styles.flex}>
                <Text style={styles.plate}>{v.vehicle_number}</Text>
                <Text style={styles.meta}>
                  {VEHICLE_TYPES.find((t) => t.value === v.vehicle_type)?.label ?? v.vehicle_type}
                  {v.owner_name ? ` · ${v.owner_name}` : ""}
                </Text>
              </View>
              <Text style={styles.action}>Show QR</Text>
            </Pressable>

            {mayManage ? (
              <Pressable
                style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
                onPress={() => requestRemove(v)}
                disabled={busyId === v.id}
                accessibilityRole="button"
              >
                {busyId === v.id
                  ? <ActivityIndicator color={colors.dangerInk} />
                  : <Text style={styles.removeText}>Request removal</Text>}
              </Pressable>
            ) : null}
          </View>
        ))}

        {requests.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Your requests</Text>
            {requests.map((r) => {
              const state = requestState(r.status);
              return (
                <View key={r.id} style={styles.requestRow}>
                  <View style={styles.flex}>
                    <Text style={styles.requestTitle}>
                      {r.request_type === "remove" ? "Remove" : "Add"} {r.vehicle_number}
                    </Text>
                    <Text style={[styles.requestState, { color: state.color }]}>{state.label}</Text>
                    {r.notes ? <Text style={styles.requestNotes}>{r.notes}</Text> : null}
                  </View>
                  <Text style={styles.requestDate}>
                    {new Date(r.created_at).toLocaleDateString("en-IN", {
                      day: "numeric", month: "short",
                    })}
                  </Text>
                </View>
              );
            })}
          </>
        ) : null}
      </ScrollView>

      {/* The sticker */}
      <Modal visible={!!showing} animationType="slide" onRequestClose={() => setShowing(null)}>
        {showing ? (
          <View style={styles.qrScreen}>
            <Text style={styles.qrPlate}>{showing.vehicle_number}</Text>
            <Text style={styles.qrMeta}>
              {[showing.wing, showing.flat_number].filter(Boolean).join("-")}
              {showing.owner_name ? ` · ${showing.owner_name}` : ""}
            </Text>
            <QrCode value={showing.qr_code} size={qrSize} />
            <Text style={styles.qrHint}>
              This is the sticker's code. The guard can scan it from the screen if the
              sticker is damaged or has not arrived yet.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              onPress={() => setShowing(null)}
              accessibilityRole="button"
            >
              <Text style={styles.closeText}>Done</Text>
            </Pressable>
          </View>
        ) : null}
      </Modal>

      {/* Register */}
      <Modal visible={showForm} animationType="slide" onRequestClose={() => setShowForm(false)}>
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Register a vehicle</Text>
            <Pressable onPress={() => setShowForm(false)} hitSlop={16} accessibilityRole="button">
              <Text style={styles.modalClose}>✕</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Vehicle number *</Text>
            <TextInput
              style={styles.input}
              value={plate}
              onChangeText={(t) => setPlate(normalizePlate(t))}
              placeholder="MH12AB1234"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect={false}
            />

            <Text style={styles.label}>Type</Text>
            <View style={styles.chips}>
              {VEHICLE_TYPES.map((t) => (
                <Pressable
                  key={t.value}
                  style={({ pressed }) => [
                    styles.chip, vehicleType === t.value && styles.chipOn, pressed && styles.pressed,
                  ]}
                  onPress={() => setVehicleType(t.value)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.chipText, vehicleType === t.value && styles.chipTextOn]}>
                    {t.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.hint}>
              This goes to your committee. The QR sticker appears here once they approve it.
            </Text>
          </ScrollView>

          <View style={styles.modalFooter}>
            <Pressable
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              onPress={() => void requestAdd()}
              disabled={saving}
              accessibilityRole="button"
            >
              {saving
                ? <ActivityIndicator color={colors.onBrand} />
                : <Text style={styles.primaryText}>Send request</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  centre: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl, flexGrow: 1 },
  pressed: { opacity: 0.75 },

  primary: {
    minHeight: TOUCH + 8, borderRadius: radius.lg,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  primaryText: { color: colors.onBrand, fontSize: type.heading, fontWeight: "800" },

  notice: {
    padding: space.md, borderRadius: radius.md,
    backgroundColor: colors.warningBg,
    borderWidth: 1, borderColor: colors.warning,
  },
  noticeText: { color: colors.text, fontSize: type.label },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    overflow: "hidden",
  },
  cardHead: {
    flexDirection: "row", alignItems: "center", gap: space.md,
    padding: space.md, minHeight: TOUCH,
  },
  plate: { color: colors.text, fontSize: type.heading, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: type.caption, marginTop: 2 },
  action: { color: colors.brandInk, fontSize: type.label, fontWeight: "700" },
  remove: {
    minHeight: TOUCH, alignItems: "center", justifyContent: "center",
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  removeText: { color: colors.dangerInk, fontSize: type.label, fontWeight: "700" },

  sectionTitle: {
    color: colors.textMuted, fontSize: type.label, fontWeight: "700",
    marginTop: space.lg,
  },
  requestRow: {
    flexDirection: "row", alignItems: "flex-start", gap: space.md,
    padding: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  requestTitle: { color: colors.text, fontSize: type.label, fontWeight: "600" },
  requestState: { fontSize: type.caption, fontWeight: "700", marginTop: 2 },
  requestNotes: { color: colors.textMuted, fontSize: type.caption, marginTop: 2 },
  requestDate: { color: colors.textFaint, fontSize: type.caption },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  emptyTitle: { color: colors.text, fontSize: type.heading, fontWeight: "700" },
  emptyBody: { color: colors.textMuted, fontSize: type.label, textAlign: "center" },

  qrScreen: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: space.lg, padding: space.xl,
    backgroundColor: colors.background,
  },
  qrPlate: { color: colors.text, fontSize: type.title, fontWeight: "800" },
  qrMeta: { color: colors.textMuted, fontSize: type.body, marginTop: -space.md },
  qrHint: { color: colors.textMuted, fontSize: type.label, textAlign: "center" },
  close: {
    minHeight: TOUCH, minWidth: 160, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  closeText: { color: colors.text, fontSize: type.body, fontWeight: "700" },

  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: space.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modalTitle: { color: colors.text, fontSize: type.title, fontWeight: "700" },
  modalClose: { color: colors.textMuted, fontSize: type.title },
  form: { padding: space.lg, gap: space.xs, paddingBottom: space.xxl },
  label: { color: colors.text, fontSize: type.label, fontWeight: "600", marginTop: space.md },
  hint: { color: colors.textMuted, fontSize: type.caption, marginTop: space.md },
  input: {
    minHeight: TOUCH,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: space.md, color: colors.text, fontSize: type.heading,
  },
  modalFooter: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.border,
  },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingVertical: space.xs },
  chip: {
    minHeight: 44, justifyContent: "center", paddingHorizontal: space.lg,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.text, fontSize: type.label, fontWeight: "600" },
  chipTextOn: { color: colors.onBrand },
});

export default VehiclesScreen;
