import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Settings2, Home, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { describeCharge } from "@/lib/billCalculation";
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

type Calc = "per_sqft" | "fixed" | "per_unit_type";

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

    const [{ data: settingsData }, { data: chargeHeadsData }, { data: flatsData }, structureRes] =
      await Promise.all([
        supabase.from("society_billing_settings").select("*").eq("society_id", societyId).maybeSingle(),
        supabase.from("maintenance_charge_heads").select("*").eq("society_id", societyId).order("name"),
        supabase.from("flats").select("*").eq("society_id", societyId).order("wing").order("flat_number"),
        structureDb.from("society_structure").select("unit_types")
          .eq("society_id", societyId).maybeSingle(),
      ]);
    setSettings(settingsData ?? null);
    setChargeHeads(chargeHeadsData ?? []);
    setFlats(flatsData ?? []);
    setUnitTypes(structureRes.data?.unit_types ?? []);
    setLoading(false);
  }, [societyId]);

  useEffect(() => { void loadAll(); }, [loadAll]);

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
    } else if (!chargeHeadForm.rate) {
      toast({ title: "Enter a rate", variant: "destructive" });
      return;
    }
    setSavingChargeHead(true);

    // per_unit_type keeps its rates in a map and leaves `rate` at zero;
    // the other two use `rate` and leave the map null. Writing both
    // would leave two sources of truth for one number.
    const perUnit = chargeHeadForm.calculation_type === "per_unit_type";
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
      rate: perUnit ? 0 : Number(chargeHeadForm.rate),
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
                <SelectItem value="fixed">Fixed amount</SelectItem>
              </SelectContent>
            </Select>
            {chargeHeadForm.calculation_type === "per_unit_type" ? (
              <div className="md:col-span-1 flex items-center text-sm text-muted-foreground">
                Rates per unit type, below
              </div>
            ) : (
              <Input type="number" placeholder={chargeHeadForm.calculation_type === "per_sqft" ? "Rate per sq.ft." : "Fixed amount"} value={chargeHeadForm.rate} onChange={(e) => setChargeHeadForm((p) => ({ ...p, rate: e.target.value }))} className="touch-target" />
            )}
            <Button onClick={() => void addChargeHead()} disabled={savingChargeHead} className="touch-target gap-2"><Plus className="h-4 w-4" /> Add</Button>
          </div>

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
            {chargeHeads.map((ch) => (
              <div key={ch.id} className="flex items-center justify-between p-2 rounded-md bg-secondary/50 border border-border">
                <div>
                  <span className="font-medium">{ch.name}</span>
                  <span className="text-sm text-muted-foreground ml-2">
                    {describeCharge({
                      id: ch.id, name: ch.name,
                      calculation_type: ch.calculation_type as Calc,
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
            ))}
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
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {flats.length === 0 && <p className="text-sm text-muted-foreground">No flats registered yet. Add them manually or import from existing residents.</p>}
            {flats.map((f) => (
              <div key={f.id} className="flex items-center justify-between p-2 rounded-md bg-secondary/50 border border-border gap-2">
                <span className="font-medium w-24">{f.wing}-{f.flat_number}</span>
                {unitTypes.length === 0 ? (
                  <span className="text-sm text-muted-foreground">
                    {unitLabel(f.flat_type, f.area_sqft) || "no unit set"}
                  </span>
                ) : (
                  <Select
                    value={f.flat_type && f.area_sqft ? `${f.flat_type}|${f.area_sqft}` : ""}
                    onValueChange={(v) => void updateFlatUnit(f, v)}
                  >
                    <SelectTrigger className="touch-target w-64">
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
                )}
                {/* A flat with no unit falls out of every per-unit and
                    per-sqft charge. Said here, where it can be fixed. */}
                {!isKnownUnit(unitTypes, f.flat_type, f.area_sqft) && unitTypes.length > 0 && (
                  <span className="text-xs text-warning-ink">not billed by unit</span>
                )}
                <div className="flex-1" />
                <Button variant="ghost" size="sm" onClick={() => void deleteFlat(f.id)} className="text-destructive-ink hover:text-destructive-ink">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default MaintenanceBillingSetup;
