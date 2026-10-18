import { useCallback, useEffect, useState } from "react";
import {
  Plug, Plus, Settings2, AlertCircle, ShieldCheck, ShieldAlert,
  Check, X, RefreshCw, Trash2, Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { evDb } from "@/lib/evDb";
import { useAuth } from "@/contexts/AuthContext";
import {
  VEHICLE_LABEL, STATUS_LABEL, formatKwh, formatRupees,
  type VehicleType, type SessionStatus,
} from "@/lib/evCharging";

/**
 * Admin / manager screen for EV charging: the tariff and payment
 * settings, the charger register, and the queue of payments waiting to
 * be confirmed.
 *
 * Both ev.manage and ev.settings are manager capabilities (see
 * permissions.ts), so this screen is available to managers as well as
 * admins. The database enforces that independently through
 * is_staff_operator().
 */

interface Charger {
  id: string; name: string; location: string | null;
  vehicle_type: VehicleType; connector_type: string | null;
  power_kw: number | null; status: string; last_seen_at: string | null;
  is_active: boolean; ocpp_charge_point_id: string | null;
  ocpp_connector_id: number; ocpp_auth_key: string | null;
}

interface PendingSession {
  id: string; created_at: string; utr: string | null; status: SessionStatus;
  amount_paid: number; credit_applied: number; energy_budget_kwh: number | null;
  resident_label: string | null; charger_id: string;
}

interface Settings {
  society_id: string;
  rate_per_kwh: number; min_amount: number; max_amount: number;
  payment_window_mins: number; auto_confirm_enabled: boolean;
  require_charger_auth: boolean;
  upi_vpa: string | null; upi_payee_name: string | null;
  idle_fee_per_hour: number;
}

const emptyCharger = () => ({
  name: "", location: "", vehicle_type: "four_wheeler" as VehicleType,
  connector_type: "", power_kw: "", ocpp_charge_point_id: "",
  ocpp_connector_id: "1", ocpp_auth_key: "",
});

const EvChargingAdmin = () => {
  const { societyId } = useAuth();
  const { toast } = useToast();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [pending, setPending] = useState<PendingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [showCharger, setShowCharger] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyCharger());

  const load = useCallback(async () => {
    if (!societyId) return;
    setLoading(true);
    setError(null);

    const [sRes, cRes, pRes] = await Promise.all([
      evDb.from("ev_settings").select("*").eq("society_id", societyId).maybeSingle(),
      evDb.from("ev_chargers").select("*").eq("society_id", societyId).order("name"),
      evDb.from("ev_sessions")
        .select("id, created_at, utr, status, amount_paid, credit_applied, energy_budget_kwh, resident_label, charger_id")
        .eq("society_id", societyId)
        .eq("status", "awaiting_approval")
        .order("created_at", { ascending: true }),
    ]);

    // Reported, never swallowed: an empty screen and a refused query
    // look identical otherwise.
    const firstError = sRes.error || cRes.error || pRes.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setSettings((sRes.data as unknown as Settings) ?? null);
    setChargers((cRes.data ?? []) as unknown as Charger[]);
    setPending((pRes.data ?? []) as unknown as PendingSession[]);
    setLoading(false);
  }, [societyId]);

  useEffect(() => { void load(); }, [load]);

  const patchSettings = async (patch: Partial<Settings>) => {
    if (!societyId || !settings) return;
    setSaving(true);
    const { error: err } = await evDb.from("ev_settings")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("society_id", societyId);
    setSaving(false);
    if (err) { toast({ title: "Could not save", description: err.message, variant: "destructive" }); return; }
    setSettings({ ...settings, ...patch });
  };

  const saveCharger = async () => {
    if (!societyId) return;
    if (!form.name.trim()) { toast({ title: "Name the charger", variant: "destructive" }); return; }

    const row = {
      society_id: societyId,
      name: form.name.trim(),
      location: form.location.trim() || null,
      vehicle_type: form.vehicle_type,
      connector_type: form.connector_type.trim() || null,
      power_kw: form.power_kw ? Number(form.power_kw) : null,
      ocpp_charge_point_id: form.ocpp_charge_point_id.trim() || null,
      ocpp_connector_id: Number(form.ocpp_connector_id) || 1,
      ocpp_auth_key: form.ocpp_auth_key.trim() || null,
    };

    setSaving(true);
    const { error: err } = editingId
      ? await evDb.from("ev_chargers").update(row).eq("id", editingId)
      : await evDb.from("ev_chargers").insert(row);
    setSaving(false);

    if (err) {
      const clash = err.message.includes("ev_chargers_ocpp_identity_uniq");
      toast({
        title: clash ? "That OCPP ID is already used" : "Could not save the charger",
        description: clash
          ? "Another charger already uses this charge point ID and connector number."
          : err.message,
        variant: "destructive",
      });
      return;
    }
    setShowCharger(false);
    setEditingId(null);
    setForm(emptyCharger());
    void load();
  };

  const decide = async (session: PendingSession, approve: boolean) => {
    const { data: me } = await supabase.auth.getUser();
    const { error: err } = await evDb.from("ev_sessions").update(
      approve
        ? {
            status: "authorized",
            confirmed_at: new Date().toISOString(),
            confirmed_by: me?.user?.id ?? null,
            confirm_source: "manual",
          }
        : { status: "cancelled" },
    ).eq("id", session.id);

    if (err) { toast({ title: "Could not update", description: err.message, variant: "destructive" }); return; }
    toast({ title: approve ? "Payment confirmed — charger will start" : "Session rejected" });
    void load();
  };

  const chargerName = (id: string) => chargers.find((c) => c.id === id)?.name ?? "Unknown charger";

  const openEdit = (c: Charger) => {
    setEditingId(c.id);
    setForm({
      name: c.name, location: c.location ?? "", vehicle_type: c.vehicle_type,
      connector_type: c.connector_type ?? "", power_kw: c.power_kw ? String(c.power_kw) : "",
      ocpp_charge_point_id: c.ocpp_charge_point_id ?? "",
      ocpp_connector_id: String(c.ocpp_connector_id ?? 1),
      ocpp_auth_key: c.ocpp_auth_key ?? "",
    });
    setShowCharger(true);
  };

  const unsecured = chargers.filter((c) => !c.ocpp_auth_key && c.ocpp_charge_point_id);

  if (loading) {
    return <div className="py-10 flex justify-center">
      <div className="h-6 w-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">EV charging could not be loaded</p>
            <p className="text-xs text-muted-foreground break-words">{error}</p>
          </div>
        </div>
      )}

      {!settings && !error && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          No EV settings row for this society. Run <code>ev_charging.sql</code> to create it.
        </div>
      )}

      {/* ── Payments waiting ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Check className="h-4 w-4" />
            Payments to confirm
            {pending.length > 0 && (
              <span className="ml-1 text-xs rounded-full bg-primary text-primary-foreground px-2 py-0.5">
                {pending.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing waiting.</p>
          ) : (
            <div className="space-y-2">
              {pending.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border border-border bg-secondary/30">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {p.resident_label || "Resident"} · {chargerName(p.charger_id)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Paid {formatRupees(p.amount_paid)}
                      {p.credit_applied > 0 && ` + ${formatRupees(p.credit_applied)} credit`}
                      {" · "}buys {formatKwh(p.energy_budget_kwh)}
                    </p>
                    <p className="text-xs font-mono mt-0.5">
                      UTR {p.utr || <span className="text-muted-foreground">not given</span>}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void decide(p, true)}>
                      <Check className="h-4 w-4 mr-1" /> Confirm
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void decide(p, false)}>
                      <X className="h-4 w-4 mr-1" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Check the UTR against your bank credits before confirming. Confirming
            starts the charger.
          </p>
        </CardContent>
      </Card>

      {/* ── Settings ── */}
      {settings && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings2 className="h-4 w-4" /> Charging settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ev-rate">Rate per kWh (₹)</Label>
                <Input
                  id="ev-rate" type="number" min="0.01" step="0.01"
                  value={settings.rate_per_kwh}
                  onChange={(e) => setSettings({ ...settings, rate_per_kwh: Number(e.target.value) })}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v > 0) void patchSettings({ rate_per_kwh: v });
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Applies to new sessions only. Sessions already running keep the
                  rate they were created at.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-window">Payment window (minutes)</Label>
                <Input
                  id="ev-window" type="number" min="1" step="1"
                  value={settings.payment_window_mins}
                  onChange={(e) => setSettings({ ...settings, payment_window_mins: Number(e.target.value) })}
                  onBlur={(e) => void patchSettings({ payment_window_mins: Number(e.target.value) || 15 })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-min">Minimum per session (₹)</Label>
                <Input
                  id="ev-min" type="number" min="1" step="1" value={settings.min_amount}
                  onChange={(e) => setSettings({ ...settings, min_amount: Number(e.target.value) })}
                  onBlur={(e) => void patchSettings({ min_amount: Number(e.target.value) || 20 })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-max">Maximum per session (₹)</Label>
                <Input
                  id="ev-max" type="number" min="1" step="1" value={settings.max_amount}
                  onChange={(e) => setSettings({ ...settings, max_amount: Number(e.target.value) })}
                  onBlur={(e) => void patchSettings({ max_amount: Number(e.target.value) || 1000 })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ev-vpa">Society UPI ID</Label>
              <Input
                id="ev-vpa" placeholder="triumphtowerschs06@mdcb"
                value={settings.upi_vpa ?? ""}
                onChange={(e) => setSettings({ ...settings, upi_vpa: e.target.value })}
                onBlur={(e) => void patchSettings({ upi_vpa: e.target.value.trim() || null })}
              />
              <Input
                className="mt-2" placeholder="Payee name shown in the UPI app"
                value={settings.upi_payee_name ?? ""}
                onChange={(e) => setSettings({ ...settings, upi_payee_name: e.target.value })}
                onBlur={(e) => void patchSettings({ upi_payee_name: e.target.value.trim() || null })}
              />
              <p className="text-xs text-muted-foreground">
                Residents see a QR built from this with the amount already filled
                in. Leave blank and the QR is hidden with a note to contact you.
              </p>
            </div>

            <div className="flex items-start justify-between gap-3 pt-1">
              <div>
                <Label className="text-sm">Require charger authentication</Label>
                <p className="text-xs text-muted-foreground">
                  {unsecured.length > 0
                    ? `${unsecured.length} charger(s) have no OCPP key. Turning this on will disconnect them.`
                    : "Every charger has a key. Safe to turn on."}
                </p>
              </div>
              <Switch
                checked={settings.require_charger_auth}
                onCheckedChange={(v) => void patchSettings({ require_charger_auth: v })}
              />
            </div>

            <div className="flex items-start justify-between gap-3">
              <div>
                <Label className="text-sm">Confirm payments automatically</Label>
                <p className="text-xs text-muted-foreground">
                  Matches the UTR against the bank's credit alerts. Leave off
                  until the email parser has been tested against real messages —
                  manual confirmation keeps working either way.
                </p>
              </div>
              <Switch
                checked={settings.auto_confirm_enabled}
                onCheckedChange={(v) => void patchSettings({ auto_confirm_enabled: v })}
              />
            </div>
            {saving && <p className="text-xs text-muted-foreground">Saving…</p>}
          </CardContent>
        </Card>
      )}

      {/* ── Chargers ── */}
      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Plug className="h-4 w-4" /> Chargers
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={() => { setEditingId(null); setForm(emptyCharger()); setShowCharger(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {chargers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No chargers yet. Add one, then set the same OCPP ID on the unit so
              it can connect.
            </p>
          ) : (
            <div className="space-y-2">
              {chargers.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border border-border bg-secondary/30">
                  <div className="min-w-0">
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      {c.name}
                      {c.ocpp_auth_key
                        ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-label="Secured" />
                        : <ShieldAlert className="h-3.5 w-3.5 text-amber-600" aria-label="No OCPP key set" />}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {VEHICLE_LABEL[c.vehicle_type]}
                      {c.power_kw ? ` · ${c.power_kw} kW` : ""}
                      {c.location ? ` · ${c.location}` : ""}
                    </p>
                    <p className="text-xs font-mono text-muted-foreground mt-0.5">
                      {c.ocpp_charge_point_id
                        ? `${c.ocpp_charge_point_id} / connector ${c.ocpp_connector_id}`
                        : "no OCPP ID set"}
                      {" · "}{c.status}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => openEdit(c)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon" variant="outline" className="h-8 w-8"
                      onClick={async () => {
                        const { error: err } = await evDb.from("ev_chargers")
                          .update({ is_active: !c.is_active }).eq("id", c.id);
                        if (err) toast({ title: "Could not update", description: err.message, variant: "destructive" });
                        else void load();
                      }}
                      title={c.is_active ? "Deactivate" : "Activate"}
                    >
                      {c.is_active ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Add / edit a charger ── */}
      <Dialog open={showCharger} onOpenChange={(o) => { if (!o) { setShowCharger(false); setEditingId(null); } }}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit charger" : "Add charger"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input value={form.name} placeholder="Basement A1"
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Location</Label>
              <Input value={form.location} placeholder="Basement, pillar 4"
                onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Vehicle type</Label>
                <Select value={form.vehicle_type}
                  onValueChange={(v) => setForm({ ...form, vehicle_type: v as VehicleType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="four_wheeler">{VEHICLE_LABEL.four_wheeler}</SelectItem>
                    <SelectItem value="two_wheeler">{VEHICLE_LABEL.two_wheeler}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Power (kW)</Label>
                <Input type="number" step="0.1" value={form.power_kw} placeholder="7.4"
                  onChange={(e) => setForm({ ...form, power_kw: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Connector type</Label>
              <Input value={form.connector_type} placeholder="Type 2 / CCS2 / Bharat AC-001"
                onChange={(e) => setForm({ ...form, connector_type: e.target.value })} />
            </div>

            <div className="pt-2 border-t border-border space-y-3">
              <p className="text-xs font-medium text-muted-foreground">OCPP connection</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1 col-span-2">
                  <Label>Charge point ID</Label>
                  <Input value={form.ocpp_charge_point_id} placeholder="CP-001"
                    onChange={(e) => setForm({ ...form, ocpp_charge_point_id: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Connector</Label>
                  <Input type="number" min="0" value={form.ocpp_connector_id}
                    onChange={(e) => setForm({ ...form, ocpp_connector_id: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Must match exactly what the unit sends. If you do not know it,
                point the charger at the server and read it from the log.
              </p>
              <div className="space-y-1">
                <Label>OCPP key</Label>
                <Input value={form.ocpp_auth_key} placeholder="Leave blank for no authentication"
                  onChange={(e) => setForm({ ...form, ocpp_auth_key: e.target.value })} />
                <p className="text-xs text-muted-foreground">
                  Put the same string in the charger's "Authorization key" field.
                  Without it, anyone who learns the charge point ID can connect
                  as this charger.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCharger(false); setEditingId(null); }}>Cancel</Button>
            <Button onClick={() => void saveCharger()} disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Add charger"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EvChargingAdmin;
