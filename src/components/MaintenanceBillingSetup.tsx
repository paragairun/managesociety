import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Settings2, Home, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  describeCharge, describeFlatCharges, type FlatCharge,
} from "@/lib/billCalculation";
import { sizeLabel, unitLabel, isKnownUnit, type UnitType } from "@/lib/societyUnits";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";

type ChargeHead = Database["public"]["Tables"]["maintenance_charge_heads"]["Row"];
type Flat = Database["public"]["Tables"]["flats"]["Row"];
type BillingSettings = Database["public"]["Tables"]["society_billing_settings"]["Row"];

const BILLING_FREQUENCIES = [
  { value: 1, label: "Monthly" },
  { value: 3, label: "Quarterly" },
  { value: 6, label: "Half-yearly" },
  { value: 12, label: "Annual" },
];

type Calc = "per_sqft" | "fixed" | "per_unit_type" | "per_flat";

/**
 * maintenance_flat_charges and charge_calculation_type.per_flat are
 * newer than the generated types.ts, so those queries narrow to an
 * error type. Cast the CLIENT rather than each row, as evDb.ts and
 * SocietySetup.tsx do; regenerating types.ts deletes this.
 *
 * Defined in supabase/schema/per_flat_charges.sql.
 */
interface FlatChargeRow extends FlatCharge { id: string }
type Err = { message: string } | null;
const flatChargeDb = supabase as unknown as {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => Promise<{ data: FlatChargeRow[] | null; error: Err }>;
    };
    upsert: (rows: Record<string, unknown>[], opts: { onConflict: string }) =>
      Promise<{ error: Err }>;
    delete: () => { in: (col: string, vals: string[]) => Promise<{ error: Err }> };
  };
};

const emptyChargeHeadForm = () => ({
  name: "",
  calculation_type: "per_unit_type" as Calc,
  rate: "",
  /** Rate per unit type name, as typed. Only used by per_unit_type. */
  unitRates: {} as Record<string, string>,
});
/** unitKey is "<type name>|<sqft>" — one control for a pair that is not independent. */
const emptyFlatForm = () => ({ wing: "", flat_number: "", unitKey: "" });

/** Split a unitKey back into its parts. */
const splitUnitKey = (key: string): { flat_type: string; area_sqft: number } | null => {
  const [name, sqft] = key.split("|");
  const area = Number(sqft);
  if (!name || !Number.isFinite(area) || area <= 0) return null;
  return { flat_type: name, area_sqft: area };
};

const MaintenanceBillingSetup = () => {
  const { societyId } = useAuth();
  const { toast } = useToast();

  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const [chargeHeads, setChargeHeads] = useState<ChargeHead[]>([]);
  const [chargeHeadForm, setChargeHeadForm] = useState(emptyChargeHeadForm());
  const [savingChargeHead, setSavingChargeHead] = useState(false);
  /**
   * The society's unit types, for the per-unit-type rate grid.
   *
   * Read through a cast: society_structure.unit_types is newer than the
   * generated types.ts. Defined in
   * supabase/schema/society_units_and_gate_mode.sql.
   */
  const [unitTypes, setUnitTypes] = useState<UnitType[]>([]);

  const [flats, setFlats] = useState<Flat[]>([]);
  const [flatForm, setFlatForm] = useState(emptyFlatForm());

  /**
   * Which flats the bulk actions act on.
   *
   * Ids rather than indexes, because the list reorders when a flat is
   * added and an index-based selection would then quietly apply a
   * charge to the wrong households.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /** Every per-flat amount for this society, for the summary and the editor. */
  const [flatCharges, setFlatCharges] = useState<FlatChargeRow[]>([]);
  /** The bulk per-flat form: which head, how much, and for which month. */
  const [bulkCharge, setBulkCharge] = useState({ headId: "", amount: "", period: "" });
  const [applyingCharge, setApplyingCharge] = useState(false);
  const [bulkUnitKey, setBulkUnitKey] = useState("");
  const [bulkWorking, setBulkWorking] = useState(false);
  const [savingFlat, setSavingFlat] = useState(false);
  const [importing, setImporting] = useState(false);

  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    if (!societyId) return;
    setLoading(true);
    // society_structure.unit_types is newer than the generated
    // types.ts, so that one query goes through a cast client.
    const structureDb = supabase as unknown as {
      from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => {
        maybeSingle: () => Promise<{ data: { unit_types?: UnitType[] } | null }> } } };
    };

    const [{ data: settingsData }, { data: chargeHeadsData }, { data: flatsData }, structureRes, chargesRes] =
      await Promise.all([
        supabase.from("society_billing_settings").select("*").eq("society_id", societyId).maybeSingle(),
        supabase.from("maintenance_charge_heads").select("*").eq("society_id", societyId).order("name"),
        supabase.from("flats").select("*").eq("society_id", societyId).order("wing").order("flat_number"),
        structureDb.from("society_structure").select("unit_types")
          .eq("society_id", societyId).maybeSingle(),
        flatChargeDb.from("maintenance_flat_charges")
          .select("id, head_id, flat_id, amount, for_period, note")
          .eq("society_id", societyId),
      ]);
    setSettings(settingsData ?? null);
    setChargeHeads(chargeHeadsData ?? []);
    setFlats(flatsData ?? []);
    setUnitTypes(structureRes.data?.unit_types ?? []);
    // Not fatal: the per-flat table is a later migration, and the rest
    // of this screen works without it.
    setFlatCharges(chargesRes.data ?? []);
    setLoading(false);
  }, [societyId]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  /**
   * Drop ids that are no longer in the list.
   *
   * A flat deleted on its own row, or by another admin, would otherwise
   * stay counted in "12 flats selected" and be sent in the next bulk
   * update — which fails on a missing row, or worse, succeeds against
   * an id that has been reused.
   */
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(flats.map((f) => f.id));
      const kept = [...prev].filter((id) => live.has(id));
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, [flats]);

  // ─── Billing settings ────────────────────────────────────────────────
  const saveSettings = async (patch: Partial<BillingSettings>) => {
    if (!societyId) return;
    setSavingSettings(true);
    const merged = {
      billing_frequency_months: settings?.billing_frequency_months ?? 1,
      due_days: settings?.due_days ?? 15,
      late_fee_fixed: settings?.late_fee_fixed ?? 0,
      late_fee_percent: settings?.late_fee_percent ?? 0,
      ...patch,
      society_id: societyId,
    };
    const { data, error } = await supabase
      .from("society_billing_settings")
      .upsert(merged, { onConflict: "society_id" })
      .select("*")
      .single();
    setSavingSettings(false);
    if (error) { toast({ title: "Could not save billing settings", description: error.message, variant: "destructive" }); return; }
    setSettings(data);
    toast({ title: "Billing settings updated" });
  };

  // ─── Charge heads ────────────────────────────────────────────────────
  const addChargeHead = async () => {
    if (!societyId) return;
    if (!chargeHeadForm.name.trim()) {
      toast({ title: "Give the charge head a name", variant: "destructive" });
      return;
    }
    if (chargeHeadForm.calculation_type === "per_unit_type") {
      const anyRate = Object.values(chargeHeadForm.unitRates)
        .some((v) => v.trim() !== "" && Number.isFinite(Number(v)));
      if (!anyRate) {
        toast({
          title: "Set a rate for at least one unit type",
          description: unitTypes.length === 0
            ? "Define your unit types first, under Society Setup."
            : "A unit type left blank is simply not charged for this head.",
          variant: "destructive",
        });
        return;
      }
    } else if (chargeHeadForm.calculation_type === "per_flat") {
      // Deliberately no rate here. The amounts are per flat and are
      // entered against the flats list below, because asking for one
      // number would imply every flat pays it — which is what the
      // 'fixed' type already means.
    } else if (!chargeHeadForm.rate) {
      toast({ title: "Enter a rate", variant: "destructive" });
      return;
    }
    setSavingChargeHead(true);

    // per_unit_type keeps its rates in a map and leaves `rate` at zero;
    // the other two use `rate` and leave the map null. Writing both
    // would leave two sources of truth for one number.
    const perUnit = chargeHeadForm.calculation_type === "per_unit_type";
    const perFlat = chargeHeadForm.calculation_type === "per_flat";
    const unitRates = perUnit
      ? Object.fromEntries(
          Object.entries(chargeHeadForm.unitRates)
            .filter(([, v]) => v.trim() !== "" && Number.isFinite(Number(v)))
            .map(([k, v]) => [k, Number(v)]),
        )
      : null;

    const { error } = await supabase.from("maintenance_charge_heads").insert({
      society_id: societyId,
      name: chargeHeadForm.name.trim(),
      calculation_type: chargeHeadForm.calculation_type,
      rate: perUnit || perFlat ? 0 : Number(chargeHeadForm.rate),
      ...(perUnit ? { unit_rates: unitRates } : {}),
    } as never);
    setSavingChargeHead(false);
    if (error) { toast({ title: "Could not add charge head", description: error.message, variant: "destructive" }); return; }
    setChargeHeadForm(emptyChargeHeadForm());
    toast({ title: "Charge head added" });
    await loadAll();
  };

  const toggleChargeHeadActive = async (ch: ChargeHead) => {
    const { error } = await supabase.from("maintenance_charge_heads").update({ is_active: !ch.is_active }).eq("id", ch.id);
    if (error) { toast({ title: "Could not update charge head", description: error.message, variant: "destructive" }); return; }
    await loadAll();
  };

  const deleteChargeHead = async (id: string) => {
    const { error } = await supabase.from("maintenance_charge_heads").delete().eq("id", id);
    if (error) { toast({ title: "Could not delete charge head", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Charge head removed" });
    await loadAll();
  };

  // ─── Flats registry ──────────────────────────────────────────────────
  const addFlat = async () => {
    if (!societyId) return;
    if (!flatForm.wing.trim() || !flatForm.flat_number.trim() || !flatForm.unitKey) {
      toast({ title: "Wing, flat number, and area are required", variant: "destructive" });
      return;
    }
    setSavingFlat(true);
    const { error } = await supabase.from("flats").insert({
      society_id: societyId,
      wing: flatForm.wing.trim().toUpperCase(),
      flat_number: flatForm.flat_number.trim(),
      ...(splitUnitKey(flatForm.unitKey) ?? { area_sqft: 0, flat_type: null }),
    });
    setSavingFlat(false);
    if (error) { toast({ title: "Could not add flat", description: error.message, variant: "destructive" }); return; }
    setFlatForm(emptyFlatForm());
    toast({ title: "Flat added" });
    await loadAll();
  };

  /**
   * Change a flat's unit, type and size together.
   *
   * Together, because they are not independent: a 3BHK in this society
   * is 1000, 1050 or 1100 sq ft. Editing the area alone — which is what
   * this screen used to allow — is how a flat ends up at a size the
   * catalogue does not have, falling out of every per-unit charge.
   */
  const updateFlatUnit = async (flat: Flat, unitKey: string) => {
    const unit = splitUnitKey(unitKey);
    if (!unit) return;
    if (!isKnownUnit(unitTypes, unit.flat_type, unit.area_sqft)) {
      toast({
        title: "That is not a unit your society has",
        description: "Add it under Society Setup first.",
        variant: "destructive",
      });
      return;
    }
    const { error } = await supabase.from("flats")
      .update({ flat_type: unit.flat_type, area_sqft: unit.area_sqft })
      .eq("id", flat.id);
    if (error) { toast({ title: "Could not update the flat", description: error.message, variant: "destructive" }); return; }
    await loadAll();
  };

  const deleteFlat = async (id: string) => {
    const { error } = await supabase.from("flats").delete().eq("id", id);
    if (error) { toast({ title: "Could not delete flat", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Flat removed" });
    await loadAll();
  };

  // ─── Selection and bulk actions ──────────────────────────────────────
  //
  // Checkboxes exist because the per-flat work is inherently bulk:
  // "these forty flats keep a car at ₹200". Doing that one flat at a
  // time is forty trips through a dialog, which is how a committee ends
  // up keeping the real numbers in a spreadsheet instead.

  const allSelected = flats.length > 0 && selected.size === flats.length;
  /** Drives the header checkbox's third state. */
  const someSelected = selected.size > 0 && !allSelected;

  const toggleOne = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /**
   * Select-all covers the rows on screen, which is all of them — the
   * list is not paged or filtered. If it ever is, this must select the
   * filtered set and say so, because a header checkbox that silently
   * includes rows the admin cannot see is how a charge lands on the
   * wrong flats.
   */
  const toggleAll = () =>
    setSelected((prev) => (prev.size === flats.length ? new Set() : new Set(flats.map((f) => f.id))));

  const clearSelection = () => setSelected(new Set());

  /** Apply one per-flat amount to every selected flat. */
  const applyFlatCharge = async () => {
    if (!societyId || selected.size === 0) return;
    const head = chargeHeads.find((h) => h.id === bulkCharge.headId);
    if (!head) {
      toast({ title: "Choose which charge this is for", variant: "destructive" });
      return;
    }
    const amount = Number(bulkCharge.amount);
    if (!bulkCharge.amount.trim() || !Number.isFinite(amount) || amount < 0) {
      toast({ title: "Enter the amount, as a number", variant: "destructive" });
      return;
    }
    const period = bulkCharge.period.trim();
    if (period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      toast({
        title: "That is not a month",
        description: "Use YYYY-MM, like 2026-11. Leave it blank to charge every month.",
        variant: "destructive",
      });
      return;
    }

    setApplyingCharge(true);
    const rows = [...selected].map((flatId) => ({
      society_id: societyId,
      head_id: head.id,
      flat_id: flatId,
      amount,
      for_period: period || null,
    }));
    // onConflict matches the two partial unique indexes: re-applying a
    // charge to the same flats corrects the amount rather than billing
    // it twice.
    const { error } = await flatChargeDb
      .from("maintenance_flat_charges")
      .upsert(rows, { onConflict: "head_id,flat_id,for_period" });
    setApplyingCharge(false);
    if (error) {
      toast({ title: "Could not apply the charge", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: `${head.name}: \u20b9${amount} on ${rows.length} flat${rows.length === 1 ? "" : "s"}`,
      description: period ? `For ${period} only.` : "Every month, until removed.",
    });
    setBulkCharge((b) => ({ ...b, amount: "" }));
    await loadAll();
  };

  /** Remove every per-flat amount under this head from the selected flats. */
  const clearFlatCharge = async () => {
    if (selected.size === 0) return;
    const head = chargeHeads.find((h) => h.id === bulkCharge.headId);
    if (!head) {
      toast({ title: "Choose which charge to remove", variant: "destructive" });
      return;
    }
    const ids = flatCharges
      .filter((c) => c.head_id === head.id && selected.has(c.flat_id))
      .map((c) => c.id);
    if (ids.length === 0) {
      toast({ title: "Nothing to remove", description: `None of the selected flats has a ${head.name} amount.` });
      return;
    }
    setApplyingCharge(true);
    const { error } = await flatChargeDb.from("maintenance_flat_charges").delete().in("id", ids);
    setApplyingCharge(false);
    if (error) {
      toast({ title: "Could not remove the charge", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Removed ${head.name} from ${ids.length} flat${ids.length === 1 ? "" : "s"}` });
    await loadAll();
  };

  /** Stamp one unit type and size onto every selected flat. */
  const applyBulkUnit = async () => {
    if (selected.size === 0) return;
    const unit = splitUnitKey(bulkUnitKey);
    if (!unit || !isKnownUnit(unitTypes, unit.flat_type, unit.area_sqft)) {
      toast({ title: "Choose a unit type and size", variant: "destructive" });
      return;
    }
    setBulkWorking(true);
    const { error } = await supabase.from("flats")
      .update({ flat_type: unit.flat_type, area_sqft: unit.area_sqft })
      .in("id", [...selected]);
    setBulkWorking(false);
    if (error) {
      toast({ title: "Could not update the flats", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${selected.size} flat${selected.size === 1 ? "" : "s"} set to ${unit.flat_type} \u2014 ${unit.area_sqft} sq ft` });
    setBulkUnitKey("");
    await loadAll();
  };

  const deleteSelectedFlats = async () => {
    if (selected.size === 0) return;
    setBulkWorking(true);
    const { error } = await supabase.from("flats").delete().in("id", [...selected]);
    setBulkWorking(false);
    if (error) {
      toast({ title: "Could not remove the flats", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${selected.size} flat${selected.size === 1 ? "" : "s"} removed` });
    clearSelection();
    await loadAll();
  };

  /** This flat's per-flat amounts, for the row summary. */
  const chargesFor = (flatId: string) => flatCharges.filter((c) => c.flat_id === flatId);

  /** Only per-flat heads can take a per-flat amount. */
  const perFlatHeads = chargeHeads.filter((h) => (h.calculation_type as Calc) === "per_flat");

  const headName = (headId: string) =>
    chargeHeads.find((h) => h.id === headId)?.name ?? "Charge";

  /** Pre-populate the flats registry from wing/flat_number combos already in use via resident_flats. */
  const importFromResidents = async () => {
    if (!societyId) return;
    setImporting(true);
    const { data: rf } = await supabase.from("resident_flats").select("wing, flat_number");
    const existing = new Set(flats.map((f) => `${f.wing}|${f.flat_number}`));
    const distinctNew = Array.from(
      new Map((rf ?? []).map((r) => [`${r.wing}|${r.flat_number}`, r])).values()
    ).filter((r) => !existing.has(`${r.wing}|${r.flat_number}`));

    if (distinctNew.length === 0) {
      setImporting(false);
      toast({ title: "Nothing to import", description: "All known flats are already registered." });
      return;
    }
    const { error } = await supabase.from("flats").insert(
      distinctNew.map((r) => ({ society_id: societyId, wing: r.wing, flat_number: r.flat_number, area_sqft: 0 }))
    );
    setImporting(false);
    if (error) { toast({ title: "Import failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Imported ${distinctNew.length} flat(s)`, description: "Set their area below to include them in billing." });
    await loadAll();
  };

  if (loading) return <div className="p-6 text-muted-foreground">Loading billing setup...</div>;

  return (
    <div className="space-y-6">
      {/* Billing settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg"><Settings2 className="h-5 w-5 text-primary-ink" /> Billing Settings</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Billing Frequency</Label>
            <Select
              value={String(settings?.billing_frequency_months ?? 1)}
              onValueChange={(v) => void saveSettings({ billing_frequency_months: Number(v) })}
              disabled={savingSettings}
            >
              <SelectTrigger className="touch-target"><SelectValue /></SelectTrigger>
              <SelectContent>
                {BILLING_FREQUENCIES.map((f) => <SelectItem key={f.value} value={String(f.value)}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Payment Due (days after bill generation)</Label>
            <Input
              type="number"
              value={settings?.due_days ?? 15}
              className="touch-target"
              onChange={(e) => setSettings((s) => ({ ...(s as BillingSettings), due_days: Number(e.target.value) }))}
              onBlur={(e) => void saveSettings({ due_days: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Late Fee (fixed amount)</Label>
            <Input
              type="number"
              value={settings?.late_fee_fixed ?? 0}
              className="touch-target"
              onChange={(e) => setSettings((s) => ({ ...(s as BillingSettings), late_fee_fixed: Number(e.target.value) }))}
              onBlur={(e) => void saveSettings({ late_fee_fixed: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Late Fee (% of bill, optional)</Label>
            <Input
              type="number"
              value={settings?.late_fee_percent ?? 0}
              className="touch-target"
              onChange={(e) => setSettings((s) => ({ ...(s as BillingSettings), late_fee_percent: Number(e.target.value) }))}
              onBlur={(e) => void saveSettings({ late_fee_percent: Number(e.target.value) })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Charge heads */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg"><Sparkles className="h-5 w-5 text-primary-ink" /> Charge Heads</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Input placeholder="e.g. Maintenance" value={chargeHeadForm.name} onChange={(e) => setChargeHeadForm((p) => ({ ...p, name: e.target.value }))} className="touch-target" />
            <Select value={chargeHeadForm.calculation_type} onValueChange={(v: Calc) => setChargeHeadForm((p) => ({ ...p, calculation_type: v }))}>
              <SelectTrigger className="touch-target"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="per_unit_type">Per unit type</SelectItem>
                <SelectItem value="per_sqft">Per sq.ft.</SelectItem>
                <SelectItem value="fixed">Fixed amount (every flat)</SelectItem>
                <SelectItem value="per_flat">Per flat (set individually)</SelectItem>
              </SelectContent>
            </Select>
            {chargeHeadForm.calculation_type === "per_unit_type" ? (
              <div className="md:col-span-1 flex items-center text-sm text-muted-foreground">
                Rates per unit type, below
              </div>
            ) : chargeHeadForm.calculation_type === "per_flat" ? (
              <div className="md:col-span-1 flex items-center text-sm text-muted-foreground">
                Amounts per flat, below
              </div>
            ) : (
              <Input type="number" placeholder={chargeHeadForm.calculation_type === "per_sqft" ? "Rate per sq.ft." : "Fixed amount"} value={chargeHeadForm.rate} onChange={(e) => setChargeHeadForm((p) => ({ ...p, rate: e.target.value }))} className="touch-target" />
            )}
            <Button onClick={() => void addChargeHead()} disabled={savingChargeHead} className="touch-target gap-2"><Plus className="h-4 w-4" /> Add</Button>
          </div>

          {chargeHeadForm.calculation_type === "per_flat" && (
            <div className="rounded-lg border border-border bg-secondary/20 p-3">
              <p className="text-sm text-muted-foreground">
                For charges that follow nothing about the flat — two- and four-wheeler
                parking, fines, penalties, a hall booking. Flat 101 keeps two scooters
                and 102 keeps none, so there is no rate to set here. Add the head, then
                tick the flats it applies to in the list below and enter the amount.
              </p>
            </div>
          )}

          {/* One rate per unit type. This is how most societies actually
              bill for lifts, security and common electricity: the cost
              follows the size of household rather than the floor area.
              A unit type left blank is deliberately NOT charged — a lift
              charge may genuinely not apply to a ground-floor shop. */}
          {chargeHeadForm.calculation_type === "per_unit_type" && (
            <div className="rounded-lg border border-border bg-secondary/20 p-3 space-y-2">
              {unitTypes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No unit types defined yet. Add them under <strong>Society Setup</strong>,
                  then charges can be set per 1BHK, 2BHK and so on.
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Leave a unit type blank to exclude it from this charge.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                    {unitTypes.map((ut) => (
                      <div key={ut.name} className="flex items-center gap-2">
                        <span className="w-20 text-sm font-medium">{ut.name}</span>
                        <Input
                          type="number"
                          placeholder="₹"
                          value={chargeHeadForm.unitRates[ut.name] ?? ""}
                          onChange={(e) => setChargeHeadForm((p) => ({
                            ...p,
                            unitRates: { ...p.unitRates, [ut.name]: e.target.value },
                          }))}
                          className="touch-target"
                          aria-label={`Rate for ${ut.name}`}
                        />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <div className="space-y-2">
            {chargeHeads.length === 0 && <p className="text-sm text-muted-foreground">No charge heads yet. Add "Maintenance" to get started.</p>}
            {chargeHeads.map((ch) => {
              /* types.ts predates per_unit_type and per_flat, so the
                 generated enum is narrower than the database's. */
              const calc = ch.calculation_type as Calc;
              return (
              <div key={ch.id} className="flex items-center justify-between p-2 rounded-md bg-secondary/50 border border-border">
                <div>
                  <span className="font-medium">{ch.name}</span>
                  <span className="text-sm text-muted-foreground ml-2">
                    {/* A per-flat head's amounts live elsewhere, so
                        describeCharge can only say "set per flat".
                        The count is what the committee needs: a head
                        nobody has been charged under bills nothing,
                        and that is invisible otherwise. */}
                    {calc === "per_flat"
                      ? describeFlatCharges({
                          id: ch.id, name: ch.name,
                          calculation_type: "per_flat", rate: ch.rate,
                        }, flatCharges)
                      : describeCharge({
                          id: ch.id, name: ch.name,
                          calculation_type: calc,
                          rate: ch.rate,
                          unit_rates: (ch as { unit_rates?: Record<string, number> | null }).unit_rates,
                        })}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={ch.is_active} onCheckedChange={() => void toggleChargeHeadActive(ch)} />
                  <Button variant="ghost" size="sm" onClick={() => void deleteChargeHead(ch.id)} className="text-destructive-ink hover:text-destructive-ink">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Flats registry */}
      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg"><Home className="h-5 w-5 text-primary-ink" /> Flats & Area</CardTitle>
          <Button variant="outline" size="sm" onClick={() => void importFromResidents()} disabled={importing}>
            {importing ? "Importing..." : "Import from Residents"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            <Input placeholder="Wing" value={flatForm.wing} onChange={(e) => setFlatForm((p) => ({ ...p, wing: e.target.value }))} className="touch-target" />
            <Input placeholder="Flat No." value={flatForm.flat_number} onChange={(e) => setFlatForm((p) => ({ ...p, flat_number: e.target.value }))} className="touch-target" />
            {/* One control, not two. The unit type and its size are not
                independent — a 3BHK in this society is 1000, 1050 or
                1100 and nothing else — and typing them separately is
                how a flat ends up at 3BHK/1075, matching no charge
                head and nobody noticing until the bills are short. */}
            {unitTypes.length === 0 ? (
              <div className="md:col-span-2 flex items-center text-sm text-muted-foreground">
                Define your unit types under <strong className="mx-1">Society Setup</strong> first.
              </div>
            ) : (
              <Select
                value={flatForm.unitKey}
                onValueChange={(v) => setFlatForm((p) => ({ ...p, unitKey: v }))}
              >
                <SelectTrigger className="touch-target md:col-span-2">
                  <SelectValue placeholder="Unit type and size" />
                </SelectTrigger>
                <SelectContent>
                  {unitTypes.flatMap((t) => t.sizes.map((sz) => (
                    <SelectItem key={`${t.name}|${sz.sqft}`} value={`${t.name}|${sz.sqft}`}>
                      {t.name} — {sizeLabel(sz)}
                    </SelectItem>
                  )))}
                </SelectContent>
              </Select>
            )}
            <Button onClick={() => void addFlat()} disabled={savingFlat} className="touch-target gap-2"><Plus className="h-4 w-4" /> Add</Button>
          </div>
          {/* ── Bulk actions ─────────────────────────────────────────
              Only once something is ticked. An always-visible bar of
              controls that act on "the selection" invites the reading
              that they act on everything, and the first time that is
              wrong it is a charge on two hundred flats. */}
          {selected.size > 0 && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm font-semibold text-foreground">
                  {selected.size} flat{selected.size === 1 ? "" : "s"} selected
                </p>
                <Button variant="ghost" size="sm" onClick={clearSelection}>Clear</Button>
              </div>

              {/* Per-flat amount. The reason the checkboxes exist:
                  "these forty flats keep a car at ₹200". */}
              {perFlatHeads.length > 0 && (
                <div className="grid gap-2 md:grid-cols-5 items-center">
                  <Select
                    value={bulkCharge.headId}
                    onValueChange={(v) => setBulkCharge((b) => ({ ...b, headId: v }))}
                  >
                    <SelectTrigger className="touch-target md:col-span-2">
                      <SelectValue placeholder="Per-flat charge" />
                    </SelectTrigger>
                    <SelectContent>
                      {perFlatHeads.map((h) => (
                        <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    placeholder="Amount ₹"
                    value={bulkCharge.amount}
                    onChange={(e) => setBulkCharge((b) => ({ ...b, amount: e.target.value }))}
                    className="touch-target"
                  />
                  <Input
                    placeholder="Month (blank = every)"
                    value={bulkCharge.period}
                    onChange={(e) => setBulkCharge((b) => ({ ...b, period: e.target.value }))}
                    className="touch-target"
                    aria-label="Bill in this month only, as YYYY-MM. Leave blank to charge every month."
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={() => void applyFlatCharge()}
                      disabled={applyingCharge}
                      className="touch-target flex-1"
                    >
                      Apply
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void clearFlatCharge()}
                      disabled={applyingCharge}
                      className="touch-target"
                      title="Remove this charge from the selected flats"
                    >
                      Remove
                    </Button>
                  </div>
                  <p className="md:col-span-5 text-xs text-muted-foreground">
                    Leave the month blank for a charge that recurs every month — parking.
                    Enter a month like <strong>2026-11</strong> for something billed once —
                    a fine, a penalty, a hall booking. Applying again to the same flats
                    corrects the amount rather than charging twice.
                  </p>
                </div>
              )}

              {/* The bulk unit assignment that would otherwise have been
                  a one-off script run against the database. */}
              {unitTypes.length > 0 && (
                <div className="grid gap-2 md:grid-cols-5 items-center border-t border-border pt-3">
                  <Select value={bulkUnitKey} onValueChange={setBulkUnitKey}>
                    <SelectTrigger className="touch-target md:col-span-3">
                      <SelectValue placeholder="Set unit type and size on all selected" />
                    </SelectTrigger>
                    <SelectContent>
                      {unitTypes.flatMap((t) => t.sizes.map((sz) => (
                        <SelectItem key={`${t.name}|${sz.sqft}`} value={`${t.name}|${sz.sqft}`}>
                          {t.name} — {sizeLabel(sz)}
                        </SelectItem>
                      )))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => void applyBulkUnit()}
                    disabled={bulkWorking || !bulkUnitKey}
                    className="touch-target"
                  >
                    Set unit
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void deleteSelectedFlats()}
                    disabled={bulkWorking}
                    className="touch-target gap-2 text-destructive-ink"
                  >
                    <Trash2 className="h-4 w-4" /> Remove flats
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="max-h-96 overflow-y-auto rounded-lg border border-border">
            {flats.length === 0 ? (
              <p className="text-sm text-muted-foreground p-3">No flats registered yet. Add them manually or import from existing residents.</p>
            ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={toggleAll}
                      aria-label={allSelected ? "Clear selection" : "Select all flats"}
                    />
                  </TableHead>
                  <TableHead className="w-28">Flat</TableHead>
                  <TableHead>Unit type and size</TableHead>
                  <TableHead>Per-flat charges</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {flats.map((f) => {
                  const mine = chargesFor(f.id);
                  return (
                  <TableRow key={f.id} data-state={selected.has(f.id) ? "selected" : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(f.id)}
                        onCheckedChange={() => toggleOne(f.id)}
                        aria-label={`Select flat ${f.wing}-${f.flat_number}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium whitespace-nowrap">{f.wing}-{f.flat_number}</TableCell>
                    <TableCell>
                      {unitTypes.length === 0 ? (
                        <span className="text-sm text-muted-foreground">
                          {unitLabel(f.flat_type, f.area_sqft) || "no unit set"}
                        </span>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Select
                            value={f.flat_type && f.area_sqft ? `${f.flat_type}|${f.area_sqft}` : ""}
                            onValueChange={(v) => void updateFlatUnit(f, v)}
                          >
                            <SelectTrigger className="touch-target w-56">
                              <SelectValue placeholder="Set unit type and size" />
                            </SelectTrigger>
                            <SelectContent>
                              {unitTypes.flatMap((t) => t.sizes.map((sz) => (
                                <SelectItem key={`${t.name}|${sz.sqft}`} value={`${t.name}|${sz.sqft}`}>
                                  {t.name} — {sizeLabel(sz)}
                                </SelectItem>
                              )))}
                            </SelectContent>
                          </Select>
                          {/* A flat with no unit falls out of every
                              per-unit and per-sqft charge. Said here,
                              where it can be fixed. */}
                          {!isKnownUnit(unitTypes, f.flat_type, f.area_sqft) && (
                            <span className="text-xs text-warning-ink">not billed by unit</span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {mine.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="space-y-0.5">
                          {mine.map((c) => (
                            <div key={c.id} className="text-muted-foreground">
                              <span className="text-foreground">
                                {headName(c.head_id)} &#8377;{c.amount}
                              </span>
                              {c.for_period ? ` · ${c.for_period} only` : " · monthly"}
                            </div>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => void deleteFlat(f.id)} className="text-destructive-ink hover:text-destructive-ink">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default MaintenanceBillingSetup;
