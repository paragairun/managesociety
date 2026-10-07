import { useCallback, useEffect, useMemo, useState } from "react";
import { Fingerprint, Loader2, Clock, CheckCircle2, RefreshCw, Link2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Assign biometric-terminal user ids ("PINs") to staff and house helps.
 *
 * Staff enrol their finger ON the eSSL terminal, which knows them only as
 * a number. The first time that number punches, it shows up here as
 * unassigned; pick the person from the dropdown and every future punch
 * becomes an attendance record for them.
 *
 * The PIN lives on the person's own row (staff_members.device_pin /
 * house_helps.device_pin), so the spreadsheet import can fill it in for a
 * whole society at once and this screen is only needed for stragglers.
 */

interface UnmappedPin {
  device_pin: string;
  punch_count: number;
  first_seen: string;
  last_seen: string;
}

interface Person {
  id: string;
  name: string;
  role: string;
  category: "society_staff" | "house_help";
  device_pin: string | null;
}

const DevicePinMapping = () => {
  const { societyId } = useAuth();
  const { toast } = useToast();
  const [unmapped, setUnmapped] = useState<UnmappedPin[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!societyId) return;
    setLoading(true);

    const [pins, staff, helps] = await Promise.all([
      supabase.from("unmapped_device_pins")
        .select("device_pin, punch_count, first_seen, last_seen")
        .eq("society_id", societyId)
        .order("last_seen", { ascending: false }),
      supabase.from("staff_members")
        .select("id, name, staff_type, device_pin")
        .eq("society_id", societyId).eq("is_active", true).order("name"),
      supabase.from("house_helps")
        .select("id, name, help_type, device_pin")
        .eq("society_id", societyId).eq("is_active", true).order("name"),
    ]);

    setUnmapped((pins.data ?? []) as UnmappedPin[]);
    setPeople([
      ...((staff.data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id), name: String(r.name), role: String(r.staff_type ?? ""),
        category: "society_staff" as const,
        device_pin: r.device_pin ? String(r.device_pin) : null,
      })),
      ...((helps.data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id), name: String(r.name), role: String(r.help_type ?? ""),
        category: "house_help" as const,
        device_pin: r.device_pin ? String(r.device_pin) : null,
      })),
    ]);
    setLoading(false);
  }, [societyId]);

  useEffect(() => { void load(); }, [load]);

  // New punches should appear without the admin reloading the page.
  useEffect(() => {
    const channel = supabase
      .channel("device-punch-changes")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "device_punches" },
        () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load]);

  const unassigned = useMemo(() => people.filter((p) => !p.device_pin), [people]);
  const assigned = useMemo(
    () => people.filter((p) => p.device_pin)
      .sort((a, b) => Number(a.device_pin) - Number(b.device_pin)),
    [people],
  );

  const assign = async (pin: string) => {
    const personKey = choice[pin];
    if (!personKey) {
      toast({ title: "Pick a person first", variant: "destructive" });
      return;
    }
    const person = people.find((p) => `${p.category}:${p.id}` === personKey);
    if (!person) return;

    setSaving(pin);
    const table = person.category === "society_staff" ? "staff_members" : "house_helps";
    const { error } = await supabase.from(table)
      .update({ device_pin: pin })
      .eq("id", person.id);
    setSaving(null);

    if (error) {
      // The partial unique index is what stops two people sharing a PIN.
      const clash = error.message.includes("society_pin_uniq");
      toast({
        title: clash ? "That PIN is already taken" : "Could not assign PIN",
        description: clash
          ? `PIN ${pin} is already assigned to someone else in this society. Clear it there first.`
          : error.message,
        variant: "destructive",
      });
      return;
    }

    toast({ title: `PIN ${pin} assigned to ${person.name}` });
    setChoice((c) => ({ ...c, [pin]: "" }));
    await load();
  };

  const clearPin = async (person: Person) => {
    const table = person.category === "society_staff" ? "staff_members" : "house_helps";
    const { error } = await supabase.from(table).update({ device_pin: null }).eq("id", person.id);
    if (error) {
      toast({ title: "Could not clear PIN", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `PIN cleared for ${person.name}` });
    await load();
  };

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-IN",
      { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Fingerprint className="h-4 w-4" /> Unassigned fingerprint IDs
            {unmapped.length > 0 && <Badge variant="destructive">{unmapped.length}</Badge>}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => void load()} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : unmapped.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nothing waiting. IDs appear here the first time someone punches on the
              terminal without being linked to a person yet.
            </p>
          ) : (
            <div className="space-y-3">
              {unmapped.map((u) => (
                <div key={u.device_pin} className="p-3 rounded-lg border border-border bg-secondary/30 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <span className="font-mono font-bold text-lg">ID {u.device_pin}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {u.punch_count} punch{u.punch_count === 1 ? "" : "es"}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> last {fmt(u.last_seen)}
                    </span>
                  </div>
                  <div className="flex gap-2 flex-col sm:flex-row">
                    <Select
                      value={choice[u.device_pin] ?? ""}
                      onValueChange={(v) => setChoice((c) => ({ ...c, [u.device_pin]: v }))}
                    >
                      <SelectTrigger className="touch-target flex-1">
                        <SelectValue placeholder="Who is this?" />
                      </SelectTrigger>
                      <SelectContent>
                        {unassigned.length === 0 && (
                          <div className="px-2 py-3 text-xs text-muted-foreground">
                            Everyone already has an ID. Clear one below to reassign.
                          </div>
                        )}
                        {unassigned.map((p) => (
                          <SelectItem key={`${p.category}:${p.id}`} value={`${p.category}:${p.id}`}>
                            {p.name} — {p.role}
                            {p.category === "house_help" ? " (help)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={() => void assign(u.device_pin)}
                      disabled={saving === u.device_pin || !choice[u.device_pin]}
                      className="touch-target gap-1.5"
                    >
                      {saving === u.device_pin
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Link2 className="h-4 w-4" />}
                      Assign
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> Assigned IDs
            <Badge variant="secondary">{assigned.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {assigned.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nobody has a fingerprint ID yet. Assign them above, or include a
              <code className="mx-1">device_pin</code> column in the staff spreadsheet.
            </p>
          ) : (
            <div className="space-y-2">
              {assigned.map((p) => (
                <div key={`${p.category}:${p.id}`}
                     className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-border">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {p.role}{p.category === "house_help" ? " · house help" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono font-bold">ID {p.device_pin}</span>
                    <Button variant="ghost" size="sm" onClick={() => void clearPin(p)}>Clear</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DevicePinMapping;
