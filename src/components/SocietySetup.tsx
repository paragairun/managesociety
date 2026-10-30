import { useCallback, useEffect, useState } from "react";
import { Building2, ScanLine, Radio, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import UnitTypesBuilder from "@/components/UnitTypesBuilder";
import FloorPlanBuilder from "@/components/FloorPlanBuilder";
import {
  normalizeUnitPlan, toPlanDrafts, plannedFlats, planCoverage, type UnitPlan,
} from "@/lib/floorPlan";
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
    upsert: (rows: Record<string, unknown>[], opts: { onConflict: string }) =>
      Promise<{ error: { message: string } | null }>;
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
  const [plan, setPlan] = useState<UnitPlan>({});
  const [savingPlan, setSavingPlan] = useState(false);
  const [applying, setApplying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingUnits, setSavingUnits] = useState(false);
  const [savingGate, setSavingGate] = useState(false);

  const load = useCallback(async () => {
    if (!societyId) return;

    const [structureRes, societyRes] = await Promise.all([
      db.from("society_structure").select("structure, unit_types, unit_plan")
        .eq("society_id", societyId).maybeSingle(),
      db.from("societies").select("gate_entry_mode").eq("id", societyId).maybeSingle(),
    ]);

    const stored = (structureRes.data?.unit_types ?? []) as UnitType[];
    setSaved(stored);
    setDrafts(toUnitTypeDrafts(stored));
    const parsedTowers = parseStoredStructure(
      structureRes.data?.structure as NormalizedStructure | NormalizedTower[] | null,
    );
    setTowers(parsedTowers);
    setPlan(toPlanDrafts(parsedTowers, (structureRes.data?.unit_plan ?? {}) as UnitPlan));
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

  const savePlan = async () => {
    if (!societyId) return;
    const result = normalizeUnitPlan(towers, plan, saved);
    if ("error" in result) {
      toast({ title: result.error, variant: "destructive" });
      return;
    }

    setSavingPlan(true);
    const { error } = await db.from("society_structure")
      .update({ unit_plan: result.plan })
      .eq("society_id", societyId);
    setSavingPlan(false);

    if (error) {
      toast({ title: "Could not save the floor plan", description: error.message, variant: "destructive" });
      return;
    }
    setPlan(toPlanDrafts(towers, result.plan));
    const c = planCoverage(towers, result.plan);
    toast({
      title: "Floor plan saved",
      description: `${c.flatsCovered} flat${c.flatsCovered === 1 ? "" : "s"} across every floor.`,
    });
  };

  /**
   * Write the plan onto the flats themselves.
   *
   * `overwrite` is the whole decision here. A society has exceptions —
   * the ground floor of shops, the penthouse that swallowed two units —
   * and those were corrected by hand on the flats table. Re-applying
   * the plan over them would undo that correction silently, and the
   * committee would find out when the penthouse got a 2BHK bill.
   *
   * So the default fills only flats that have no unit yet, and
   * overwriting is a separate button that says what it will do.
   */
  const applyPlan = async (overwrite: boolean) => {
    if (!societyId) return;
    const result = normalizeUnitPlan(towers, plan, saved);
    if ("error" in result) {
      toast({ title: result.error, variant: "destructive" });
      return;
    }
    const planned = plannedFlats(towers, result.plan);
    if (planned.length === 0) {
      toast({ title: "Nothing to apply", description: "Set at least one flat on a floor first." });
      return;
    }

    setApplying(true);

    // Which flats already exist, and which of those already have a
    // unit. Read rather than assumed: this screen does not own the
    // flats table and another admin may have been editing it.
    const { data: existing, error: readErr } = await supabase
      .from("flats")
      .select("id, wing, flat_number, flat_type, area_sqft")
      .eq("society_id", societyId);

    if (readErr) {
      setApplying(false);
      toast({ title: "Could not read the flats", description: readErr.message, variant: "destructive" });
      return;
    }

    const byKey = new Map(
      (existing ?? []).map((f) => [`${f.wing}|${f.flat_number}`, f]),
    );

    const toInsert: Record<string, unknown>[] = [];
    const toUpdate: { id: string; flat_type: string; area_sqft: number }[] = [];
    let leftAlone = 0;

    for (const f of planned) {
      const found = byKey.get(`${f.wing}|${f.flat_number}`);
      if (!found) {
        toInsert.push({
          society_id: societyId,
          wing: f.wing,
          flat_number: f.flat_number,
          flat_type: f.flat_type,
          area_sqft: f.area_sqft,
        });
        continue;
      }
      const hasUnit = !!found.flat_type && !!found.area_sqft;
      if (hasUnit && !overwrite) { leftAlone++; continue; }
      if (found.flat_type === f.flat_type && found.area_sqft === f.area_sqft) continue;
      toUpdate.push({ id: found.id, flat_type: f.flat_type, area_sqft: f.area_sqft });
    }

    if (toInsert.length > 0) {
      const { error } = await supabase.from("flats").insert(toInsert as never);
      if (error) {
        setApplying(false);
        toast({ title: "Could not add the new flats", description: error.message, variant: "destructive" });
        return;
      }
    }

    // One statement per distinct unit rather than per flat: a 200-flat
    // society has a handful of unit types, so this is a few round
    // trips instead of two hundred.
    const groups = new Map<string, string[]>();
    for (const u of toUpdate) {
      const key = `${u.flat_type}|${u.area_sqft}`;
      groups.set(key, [...(groups.get(key) ?? []), u.id]);
    }
    for (const [key, ids] of groups) {
      const [flat_type, sqft] = key.split("|");
      const { error } = await supabase.from("flats")
        .update({ flat_type, area_sqft: Number(sqft) })
        .in("id", ids);
      if (error) {
        setApplying(false);
        toast({ title: "Could not update the flats", description: error.message, variant: "destructive" });
        return;
      }
    }

    setApplying(false);
    toast({
      title: `${toInsert.length + toUpdate.length} flat${toInsert.length + toUpdate.length === 1 ? "" : "s"} updated`,
      description: [
        toInsert.length > 0 ? `${toInsert.length} added` : null,
        toUpdate.length > 0 ? `${toUpdate.length} set` : null,
        leftAlone > 0 ? `${leftAlone} left as they were` : null,
      ].filter(Boolean).join(" · ") || "Everything already matched the plan.",
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
  const coverage = planCoverage(towers, plan);

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

      {/* ── Floor plan ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <LayoutGrid className="h-5 w-5 text-primary-ink" /> Which Unit Sits Where
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Describe one floor and every floor follows — your building's floor plate
            repeats, so the flat at the end of the corridor is the same unit on the
            second floor and the eleventh. This is what connects your unit types to
            your actual flats: without it every flat has to be set by hand, and any
            flat left unset drops out of every charge billed by unit or by area.
          </p>

          <FloorPlanBuilder
            towers={towers}
            unitTypes={saved}
            plan={plan}
            onChange={setPlan}
            disabled={savingPlan || applying}
          />

          {saved.length > 0 && coverage.total > 0 && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void savePlan()} disabled={savingPlan || applying}>
                  {savingPlan ? "Saving…" : "Save floor plan"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void applyPlan(false)}
                  disabled={savingPlan || applying || coverage.filled === 0}
                >
                  {applying ? "Applying…" : "Apply to flats"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => void applyPlan(true)}
                  disabled={savingPlan || applying || coverage.filled === 0}
                  title="Also replace units that were set by hand"
                >
                  Apply, overwriting
                </Button>
              </div>

              <div className="text-xs text-muted-foreground space-y-1">
                {/* A half-filled plan is the dangerous state: it looks
                    done, applies cleanly, and leaves part of the
                    society unstamped and unbilled. */}
                <p>
                  {coverage.filled} of {coverage.total} positions set
                  {coverage.flatsCovered > 0 &&
                    ` — covers ${coverage.flatsCovered} flat${coverage.flatsCovered === 1 ? "" : "s"}`}
                  {coverage.filled > 0 && coverage.filled < coverage.total && (
                    <strong className="text-warning-ink">
                      {" "}· the rest will be left without a unit
                    </strong>
                  )}
                </p>
                <p>
                  <strong>Apply to flats</strong> fills in flats that have no unit yet and
                  adds any the plan says should exist. It leaves alone any flat whose unit
                  you set by hand — a shop, a penthouse — so your corrections survive.
                  Use <strong>Apply, overwriting</strong> only to replace those too.
                </p>
                {coverage.wingsWithoutFloors.length > 0 && (
                  <p>
                    Wing {coverage.wingsWithoutFloors.join(", ")} was entered as a plain
                    flat range rather than floor by floor, so there is no repeating floor
                    to describe. Set those on the flats list under Maintenance &amp; Billing.
                  </p>
                )}
              </div>
            </>
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
