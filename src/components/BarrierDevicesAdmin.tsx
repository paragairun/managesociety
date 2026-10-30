import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Trash2, Copy, Plus, Radio } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables } from "@/integrations/supabase/types";

type Device = Tables<"barrier_devices">;

const generateToken = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

const BarrierDevicesAdmin = () => {
  const { toast } = useToast();
  const { societyId } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [form, setForm] = useState({ name: "", location: "", direction: "both" });
  const [saving, setSaving] = useState(false);
  const [revealId, setRevealId] = useState<string | null>(null);

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/barrier-scan`;

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("barrier_devices").select("*").order("created_at", { ascending: false });
    if (error) { toast({ title: "Could not load devices", description: error.message, variant: "destructive" }); return; }
    setDevices((data ?? []) as Device[]);
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const addDevice = async () => {
    if (!form.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    if (!societyId) { toast({ title: "Society not loaded", variant: "destructive" }); return; }
    setSaving(true);
    const { error } = await supabase.from("barrier_devices").insert({
      name: form.name.trim(),
      location: form.location.trim() || null,
      direction: form.direction,
      device_token: generateToken(),
      society_id: societyId,
    });
    setSaving(false);
    if (error) { toast({ title: "Could not add device", description: error.message, variant: "destructive" }); return; }
    setForm({ name: "", location: "", direction: "both" });
    toast({ title: "Barrier device added" });
    void load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("barrier_devices").delete().eq("id", id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Device removed" });
    void load();
  };

  const toggleActive = async (d: Device) => {
    const { error } = await supabase.from("barrier_devices").update({ is_active: !d.is_active }).eq("id", d.id);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    void load();
  };

  const rotate = async (d: Device) => {
    const { error } = await supabase.from("barrier_devices").update({ device_token: generateToken() }).eq("id", d.id);
    if (error) { toast({ title: "Rotate failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Token rotated — update your hardware" });
    setRevealId(d.id);
    void load();
  };

  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text);
    toast({ title: `${what} copied` });
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Plus className="h-5 w-5 text-primary-ink" /> Add Boom Barrier
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Main Gate" />
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Entry side" />
            </div>
            <div className="space-y-2">
              <Label>Direction</Label>
              <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="entry">Entry</SelectItem>
                  <SelectItem value="exit">Exit</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={() => void addDevice()} disabled={saving} className="gap-2">
            <Plus className="h-4 w-4" /> {saving ? "Adding..." : "Add Device"}
          </Button>
          <div className="rounded-md border border-border bg-secondary/30 p-3 text-xs space-y-1">
            <p className="font-medium text-foreground">Hardware webhook</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all">{webhookUrl}</code>
              <Button size="sm" variant="ghost" onClick={() => void copy(webhookUrl, "Webhook URL")}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <p className="text-muted-foreground">
              POST with header <code>x-device-token: &lt;token&gt;</code> and body
              <code> {`{ "qr": "...", "vehicle_number": "MH01AB1234", "direction": "entry" }`}</code>.
              Response: <code>{`{ "open": true|false, "reason": "..." }`}</code>.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Radio className="h-5 w-5 text-primary-ink" /> Configured Barriers ({devices.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {devices.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No barriers yet.</p>
          ) : devices.map((d) => (
            <div key={d.id} className="p-3 rounded-lg border border-border bg-secondary/40 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-foreground truncate">{d.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.location ?? "—"} • {d.direction} • {d.last_seen_at ? `last seen ${new Date(d.last_seen_at).toLocaleString()}` : "never seen"}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex items-center gap-2">
                    <Switch checked={d.is_active} onCheckedChange={() => void toggleActive(d)} />
                    <span className="text-xs text-muted-foreground">{d.is_active ? "Active" : "Disabled"}</span>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => void rotate(d)}>Rotate token</Button>
                  <Button size="sm" variant="destructive" onClick={() => void remove(d.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Token:</span>
                {revealId === d.id ? (
                  <>
                    <code className="flex-1 break-all">{d.device_token}</code>
                    <Button size="sm" variant="ghost" onClick={() => void copy(d.device_token, "Token")}>
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRevealId(null)}>Hide</Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setRevealId(d.id)}>Reveal</Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
};

export default BarrierDevicesAdmin;