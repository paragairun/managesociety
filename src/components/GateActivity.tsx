import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Radio, DoorOpen, DoorClosed, ShieldAlert, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables } from "@/integrations/supabase/types";

type Device = Tables<"barrier_devices">;
type Event = Tables<"barrier_events">;

const GateActivity = () => {
  const { user, societyId } = useAuth();
  const { toast } = useToast();
  const [devices, setDevices] = useState<Device[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [d, e] = await Promise.all([
      supabase.from("barrier_devices").select("*").order("name"),
      supabase.from("barrier_events").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    if (d.data) setDevices(d.data as Device[]);
    if (e.data) setEvents(e.data as Event[]);
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("barrier-events")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "barrier_events" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load]);

  const override = async (device: Device, decision: "manual_open" | "manual_close") => {
    if (!societyId) { toast({ title: "Society not loaded", variant: "destructive" }); return; }
    setBusy(device.id);
    const { error } = await supabase.from("barrier_events").insert({
      device_id: device.id,
      decision,
      reason: "guard_override",
      actor_user_id: user?.id ?? null,
      society_id: societyId,
    });
    setBusy(null);
    if (error) { toast({ title: "Override failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: decision === "manual_open" ? "Barrier opened" : "Barrier closed", description: device.name });
    void load();
  };

  const isOnline = (d: Device) => d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 60_000;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Radio className="h-5 w-5 text-primary-ink" /> Boom Barriers ({devices.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {devices.length === 0 ? (
            <p className="text-muted-foreground text-center py-4 text-sm">
              No barrier devices configured. Ask an admin to add one.
            </p>
          ) : devices.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-secondary/50 border border-border">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-foreground truncate">{d.name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${isOnline(d) ? "bg-success/20 text-success-ink" : "bg-muted text-muted-foreground"}`}>
                    {isOnline(d) ? "online" : "offline"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{d.location ?? "—"} • {d.direction}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="outline" disabled={busy === d.id} onClick={() => void override(d, "manual_open")} className="gap-1">
                  <DoorOpen className="h-4 w-4" /> Open
                </Button>
                <Button size="sm" variant="outline" disabled={busy === d.id} onClick={() => void override(d, "manual_close")} className="gap-1">
                  <DoorClosed className="h-4 w-4" /> Close
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Recent Gate Activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {events.length === 0 ? (
            <p className="text-muted-foreground text-center py-4 text-sm">No events yet.</p>
          ) : events.map((ev) => {
            const opened = ev.decision === "opened" || ev.decision === "manual_open";
            return (
              <div key={ev.id} className="flex items-center gap-3 p-2 rounded-lg border border-border">
                {opened ? <ShieldCheck className="h-4 w-4 text-success-ink shrink-0" /> : <ShieldAlert className="h-4 w-4 text-destructive-ink shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {ev.vehicle_number ?? "—"} • {ev.decision} {ev.reason ? `(${ev.reason})` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">{new Date(ev.created_at).toLocaleString()}</p>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </>
  );
};

export default GateActivity;