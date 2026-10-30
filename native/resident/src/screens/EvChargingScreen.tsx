import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput,
  useWindowDimensions, View,
} from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import QrCode from "@/components/QrCode";
import { makeEvDb } from "@core/evDb";
import {
  VEHICLE_LABEL, STATUS_LABEL, splitWithCredit, validateAmount, validateUtr,
  normaliseUtr, upiPaymentLink, isChargerAvailable, isSessionOpen,
  chargeProgress, minutesLeftToPay, formatKwh, formatRupees,
  type Charger, type SessionStatus, type VehicleType,
} from "@core/evCharging";
import { colors, radius, space, TOUCH, type } from "@/theme";

interface Session {
  id: string;
  status: SessionStatus;
  charger_id: string;
  amount_paid: number;
  credit_applied: number;
  rate_per_kwh: number;
  energy_budget_kwh: number | null;
  kwh_consumed: number | null;
  cost: number | null;
  utr: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

interface Settings {
  rate_per_kwh: number;
  min_amount: number;
  max_amount: number;
  payment_window_mins: number;
  upi_vpa: string | null;
  upi_payee_name: string | null;
}

const evDb = makeEvDb(supabase);

/**
 * Pick a charger, pay, charge.
 *
 * Every rule — the amount limits, the credit split, the UPI link, the
 * energy budget, what a status means — comes from @core/evCharging,
 * which the website uses too and which is already tested. This screen
 * is the phone's half of it.
 *
 * The flow is deliberately explicit that payment is NOT instant. UPI
 * gives no callback, so after paying the resident enters the UTR and
 * waits for the bank alert to be matched or for a guard to confirm.
 * Pretending otherwise leaves somebody standing at a charger that never
 * starts.
 */
const EvChargingScreen = () => {
  const { societyId, user } = useAuth();
  const { width } = useWindowDimensions();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [credit, setCredit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [picked, setPicked] = useState<Charger | null>(null);
  const [amount, setAmount] = useState("100");
  const [utr, setUtr] = useState("");
  const [filter, setFilter] = useState<"all" | VehicleType>("all");

  const qrSize = Math.min(width - space.xl * 2, 320);

  const load = useCallback(async () => {
    if (!societyId || !user) return;
    setError(null);

    const [sRes, cRes, openRes, balRes] = await Promise.all([
      evDb.from("ev_settings")
        .select("rate_per_kwh, min_amount, max_amount, payment_window_mins, upi_vpa, upi_payee_name")
        .eq("society_id", societyId).maybeSingle(),
      evDb.from("ev_chargers_public").select("*").eq("is_active", true).order("name"),
      evDb.from("ev_sessions").select("*")
        .eq("user_id", user.id)
        .in("status", ["awaiting_payment", "awaiting_approval", "authorized", "charging"])
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      evDb.rpc<number>("ev_credit_balance", { _user: user.id }),
    ]);

    const firstError = sRes.error || cRes.error || openRes.error;
    if (firstError) { setError(firstError.message); setLoading(false); return; }

    setSettings(sRes.data as unknown as Settings);
    setChargers((cRes.data ?? []) as unknown as Charger[]);
    setSession((openRes.data as unknown as Session) ?? null);
    setCredit(Number(balRes.data ?? 0));
    setLoading(false);
  }, [societyId, user]);

  useEffect(() => { void load(); }, [load]);

  // While a session is live the charger reports progress every few
  // seconds. Polled rather than subscribed: the readings come from
  // hardware writing on its own schedule, and a missed realtime frame
  // would leave the bar frozen while the car charges.
  useEffect(() => {
    if (!session || !isSessionOpen(session.status)) return;
    const t = setInterval(() => { void load(); }, 8000);
    return () => clearInterval(t);
  }, [session, load]);

  const amountNum = Number(amount);
  const split = splitWithCredit(Number.isFinite(amountNum) ? amountNum : 0, credit);

  // Built per session with the amount already in it, so the resident
  // cannot mistype the figure at the moment of paying.
  const payLink = settings && session
    ? upiPaymentLink({
        vpa: settings.upi_vpa,
        payeeName: settings.upi_payee_name,
        amount: Number(session.amount_paid),
        note: `EV charging ${String(session.id).slice(0, 8)}`,
      })
    : null;

  const start = useCallback(async () => {
    if (!picked || !settings || !societyId || !user) return;
    const problem = validateAmount(amountNum, settings);
    if (problem) { Alert.alert(problem); return; }

    setBusy(true);
    // amount_paid carries the TOTAL to spend; the database decides how
    // much of it credit covers and what is left to pay.
    const { error: err } = await evDb.from("ev_sessions").insert({
      society_id: societyId,
      charger_id: picked.id,
      user_id: user.id,
      amount_paid: amountNum,
    });
    setBusy(false);

    if (err) {
      const busyCharger = err.message.includes("ev_sessions_one_open_per_charger");
      Alert.alert(
        busyCharger ? "That charger is already in use" : "Could not start",
        busyCharger ? "Pick another, or try again when it is free." : err.message,
      );
      return;
    }
    setPicked(null);
    await load();
  }, [picked, settings, societyId, user, amountNum, load]);

  const submitUtr = useCallback(async () => {
    if (!session) return;
    const problem = validateUtr(utr);
    if (problem) { Alert.alert(problem); return; }

    setBusy(true);
    const { error: err } = await evDb.from("ev_sessions")
      .update({ utr: normaliseUtr(utr), status: "awaiting_approval" })
      .eq("id", session.id);
    setBusy(false);

    if (err) {
      const reused = err.message.includes("ev_sessions_utr_uniq");
      Alert.alert(
        reused ? "That UTR is already used" : "Could not submit",
        reused
          ? "Each payment reference can only be used once. Check you copied the right one."
          : err.message,
      );
      return;
    }
    setUtr("");
    await load();
  }, [session, utr, load]);

  const cancel = useCallback(() => {
    if (!session) return;
    Alert.alert("Cancel this session?", "Anything already paid stays as credit.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel session",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          await evDb.from("ev_sessions").update({ status: "cancelled" }).eq("id", session.id);
          setBusy(false);
          await load();
        },
      },
    ]);
  }, [session, load]);

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.fill, styles.scrollPad]}>
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>EV charging could not be loaded</Text>
          <Text style={styles.errorBody}>{error}</Text>
        </View>
      </View>
    );
  }

  const refresh = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => { setRefreshing(true); void load().then(() => setRefreshing(false)); }}
      tintColor={colors.brand}
    />
  );

  // ── A session is in progress ────────────────────────────────────────
  if (session) {
    const charger = chargers.find((c) => c.id === session.charger_id);
    const progress = chargeProgress(session.kwh_consumed, session.energy_budget_kwh);
    const minsLeft = settings
      ? minutesLeftToPay(session.created_at, settings.payment_window_mins)
      : null;

    return (
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} refreshControl={refresh}
          keyboardShouldPersistTaps="handled">
          <View style={styles.statusCard}>
            <Text style={styles.statusLabel}>{STATUS_LABEL[session.status]}</Text>
            <Text style={styles.statusCharger}>{charger?.name ?? "Charger"}</Text>
          </View>

          {session.status === "awaiting_payment" && payLink ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Pay {formatRupees(session.amount_paid)}</Text>
              {session.credit_applied > 0 ? (
                <Text style={styles.cardMeta}>
                  {formatRupees(session.credit_applied)} covered by your credit.
                </Text>
              ) : null}
              <QrCode value={payLink} size={qrSize} caption="Scan with any UPI app" />
              {minsLeft !== null ? (
                <Text style={[styles.cardMeta, minsLeft <= 5 && styles.urgent]}>
                  {minsLeft > 0
                    ? `${minsLeft} ${minsLeft === 1 ? "minute" : "minutes"} left to pay.`
                    : "The payment window has closed."}
                </Text>
              ) : null}

              <Text style={styles.label}>Payment reference (UTR)</Text>
              <TextInput
                style={styles.input}
                value={utr}
                onChangeText={setUtr}
                placeholder="12 digits from your UPI app"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <Text style={styles.hint}>
                UPI does not tell us when you have paid, so this is how the charger knows.
                It starts once your payment is matched.
              </Text>

              <Pressable
                style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
                onPress={() => void submitUtr()}
                disabled={busy}
                accessibilityRole="button"
              >
                {busy
                  ? <ActivityIndicator color={colors.onBrand} />
                  : <Text style={styles.primaryText}>I have paid</Text>}
              </Pressable>
            </View>
          ) : null}

          {session.status === "awaiting_approval" ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Waiting for your payment to be matched</Text>
              <Text style={styles.cardMeta}>
                Reference {session.utr}. This usually takes a minute or two; a guard can
                confirm it if the bank alert is slow.
              </Text>
            </View>
          ) : null}

          {(session.status === "authorized" || session.status === "charging") ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                {session.status === "charging" ? "Charging" : "Ready — plug in"}
              </Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
              </View>
              <Text style={styles.cardMeta}>
                {formatKwh(session.kwh_consumed)} of {formatKwh(session.energy_budget_kwh)}
                {session.cost !== null ? ` · ${formatRupees(session.cost)} so far` : ""}
              </Text>
              <Text style={styles.hint}>
                It stops on its own when the energy you paid for is used.
              </Text>
            </View>
          ) : null}

          <Pressable
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            onPress={cancel}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>Cancel this session</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── No session: pick a charger ──────────────────────────────────────
  const visible = chargers.filter((c) => filter === "all" || c.vehicle_type === filter);

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={refresh}
        keyboardShouldPersistTaps="handled">
        {credit > 0 ? (
          <View style={styles.creditBanner}>
            <Text style={styles.creditText}>
              {formatRupees(credit)} credit will be used first.
            </Text>
          </View>
        ) : null}

        <View style={styles.chips}>
          {([["all", "All"], ["four_wheeler", VEHICLE_LABEL.four_wheeler],
            ["two_wheeler", VEHICLE_LABEL.two_wheeler]] as const).map(([value, label]) => (
            <Pressable
              key={value}
              style={({ pressed }) => [
                styles.chip, filter === value && styles.chipOn, pressed && styles.pressed,
              ]}
              onPress={() => setFilter(value as "all" | VehicleType)}
              accessibilityRole="button"
            >
              <Text style={[styles.chipText, filter === value && styles.chipTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {visible.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No chargers</Text>
            <Text style={styles.emptyBody}>
              {chargers.length === 0
                ? "Your society has not set up EV charging yet."
                : "None of that type. Try another filter."}
            </Text>
          </View>
        ) : visible.map((c) => {
          const free = isChargerAvailable(c);
          const chosen = picked?.id === c.id;
          return (
            <Pressable
              key={c.id}
              style={({ pressed }) => [
                styles.chargerRow,
                chosen && styles.chargerChosen,
                !free && styles.chargerBusy,
                pressed && styles.pressed,
              ]}
              onPress={() => free && setPicked(chosen ? null : c)}
              disabled={!free}
              accessibilityRole="button"
            >
              <View style={styles.flex}>
                <Text style={styles.chargerName}>{c.name}</Text>
                <Text style={styles.chargerMeta}>
                  {VEHICLE_LABEL[c.vehicle_type]}
                  {c.location ? ` · ${c.location}` : ""}
                </Text>
              </View>
              <Text style={[styles.chargerState, free ? styles.free : styles.inUse]}>
                {free ? (chosen ? "Selected" : "Free") : "In use"}
              </Text>
            </Pressable>
          );
        })}

        {picked && settings ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>How much to charge?</Text>
            <Text style={styles.cardMeta}>
              {formatRupees(settings.rate_per_kwh)} per unit · between{" "}
              {formatRupees(settings.min_amount)} and {formatRupees(settings.max_amount)}
            </Text>

            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={(t) => setAmount(t.replace(/\D/g, "").slice(0, 5))}
              placeholder="100"
              placeholderTextColor={colors.textFaint}
              inputMode="numeric"
              keyboardType="number-pad"
            />

            {split.creditApplied > 0 ? (
              <Text style={styles.hint}>
                {formatRupees(split.creditApplied)} from credit,{" "}
                {formatRupees(split.cashToPay)} to pay now.
              </Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              onPress={() => void start()}
              disabled={busy}
              accessibilityRole="button"
            >
              {busy
                ? <ActivityIndicator color={colors.onBrand} />
                : <Text style={styles.primaryText}>Start at {picked.name}</Text>}
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  centre: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl, flexGrow: 1 },
  scrollPad: { padding: space.lg },
  pressed: { opacity: 0.75 },

  statusCard: {
    padding: space.lg, alignItems: "center", gap: space.xs,
    backgroundColor: colors.brandBg,
    borderWidth: 1, borderColor: colors.brand, borderRadius: radius.lg,
  },
  statusLabel: { color: colors.text, fontSize: type.title, fontWeight: "800" },
  statusCharger: { color: colors.textMuted, fontSize: type.label },

  card: {
    padding: space.lg, gap: space.sm, alignItems: "stretch",
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
  },
  cardTitle: { color: colors.text, fontSize: type.heading, fontWeight: "700", textAlign: "center" },
  cardMeta: { color: colors.textMuted, fontSize: type.label, textAlign: "center" },
  urgent: { color: colors.dangerInk, fontWeight: "700" },

  label: { color: colors.text, fontSize: type.label, fontWeight: "600", marginTop: space.md },
  hint: { color: colors.textMuted, fontSize: type.caption },
  input: {
    minHeight: TOUCH,
    backgroundColor: colors.background,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: space.md, color: colors.text, fontSize: type.heading,
  },

  primary: {
    minHeight: TOUCH, borderRadius: radius.md, marginTop: space.sm,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  primaryText: { color: colors.onBrand, fontSize: type.body, fontWeight: "800" },
  secondary: {
    minHeight: TOUCH, borderRadius: radius.md, marginTop: space.md,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  secondaryText: { color: colors.textMuted, fontSize: type.label, fontWeight: "700" },

  progressTrack: {
    height: 10, borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised, overflow: "hidden",
  },
  progressFill: { height: 10, backgroundColor: colors.success },

  creditBanner: {
    padding: space.md, borderRadius: radius.md,
    backgroundColor: colors.successBg,
    borderWidth: 1, borderColor: colors.success,
  },
  creditText: { color: colors.text, fontSize: type.label, fontWeight: "600" },

  chargerRow: {
    flexDirection: "row", alignItems: "center", gap: space.md,
    padding: space.md, minHeight: TOUCH,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  chargerChosen: { borderWidth: 2, borderColor: colors.brand, backgroundColor: colors.brandBg },
  chargerBusy: { opacity: 0.6 },
  chargerName: { color: colors.text, fontSize: type.body, fontWeight: "700" },
  chargerMeta: { color: colors.textMuted, fontSize: type.caption, marginTop: 2 },
  chargerState: { fontSize: type.caption, fontWeight: "700" },
  free: { color: colors.successInk },
  inUse: { color: colors.textMuted },

  errorBox: {
    padding: space.lg, gap: space.xs, borderRadius: radius.md,
    backgroundColor: colors.dangerBg,
    borderWidth: 1, borderColor: colors.danger,
  },
  errorTitle: { color: colors.text, fontSize: type.body, fontWeight: "700" },
  errorBody: { color: colors.textMuted, fontSize: type.caption },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  emptyTitle: { color: colors.text, fontSize: type.heading, fontWeight: "700" },
  emptyBody: { color: colors.textMuted, fontSize: type.label, textAlign: "center" },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingVertical: space.xs },
  chip: {
    minHeight: 40, justifyContent: "center", paddingHorizontal: space.lg,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.text, fontSize: type.label, fontWeight: "600" },
  chipTextOn: { color: colors.onBrand },
});

export default EvChargingScreen;
