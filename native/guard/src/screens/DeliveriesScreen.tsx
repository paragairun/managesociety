import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import FlatPicker from "@/components/FlatPicker";
import {
  DELIVERY_TYPES, deliveryIcon, deliveryLabel, statusDisplay,
  emptyDraft, normalizeMobile, validateDraft, draftToRow, minutesLeft, groupVisits,
  type DeliveryVisit, type DeliveryDraft, type StatusTone,
} from "@core/deliveries";
import { colors, radius, space, TOUCH, type } from "@/theme";

/**
 * The widest the stored photo gets, in pixels.
 *
 * The photo goes into delivery_visits.photo_base64 as a data URI, so it
 * travels in every row the resident app reads. A phone camera's full
 * frame is around 4000px and base64-encodes to several megabytes, which
 * on a gate's connection is a visible stall and on the resident's side
 * a slow list. 640px is more than enough to recognise a face on a phone
 * and lands around 40-60 KB.
 */
const PHOTO_WIDTH = 640;

const TONE_COLOR: Record<StatusTone, string> = {
  waiting: colors.warning,
  good: colors.success,
  bad: colors.danger,
  done: colors.textMuted,
};

/**
 * Deliveries: register an agent at the gate, and track who is inside.
 *
 * The flow this screen exists for: an agent arrives, the guard
 * photographs them, picks the flat, and the resident is asked. Until
 * the resident answers, the agent waits — so "Awaiting approval" is the
 * first section and carries a countdown, because the guard's real
 * question is how much longer to make somebody stand there.
 */
const DeliveriesScreen = () => {
  const { societyId, user } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();

  const [visits, setVisits] = useState<DeliveryVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [exitingId, setExitingId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<DeliveryDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const camera = useRef<CameraView>(null);

  const load = useCallback(async (expire = false) => {
    if (!societyId) return;
    // Pending visits that nobody answered are expired server-side, so
    // the guard is not left looking at a request from two hours ago as
    // though it were still live.
    if (expire) await supabase.rpc("expire_delivery_visits", { p_society_id: societyId });

    const { data } = await supabase
      .from("delivery_visits")
      .select("*")
      .eq("society_id", societyId)
      .not("status", "in", '("completed","expired")')
      .order("entry_time", { ascending: false });
    setVisits((data ?? []) as DeliveryVisit[]);
    setLoading(false);
  }, [societyId]);

  useEffect(() => { void load(true); }, [load]);

  // A live subscription instead of the website's 10-second poll.
  //
  // The poll is what made the keyboard vanish on the web dashboard: a
  // refetch re-rendered the list behind the open form every 10 seconds,
  // and on Android a layout change while the soft keyboard is up
  // dismisses the keyboard. A guard typing a 10-digit number was thrown
  // out every other digit. A subscription only fires when a row really
  // changed, and the form is a native modal over its own surface — but
  // the refresh is still held while the form is open, because a row
  // moving under a half-typed form is confusing even when the keyboard
  // survives it.
  useEffect(() => {
    if (!societyId || showForm) return;
    const channel = supabase
      .channel("guard-delivery-visits")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "delivery_visits", filter: `society_id=eq.${societyId}` },
        () => { void load(false); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [societyId, showForm, load]);

  const openCamera = useCallback(async () => {
    if (!permission?.granted) {
      const asked = await requestPermission();
      if (!asked.granted) {
        Alert.alert(
          "Camera not allowed",
          "Allow camera access in Settings → Apps → ManageSociety Guard to photograph agents.",
        );
        return;
      }
    }
    setCameraOpen(true);
  }, [permission?.granted, requestPermission]);

  const capture = useCallback(async () => {
    if (!camera.current || capturing) return;
    setCapturing(true);
    try {
      const shot = await camera.current.takePictureAsync({ quality: 0.8, skipProcessing: true });
      if (!shot?.uri) throw new Error("The camera returned no image.");

      const rendered = await ImageManipulator
        .manipulate(shot.uri)
        .resize({ width: PHOTO_WIDTH })
        .renderAsync();
      const out = await rendered.saveAsync({
        base64: true, compress: 0.6, format: SaveFormat.JPEG,
      });
      if (!out.base64) throw new Error("The photo could not be encoded.");

      // Stored as a data URI, not bare base64: the resident and admin
      // web apps render this straight into an <img src>, and bare
      // base64 would show as a broken image there.
      setDraft((d) => ({ ...d, photo_base64: `data:image/jpeg;base64,${out.base64}` }));
      setCameraOpen(false);
    } catch (e) {
      Alert.alert("Could not take the photo", e instanceof Error ? e.message : String(e));
    } finally {
      setCapturing(false);
    }
  }, [capturing]);

  const submit = useCallback(async () => {
    const problem = validateDraft(draft);
    if (problem) { Alert.alert("Not quite done", problem); return; }
    if (!societyId) { Alert.alert("Society not loaded", "Sign out and back in, then try again."); return; }

    setSaving(true);
    const { error } = await supabase.from("delivery_visits").insert({
      ...draftToRow(draft),
      society_id: societyId,
      guard_id: user?.id ?? null,
    });
    setSaving(false);

    if (error) { Alert.alert("Could not register the delivery", error.message); return; }

    setDraft(emptyDraft());
    setShowForm(false);
    await load(false);
  }, [draft, societyId, user?.id, load]);

  const markExit = useCallback(async (v: DeliveryVisit) => {
    setExitingId(v.id);
    const { error } = await supabase
      .from("delivery_visits")
      .update({ status: "completed", exit_time: new Date().toISOString() })
      .eq("id", v.id);
    setExitingId(null);
    if (error) { Alert.alert("Could not log the exit", error.message); return; }
    await load(false);
  }, [load]);

  const { pending, approved, rejected, total } = groupVisits(visits, query);

  const Card = ({ v }: { v: DeliveryVisit }) => {
    const status = statusDisplay(v.status);
    const left = minutesLeft(v.expires_at);
    return (
      <View style={[
        styles.card,
        v.status === "approved" && styles.cardGood,
        v.status === "rejected" && styles.cardBad,
      ]}>
        <View style={styles.cardTop}>
          {v.photo_base64 ? (
            <Image source={{ uri: v.photo_base64 }} style={styles.photo} />
          ) : (
            <View style={styles.photoFallback}>
              <Text style={styles.photoIcon}>{deliveryIcon(v.delivery_type)}</Text>
            </View>
          )}
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>
              {deliveryIcon(v.delivery_type)} {deliveryLabel(v.delivery_type)}
            </Text>
            <Text style={styles.cardMeta}>
              {v.mobile}{v.agent_name ? ` · ${v.agent_name}` : ""}
            </Text>
            <Text style={styles.cardMeta}>
              {[v.wing, v.flat_number].filter(Boolean).join("-")} · {new Date(v.entry_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </Text>
          </View>
          <View style={styles.cardRight}>
            <Text style={[styles.status, { color: TONE_COLOR[status.tone] }]}>{status.label}</Text>
            {v.status === "pending_approval" && left > 0 ? (
              <Text style={styles.expiry}>{left}m left</Text>
            ) : null}
          </View>
        </View>

        {v.status === "approved" ? (
          <Pressable
            style={({ pressed }) => [styles.exit, pressed && styles.pressed]}
            onPress={() => void markExit(v)}
            disabled={exitingId === v.id}
            accessibilityRole="button"
          >
            {exitingId === v.id
              ? <ActivityIndicator color={colors.success} />
              : <Text style={styles.exitText}>Mark Exit</Text>}
          </Pressable>
        ) : null}
      </View>
    );
  };

  const Section = ({ title, tone, items }: { title: string; tone: StatusTone; items: DeliveryVisit[] }) =>
    items.length === 0 ? null : (
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: TONE_COLOR[tone] }]}>
          {title} ({items.length})
        </Text>
        {items.map((v) => <Card key={v.id} v={v} />)}
      </View>
    );

  return (
    <View style={styles.fill}>
      <View style={styles.toolbar}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search mobile, flat, type"
          placeholderTextColor={colors.textFaint}
          autoCorrect={false}
          autoCapitalize="none"
        />
        <Pressable
          style={({ pressed }) => [styles.register, pressed && styles.pressed]}
          onPress={() => setShowForm(true)}
          accessibilityRole="button"
        >
          <Text style={styles.registerText}>+ Register</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={[styles.fill, styles.centre]}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void load(true).then(() => setRefreshing(false)); }}
              tintColor={colors.brand}
            />
          }
        >
          <Section title="Awaiting approval" tone="waiting" items={pending} />
          <Section title="Approved — inside" tone="good" items={approved} />
          <Section title="Rejected" tone="bad" items={rejected} />
          {total === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                {query.trim() ? "Nothing matches that" : "No active deliveries"}
              </Text>
              <Text style={styles.emptyBody}>
                {query.trim()
                  ? "Try a mobile number or a flat."
                  : "Tap Register when an agent arrives at the gate."}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      )}

      {/* Registration form */}
      <Modal
        visible={showForm}
        animationType="slide"
        onRequestClose={() => { setShowForm(false); setDraft(emptyDraft()); }}
      >
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Register Delivery</Text>
            <Pressable
              onPress={() => { setShowForm(false); setDraft(emptyDraft()); }}
              hitSlop={16}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={styles.modalClose}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.form}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.label}>Agent photo (optional)</Text>
            {draft.photo_base64 ? (
              <View style={styles.photoRow}>
                <Image source={{ uri: draft.photo_base64 }} style={styles.photoLarge} />
                <View style={styles.photoActions}>
                  <Pressable style={styles.secondary} onPress={() => void openCamera()}>
                    <Text style={styles.secondaryText}>Retake</Text>
                  </Pressable>
                  <Pressable
                    style={styles.secondary}
                    onPress={() => setDraft((d) => ({ ...d, photo_base64: "" }))}
                  >
                    <Text style={styles.secondaryText}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                style={({ pressed }) => [styles.photoBtn, pressed && styles.pressed]}
                onPress={() => void openCamera()}
                accessibilityRole="button"
              >
                <Text style={styles.photoBtnText}>Take Photo</Text>
              </Pressable>
            )}

            <Text style={styles.label}>Mobile number *</Text>
            <TextInput
              style={styles.input}
              value={draft.mobile}
              onChangeText={(t) => setDraft((d) => ({ ...d, mobile: normalizeMobile(t) }))}
              placeholder="98765 43210"
              placeholderTextColor={colors.textFaint}
              inputMode="numeric"
              keyboardType="number-pad"
              maxLength={10}
              // No autofill dropdown here at all, which is the whole
              // point of the native form: a gate device is shared by
              // every guard on every shift, and on the website the
              // browser's saved-value list opening over this field was
              // what kept pushing the keyboard away.
              autoComplete="off"
              autoCorrect={false}
            />

            <Text style={styles.label}>Agent name (optional)</Text>
            <TextInput
              style={styles.input}
              value={draft.agent_name}
              onChangeText={(t) => setDraft((d) => ({ ...d, agent_name: t }))}
              placeholder="Rajan"
              placeholderTextColor={colors.textFaint}
              autoComplete="off"
              autoCorrect={false}
            />

            <Text style={styles.label}>What is being delivered *</Text>
            <View style={styles.typeGrid}>
              {DELIVERY_TYPES.map((t) => (
                <Pressable
                  key={t.value}
                  style={({ pressed }) => [
                    styles.typeChip,
                    draft.delivery_type === t.value && styles.typeChipOn,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => setDraft((d) => ({ ...d, delivery_type: t.value }))}
                  accessibilityRole="button"
                >
                  <Text style={[
                    styles.typeChipText,
                    draft.delivery_type === t.value && styles.typeChipTextOn,
                  ]}>
                    {t.icon} {t.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Delivering to *</Text>
            <FlatPicker
              societyId={societyId}
              wing={draft.wing}
              flatNumber={draft.flat_number}
              onChange={(wing, flat_number) => setDraft((d) => ({ ...d, wing, flat_number }))}
            />
          </ScrollView>

          <View style={styles.modalFooter}>
            <Pressable
              style={({ pressed }) => [styles.submit, pressed && styles.pressed]}
              onPress={() => void submit()}
              disabled={saving}
              accessibilityRole="button"
            >
              {saving
                ? <ActivityIndicator color={colors.onBrand} />
                : <Text style={styles.submitText}>Register & Notify Resident</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Camera */}
      <Modal visible={cameraOpen} animationType="fade" onRequestClose={() => setCameraOpen(false)}>
        <View style={styles.fill}>
          <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />
          <View style={styles.camFooter}>
            <Pressable
              style={({ pressed }) => [styles.camCancel, pressed && styles.pressed]}
              onPress={() => setCameraOpen(false)}
            >
              <Text style={styles.camCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.camShoot, pressed && styles.pressed]}
              onPress={() => void capture()}
              disabled={capturing}
              accessibilityRole="button"
              accessibilityLabel="Capture photo"
            >
              {capturing
                ? <ActivityIndicator color={colors.onBrand} />
                : <Text style={styles.camShootText}>Capture</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  centre: { alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.75 },
  scroll: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl, flexGrow: 1 },

  toolbar: {
    flexDirection: "row", gap: space.sm,
    padding: space.lg, paddingBottom: space.sm,
  },
  search: {
    flex: 1, minHeight: TOUCH,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: space.md, color: colors.text, fontSize: type.body,
  },
  register: {
    minHeight: TOUCH, paddingHorizontal: space.lg,
    backgroundColor: colors.brand, borderRadius: radius.md,
    alignItems: "center", justifyContent: "center",
  },
  registerText: { color: colors.onBrand, fontSize: type.body, fontWeight: "800" },

  section: { gap: space.sm },
  sectionTitle: { fontSize: type.label, fontWeight: "700" },

  card: {
    padding: space.md, gap: space.sm,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  cardGood: { borderColor: colors.success, backgroundColor: colors.successBg },
  cardBad: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  cardTitle: { color: colors.text, fontSize: type.body, fontWeight: "700" },
  cardMeta: { color: colors.textMuted, fontSize: type.caption, marginTop: 2 },
  cardRight: { alignItems: "flex-end", maxWidth: 110 },
  status: { fontSize: type.caption, fontWeight: "700", textAlign: "right" },
  expiry: { color: colors.textFaint, fontSize: type.caption, marginTop: 2 },

  photo: { width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised },
  photoFallback: {
    width: 52, height: 52, borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center", justifyContent: "center",
  },
  photoIcon: { fontSize: 24 },

  exit: {
    minHeight: TOUCH, borderRadius: radius.md,
    borderWidth: 2, borderColor: colors.success,
    alignItems: "center", justifyContent: "center",
  },
  exitText: { color: colors.success, fontSize: type.body, fontWeight: "800" },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  emptyTitle: { color: colors.text, fontSize: type.heading, fontWeight: "700" },
  emptyBody: { color: colors.textMuted, fontSize: type.label, textAlign: "center" },

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
  input: {
    minHeight: TOUCH,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: space.md, color: colors.text, fontSize: type.heading,
  },

  photoRow: { flexDirection: "row", gap: space.md, alignItems: "center" },
  photoLarge: { width: 88, height: 88, borderRadius: radius.md, backgroundColor: colors.surfaceRaised },
  photoActions: { gap: space.sm },
  photoBtn: {
    minHeight: TOUCH, borderRadius: radius.md,
    borderWidth: 2, borderColor: colors.border, borderStyle: "dashed",
    alignItems: "center", justifyContent: "center",
  },
  photoBtnText: { color: colors.text, fontSize: type.body, fontWeight: "700" },
  secondary: {
    minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  secondaryText: { color: colors.text, fontSize: type.label, fontWeight: "600" },

  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingVertical: space.xs },
  typeChip: {
    minHeight: 44, justifyContent: "center", paddingHorizontal: space.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
  },
  typeChipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  typeChipText: { color: colors.text, fontSize: type.label, fontWeight: "600" },
  typeChipTextOn: { color: colors.onBrand },

  modalFooter: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  submit: {
    minHeight: TOUCH + 8, borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  submitText: { color: colors.onBrand, fontSize: type.heading, fontWeight: "800" },

  camFooter: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    flexDirection: "row", gap: space.md, padding: space.xl,
    backgroundColor: "rgba(15,18,28,0.85)",
  },
  camCancel: {
    flex: 1, minHeight: TOUCH, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  camCancelText: { color: colors.text, fontSize: type.heading, fontWeight: "700" },
  camShoot: {
    flex: 2, minHeight: TOUCH, borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  camShootText: { color: colors.onBrand, fontSize: type.heading, fontWeight: "800" },
});

export default DeliveriesScreen;
