import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput,
  useWindowDimensions, View,
} from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import QrCode from "@/components/QrCode";
import {
  emptyGuestPassDraft, validateGuestPassDraft, guestPassCreateBody,
  normalizeGuestPhone, normalizePlate, guestPassStatus,
  type GuestPassDraft,
} from "@core/guest-pass";
import { colors, radius, space, TOUCH, type } from "@/theme";

interface GuestPass {
  id: string;
  visitor_name: string;
  phone: string;
  vehicle_number: string;
  purpose: string | null;
  status: string;
  created_at: string;
  qr_payload: string;
}

interface ResidentFlat {
  id: string;
  wing: string;
  flat_number: string;
  is_primary: boolean;
  flat_label: string;
}

/**
 * Issue a guest a QR, and show it.
 *
 * The flow this serves is somebody being on their way: a resident
 * fills in three fields, hands the resulting code to their guest over
 * WhatsApp, and the guard scans it at the gate. So the finished QR is
 * the loud part of the screen, and everything else gets out of its way.
 *
 * The pass is created by the resident-guest-passes edge function, the
 * same one the website calls — it owns the payload shape the guard's
 * scanner decodes, and duplicating that here would be two encoders for
 * one contract.
 */
const GuestPassScreen = () => {
  const { societyId, user } = useAuth();
  const { width } = useWindowDimensions();

  /**
   * The QR fills the screen's width, less a margin.
   *
   * Not a fixed size, because a guest pass is a dense code: the payload
   * carries the visitor, the flat, the plate and the request id, which
   * comes to about 250 characters and a version 11-13 symbol — 61 to 69
   * modules across. At a fixed 280pt that is 3.6pt per module, around
   * half a millimetre, which a phone camera manages indoors and
   * struggles with at a gate in sun. Filling the width gives roughly
   * 5pt per module on an ordinary phone, which is a comfortable margin.
   *
   * Capped at 420 so it does not become absurd on a tablet.
   */
  const qrSize = Math.min(width - space.xl * 2, 420);

  const [passes, setPasses] = useState<GuestPass[]>([]);
  const [flats, setFlats] = useState<ResidentFlat[]>([]);
  const [activeFlatId, setActiveFlatId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<GuestPassDraft>(emptyGuestPassDraft());
  const [saving, setSaving] = useState(false);

  /** The pass being shown full-screen as a QR, if any. */
  const [showing, setShowing] = useState<GuestPass | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase.functions.invoke("resident-guest-passes", {
      body: { action: "list" },
    });
    setLoading(false);
    if (error || data?.error) return;

    setPasses((data.passes ?? []) as GuestPass[]);
    const fl = (data.flats ?? []) as ResidentFlat[];
    setFlats(fl);
    setActiveFlatId((prev) =>
      fl.find((f) => f.id === prev)?.id
      ?? fl.find((f) => f.is_primary)?.id
      ?? fl[0]?.id
      ?? "");
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async () => {
    const problem = validateGuestPassDraft(draft);
    if (problem) { Alert.alert("Not quite done", problem); return; }
    if (!societyId) { Alert.alert("Society not loaded", "Sign out and back in, then try again."); return; }

    setSaving(true);
    const { data, error } = await supabase.functions.invoke("resident-guest-passes", {
      body: guestPassCreateBody(draft, activeFlatId || undefined),
    });
    setSaving(false);

    if (error || data?.error) {
      Alert.alert("Could not create the pass", error?.message ?? data?.error ?? "Please try again.");
      return;
    }

    const created = data.pass as GuestPass;
    setPasses((prev) => [created, ...prev.filter((p) => p.id !== created.id)]);
    setDraft(emptyGuestPassDraft());
    setShowForm(false);
    // Straight to the code. The resident made this to send to someone,
    // and a list with a new row in it is one more tap before they can.
    setShowing(created);
  }, [draft, societyId, activeFlatId]);

  const activeFlat = flats.find((f) => f.id === activeFlatId) ?? flats[0];

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

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
        <Pressable
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          onPress={() => setShowForm(true)}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>New guest pass</Text>
        </Pressable>

        {flats.length > 1 ? (
          <View style={styles.flatRow}>
            <Text style={styles.subLabel}>For</Text>
            <View style={styles.chips}>
              {flats.map((f) => (
                <Pressable
                  key={f.id}
                  style={({ pressed }) => [
                    styles.chip,
                    f.id === activeFlatId && styles.chipOn,
                    pressed && styles.pressed,
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
          </View>
        ) : null}

        {passes.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No passes yet</Text>
            <Text style={styles.emptyBody}>
              Create one and send the code to your guest. The guard scans it at the gate.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Recent passes</Text>
            {passes.map((p) => {
              const status = guestPassStatus(p.status);
              return (
                <Pressable
                  key={p.id}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  onPress={() => setShowing(p)}
                  accessibilityRole="button"
                >
                  <View style={styles.flex}>
                    <Text style={styles.rowTitle}>{p.visitor_name}</Text>
                    <Text style={styles.rowMeta}>
                      {p.vehicle_number}
                      {p.purpose ? ` · ${p.purpose}` : ""}
                    </Text>
                    <Text style={[
                      styles.rowStatus,
                      status.usable ? styles.rowStatusLive : styles.rowStatusDone,
                    ]}>
                      {status.label}
                    </Text>
                  </View>
                  <Text style={styles.rowAction}>
                    {status.usable ? "Show QR" : "View"}
                  </Text>
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>

      {/* The pass itself */}
      <Modal
        visible={!!showing}
        animationType="slide"
        onRequestClose={() => setShowing(null)}
      >
        {showing ? (
          <View style={styles.qrScreen}>
            <Text style={styles.qrName}>{showing.visitor_name}</Text>
            <Text style={styles.qrFlat}>
              {activeFlat?.flat_label ?? ""}
              {showing.vehicle_number ? ` · ${showing.vehicle_number}` : ""}
            </Text>

            <QrCode value={showing.qr_payload} size={qrSize} />

            {guestPassStatus(showing.status).usable ? (
              <Text style={styles.qrHint}>
                Show this at the gate, or send your guest a screenshot. It works once.
                {"\n"}Turn your screen brightness up if the guard's scanner struggles.
              </Text>
            ) : (
              <View style={styles.usedBanner}>
                <Text style={styles.usedText}>{guestPassStatus(showing.status).label}</Text>
                <Text style={styles.usedBody}>
                  A pass can only be used once. Create a new one if your guest is coming again.
                </Text>
              </View>
            )}

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

      {/* Create */}
      <Modal
        visible={showForm}
        animationType="slide"
        onRequestClose={() => { setShowForm(false); setDraft(emptyGuestPassDraft()); }}
      >
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New guest pass</Text>
            <Pressable
              onPress={() => { setShowForm(false); setDraft(emptyGuestPassDraft()); }}
              hitSlop={16}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={styles.modalClose}>✕</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Who is visiting *</Text>
            <TextInput
              style={styles.input}
              value={draft.visitor_name}
              onChangeText={(t) => setDraft((d) => ({ ...d, visitor_name: t }))}
              placeholder="Ramesh Kumar"
              placeholderTextColor={colors.textFaint}
              autoComplete="off"
              autoCorrect={false}
            />

            <Text style={styles.label}>Their mobile number *</Text>
            <TextInput
              style={styles.input}
              value={draft.phone}
              onChangeText={(t) => setDraft((d) => ({ ...d, phone: normalizeGuestPhone(t) }))}
              placeholder="98765 43210"
              placeholderTextColor={colors.textFaint}
              inputMode="numeric"
              keyboardType="number-pad"
              maxLength={10}
              autoComplete="off"
              autoCorrect={false}
            />

            <Text style={styles.label}>Vehicle number *</Text>
            <TextInput
              style={styles.input}
              value={draft.vehicle_number}
              onChangeText={(t) => setDraft((d) => ({ ...d, vehicle_number: normalizePlate(t) }))}
              placeholder="MH12AB1234"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect={false}
            />
            <Text style={styles.hint}>
              The guard matches this at the gate, so it is needed even for a short visit.
            </Text>

            <Text style={styles.label}>Purpose</Text>
            <TextInput
              style={styles.input}
              value={draft.purpose}
              onChangeText={(t) => setDraft((d) => ({ ...d, purpose: t }))}
              placeholder="Dinner, repairs, delivery…"
              placeholderTextColor={colors.textFaint}
              autoComplete="off"
            />
          </ScrollView>

          <View style={styles.modalFooter}>
            <Pressable
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              onPress={() => void create()}
              disabled={saving}
              accessibilityRole="button"
            >
              {saving
                ? <ActivityIndicator color={colors.onBrand} />
                : <Text style={styles.primaryText}>Create pass</Text>}
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

  flatRow: { gap: space.xs, marginTop: space.sm },
  subLabel: { color: colors.textMuted, fontSize: type.caption },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    minHeight: 40, justifyContent: "center", paddingHorizontal: space.lg,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.text, fontSize: type.label, fontWeight: "600" },
  chipTextOn: { color: colors.onBrand },

  sectionTitle: {
    color: colors.textMuted, fontSize: type.label, fontWeight: "700",
    marginTop: space.lg,
  },
  row: {
    flexDirection: "row", alignItems: "center", gap: space.md,
    minHeight: TOUCH, padding: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  rowTitle: { color: colors.text, fontSize: type.body, fontWeight: "700" },
  rowMeta: { color: colors.textMuted, fontSize: type.caption, marginTop: 2 },
  rowStatus: { fontSize: type.caption, fontWeight: "700", marginTop: 2 },
  rowStatusLive: { color: colors.successInk },
  rowStatusDone: { color: colors.textMuted },
  rowAction: { color: colors.brandInk, fontSize: type.label, fontWeight: "700" },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  emptyTitle: { color: colors.text, fontSize: type.heading, fontWeight: "700" },
  emptyBody: { color: colors.textMuted, fontSize: type.label, textAlign: "center" },

  qrScreen: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: space.lg, padding: space.xl,
    backgroundColor: colors.background,
  },
  qrName: { color: colors.text, fontSize: type.title, fontWeight: "800" },
  qrFlat: { color: colors.textMuted, fontSize: type.body, marginTop: -space.md },
  qrHint: { color: colors.textMuted, fontSize: type.label, textAlign: "center" },
  usedBanner: {
    padding: space.lg, gap: space.xs, borderRadius: radius.md,
    backgroundColor: colors.warningBg,
    borderWidth: 1, borderColor: colors.warning,
  },
  usedText: { color: colors.text, fontSize: type.body, fontWeight: "700", textAlign: "center" },
  usedBody: { color: colors.textMuted, fontSize: type.caption, textAlign: "center" },
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
  hint: { color: colors.textMuted, fontSize: type.caption, marginTop: space.xs },
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
});

export default GuestPassScreen;
