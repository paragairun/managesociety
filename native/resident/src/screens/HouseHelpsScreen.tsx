import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Image, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View,
} from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import QrCode from "@/components/QrCode";
import { colors, radius, space, TOUCH, type } from "@/theme";

interface HouseHelp {
  id: string;
  name: string;
  help_type: string;
  phone: string | null;
  photo_base64: string | null;
  qr_code: string;
  is_active: boolean;
}

interface ResidentFlat {
  id: string;
  wing: string;
  flat_number: string;
  is_primary: boolean;
  flat_label: string;
}

/**
 * The maids, cooks and drivers who come to this flat.
 *
 * A resident does NOT create these — the committee registers a house
 * help once, for the whole society, with their photo and their QR.
 * What a resident does is LINK one to their flat, which is how the
 * guard knows who a person at the gate is coming to see, and how the
 * attendance log knows whose flat to credit.
 *
 * So this screen is a directory with a link/unlink, not a form. The
 * distinction matters: one person working in six flats is one record
 * and six links, not six people.
 *
 * Only a primary resident gets here at all — @core/residentAccess
 * withholds the section from family and tenant logins, because a house
 * help's QR opens the gate for a person.
 */
const HouseHelpsScreen = () => {
  const { user, societyId } = useAuth();
  const { width } = useWindowDimensions();

  const [linked, setLinked] = useState<HouseHelp[]>([]);
  const [available, setAvailable] = useState<HouseHelp[]>([]);
  const [flats, setFlats] = useState<ResidentFlat[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [showing, setShowing] = useState<HouseHelp | null>(null);
  const [linking, setLinking] = useState<HouseHelp | null>(null);

  const qrSize = Math.min(width - space.xl * 2, 360);

  const load = useCallback(async () => {
    if (!user || !societyId) return;

    const [{ data: links }, { data: flatRows }] = await Promise.all([
      supabase.from("house_help_flats")
        .select("house_help_id, wing, flat_number")
        .eq("resident_id", user.id),
      supabase.from("resident_flats")
        .select("id, wing, flat_number, is_primary")
        .eq("user_id", user.id)
        .order("is_primary", { ascending: false }),
    ]);

    setFlats(((flatRows ?? []) as Omit<ResidentFlat, "flat_label">[]).map((f) => ({
      ...f,
      flat_label: [f.wing, f.flat_number].filter(Boolean).join("-"),
    })));

    const linkedIds = new Set((links ?? []).map((l) => l.house_help_id as string));

    const { data: all } = await supabase
      .from("house_helps")
      .select("id, name, help_type, phone, photo_base64, qr_code, is_active")
      .eq("society_id", societyId)
      .eq("is_active", true)
      .order("name");

    const helps = (all ?? []) as HouseHelp[];
    setLinked(helps.filter((h) => linkedIds.has(h.id)));
    setAvailable(helps.filter((h) => !linkedIds.has(h.id)));
    setLoading(false);
  }, [user, societyId]);

  useEffect(() => { void load(); }, [load]);

  const link = useCallback(async (help: HouseHelp, flat: ResidentFlat) => {
    if (!user) return;
    setBusyId(help.id);
    const { error } = await supabase.from("house_help_flats").insert({
      house_help_id: help.id,
      resident_id: user.id,
      wing: flat.wing,
      flat_number: flat.flat_number,
    });
    setBusyId(null);
    setLinking(null);
    if (error) { Alert.alert("Could not add them", error.message); return; }
    await load();
  }, [user, load]);

  const unlink = useCallback((help: HouseHelp) => {
    Alert.alert(
      `Remove ${help.name}?`,
      "They stay registered with the society — this only removes them from your flat.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            if (!user) return;
            setBusyId(help.id);
            const { error } = await supabase.from("house_help_flats").delete()
              .eq("house_help_id", help.id).eq("resident_id", user.id);
            setBusyId(null);
            if (error) { Alert.alert("Could not remove them", error.message); return; }
            await load();
          },
        },
      ],
    );
  }, [user, load]);

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  const q = query.trim().toLowerCase();
  const matches = available.filter((h) =>
    !q || h.name.toLowerCase().includes(q) || h.help_type.toLowerCase().includes(q));

  const Row = ({ help, isLinked }: { help: HouseHelp; isLinked: boolean }) => (
    <View style={styles.row}>
      {help.photo_base64 ? (
        <Image source={{ uri: help.photo_base64 }} style={styles.photo} />
      ) : (
        <View style={styles.photoFallback}>
          <Text style={styles.photoInitial}>{help.name.charAt(0).toUpperCase()}</Text>
        </View>
      )}

      <Pressable
        style={styles.flex}
        onPress={() => setShowing(help)}
        accessibilityRole="button"
      >
        <Text style={styles.name}>{help.name}</Text>
        <Text style={styles.meta}>
          {help.help_type}
          {help.phone ? ` · ${help.phone}` : ""}
        </Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [
          styles.rowAction, isLinked && styles.rowActionRemove, pressed && styles.pressed,
        ]}
        onPress={() => (isLinked ? unlink(help) : setLinking(help))}
        disabled={busyId === help.id}
        accessibilityRole="button"
      >
        {busyId === help.id
          ? <ActivityIndicator color={isLinked ? colors.dangerInk : colors.onBrand} />
          : (
            <Text style={[styles.rowActionText, isLinked && styles.rowActionTextRemove]}>
              {isLinked ? "Remove" : "Add"}
            </Text>
          )}
      </Pressable>
    </View>
  );

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
        <Text style={styles.sectionTitle}>Coming to your flat</Text>
        {linked.length === 0 ? (
          <Text style={styles.note}>
            Nobody added yet. Pick from the society's list below.
          </Text>
        ) : linked.map((h) => <Row key={h.id} help={h} isLinked />)}

        <Text style={[styles.sectionTitle, styles.spaced]}>
          Registered with the society
        </Text>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name or work"
          placeholderTextColor={colors.textFaint}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {matches.length === 0 ? (
          <Text style={styles.note}>
            {available.length === 0
              ? "Everyone registered is already added to your flat."
              : "Nobody matches that."}
          </Text>
        ) : matches.map((h) => <Row key={h.id} help={h} isLinked={false} />)}

        <Text style={styles.footnote}>
          House helps are registered by your committee, with their photo and ID card.
          If someone is missing from this list, ask them to add the person first.
        </Text>
      </ScrollView>

      {/* Their ID card */}
      <Modal visible={!!showing} animationType="slide" onRequestClose={() => setShowing(null)}>
        {showing ? (
          <View style={styles.qrScreen}>
            {showing.photo_base64 ? (
              <Image source={{ uri: showing.photo_base64 }} style={styles.qrPhoto} />
            ) : null}
            <Text style={styles.qrName}>{showing.name}</Text>
            <Text style={styles.qrMeta}>
              {showing.help_type}
              {showing.phone ? ` · ${showing.phone}` : ""}
            </Text>
            <QrCode value={showing.qr_code} size={qrSize} />
            <Text style={styles.qrHint}>
              The guard scans this at the gate. It is the same code as on their ID card.
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

      {/* Which flat */}
      <Modal visible={!!linking} animationType="fade" transparent onRequestClose={() => setLinking(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setLinking(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>
              Add {linking?.name} to which flat?
            </Text>
            {flats.map((f) => (
              <Pressable
                key={f.id}
                style={({ pressed }) => [styles.sheetOption, pressed && styles.pressed]}
                onPress={() => linking && void link(linking, f)}
                accessibilityRole="button"
              >
                <Text style={styles.sheetOptionText}>{f.flat_label}</Text>
              </Pressable>
            ))}
            <Pressable
              style={({ pressed }) => [styles.sheetCancel, pressed && styles.pressed]}
              onPress={() => setLinking(null)}
              accessibilityRole="button"
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  centre: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  pressed: { opacity: 0.75 },
  spaced: { marginTop: space.lg },

  sectionTitle: { color: colors.textMuted, fontSize: type.label, fontWeight: "700" },
  note: { color: colors.textMuted, fontSize: type.label, paddingVertical: space.sm },
  footnote: {
    color: colors.textFaint, fontSize: type.caption,
    marginTop: space.lg, lineHeight: 16,
  },

  search: {
    minHeight: TOUCH,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: space.md, color: colors.text, fontSize: type.body,
  },

  row: {
    flexDirection: "row", alignItems: "center", gap: space.md,
    padding: space.md, minHeight: TOUCH + space.md,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  photo: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised },
  photoFallback: {
    width: 44, height: 44, borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center", justifyContent: "center",
  },
  photoInitial: { color: colors.textMuted, fontSize: type.heading, fontWeight: "700" },
  name: { color: colors.text, fontSize: type.body, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: type.caption, marginTop: 2 },

  rowAction: {
    minHeight: 40, minWidth: 76, borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  rowActionRemove: {
    backgroundColor: "transparent",
    borderWidth: 1, borderColor: colors.danger,
  },
  rowActionText: { color: colors.onBrand, fontSize: type.label, fontWeight: "700" },
  rowActionTextRemove: { color: colors.dangerInk },

  qrScreen: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: space.md, padding: space.xl,
    backgroundColor: colors.background,
  },
  qrPhoto: { width: 72, height: 72, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised },
  qrName: { color: colors.text, fontSize: type.title, fontWeight: "800" },
  qrMeta: { color: colors.textMuted, fontSize: type.body },
  qrHint: { color: colors.textMuted, fontSize: type.label, textAlign: "center" },
  close: {
    minHeight: TOUCH, minWidth: 160, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  closeText: { color: colors.text, fontSize: type.body, fontWeight: "700" },

  sheetBackdrop: {
    flex: 1, justifyContent: "flex-end",
    backgroundColor: colors.scrim,
  },
  sheet: {
    padding: space.lg, gap: space.sm,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
  },
  sheetTitle: { color: colors.text, fontSize: type.heading, fontWeight: "700", marginBottom: space.sm },
  sheetOption: {
    minHeight: TOUCH, justifyContent: "center", paddingHorizontal: space.lg,
    backgroundColor: colors.surfaceRaised, borderRadius: radius.md,
  },
  sheetOptionText: { color: colors.text, fontSize: type.body, fontWeight: "600" },
  sheetCancel: {
    minHeight: TOUCH, alignItems: "center", justifyContent: "center", marginTop: space.sm,
  },
  sheetCancelText: { color: colors.textMuted, fontSize: type.body, fontWeight: "600" },
});

export default HouseHelpsScreen;
