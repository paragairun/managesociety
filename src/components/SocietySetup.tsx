import { useCallback, useEffect, useState } from "react";
import { Building2, ScanLine, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import UnitTypesBuilder from "@/components/UnitTypesBuilder";
import {
  normalizeUnitTypes, toUnitTypeDrafts, emptyUnitType,
  type UnitType, type UnitTypeDraft,
} from "@/lib/societyUnits";
import {
  parseStoredStructure, structureFields,
  type NormalizedTower, type NormalizedStructure,
} from "@/lib/societyStructure";

type GateMode = "qr_sticker" | "rfid";

/**
 * society_structure.unit_types and societies.gate_entry_mode are newer
 * than the generated types.ts, so `.from()` narrows those rows to an
 * error type. Cast the CLIENT rather than each row, as evDb.ts and
 * usePushNotifications.ts do; regenerating types.ts deletes this and
 * nothing else.
 *
 * Both columns are defined in
 * supabase/schema/society_units_and_gate_mode.sql.
 */
interface LooseResult<T> { data: T | null; error: { message: string } | null }
const db = supabase as unknown as {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<LooseResult<Record<string, unknown>>>;
      };
    };
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
    };
  };
};

/**
 * The society's own shape: what kinds of flat it has, and how vehicles
 * get through the gate.
 *
 * Both settings reach much further than this screen. The unit catalogue
 * is what every per-unit maintenance charge is computed against, and
 * the gate mode decides whether a guard's app shows a scanner at all.
 */
const SocietySetup = () => {
  const { societyId } = useAuth();
  const { toast } = useToast();

  const [drafts, setDrafts] = useState<UnitTypeDraft[]>([emptyUnitType()]);
  const [saved, setSaved] = useState<UnitType[]>([]);
  const [towers, setTowers] = useState<NormalizedTower[]>([]);
  const [gateMode, setGateMode] = useState<GateMode>("qr_sticker");
  const [loading, setLoading] = useState(true);
  const [savingUnits, setSavingUnits] = useState(false);
  const [savingGate, setSavingGate] = useState(false);

  const load = useCallback(async () => {
    if (!societyId) return;

    const [structureRes, societyRes] = await Promise.all([
      db.from("society_structure").select("structure, unit_types")
        .eq("society_id", societyId).maybeSingle(),
      db.from("societies").select("gate_entry_mode").eq("id", societyId).maybeSingle(),
    ]);

    const stored = (structureRes.data?.unit_types ?? []) as UnitType[];
    setSaved(stored);
    setDrafts(toUnitTypeDrafts(stored));
    setTowers(parseStoredStructure(
      structureRes.data?.structure as NormalizedStructure | NormalizedTower[] | null,
    ));
    setGateMode(societyRes.data?.gate_entry_mode === "rfid" ? "rfid" : "qr_sticker");
    setLoading(false);
  }, [societyId]);

  useEffect(() => { void load(); }, [load]);

  const saveUnits = async () => {
    if (!societyId) return;
    const result = normalizeUnitTypes(drafts);
    if ("error" in result) {
      toast({ title: result.error, variant: "destructive" });
      return;
    }

    setSavingUnits(true);
    const { error } = await db.from("society_structure")
      .update({ unit_types: result.unitTypes })
      .eq("society_id", societyId);
    setSavingUnits(false);

    if (error) {
      toast({ title: "Could not save the unit types", description: error.message, variant: "destructive" });
      return;
    }
    setSaved(result.unitTypes);
    toast({
      title: "Unit types saved",
      description: `${result.unitTypes.length} ${result.unitTypes.length === 1 ? "type" : "types"}, ` +
        `${result.unitTypes.reduce((n, t) => n + t.sizes.length, 0)} sizes in all.`,
    });
  };

  const saveGateMode = async (mode: GateMode) => {
    if (!societyId) return;
    setSavingGate(true);
    const { error } = await db.from("societies")
      .update({ gate_entry_mode: mode })
      .eq("id", societyId);
    setSavingGate(false);
    if (error) {
      toast({ title: "Could not change the gate mode", description: error.message, variant: "destructive" });
      return;
    }
    setGateMode(mode);
    toast({
      title: mode === "rfid" ? "Switched to RFID barriers" : "Switched to QR stickers",
      description: mode === "rfid"
        ? "Guards will no longer see the QR scanner. They may need to reopen the app."
        : "Guards will see the QR scanner again.",
    });
  };

  if (loading) {
    return <p className="text-muted-foreground py-8 text-center">Loading society setup…</p>;
  }

  const fields = structureFields(towers);

  return (
    <div className="space-y-4">
      {/* ── Unit types ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="h-5 w-5 text-primary-ink" /> Unit Types and Sizes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The kinds of flat your society has, and the sizes each one comes in. A 3BHK
            might exist at 1000, 1050 and 1100 sq ft — list each. Maintenance charges can
            then be set per unit type or per square foot, and every flat picks from this
            list rather than having a size typed in by hand.
          </p>

          <UnitTypesBuilder
            drafts={drafts}
            onChange={setDrafts}
            disabled={savingUnits}
            idPrefix="setup-unit"
          />

          <Button onClick={() => void saveUnits()} disabled={savingUnits}>
            {savingUnits ? "Saving…" : "Save unit types"}
          </Button>

          {saved.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Currently saved: {saved.map((t) =>
                `${t.name} (${t.sizes.map((s) => s.sqft).join(", ")} sq ft)`).join(" · ")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Gate entry ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">How vehicles get through your gate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <button
            type="button"
            onClick={() => void saveGateMode("qr_sticker")}
            disabled={savingGate}
            className={`w-full text-left rounded-lg border p-3 flex gap-3 items-start transition
              ${gateMode === "qr_sticker"
                ? "border-primary bg-primary/10"
                : "border-border hover:bg-secondary/40"}`}
          >
            <ScanLine className="h-5 w-5 text-primary-ink shrink-0 mt-0.5" />
            <span>
              <span className="block font-semibold">QR stickers — our system</span>
              <span className="block text-sm text-muted-foreground">
                Each registered vehicle gets a QR sticker. Guards scan it, along with guest
                passes and staff ID cards.
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => void saveGateMode("rfid")}
            disabled={savingGate}
            className={`w-full text-left rounded-lg border p-3 flex gap-3 items-start transition
              ${gateMode === "rfid"
                ? "border-primary bg-primary/10"
                : "border-border hover:bg-secondary/40"}`}
          >
            <Radio className="h-5 w-5 text-primary-ink shrink-0 mt-0.5" />
            <span>
              <span className="block font-semibold">RFID boom barriers</span>
              <span className="block text-sm text-muted-foreground">
                You use Park+ or a similar RFID system. The QR scanner is hidden from the
                guard app, since nothing there is scanned. Guest passes, deliveries and
                visitor registration work exactly the same.
              </span>
            </span>
          </button>
        </CardContent>
      </Card>

      {/* ── What residents and guards will see ───────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Address fields</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            A field with fewer than two distinct values is hidden everywhere — it would be a
            dropdown with one option that a guard taps past at every entry. This follows
            your towers and wings automatically; nothing to set.
          </p>
          <ul className="space-y-1">
            <li>
              <span className="font-medium">Tower:</span>{" "}
              {fields.tower
                ? <span className="text-success-ink">shown</span>
                : <span className="text-muted-foreground">hidden — you have fewer than two</span>}
            </li>
            <li>
              <span className="font-medium">Wing:</span>{" "}
              {fields.wing
                ? <span className="text-success-ink">shown</span>
                : <span className="text-muted-foreground">hidden — you have fewer than two</span>}
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};

export default SocietySetup;
