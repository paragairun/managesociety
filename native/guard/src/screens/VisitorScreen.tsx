import { useCallback } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { gateActions, visitorFormUrl, type GateAction } from "@core/visitorForm";
import { colors, radius, space, TOUCH, type } from "@/theme";

interface Props {
  /** Open the scanner. Supplied by the shell, which owns navigation. */
  onScan: () => void;
}

/**
 * Somebody is at the gate with no delivery.
 *
 * Two routes in, and the guard needs both within one tap:
 *
 *   PRE-APPROVED — a resident made them a guest pass in advance and
 *   they have the QR on their phone. Scan it, barrier opens.
 *
 *   IMPROMPTU — they have simply turned up. Nothing to scan, so their
 *   details go on the society's visitor form and the flat is asked
 *   from there.
 *
 * Which options exist comes from @core/visitorForm: a society on RFID
 * boom barriers gets no scan button, because nobody there scans
 * anything and a dead button at a gate is worse than a missing one.
 */
const VisitorScreen = ({ onScan }: Props) => {
  const { societySlug, societyName, gateEntryMode } = useAuth();

  const formUrl = visitorFormUrl(societySlug);
  const actions = gateActions({ gateEntryMode, formUrl });

  const openForm = useCallback(async () => {
    if (!formUrl) return;
    const can = await Linking.canOpenURL(formUrl);
    if (!can) {
      Alert.alert("Could not open the form", "No browser on this device can open it.");
      return;
    }
    await Linking.openURL(formUrl);
  }, [formUrl]);

  const run = (id: GateAction) => {
    if (id === "scan") onScan();
    else void openForm();
  };

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.scroll}>
      <Text style={styles.lead}>Who is at the gate?</Text>

      {actions.length === 0 ? (
        // RFID and no society slug. Rare, but the screen has to say
        // something rather than be an empty space.
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing to do here yet</Text>
          <Text style={styles.emptyBody}>
            {societyName ?? "This society"} has no visitor form set up, and entry is by
            RFID rather than QR. Ask your committee to finish the society's setup.
          </Text>
        </View>
      ) : actions.map((action) => (
        <Pressable
          key={action.id}
          style={({ pressed }) => [
            styles.option,
            action.id === "scan" && styles.optionPrimary,
            pressed && styles.pressed,
          ]}
          onPress={() => run(action.id)}
          accessibilityRole="button"
        >
          <Text style={[
            styles.optionTitle,
            action.id === "scan" && styles.optionTitlePrimary,
          ]}>
            {action.title}
          </Text>
          <Text style={[
            styles.optionSubtitle,
            action.id === "scan" && styles.optionSubtitlePrimary,
          ]}>
            {action.subtitle}
          </Text>
        </Pressable>
      ))}

      {formUrl ? (
        <Text style={styles.note}>
          The visitor form opens in the browser. A visitor can also fill it in
          themselves — send them the link while they are walking up.
        </Text>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: space.lg, gap: space.md, paddingBottom: space.xxl, flexGrow: 1 },
  pressed: { opacity: 0.75 },

  lead: { color: colors.text, fontSize: type.title, fontWeight: "700" },

  option: {
    padding: space.xl, gap: space.xs, minHeight: TOUCH + space.xl,
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
  },
  optionPrimary: { backgroundColor: colors.brand, borderColor: colors.brand },
  optionTitle: { color: colors.text, fontSize: type.title, fontWeight: "800" },
  optionTitlePrimary: { color: colors.onBrand },
  optionSubtitle: { color: colors.textMuted, fontSize: type.label },
  optionSubtitlePrimary: { color: colors.onBrand, opacity: 0.85 },

  note: { color: colors.textMuted, fontSize: type.caption, marginTop: space.md },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  emptyTitle: { color: colors.text, fontSize: type.heading, fontWeight: "700" },
  emptyBody: { color: colors.textMuted, fontSize: type.label, textAlign: "center" },
});

export default VisitorScreen;
