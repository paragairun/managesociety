import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Image, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, Vibration, View,
} from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  deliveryIcon, deliveryLabel, statusDisplay, minutesLeft, groupVisits,
  flatMatchFilter, decideDelivery, decisionFailed,
  RECENT_WINDOW_MS,
  type DeliveryVisit, type StatusTone, type ResidentFlat,
} from "@core/deliveries";
import { can } from "@core/residentAccess";
import { colors, radius, space, TOUCH, TOUCH_URGENT, type } from "@/theme";

const TONE_COLOR: Record<StatusTone, string> = {
  waiting: colors.warningInk,
  good: colors.successInk,
  bad: colors.dangerInk,
  done: colors.textMuted,
};

/**
 * How the phone nags while somebody is standing at the gate.
 *
 * A repeating vibration rather than a looping ringtone. The website
 * builds a phone-ring out of Web Audio because a browser tab has
 * nothing better; a native app does not need to, and the resident was
 * explicit that the ring itself was never the point. The notification
 * channel handles the case that actually matters — phone in a pocket,
 * app closed — and this is only for when the screen is already open,
 * where a buzz every few seconds is enough and a siren would be rude.
 *
 * Pattern: wait 0ms, buzz 400ms, pause 1600ms, repeated.
 */
const NAG_PATTERN = [0, 400, 1600];

interface Props {
  /** True when the screen opened from a notification tap. */
  fromNotification?: boolean;
}

const DeliveriesScreen = ({ fromNotification }: Props) => {
  const { user, societyId, identity } = useAuth();

  const [visits, setVisits] = useState<DeliveryVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flats, setFlats] = useState<ResidentFlat[]>([]);
  const [noFlats, setNoFlats] = useState(false);

  const nagging = useRef(false);

  const load = useCallback(async () => {
    if (!user || !societyId) return;

    // A delivery belongs to a FLAT, not to a person: a resident with two
    // flats answers for both, and a tenant answers for the one they live
    // in. So the query is driven by resident_flats rather than user id.
    const { data: flatRows } = await supabase
      .from("resident_flats")
      .select("wing, flat_number")
      .eq("user_id", user.id);

    const mine = (flatRows ?? []) as ResidentFlat[];
    setFlats(mine);

    const filter = flatMatchFilter(mine);
    if (!filter) {
      // No flats: show nothing and say why, rather than falling through
      // to an unfiltered query that would list the whole society.
      setNoFlats(true);
      setVisits([]);
      setLoading(false);
      return;
    }
    setNoFlats(false);

    const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
    const { data } = await supabase
      .from("delivery_visits")
      .select("*")
      .eq("society_id", societyId)
      .or(filter)
      .gte("entry_time", since)
      .not("status", "in", '("completed","expired")')
      .order("entry_time", { ascending: false });

    setVisits((data ?? []) as DeliveryVisit[]);
    setLoading(false);
  }, [user, societyId]);

  useEffect(() => { void load(); }, [load]);

  // Live, not polled. Someone is standing at the gate; a ten-second
  // poll is ten seconds of them standing there after the guard has
  // already registered them.
  useEffect(() => {
    if (!societyId) return;
    const channel = supabase
      .channel("resident-deliveries")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "delivery_visits", filter: `society_id=eq.${societyId}` },
        () => { void load(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [societyId, load]);

  const { pending, approved, rejected, total } = groupVisits(visits);

  // Buzz while anything is pending and this screen is on top; stop the
  // moment it is answered or the resident leaves.
  useEffect(() => {
    const shouldNag = pending.length > 0;
    if (shouldNag && !nagging.current) {
      nagging.current = true;
      Vibration.vibrate(NAG_PATTERN, true);
    } else if (!shouldNag && nagging.current) {
      nagging.current = false;
      Vibration.cancel();
    }
    return () => {
      if (nagging.current) {
        nagging.current = false;
        Vibration.cancel();
      }
    };
  }, [pending.length]);

  const decide = useCallback(async (visit: DeliveryVisit, approve: boolean) => {
    if (!can(identity, "decideDelivery")) return;
    setBusyId(visit.id);
    const result = await decideDelivery(
      {
        async setDecision(visitId, status, decidedBy) {
          const { error } = await supabase
            .from("delivery_visits")
            .update({ status, approved_by: decidedBy })
            .eq("id", visitId);
          return error?.message ?? null;
        },
      },
      visit.id,
      approve,
      user?.id ?? null,
    );
    setBusyId(null);

    if (decisionFailed(result)) {
      Alert.alert(approve ? "Could not approve" : "Could not reject", result.error);
      return;
    }
    await load();
  }, [identity, user?.id, load]);

  const confirmReject = (visit: DeliveryVisit) => {
    Alert.alert(
      "Turn this delivery away?",
      `${deliveryLabel(visit.delivery_type)} for ${[visit.wing, visit.flat_number].filter(Boolean).join("-")} will be refused at the gate.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Reject", style: "destructive", onPress: () => void decide(visit, false) },
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

  const Card = ({ v, urgent }: { v: DeliveryVisit; urgent: boolean }) => {
    const status = statusDisplay(v.status);
    const left = minutesLeft(v.expires_at);
    return (
      <View style={[
        styles.card,
        urgent && styles.cardUrgent,
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
            {v.agent_name ? <Text style={styles.cardMeta}>{v.agent_name}</Text> : null}
            <Text style={styles.cardMeta}>{v.mobile}</Text>
            <Text style={styles.cardMeta}>
              {[v.wing, v.flat_number].filter(Boolean).join("-")} · arrived{" "}
              {new Date(v.entry_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </Text>
          </View>
        </View>

        {urgent ? (
          <>
            {left > 0 ? (
              <Text style={styles.expiry}>
                Expires in {left} {left === 1 ? "minute" : "minutes"} if nobody answers.
              </Text>
            ) : (
              <Text style={styles.expiry}>This request is about to expire.</Text>
            )}

            {can(identity, "decideDelivery") ? (
              <View style={styles.actions}>
                <Pressable
                  style={({ pressed }) => [styles.reject, pressed && styles.pressed]}
                  onPress={() => confirmReject(v)}
                  disabled={busyId === v.id}
                  accessibilityRole="button"
                >
                  <Text style={styles.rejectText}>Reject</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.approve, pressed && styles.pressed]}
                  onPress={() => void decide(v, true)}
                  disabled={busyId === v.id}
                  accessibilityRole="button"
                >
                  {busyId === v.id
                    ? <ActivityIndicator color={colors.onSuccess} />
                    : <Text style={styles.approveText}>Approve</Text>}
                </Pressable>
              </View>
            ) : null}
          </>
        ) : (
          <Text style={[styles.status, { color: TONE_COLOR[status.tone] }]}>{status.label}</Text>
        )}
      </View>
    );
  };

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
      {noFlats ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No flat on this account</Text>
          <Text style={styles.emptyBody}>
            Deliveries are matched to your flat. Ask your committee to add yours.
          </Text>
        </View>
      ) : null}

      {pending.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.waitingTitle}>
            {pending.length === 1
              ? "Someone is at the gate"
              : `${pending.length} people are at the gate`}
          </Text>
          {pending.map((v) => <Card key={v.id} v={v} urgent />)}
        </View>
      ) : null}

      {approved.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Let in</Text>
          {approved.map((v) => <Card key={v.id} v={v} urgent={false} />)}
        </View>
      ) : null}

      {rejected.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Turned away</Text>
          {rejected.map((v) => <Card key={v.id} v={v} urgent={false} />)}
        </View>
      ) : null}

      {total === 0 && !noFlats ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing waiting</Text>
          <Text style={styles.emptyBody}>
            {fromNotification
              ? "This one has already been dealt with — someone else in your flat may have answered it."
              : "When a delivery arrives at the gate you will be asked here, and your phone will ring."}
          </Text>
          {flats.length > 0 ? (
            <Text style={styles.emptyFlats}>
              Watching {flats.map((f) => [f.wing, f.flat_number].filter(Boolean).join("-")).join(", ")}
            </Text>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  centre: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl, flexGrow: 1 },
  pressed: { opacity: 0.75 },

  section: { gap: space.sm },
  sectionTitle: { color: colors.textMuted, fontSize: type.label, fontWeight: "700" },
  waitingTitle: { color: colors.text, fontSize: type.title, fontWeight: "800" },

  card: {
    padding: space.md, gap: space.sm,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  cardUrgent: {
    borderWidth: 2, borderColor: colors.warning,
    backgroundColor: colors.warningBg,
    padding: space.lg,
  },
  cardGood: { borderColor: colors.success, backgroundColor: colors.successBg },
  cardBad: { borderColor: colors.danger, backgroundColor: colors.dangerBg },

  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  cardTitle: { color: colors.text, fontSize: type.heading, fontWeight: "700" },
  cardMeta: { color: colors.textMuted, fontSize: type.label, marginTop: 2 },
  status: { fontSize: type.label, fontWeight: "700" },
  expiry: { color: colors.text, fontSize: type.label },

  photo: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised },
  photoFallback: {
    width: 64, height: 64, borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center", justifyContent: "center",
  },
  photoIcon: { fontSize: 30 },

  // Gate-sized, on a resident's phone: somebody is physically waiting on
  // this, and a mis-tap turns a delivery agent away.
  actions: { flexDirection: "row", gap: space.lg, marginTop: space.xs },
  reject: {
    flex: 1, minHeight: TOUCH_URGENT, borderRadius: radius.md,
    borderWidth: 2, borderColor: colors.danger,
    alignItems: "center", justifyContent: "center",
  },
  rejectText: { color: colors.dangerInk, fontSize: type.heading, fontWeight: "700" },
  approve: {
    flex: 2, minHeight: TOUCH_URGENT, borderRadius: radius.md,
    backgroundColor: colors.success,
    alignItems: "center", justifyContent: "center",
  },
  approveText: { color: colors.onSuccess, fontSize: type.heading, fontWeight: "800" },

  empty: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: space.sm, paddingVertical: space.xxl, minHeight: TOUCH * 4,
  },
  emptyTitle: { color: colors.text, fontSize: type.heading, fontWeight: "700" },
  emptyBody: { color: colors.textMuted, fontSize: type.label, textAlign: "center" },
  emptyFlats: { color: colors.textFaint, fontSize: type.caption, marginTop: space.sm },
});

export default DeliveriesScreen;
