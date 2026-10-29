import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import { makeGatePorts } from "@core/gatePorts";
import { resolveGateScan, describeOutcome, type GateScanOutcome } from "@core/gateScan";
import { colors, radius, space, TOUCH, type } from "@/theme";

interface VehicleHit {
  id: string;
  vehicle_number: string;
  owner_name: string;
  wing: string;
  flat_number: string;
}

/**
 * Search & Scan — the screen a guard spends their shift on.
 *
 * The camera does the work; the search box is the fallback for a
 * sticker too scratched to read, which is common on a vehicle that has
 * been through two monsoons.
 *
 * What a code MEANS is decided by @core/gateScan, shared verbatim with
 * the website. This file is camera plumbing and presentation.
 */
const ScanScreen = () => {
  const { societyId, user } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();

  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<GateScanOutcome | null>(null);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<VehicleHit[]>([]);
  const [searching, setSearching] = useState(false);

  // A barcode in view fires onBarcodeScanned continuously, many times a
  // second. Without this latch the same pass is resolved dozens of
  // times — and for a single-use guest pass that means the first scan
  // succeeds and the rest report "already used" over the top of it.
  const handling = useRef(false);

  const onScanned = useCallback(async (raw: string) => {
    if (handling.current || !societyId) return;
    handling.current = true;
    setScanning(false);
    setBusy(true);

    const ports = makeGatePorts(supabase, societyId, user?.id ?? null);
    const result = await resolveGateScan(ports, raw);

    setOutcome(result);
    setBusy(false);
    // Long enough that a guard who looked away still sees the verdict.
    setTimeout(() => { handling.current = false; }, 1500);
  }, [societyId, user?.id]);

  const search = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2 || !societyId) { setHits([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from("vehicles")
      .select("id, vehicle_number, owner_name, wing, flat_number")
      .eq("society_id", societyId)
      .ilike("vehicle_number", `%${q.replace(/\s/g, "")}%`)
      .limit(15);
    setHits((data ?? []) as VehicleHit[]);
    setSearching(false);
  }, [query, societyId]);

  const logManually = useCallback(async (v: VehicleHit) => {
    if (!societyId) return;
    setBusy(true);
    const { error } = await supabase.from("entry_logs").insert({
      vehicle_number: v.vehicle_number,
      owner_name: v.owner_name,
      wing: v.wing,
      flat_number: v.flat_number,
      entry_type: "resident",
      society_id: societyId,
      logged_by: user?.id ?? null,
    });
    setBusy(false);
    setOutcome(error
      ? { kind: "error", message: error.message }
      : {
          kind: "vehicle",
          vehicleNumber: v.vehicle_number,
          flat: v.wing ? `${v.wing}-${v.flat_number}` : v.flat_number,
          ownerName: v.owner_name,
        });
    setQuery("");
    setHits([]);
  }, [societyId, user?.id]);

  const tone = (o: GateScanOutcome) => {
    switch (o.kind) {
      case "staff": case "guest": case "vehicle": return styles.bannerOk;
      case "rejected": case "unknown": return styles.bannerWarn;
      case "error": return styles.bannerBad;
    }
  };

  if (scanning) {
    return (
      <View style={styles.fill}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => void onScanned(data)}
        />
        <View style={styles.reticle} pointerEvents="none" />
        <View style={styles.camFooter}>
          <Text style={styles.camHint}>Point at the QR code on the pass, sticker or ID card</Text>
          <Pressable style={styles.cancel} onPress={() => setScanning(false)}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <FlatList
        contentContainerStyle={styles.scroll}
        data={hits}
        keyExtractor={(v) => v.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            {outcome ? (
              <View style={[styles.banner, tone(outcome)]}>
                <Text style={styles.bannerText}>{describeOutcome(outcome)}</Text>
                <Pressable onPress={() => setOutcome(null)} hitSlop={12}>
                  <Text style={styles.bannerClose}>✕</Text>
                </Pressable>
              </View>
            ) : null}

            <Pressable
              style={({ pressed }) => [styles.scanBtn, pressed && styles.pressed]}
              onPress={async () => {
                if (!permission?.granted) {
                  const asked = await requestPermission();
                  if (!asked.granted) {
                    setOutcome({
                      kind: "error",
                      message: "Camera access is needed to scan. Allow it in Settings → Apps → ManageSociety Guard.",
                    });
                    return;
                  }
                }
                setOutcome(null);
                setScanning(true);
              }}
              disabled={busy}
              accessibilityRole="button"
            >
              {busy
                ? <ActivityIndicator color={colors.onBrand} />
                : <Text style={styles.scanBtnText}>⬚  Scan QR</Text>}
            </Pressable>

            <Text style={styles.or}>or look the vehicle up</Text>

            <View style={styles.searchRow}>
              <TextInput
                style={styles.input}
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={() => void search()}
                placeholder="Vehicle number"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="characters"
                autoCorrect={false}
                // A gate device is shared across shifts; the browser-style
                // habit of remembering what the last person typed is wrong
                // here, and on the website it was fighting the keyboard.
                returnKeyType="search"
              />
              <Pressable
                style={({ pressed }) => [styles.searchBtn, pressed && styles.pressed]}
                onPress={() => void search()}
              >
                <Text style={styles.searchBtnText}>{searching ? "…" : "Find"}</Text>
              </Pressable>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.hit, pressed && styles.pressed]}
            onPress={() => void logManually(item)}
            disabled={busy}
          >
            <View style={styles.flex}>
              <Text style={styles.hitTitle}>{item.vehicle_number}</Text>
              <Text style={styles.hitSub}>
                {item.owner_name}
                {item.wing || item.flat_number ? ` · ${[item.wing, item.flat_number].filter(Boolean).join("-")}` : ""}
              </Text>
            </View>
            <Text style={styles.hitAction}>Log entry</Text>
          </Pressable>
        )}
        // Returns an element either way: ListEmptyComponent is typed as
        // Element | ComponentType, with no null in it.
        ListEmptyComponent={
          <Text style={styles.empty}>
            {query.trim().length >= 2 && !searching
              ? `No vehicle matches "${query.trim()}".`
              : ""}
          </Text>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  pressed: { opacity: 0.75 },
  header: { gap: space.md, marginBottom: space.sm },

  banner: {
    flexDirection: "row", alignItems: "center", gap: space.md,
    padding: space.md, borderRadius: radius.md, borderWidth: 1,
  },
  bannerOk: { backgroundColor: colors.successBg, borderColor: colors.success },
  bannerWarn: { backgroundColor: colors.warningBg, borderColor: colors.warning },
  bannerBad: { backgroundColor: colors.dangerBg, borderColor: colors.danger },
  bannerText: { color: colors.text, fontSize: type.body, fontWeight: "600", flex: 1 },
  bannerClose: { color: colors.textMuted, fontSize: type.body },

  scanBtn: {
    minHeight: 88, backgroundColor: colors.brand, borderRadius: radius.lg,
    alignItems: "center", justifyContent: "center",
  },
  scanBtnText: { color: colors.onBrand, fontSize: type.title, fontWeight: "800" },

  or: { color: colors.textMuted, fontSize: type.label, textAlign: "center" },

  searchRow: { flexDirection: "row", gap: space.sm },
  input: {
    flex: 1, minHeight: TOUCH,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: space.lg, color: colors.text, fontSize: type.body,
  },
  searchBtn: {
    minWidth: 84, minHeight: TOUCH,
    backgroundColor: colors.surfaceRaised, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  searchBtnText: { color: colors.text, fontSize: type.body, fontWeight: "700" },

  hit: {
    flexDirection: "row", alignItems: "center", gap: space.md,
    minHeight: TOUCH, padding: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  hitTitle: { color: colors.text, fontSize: type.body, fontWeight: "700" },
  hitSub: { color: colors.textMuted, fontSize: type.caption, marginTop: 2 },
  hitAction: { color: colors.brand, fontSize: type.label, fontWeight: "700" },

  empty: { color: colors.textFaint, fontSize: type.label, textAlign: "center", marginTop: space.lg },

  reticle: {
    position: "absolute", alignSelf: "center", top: "28%",
    width: 240, height: 240,
    borderWidth: 3, borderColor: colors.brand, borderRadius: radius.lg,
  },
  camFooter: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    padding: space.xl, gap: space.md,
    backgroundColor: "rgba(15,18,28,0.85)",
  },
  camHint: { color: colors.text, fontSize: type.body, textAlign: "center" },
  cancel: {
    minHeight: TOUCH, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  cancelText: { color: colors.text, fontSize: type.heading, fontWeight: "700" },
});

export default ScanScreen;
