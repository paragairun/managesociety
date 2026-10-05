import { useCallback, useEffect, useMemo, useState } from "react";
import { Shield, Search, Trash2, Clock, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * Guard accounts registry — the third registry alongside Vehicles and
 * Users, scoped to the guard role.
 *
 * It answers the questions an admin actually has about guards, which the
 * general User Registry does not: who is on the gate, when did they last
 * log an entry, and how much have they logged. Those come from
 * entry_logs/staff_logs where logged_by is the guard's user id.
 */

interface GuardRow {
  user_id: string;
  display_name: string | null;
  email: string | null;
  created_at?: string | null;
  lastActivity: string | null;
  entriesLogged: number;
  staffScans: number;
}

const GuardRegistry = () => {
  const { societyId } = useAuth();
  const { toast } = useToast();
  const [guards, setGuards] = useState<GuardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchGuards = useCallback(async () => {
    setLoading(true);
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      toast({ title: "Session expired", description: "Please sign in again.", variant: "destructive" });
      setLoading(false);
      return;
    }

    // Reuse the existing list-users function rather than querying
    // auth.users directly, so e-mail stays behind the service role.
    const { data, error } = await supabase.functions.invoke("list-users", {
      headers: { Authorization: `Bearer ${sess.session.access_token}` },
    });
    if (error || !data?.users) {
      toast({ title: "Could not load guards", description: error?.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const guardUsers = (data.users as { user_id: string; role: string; display_name: string | null; email: string | null }[])
      .filter((u) => u.role === "guard");

    if (guardUsers.length === 0) { setGuards([]); setLoading(false); return; }

    const ids = guardUsers.map((g) => g.user_id);
    const [entries, staffScans] = await Promise.all([
      supabase.from("entry_logs").select("logged_by, entry_time")
        .eq("society_id", societyId ?? "").in("logged_by", ids),
      supabase.from("staff_logs").select("logged_by, timestamp")
        .eq("society_id", societyId ?? "").in("logged_by", ids),
    ]);

    const entryRows = (entries.data ?? []) as { logged_by: string | null; entry_time: string }[];
    const scanRows = (staffScans.data ?? []) as { logged_by: string | null; timestamp: string }[];

    setGuards(guardUsers.map((g) => {
      const mine = entryRows.filter((r) => r.logged_by === g.user_id);
      const scans = scanRows.filter((r) => r.logged_by === g.user_id);
      const times = [...mine.map((r) => r.entry_time), ...scans.map((r) => r.timestamp)]
        .filter(Boolean).sort();
      return {
        ...g,
        entriesLogged: mine.length,
        staffScans: scans.length,
        lastActivity: times.length ? times[times.length - 1] : null,
      };
    }));
    setLoading(false);
  }, [societyId, toast]);

  useEffect(() => { void fetchGuards(); }, [fetchGuards]);

  useEffect(() => {
    const channel = supabase
      .channel("guard-registry-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles" }, () => { void fetchGuards(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [fetchGuards]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return guards;
    return guards.filter((g) =>
      (g.display_name ?? "").toLowerCase().includes(q) ||
      (g.email ?? "").toLowerCase().includes(q));
  }, [guards, query]);

  const removeGuard = async (g: GuardRow) => {
    setDeletingId(g.user_id);
    const { data: sess } = await supabase.auth.getSession();
    const { error } = await supabase.functions.invoke("delete-user", {
      body: { user_id: g.user_id },
      headers: { Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
    });
    setDeletingId(null);
    if (error) { toast({ title: "Could not remove guard", description: error.message, variant: "destructive" }); return; }
    toast({ title: `${g.display_name ?? "Guard"} removed` });
    await fetchGuards();
  };

  const fmt = (iso: string | null) => {
    if (!iso) return "No activity yet";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "No activity yet";
    return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="h-4 w-4" /> Guard Registry
          <Badge variant="secondary" className="ml-1">{guards.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search guards by name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 touch-target"
          />
        </div>

        {loading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {guards.length === 0
              ? "No guard accounts yet. Guards appear here once their registration is approved."
              : "No guards match that search."}
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map((g) => (
              <div key={g.user_id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-secondary/30">
                <div className="min-w-0">
                  <p className="font-medium truncate">{g.display_name ?? "Unnamed guard"}</p>
                  <p className="text-xs text-muted-foreground truncate">{g.email}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                    <Clock className="h-3 w-3" /> Last active: {fmt(g.lastActivity)}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-semibold">{g.entriesLogged}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Entries</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{g.staffScans}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Staff scans</p>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" disabled={deletingId === g.user_id} aria-label={`Remove ${g.display_name ?? "guard"}`}>
                        {deletingId === g.user_id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Trash2 className="h-4 w-4 text-destructive" />}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove this guard account?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {g.display_name ?? "This guard"} will lose access immediately.
                          Entries they already logged are kept for the audit trail.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void removeGuard(g)}>Remove</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default GuardRegistry;
