import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { supabase } from "@/lib/supabase";
import {
  parseStoredStructure, allWings, flatsForWing, towerForWing,
  type NormalizedTower, type NormalizedStructure,
} from "@core/societyStructure";
import { colors, radius, space, TOUCH, type } from "@/theme";

interface Props {
  societyId: string | null;
  wing: string;
  flatNumber: string;
  onChange: (wing: string, flatNumber: string) => void;
}

/** How many flat chips to show before asking the guard to narrow it down. */
const MAX_CHIPS = 24;

/**
 * Tower → Wing → Flat, from the society's configured structure.
 *
 * Deliberately chips rather than dropdowns. A dropdown on Android opens
 * a modal over a modal, and the guard is already inside the delivery
 * form — two taps and a dismiss animation to choose a wing, with the
 * soft keyboard fighting for the same space. Chips are one tap and
 * never move the layout.
 *
 * Societies onboarded before the structure builder have no towers at
 * all, so this falls back to two plain text fields — which is what
 * their guards have always used.
 */
const FlatPicker = ({ societyId, wing, flatNumber, onChange }: Props) => {
  const [towers, setTowers] = useState<NormalizedTower[]>([]);
  const [loading, setLoading] = useState(true);
  const [tower, setTower] = useState<string | null>(null);
  const [flatFilter, setFlatFilter] = useState("");

  useEffect(() => {
    if (!societyId) { setTowers([]); setLoading(false); return; }
    let active = true;
    void supabase
      .from("society_structure")
      .select("structure")
      .eq("society_id", societyId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        setLoading(false);
        if (error) { setTowers([]); return; }
        setTowers(parseStoredStructure(
          data?.structure as unknown as NormalizedStructure | NormalizedTower[] | null,
        ));
      });
    return () => { active = false; };
  }, [societyId]);

  // Keep the tower in step with a wing set from outside (a reset, say).
  useEffect(() => {
    setTower(wing ? towerForWing(towers, wing) ?? null : null);
  }, [wing, towers]);

  const towerNames = useMemo(() => towers.map((t) => t.tower_name), [towers]);
  const wingsHere = useMemo(
    () => allWings(towers).filter((w) => w.tower_name === tower).map((w) => w.wing),
    [towers, tower],
  );
  const flats = useMemo(() => (wing ? flatsForWing(towers, wing) : []), [towers, wing]);
  const shownFlats = useMemo(() => {
    const q = flatFilter.trim();
    const matching = q ? flats.filter((f) => f.includes(q)) : flats;
    return matching.slice(0, MAX_CHIPS);
  }, [flats, flatFilter]);

  if (loading) {
    return <ActivityIndicator color={colors.brand} style={styles.loading} />;
  }

  // Legacy societies: free text, upper-cased, same as the website.
  if (towers.length === 0) {
    return (
      <View style={styles.freeRow}>
        <View style={styles.freeCol}>
          <Text style={styles.subLabel}>Wing</Text>
          <TextInput
            style={styles.input}
            value={wing}
            onChangeText={(t) => onChange(t.toUpperCase(), flatNumber)}
            placeholder="A"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </View>
        <View style={styles.freeCol}>
          <Text style={styles.subLabel}>Flat number</Text>
          <TextInput
            style={styles.input}
            value={flatNumber}
            onChangeText={(t) => onChange(wing, t.toUpperCase())}
            placeholder="1201"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.subLabel}>Tower</Text>
      <ChipRow
        options={towerNames}
        selected={tower}
        onSelect={(t) => { setTower(t); setFlatFilter(""); onChange("", ""); }}
      />

      {tower ? (
        <>
          <Text style={styles.subLabel}>Wing</Text>
          <ChipRow
            options={wingsHere}
            selected={wing || null}
            onSelect={(w) => { setFlatFilter(""); onChange(w, ""); }}
          />
        </>
      ) : null}

      {wing ? (
        <>
          <Text style={styles.subLabel}>Flat</Text>
          {flatNumber ? (
            <Pressable style={styles.chosen} onPress={() => onChange(wing, "")}>
              <Text style={styles.chosenText}>{wing}-{flatNumber}</Text>
              <Text style={styles.chosenChange}>change</Text>
            </Pressable>
          ) : (
            <>
              {flats.length > MAX_CHIPS ? (
                <TextInput
                  style={styles.input}
                  value={flatFilter}
                  onChangeText={setFlatFilter}
                  placeholder={`Type to narrow ${flats.length} flats`}
                  placeholderTextColor={colors.textFaint}
                  inputMode="numeric"
                  autoCorrect={false}
                />
              ) : null}
              <ChipRow
                options={shownFlats}
                selected={null}
                onSelect={(f) => onChange(wing, f)}
                wrap
              />
              {shownFlats.length === 0 ? (
                <Text style={styles.note}>No flat matches that.</Text>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </View>
  );
};

const ChipRow = ({ options, selected, onSelect, wrap }: {
  options: string[];
  selected: string | null;
  onSelect: (value: string) => void;
  wrap?: boolean;
}) => {
  const chips = options.map((o) => (
    <Pressable
      key={o}
      style={({ pressed }) => [
        styles.chip,
        selected === o && styles.chipOn,
        pressed && styles.pressed,
      ]}
      onPress={() => onSelect(o)}
      accessibilityRole="button"
    >
      <Text style={[styles.chipText, selected === o && styles.chipTextOn]}>{o}</Text>
    </Pressable>
  ));

  // Wrapped for flats, where there may be two dozen and scrolling
  // sideways past them is slower than reading a block.
  if (wrap) return <View style={styles.chipWrap}>{chips}</View>;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipScroll}
      keyboardShouldPersistTaps="handled"
    >
      {chips}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  loading: { marginVertical: space.lg },
  subLabel: { color: colors.textMuted, fontSize: type.caption, marginTop: space.sm },
  note: { color: colors.textFaint, fontSize: type.caption },
  pressed: { opacity: 0.75 },

  freeRow: { flexDirection: "row", gap: space.md },
  freeCol: { flex: 1, gap: space.xs },

  input: {
    minHeight: TOUCH,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: space.md, color: colors.text, fontSize: type.body,
  },

  chipScroll: { gap: space.sm, paddingVertical: space.xs },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingVertical: space.xs },
  chip: {
    minHeight: 44, justifyContent: "center",
    paddingHorizontal: space.lg,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.text, fontSize: type.body, fontWeight: "600" },
  chipTextOn: { color: colors.onBrand },

  chosen: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    minHeight: TOUCH, paddingHorizontal: space.lg,
    backgroundColor: colors.successBg,
    borderWidth: 1, borderColor: colors.success, borderRadius: radius.md,
  },
  chosenText: { color: colors.text, fontSize: type.heading, fontWeight: "700" },
  chosenChange: { color: colors.brand, fontSize: type.label, fontWeight: "700" },
});

export default FlatPicker;
