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

const emptyChargeHeadForm = () => ({ name: "", calculation_type: "per_sqft" as "per_sqft" | "fixed", rate: "" });
const emptyFlatForm = () => ({ wing: "", flat_number: "", area_sqft: "", flat_type: "" });

const MaintenanceBillingSetup = () => {
  const { societyId } = useAuth();
  const { toast } = useToast();

  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const [chargeHeads, setChargeHeads] = useState<ChargeHead[]>([]);
  const [chargeHeadForm, setChargeHeadForm] = useState(emptyChargeHeadForm());
  const [savingChargeHead, setSavingChargeHead] = useState(false);

  const [flats, setFlats] = useState<Flat[]>([]);
  const [flatForm, setFlatForm] = useState(emptyFlatForm());
  const [savingFlat, setSavingFlat] = useState(false);
  const [importing, setImporting] = useState(false);

  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    if (!societyId) return;
    setLoading(true);
    const [{ data: settingsData }, { data: chargeHeadsData }, { data: flatsData }] = await Promise.all([
      supabase.from("society_billing_settings").select("*").eq("society_id", societyId).maybeSingle(),
      supabase.from("maintenance_charge_heads").select("*").eq("society_id", societyId).order("name"),
      supabase.from("flats").select("*").eq("society_id", societyId).order("wing").order("flat_number"),
    ]);
    setSettings(settingsData ?? null);
    setChargeHeads(chargeHeadsData ?? []);
    setFlats(flatsData ?? []);
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
    if (!chargeHeadForm.name.trim() || !chargeHeadForm.rate) {
      toast({ title: "Name and rate are required", variant: "destructive" });
      return;
    }
    setSavingChargeHead(true);
    const { error } = await supabase.from("maintenance_charge_heads").insert({
      society_id: societyId,
      name: chargeHeadForm.name.trim(),
      calculation_type: chargeHeadForm.calculation_type,
      rate: Number(chargeHeadForm.rate),
    });
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
    if (!flatForm.wing.trim() || !flatForm.flat_number.trim() || !flatForm.area_sqft) {
      toast({ title: "Wing, flat number, and area are required", variant: "destructive" });
      return;
    }
    setSavingFlat(true);
    const { error } = await supabase.from("flats").insert({
      society_id: societyId,
      wing: flatForm.wing.trim().toUpperCase(),
      flat_number: flatForm.flat_number.trim(),
      area_sqft: Number(flatForm.area_sqft),
      flat_type: flatForm.flat_type.trim() || null,
    });
    setSavingFlat(false);
    if (error) { toast({ title: "Could not add flat", description: error.message, variant: "destructive" }); return; }
    setFlatForm(emptyFlatForm());
    toast({ title: "Flat added" });
    await loadAll();
  };

  const updateFlatArea = async (flat: Flat, area_sqft: string) => {
    const n = Number(area_sqft);
    if (!area_sqft || Number.isNaN(n)) return;
    const { error } = await supabase.from("flats").update({ area_sqft: n }).eq("id", flat.id);
    if (error) { toast({ title: "Could not update area", description: error.message, variant: "destructive" }); return; }
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
            <Select value={chargeHeadForm.calculation_type} onValueChange={(v: "per_sqft" | "fixed") => setChargeHeadForm((p) => ({ ...p, calculation_type: v }))}>
              <SelectTrigger className="touch-target"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="per_sqft">Per sq.ft.</SelectItem>
                <SelectItem value="fixed">Fixed amount</SelectItem>
              </SelectContent>
            </Select>
            <Input type="number" placeholder={chargeHeadForm.calculation_type === "per_sqft" ? "Rate per sq.ft." : "Fixed amount"} value={chargeHeadForm.rate} onChange={(e) => setChargeHeadForm((p) => ({ ...p, rate: e.target.value }))} className="touch-target" />
            <Button onClick={() => void addChargeHead()} disabled={savingChargeHead} className="touch-target gap-2"><Plus className="h-4 w-4" /> Add</Button>
          </div>
          <div className="space-y-2">
            {chargeHeads.length === 0 && <p className="text-sm text-muted-foreground">No charge heads yet. Add "Maintenance" to get started.</p>}
            {chargeHeads.map((ch) => (
              <div key={ch.id} className="flex items-center justify-between p-2 rounded-md bg-secondary/50 border border-border">
                <div>
                  <span className="font-medium">{ch.name}</span>
                  <span className="text-sm text-muted-foreground ml-2">
                    {ch.calculation_type === "per_sqft" ? `₹${ch.rate}/sq.ft.` : `₹${ch.rate} fixed`}
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
            <Input type="number" placeholder="Area (sq.ft.)" value={flatForm.area_sqft} onChange={(e) => setFlatForm((p) => ({ ...p, area_sqft: e.target.value }))} className="touch-target" />
            <Input placeholder="Type (e.g. 2BHK)" value={flatForm.flat_type} onChange={(e) => setFlatForm((p) => ({ ...p, flat_type: e.target.value }))} className="touch-target" />
            <Button onClick={() => void addFlat()} disabled={savingFlat} className="touch-target gap-2"><Plus className="h-4 w-4" /> Add</Button>
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {flats.length === 0 && <p className="text-sm text-muted-foreground">No flats registered yet. Add them manually or import from existing residents.</p>}
            {flats.map((f) => (
              <div key={f.id} className="flex items-center justify-between p-2 rounded-md bg-secondary/50 border border-border gap-2">
                <span className="font-medium w-24">{f.wing}-{f.flat_number}</span>
                <span className="text-sm text-muted-foreground w-20">{f.flat_type ?? "—"}</span>
                <Input
                  type="number"
                  defaultValue={f.area_sqft}
                  className="touch-target w-32"
                  onBlur={(e) => void updateFlatArea(f, e.target.value)}
                />
                <span className="text-sm text-muted-foreground">sq.ft.</span>
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
