import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { supabase } from "@/lib/supabase";
import {
  money, outstanding, totalOutstanding, billState, periodLabel, dueLabel,
  type Bill, type DueTone,
} from "@core/dues";
import { colors, radius, space, TOUCH, type } from "@/theme";

interface LineItem {
  id: string;
  bill_id: string;
  description: string;
  amount: number;
}

interface Payment {
  id: string;
  bill_id: string;
  amount: number;
  payment_date: string;
  /** "upi", "cash", "cheque", "bank_transfer", "other". */
  payment_method: string;
  reference_number: string | null;
}

/** The stored method, as a person would say it. */
const METHOD_LABEL: Record<string, string> = {
  upi: "UPI",
  cash: "Cash",
  cheque: "Cheque",
  bank_transfer: "Bank transfer",
  other: "Other",
};
const paymentMethod = (value: string): string => METHOD_LABEL[value] ?? value;

const TONE_COLOR: Record<DueTone, string> = {
  paid: colors.successInk,
  partial: colors.warningInk,
  due: colors.textMuted,
  late: colors.dangerInk,
};

/**
 * What the flat owes, and what it was for.
 *
 * The total comes first and large, because that is the question. Each
 * bill then opens to show its line items and any payments recorded
 * against it — the two things a resident asks when a number looks
 * wrong, and the two the committee gets phoned about.
 *
 * No filtering by flat here. RLS already scopes maintenance_bills to
 * the resident's own flats, including through a parent lookup for a
 * family or tenant login, so a filter in the app would either duplicate
 * that or quietly contradict it.
 */
const DuesScreen = () => {
  const [bills, setBills] = useState<Bill[]>([]);
  const [lineItems, setLineItems] = useState<Record<string, LineItem[]>>({});
  const [payments, setPayments] = useState<Record<string, Payment[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data: billRows } = await supabase
      .from("maintenance_bills")
      .select("*")
      .order("billing_period_start", { ascending: false });

    const list = (billRows ?? []) as Bill[];
    setBills(list);

    if (list.length > 0) {
      const ids = list.map((b) => b.id);
      const [items, pays] = await Promise.all([
        supabase.from("maintenance_bill_line_items").select("*").in("bill_id", ids),
        supabase.from("maintenance_payments").select("*").in("bill_id", ids)
          .order("payment_date", { ascending: false }),
      ]);

      const byBill: Record<string, LineItem[]> = {};
      for (const li of (items.data ?? []) as LineItem[]) {
        (byBill[li.bill_id] ??= []).push(li);
      }
      setLineItems(byBill);

      const paysByBill: Record<string, Payment[]> = {};
      for (const p of (pays.data ?? []) as Payment[]) {
        (paysByBill[p.bill_id] ??= []).push(p);
      }
      setPayments(paysByBill);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  const total = totalOutstanding(bills);

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
      <View style={[styles.totalCard, total > 0 ? styles.totalDue : styles.totalClear]}>
        <Text style={styles.totalLabel}>
          {total > 0 ? "Outstanding" : "Nothing outstanding"}
        </Text>
        {total > 0 ? (
          <Text style={[styles.totalAmount, { color: colors.dangerInk }]}>{money(total)}</Text>
        ) : (
          <Text style={[styles.totalAmount, { color: colors.successInk }]}>All paid</Text>
        )}
      </View>

      {bills.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No bills yet</Text>
          <Text style={styles.emptyBody}>
            Maintenance bills appear here as the committee issues them.
          </Text>
        </View>
      ) : bills.map((bill) => {
        const state = billState(bill);
        const left = outstanding(bill);
        const isOpen = expanded === bill.id;
        const items = lineItems[bill.id] ?? [];
        const paid = payments[bill.id] ?? [];

        return (
          <View key={bill.id} style={styles.card}>
            <Pressable
              style={({ pressed }) => [styles.cardHead, pressed && styles.pressed]}
              onPress={() => setExpanded(isOpen ? null : bill.id)}
              accessibilityRole="button"
            >
              <View style={styles.flex}>
                <Text style={styles.period}>{periodLabel(bill)}</Text>
                <Text style={styles.meta}>
                  {[bill.wing, bill.flat_number].filter(Boolean).join("-")} · {dueLabel(bill)}
                </Text>
                <Text style={[styles.state, { color: TONE_COLOR[state.tone] }]}>{state.label}</Text>
              </View>
              <View style={styles.amounts}>
                <Text style={styles.total}>{money(bill.total_amount)}</Text>
                {left > 0 && left !== bill.total_amount ? (
                  <Text style={styles.left}>{money(left)} left</Text>
                ) : null}
                <Text style={styles.chevron}>{isOpen ? "Hide" : "Details"}</Text>
              </View>
            </Pressable>

            {isOpen ? (
              <View style={styles.detail}>
                {items.length > 0 ? (
                  <>
                    <Text style={styles.detailTitle}>What this covers</Text>
                    {items.map((li) => (
                      <View key={li.id} style={styles.detailRow}>
                        <Text style={styles.detailText}>{li.description}</Text>
                        <Text style={styles.detailAmount}>{money(li.amount)}</Text>
                      </View>
                    ))}
                  </>
                ) : (
                  <Text style={styles.detailNote}>No breakdown was recorded for this bill.</Text>
                )}

                {paid.length > 0 ? (
                  <>
                    <Text style={[styles.detailTitle, styles.detailSpaced]}>Payments received</Text>
                    {paid.map((p) => (
                      <View key={p.id} style={styles.detailRow}>
                        <Text style={styles.detailText}>
                          {new Date(p.payment_date).toLocaleDateString("en-IN", {
                            day: "numeric", month: "short", year: "numeric",
                          })}
                          {p.payment_method ? ` · ${paymentMethod(p.payment_method)}` : ""}
                          {p.reference_number ? ` · ${p.reference_number}` : ""}
                        </Text>
                        <Text style={[styles.detailAmount, { color: colors.successInk }]}>
                          {money(p.amount)}
                        </Text>
                      </View>
                    ))}
                  </>
                ) : null}

                {left > 0 ? (
                  <Text style={styles.payNote}>
                    Pay the committee directly — this app records payments, it does not take them.
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  centre: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl, flexGrow: 1 },
  pressed: { opacity: 0.75 },

  totalCard: {
    padding: space.xl, alignItems: "center", gap: space.xs,
    borderRadius: radius.lg, borderWidth: 1,
  },
  totalDue: { backgroundColor: colors.dangerBg, borderColor: colors.danger },
  totalClear: { backgroundColor: colors.successBg, borderColor: colors.success },
  totalLabel: { color: colors.textMuted, fontSize: type.label },
  totalAmount: { fontSize: 36, fontWeight: "800" },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    overflow: "hidden",
  },
  cardHead: {
    flexDirection: "row", alignItems: "flex-start", gap: space.md,
    padding: space.md, minHeight: TOUCH,
  },
  period: { color: colors.text, fontSize: type.body, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: type.caption, marginTop: 2 },
  state: { fontSize: type.caption, fontWeight: "700", marginTop: 2 },
  amounts: { alignItems: "flex-end" },
  total: { color: colors.text, fontSize: type.body, fontWeight: "700" },
  left: { color: colors.dangerInk, fontSize: type.caption, marginTop: 2 },
  chevron: { color: colors.brandInk, fontSize: type.caption, fontWeight: "700", marginTop: space.xs },

  detail: {
    padding: space.md, gap: space.xs,
    borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.muted,
  },
  detailTitle: { color: colors.text, fontSize: type.caption, fontWeight: "700" },
  detailSpaced: { marginTop: space.md },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  detailText: { color: colors.textMuted, fontSize: type.label, flex: 1 },
  detailAmount: { color: colors.text, fontSize: type.label, fontWeight: "600" },
  detailNote: { color: colors.textMuted, fontSize: type.label },
  payNote: {
    color: colors.textMuted, fontSize: type.caption,
    marginTop: space.md, fontStyle: "italic",
  },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  emptyTitle: { color: colors.text, fontSize: type.heading, fontWeight: "700" },
  emptyBody: { color: colors.textMuted, fontSize: type.label, textAlign: "center" },
});

export default DuesScreen;
