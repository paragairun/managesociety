import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import { can, whyNot } from "@core/residentAccess";
import { normalizeGuestPhone } from "@core/guest-pass";
import { colors, radius, space, TOUCH, type } from "@/theme";

interface ResidentFlat {
  id: string;
  wing: string;
  flat_number: string;
  is_primary: boolean;
  flat_label: string;
}

interface ChildAccount {
  user_id: string;
  display_name: string;
  phone: string | null;
  child_type: string;
}

/**
 * Name, phone, flats, the people who share this login's flat, and the
 * way out.
 *
 * Which of those a given account can change is decided by
 * @core/residentAccess, not here. A family or tenant login sees its
 * flats and can edit its own name and number, but cannot add a flat,
 * change which is primary, create further logins, or delete the
 * account — each of those would let a tenant quietly widen their own
 * access, and each comes with a sentence saying who can do it instead.
 */
const ProfileScreen = () => {
  const { user, identity, parentName, societyName, societyId, signOut } = useAuth();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [flats, setFlats] = useState<ResidentFlat[]>([]);
  const [children, setChildren] = useState<ChildAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [newWing, setNewWing] = useState("");
  const [newFlat, setNewFlat] = useState("");
  const [addingFlat, setAddingFlat] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;

    const [{ data: profile }, { data: flatRows }] = await Promise.all([
      supabase.from("profiles").select("display_name, phone").eq("user_id", user.id).maybeSingle(),
      supabase.from("resident_flats").select("id, wing, flat_number, is_primary")
        .eq("user_id", user.id)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true }),
    ]);

    setName(profile?.display_name ?? "");
    setPhone(profile?.phone ?? "");
    setFlats(((flatRows ?? []) as Omit<ResidentFlat, "flat_label">[]).map((f) => ({
      ...f,
      flat_label: [f.wing, f.flat_number].filter(Boolean).join("-"),
    })));

    if (can(identity, "manageChildAccounts")) {
      const { data: kids } = await supabase
        .from("profiles")
        .select("user_id, display_name, phone, child_type")
        .eq("parent_user_id", user.id)
        .order("created_at", { ascending: true });
      setChildren((kids ?? []) as ChildAccount[]);
    }

    setLoading(false);
  }, [user, identity]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    if (!user) return;
    if (!name.trim()) { Alert.alert("Your name is needed", "It appears on your vehicles' gate stickers."); return; }
    setSaving(true);
    const { error } = await supabase.from("profiles").update({
      display_name: name.trim(),
      phone: phone.trim() || null,
    }).eq("user_id", user.id);
    setSaving(false);
    if (error) { Alert.alert("Could not save", error.message); return; }
    Alert.alert("Saved");
  }, [user, name, phone]);

  const addFlat = useCallback(async () => {
    if (!user || !societyId) return;
    const wing = newWing.trim().toUpperCase();
    const flat_number = newFlat.trim().toUpperCase();
    if (!wing || !flat_number) { Alert.alert("Enter both the wing and the flat number"); return; }

    setAddingFlat(true);
    const { error } = await supabase.from("resident_flats").insert({
      user_id: user.id,
      wing,
      flat_number,
      // The first flat on an account is its primary by definition —
      // there is nothing else for it to be.
      is_primary: flats.length === 0,
      society_id: societyId,
    });
    setAddingFlat(false);
    if (error) { Alert.alert("Could not add the flat", error.message); return; }
    setNewWing(""); setNewFlat("");
    await load();
  }, [user, societyId, newWing, newFlat, flats.length, load]);

  const setPrimary = useCallback(async (flat: ResidentFlat) => {
    setBusyId(flat.id);
    // An RPC rather than two updates: making one flat primary must
    // un-primary the others, and doing that in two round trips leaves a
    // window with two primaries or none.
    const { error } = await supabase.rpc("set_primary_flat", { _flat_id: flat.id });
    setBusyId(null);
    if (error) { Alert.alert("Could not change the primary flat", error.message); return; }
    await load();
  }, [load]);

  const removeFlat = useCallback((flat: ResidentFlat) => {
    Alert.alert(
      `Remove ${flat.flat_label}?`,
      "You stop seeing this flat's deliveries, dues and vehicles.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setBusyId(flat.id);
            const { error } = await supabase.from("resident_flats").delete().eq("id", flat.id);
            setBusyId(null);
            if (error) { Alert.alert("Could not remove the flat", error.message); return; }
            await load();
          },
        },
      ],
    );
  }, [load]);

  const confirmSignOut = () => {
    Alert.alert("Sign out?", "", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);
  };

  const confirmDelete = () => {
    Alert.alert(
      "Delete your account?",
      "This removes your login, your flats and your guest passes. It cannot be undone, and your committee cannot restore it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete everything",
          style: "destructive",
          onPress: async () => {
            const { data, error } = await supabase.functions.invoke("delete-own-account");
            if (error || data?.error) {
              Alert.alert("Could not delete the account", data?.error ?? error?.message ?? "Please try again.");
              return;
            }
            await signOut();
          },
        },
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

  const Refusal = ({ action }: { action: Parameters<typeof whyNot>[1] }) => {
    const message = whyNot(identity, action);
    if (!message) return null;
    return (
      <View style={styles.notice}>
        <Text style={styles.noticeText}>{message}</Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
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
          <Text style={styles.email}>{user?.email}</Text>
        </View>

        <Text style={styles.sectionTitle}>About you</Text>
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor={colors.textFaint}
          autoComplete="off"
        />
        <Text style={styles.hint}>This appears on your vehicles' gate stickers.</Text>

        <Text style={styles.label}>Phone</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={(t) => setPhone(normalizeGuestPhone(t))}
          placeholder="98765 43210"
          placeholderTextColor={colors.textFaint}
          inputMode="numeric"
          keyboardType="number-pad"
          maxLength={10}
        />

        <Pressable
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          onPress={() => void save()}
          disabled={saving}
          accessibilityRole="button"
        >
          {saving
            ? <ActivityIndicator color={colors.onBrand} />
            : <Text style={styles.primaryText}>Save</Text>}
        </Pressable>

        <Text style={[styles.sectionTitle, styles.spaced]}>Your flats</Text>
        {flats.length === 0 ? (
          <Text style={styles.note}>No flats on this account yet.</Text>
        ) : flats.map((f) => (
          <View key={f.id} style={styles.row}>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>{f.flat_label}</Text>
              {f.is_primary ? <Text style={styles.primaryTag}>Primary</Text> : null}
            </View>
            {can(identity, "setPrimaryFlat") && !f.is_primary ? (
              <Pressable
                style={({ pressed }) => [styles.smallBtn, pressed && styles.pressed]}
                onPress={() => void setPrimary(f)}
                disabled={busyId === f.id}
                accessibilityRole="button"
              >
                <Text style={styles.smallBtnText}>Make primary</Text>
              </Pressable>
            ) : null}
            {can(identity, "addFlat") && flats.length > 1 ? (
              <Pressable
                style={({ pressed }) => [styles.smallBtn, styles.smallBtnDanger, pressed && styles.pressed]}
                onPress={() => removeFlat(f)}
                disabled={busyId === f.id}
                accessibilityRole="button"
              >
                <Text style={styles.smallBtnDangerText}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        ))}

        {can(identity, "addFlat") ? (
          <View style={styles.addFlatRow}>
            <TextInput
              style={[styles.input, styles.wingInput]}
              value={newWing}
              onChangeText={(t) => setNewWing(t.toUpperCase())}
              placeholder="Wing"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="characters"
              maxLength={4}
            />
            <TextInput
              style={[styles.input, styles.flex]}
              value={newFlat}
              onChangeText={(t) => setNewFlat(t.toUpperCase())}
              placeholder="Flat number"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="characters"
            />
            <Pressable
              style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
              onPress={() => void addFlat()}
              disabled={addingFlat}
              accessibilityRole="button"
            >
              {addingFlat
                ? <ActivityIndicator color={colors.onBrand} />
                : <Text style={styles.addBtnText}>Add</Text>}
            </Pressable>
          </View>
        ) : <Refusal action="addFlat" />}

        {can(identity, "manageChildAccounts") ? (
          <>
            <Text style={[styles.sectionTitle, styles.spaced]}>Family and tenant logins</Text>
            {children.length === 0 ? (
              <Text style={styles.note}>
                Nobody else has a login for your flat. These are created from the website.
              </Text>
            ) : children.map((c) => (
              <View key={c.user_id} style={styles.row}>
                <View style={styles.flex}>
                  <Text style={styles.rowTitle}>{c.display_name}</Text>
                  <Text style={styles.rowMeta}>
                    {c.child_type === "tenant" ? "Tenant" : "Family"}
                    {c.phone ? ` · ${c.phone}` : ""}
                  </Text>
                </View>
              </View>
            ))}
          </>
        ) : null}

        <Text style={[styles.sectionTitle, styles.spaced]}>Account</Text>
        <Pressable
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          onPress={confirmSignOut}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>Sign out</Text>
        </Pressable>

        {can(identity, "deleteAccount") ? (
          <Pressable
            style={({ pressed }) => [styles.danger, pressed && styles.pressed]}
            onPress={confirmDelete}
            accessibilityRole="button"
          >
            <Text style={styles.dangerText}>Delete my account</Text>
          </Pressable>
        ) : <Refusal action="deleteAccount" />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  centre: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: space.lg, gap: space.xs, paddingBottom: space.xxl },
  pressed: { opacity: 0.75 },
  spaced: { marginTop: space.xl },

  society: { color: colors.text, fontSize: type.title, fontWeight: "700" },
  subtitle: { color: colors.textMuted, fontSize: type.label, marginTop: 2 },
  email: { color: colors.textFaint, fontSize: type.caption, marginTop: 2 },

  sectionTitle: {
    color: colors.textMuted, fontSize: type.label, fontWeight: "700",
    marginTop: space.lg, marginBottom: space.xs,
  },
  label: { color: colors.text, fontSize: type.label, fontWeight: "600", marginTop: space.md },
  hint: { color: colors.textMuted, fontSize: type.caption, marginTop: space.xs },
  note: { color: colors.textMuted, fontSize: type.label, paddingVertical: space.sm },

  input: {
    minHeight: TOUCH,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: space.md, color: colors.text, fontSize: type.body,
  },

  primary: {
    minHeight: TOUCH, borderRadius: radius.md, marginTop: space.lg,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  primaryText: { color: colors.onBrand, fontSize: type.body, fontWeight: "800" },

  secondary: {
    minHeight: TOUCH, borderRadius: radius.md, marginTop: space.sm,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  secondaryText: { color: colors.text, fontSize: type.body, fontWeight: "700" },

  danger: {
    minHeight: TOUCH, borderRadius: radius.md, marginTop: space.sm,
    borderWidth: 1, borderColor: colors.danger,
    alignItems: "center", justifyContent: "center",
  },
  dangerText: { color: colors.dangerInk, fontSize: type.body, fontWeight: "700" },

  row: {
    flexDirection: "row", alignItems: "center", gap: space.sm,
    padding: space.md, minHeight: TOUCH,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    marginBottom: space.xs,
  },
  rowTitle: { color: colors.text, fontSize: type.body, fontWeight: "700" },
  rowMeta: { color: colors.textMuted, fontSize: type.caption, marginTop: 2 },
  primaryTag: { color: colors.successInk, fontSize: type.caption, fontWeight: "700", marginTop: 2 },

  smallBtn: {
    minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  smallBtnText: { color: colors.text, fontSize: type.caption, fontWeight: "700" },
  smallBtnDanger: { borderColor: colors.danger },
  smallBtnDangerText: { color: colors.dangerInk, fontSize: type.caption, fontWeight: "700" },

  addFlatRow: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  wingInput: { width: 84 },
  addBtn: {
    minWidth: 72, minHeight: TOUCH, borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  addBtnText: { color: colors.onBrand, fontSize: type.body, fontWeight: "800" },

  notice: {
    padding: space.md, borderRadius: radius.md, marginTop: space.xs,
    backgroundColor: colors.warningBg,
    borderWidth: 1, borderColor: colors.warning,
  },
  noticeText: { color: colors.text, fontSize: type.label },
});

export default ProfileScreen;
