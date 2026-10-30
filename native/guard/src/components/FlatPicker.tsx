import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { supabase } from "@/lib/supabase";
import {
  parseStoredStructure, allWings, flatsForWing, towerForWing, structureFields,
  type NormalizedTower, type NormalizedStructure,
} from "@core/societyStructure";
import { colors, radius, space, TOUCH, type } from "@/theme";

interface Props {
  societyId: string | null;
  wing: string;
  flatNumber: string;
  onChange: (wing: string, flatNumber: string) => void;
}

/**
 * Above this many flats, a filter box appears above the list.
 *
 * The list itself is never truncated — every flat is always reachable
 * by scrolling. An earlier version capped it at 24 and left the rest
 * unreachable unless the guard typed, which at a gate means a guard who
 * does not know a filter is needed simply cannot find flat 1204.
 */
const FILTER_ABOVE = 24;

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
  const flats = useMemo(() => {
    if (wing) return flatsForWing(towers, wing);
    // A society with one wing hides the wing picker entirely, so there
    // is no wing selected to list flats for. Fall back to the only
    // wing there is, which is what the guard means.
    const only = allWings(towers);
    return only.length === 1 ? flatsForWing(towers, only[0].wing) : [];
  }, [towers, wing]);

  const shownFlats = useMemo(() => {
    const q = flatFilter.trim();
    // Filtered, never truncated. Every flat stays reachable by
    // scrolling, because a guard who does not know a filter exists
    // must still be able to find flat 1204.
    return q ? flats.filter((f) => f.includes(q)) : flats;
  }, [flats, flatFilter]);

  const fields = structureFields(towers);

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

  // A society with one tower, or one wing, does not get a picker for
  // it: that is a dropdown with one option that a guard taps past at
  // every gate entry. structureFields decides, from the same rule the
  // website and the resident app use.
  const needsTower = fields.tower;
  const needsWing = fields.wing;

  // With no pickers above it, the flat list is the whole control and
  // should be shown immediately rather than waiting on a wing.
  const showFlats = (!needsWing && !needsTower) || !!wing;

  /**
   * The wing to SAVE, which is not always the one shown.
   *
   * A single-wing society hides the picker, but entry_logs,
   * delivery_visits and the flats table all still carry a wing, and the
   * guard app must not write an empty one — that flat would then match
   * nothing when a resident's app looks for its own deliveries. So the
   * only wing there is gets filled in silently.
   */
  const soleWing = allWings(towers).length === 1 ? allWings(towers)[0].wing : "";
  const wingToSave = wing || soleWing;

  return (
    <View style={styles.wrap}>
      {needsTower ? (
        <>
          <Text style={styles.subLabel}>Tower</Text>
          <ChipRow
            options={towerNames}
            selected={tower}
            onSelect={(t) => { setTower(t); setFlatFilter(""); onChange("", ""); }}
          />
        </>
      ) : null}

      {needsWing && (tower || !needsTower) ? (
        <>
          <Text style={styles.subLabel}>Wing</Text>
          <ChipRow
            options={needsTower ? wingsHere : allWings(towers).map((w) => w.wing)}
            selected={wing || null}
            onSelect={(w) => { setFlatFilter(""); onChange(w, ""); }}
          />
        </>
      ) : null}

      {showFlats ? (
        <>
          <Text style={styles.subLabel}>Flat</Text>
          {flatNumber ? (
            <Pressable style={styles.chosen} onPress={() => onChange(wingToSave, "")}>
              <Text style={styles.chosenText}>
                {needsWing && wingToSave ? `${wingToSave}-${flatNumber}` : flatNumber}
              </Text>
              <Text style={styles.chosenChange}>change</Text>
            </Pressable>
          ) : (
            <>
              {flats.length > FILTER_ABOVE ? (
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
                onSelect={(f) => onChange(wingToSave, f)}
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
  chosenChange: { color: colors.brandInk, fontSize: type.label, fontWeight: "700" },
});

export default FlatPicker;
