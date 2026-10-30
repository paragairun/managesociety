import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  emptyBookingDraft, validateBooking, bookingState, canCancel, shortTime,
  type Amenity, type BookingDraft, type BookingTone,
} from "@core/amenityBooking";
import { can } from "@core/residentAccess";
import { colors, radius, space, TOUCH, type } from "@/theme";

interface Booking {
  id: string;
  amenity_id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  status: string;
  notes: string | null;
  wing: string;
  flat_number: string;
}

interface ResidentFlat {
  id: string;
  wing: string;
  flat_number: string;
  is_primary: boolean;
  flat_label: string;
}

const TONE_COLOR: Record<BookingTone, string> = {
  waiting: colors.warningInk,
  good: colors.successInk,
  bad: colors.dangerInk,
  done: colors.textMuted,
};

/** A time typed as digits, nudged towards HH:MM as it is entered. */
const asTime = (raw: string): string => {
  const d = raw.replace(/\D/g, "").slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}:${d.slice(2)}`;
};

/**
 * Book the clubhouse, the court, the hall.
 *
 * Every rule the form enforces — the time order, the per-amenity cap,
 * the opening hours — comes from @core/amenityBooking, which the
 * website uses too and the database enforces again. Three checks of one
 * rule sounds redundant until the first resident picks a three-hour
 * slot on a court capped at two and is told by a server round trip
 * instead of by the form in front of them.
 */
const AmenitiesScreen = () => {
  const { user, societyId, identity } = useAuth();

  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [flats, setFlats] = useState<ResidentFlat[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<BookingDraft>(emptyBookingDraft(""));

  const load = useCallback(async () => {
    if (!societyId || !user) return;

    // Bookings whose slot has passed are closed off server-side, so the
    // resident is not looking at last Tuesday as though it were still a
    // plan they could cancel.
    await supabase.rpc("complete_past_amenity_bookings", { p_society_id: societyId });

    const [am, bk, fl] = await Promise.all([
      supabase.from("amenities").select("*")
        .eq("society_id", societyId).eq("is_active", true).order("name"),
      supabase.from("amenity_bookings").select("*")
        .order("booking_date", { ascending: false })
        .order("start_time", { ascending: false }),
      supabase.from("resident_flats").select("id, wing, flat_number, is_primary")
        .eq("user_id", user.id),
    ]);

    setAmenities((am.data ?? []) as Amenity[]);
    setBookings((bk.data ?? []) as Booking[]);

    const myFlats = ((fl.data ?? []) as Omit<ResidentFlat, "flat_label">[]).map((f) => ({
      ...f,
      flat_label: [f.wing, f.flat_number].filter(Boolean).join("-"),
    }));
    setFlats(myFlats);

    setDraft((d) => (d.flatId
      ? d
      : { ...d, flatId: myFlats.find((f) => f.is_primary)?.id ?? myFlats[0]?.id ?? "" }));
    setLoading(false);
  }, [societyId, user]);

  useEffect(() => { void load(); }, [load]);

  const selected = amenities.find((a) => a.id === draft.amenityId);

  const submit = useCallback(async () => {
    const problem = validateBooking(draft, selected);
    if (problem) { Alert.alert("Not quite", problem); return; }
    if (!user || !societyId || !selected) return;

    const flat = flats.find((f) => f.id === draft.flatId);
    if (!flat) { Alert.alert("Choose which flat this is for"); return; }

    setSaving(true);
    const { error } = await supabase.from("amenity_bookings").insert({
      amenity_id: selected.id,
      society_id: societyId,
      wing: flat.wing,
      flat_number: flat.flat_number,
      booked_by: user.id,
      booking_date: draft.date,
      start_time: draft.start_time,
      end_time: draft.end_time,
      notes: draft.notes.trim() || null,
    });
    setSaving(false);

    if (error) {
      // The database enforces the same rules plus the ones only it can
      // see — a clash with somebody else's booking, above all — so its
      // message is worth showing rather than replacing.
      Alert.alert("Could not book", error.message);
      return;
    }

    setDraft(emptyBookingDraft(draft.flatId));
    setShowForm(false);
    await load();
  }, [draft, selected, user, societyId, flats, load]);

  const cancel = useCallback((booking: Booking) => {
    Alert.alert(
      "Cancel this booking?",
      "The slot goes back to whoever wants it.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Cancel booking",
          style: "destructive",
          onPress: async () => {
            setCancellingId(booking.id);
            const { error } = await supabase
              .from("amenity_bookings")
              .update({ status: "cancelled" })
              .eq("id", booking.id);
            setCancellingId(null);
            if (error) { Alert.alert("Could not cancel", error.message); return; }
            await load();
          },
        },
      ],
    );
  }, [load]);

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  const amenityName = (id: string) =>
    amenities.find((a) => a.id === id)?.name ?? "Amenity";

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
        {can(identity, "bookAmenity") && amenities.length > 0 ? (
          <Pressable
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            onPress={() => setShowForm(true)}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>Book an amenity</Text>
          </Pressable>
        ) : null}

        {amenities.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No amenities set up</Text>
            <Text style={styles.emptyBody}>
              Your committee adds these from the admin panel.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Available</Text>
            {amenities.map((a) => (
              <View key={a.id} style={styles.amenityRow}>
                <View style={styles.flex}>
                  <Text style={styles.amenityName}>{a.name}</Text>
                  <Text style={styles.amenityMeta}>
                    Open {shortTime(a.operating_hours_start)}–{shortTime(a.operating_hours_end)}
                    {" · up to "}
                    {a.max_booking_hours}h at a time
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}

        {bookings.length > 0 ? (
          <>
            <Text style={[styles.sectionTitle, styles.spaced]}>Your bookings</Text>
            {bookings.map((b) => {
              const state = bookingState(b.status);
              return (
                <View key={b.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={styles.flex}>
                      <Text style={styles.bookingName}>{amenityName(b.amenity_id)}</Text>
                      <Text style={styles.bookingMeta}>
                        {new Date(b.booking_date).toLocaleDateString("en-IN", {
                          weekday: "short", day: "numeric", month: "short",
                        })}
                        {" · "}
                        {shortTime(b.start_time)}–{shortTime(b.end_time)}
                      </Text>
                      <Text style={[styles.bookingState, { color: TONE_COLOR[state.tone] }]}>
                        {state.label}
                      </Text>
                      {b.notes ? <Text style={styles.bookingNotes}>{b.notes}</Text> : null}
                    </View>
                  </View>

                  {canCancel(b.status) ? (
                    <Pressable
                      style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
                      onPress={() => cancel(b)}
                      disabled={cancellingId === b.id}
                      accessibilityRole="button"
                    >
                      {cancellingId === b.id
                        ? <ActivityIndicator color={colors.dangerInk} />
                        : <Text style={styles.cancelText}>Cancel booking</Text>}
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </>
        ) : null}
      </ScrollView>

      <Modal
        visible={showForm}
        animationType="slide"
        onRequestClose={() => setShowForm(false)}
      >
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Book an amenity</Text>
            <Pressable onPress={() => setShowForm(false)} hitSlop={16} accessibilityRole="button">
              <Text style={styles.modalClose}>✕</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>What *</Text>
            <View style={styles.chips}>
              {amenities.map((a) => (
                <Pressable
                  key={a.id}
                  style={({ pressed }) => [
                    styles.chip,
                    draft.amenityId === a.id && styles.chipOn,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => setDraft((d) => ({ ...d, amenityId: a.id }))}
                  accessibilityRole="button"
                >
                  <Text style={[styles.chipText, draft.amenityId === a.id && styles.chipTextOn]}>
                    {a.name}
                  </Text>
                </Pressable>
              ))}
            </View>
            {selected ? (
              <Text style={styles.hint}>
                Open {shortTime(selected.operating_hours_start)}–{shortTime(selected.operating_hours_end)},
                {" "}up to {selected.max_booking_hours}h at a time.
              </Text>
            ) : null}

            {flats.length > 1 ? (
              <>
                <Text style={styles.label}>For which flat *</Text>
                <View style={styles.chips}>
                  {flats.map((f) => (
                    <Pressable
                      key={f.id}
                      style={({ pressed }) => [
                        styles.chip,
                        draft.flatId === f.id && styles.chipOn,
                        pressed && styles.pressed,
                      ]}
                      onPress={() => setDraft((d) => ({ ...d, flatId: f.id }))}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.chipText, draft.flatId === f.id && styles.chipTextOn]}>
                        {f.flat_label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            <Text style={styles.label}>Date *</Text>
            <TextInput
              style={styles.input}
              value={draft.date}
              onChangeText={(t) => setDraft((d) => ({ ...d, date: t }))}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textFaint}
              inputMode="numeric"
              autoCorrect={false}
            />

            <View style={styles.timeRow}>
              <View style={styles.flex}>
                <Text style={styles.label}>From *</Text>
                <TextInput
                  style={styles.input}
                  value={draft.start_time}
                  onChangeText={(t) => setDraft((d) => ({ ...d, start_time: asTime(t) }))}
                  placeholder="18:00"
                  placeholderTextColor={colors.textFaint}
                  inputMode="numeric"
                  keyboardType="number-pad"
                  maxLength={5}
                />
              </View>
              <View style={styles.flex}>
                <Text style={styles.label}>To *</Text>
                <TextInput
                  style={styles.input}
                  value={draft.end_time}
                  onChangeText={(t) => setDraft((d) => ({ ...d, end_time: asTime(t) }))}
                  placeholder="20:00"
                  placeholderTextColor={colors.textFaint}
                  inputMode="numeric"
                  keyboardType="number-pad"
                  maxLength={5}
                />
              </View>
            </View>

            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={[styles.input, styles.notes]}
              value={draft.notes}
              onChangeText={(t) => setDraft((d) => ({ ...d, notes: t }))}
              placeholder="Birthday party, 20 people…"
              placeholderTextColor={colors.textFaint}
              multiline
            />
          </ScrollView>

          <View style={styles.modalFooter}>
            <Pressable
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              onPress={() => void submit()}
              disabled={saving}
              accessibilityRole="button"
            >
              {saving
                ? <ActivityIndicator color={colors.onBrand} />
                : <Text style={styles.primaryText}>Request booking</Text>}
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
  spaced: { marginTop: space.lg },

  primary: {
    minHeight: TOUCH + 8, borderRadius: radius.lg,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  primaryText: { color: colors.onBrand, fontSize: type.heading, fontWeight: "800" },

  sectionTitle: {
    color: colors.textMuted, fontSize: type.label, fontWeight: "700",
    marginTop: space.md,
  },
  amenityRow: {
    flexDirection: "row", alignItems: "center", gap: space.md,
    padding: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  amenityName: { color: colors.text, fontSize: type.body, fontWeight: "700" },
  amenityMeta: { color: colors.textMuted, fontSize: type.caption, marginTop: 2 },

  card: {
    padding: space.md, gap: space.sm,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  cardTop: { flexDirection: "row", gap: space.md },
  bookingName: { color: colors.text, fontSize: type.body, fontWeight: "700" },
  bookingMeta: { color: colors.textMuted, fontSize: type.label, marginTop: 2 },
  bookingState: { fontSize: type.caption, fontWeight: "700", marginTop: 2 },
  bookingNotes: { color: colors.textMuted, fontSize: type.caption, marginTop: space.xs },
  cancel: {
    minHeight: TOUCH, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.danger,
    alignItems: "center", justifyContent: "center",
  },
  cancelText: { color: colors.dangerInk, fontSize: type.label, fontWeight: "700" },

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
  hint: { color: colors.textMuted, fontSize: type.caption, marginTop: space.xs },
  input: {
    minHeight: TOUCH,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: space.md, color: colors.text, fontSize: type.heading,
  },
  notes: { minHeight: TOUCH * 2, paddingTop: space.md, textAlignVertical: "top" },
  timeRow: { flexDirection: "row", gap: space.md },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingVertical: space.xs },
  chip: {
    minHeight: 44, justifyContent: "center", paddingHorizontal: space.lg,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.text, fontSize: type.label, fontWeight: "600" },
  chipTextOn: { color: colors.onBrand },

  modalFooter: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
});

export default AmenitiesScreen;
