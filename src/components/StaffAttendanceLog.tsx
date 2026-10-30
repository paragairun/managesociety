import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Calendar, Clock, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  istMonthRange, summarizeAttendance, formatIstDate, formatIstTime,
  type StaffLogRow as StaffLog, type NameMap, type StaffShift,
} from "@/lib/attendanceSummary";

interface StaffAttendanceLogProps {
  filterStaffId?: string;
  filterCategory?: "society_staff" | "house_help" | "all";
  showSummary?: boolean;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const StaffAttendanceLog = ({ filterStaffId, filterCategory = "all", showSummary = true }: StaffAttendanceLogProps) => {
  const { societyId, roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const isResident = roles.includes("resident");
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [logs, setLogs] = useState<StaffLog[]>([]);
  const [nameMap, setNameMap] = useState<NameMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!societyId) return;
    setLoading(true);
    setError(null);

    // Indian month boundaries, computed independently of the device's own
    // timezone so the dashboard and the receiver agree on which month a
    // punch belongs to.
    const { start, end } = istMonthRange(year, month);

    let q = supabase.from("staff_logs").select("*").eq("society_id", societyId)
      .gte("timestamp", start).lt("timestamp", end).order("timestamp", { ascending: false });
    if (filterStaffId) q = q.eq("staff_id", filterStaffId);
    if (filterCategory !== "all") q = q.eq("category", filterCategory);
    if (isResident && !isAdmin) q = q.eq("category", "house_help");

    // The error was previously discarded. That is how a hard 500 from a
    // recursive RLS policy showed up as "No attendance records for this
    // period" — an empty month and a broken query looked identical, and
    // the real cause only surfaced in the browser's network tab.
    const { data: logData, error: logErr } = await q;
    if (logErr) {
      setError(logErr.message);
      setLogs([]);
      setNameMap({});
      setLoading(false);
      return;
    }

    const fetched = (logData ?? []) as StaffLog[];
    const ids = [...new Set(fetched.map((l) => l.staff_id))];
    const map: NameMap = {};

    if (ids.length > 0) {
      const [{ data: sd, error: sErr }, { data: hd, error: hErr }] = await Promise.all([
        supabase.from("staff_members").select("id, name, staff_type, shift").in("id", ids),
        supabase.from("house_helps").select("id, name, help_type, shift").in("id", ids),
      ]);
      // A failed name lookup is reported rather than silently rendering
      // every row as "Unknown".
      if (sErr || hErr) setError((sErr ?? hErr)!.message);
      // shift drives which attendance day each row is filed under, so it
      // has to come back with the name, not be defaulted here.
      const asShift = (v: unknown): StaffShift => (v === "night" ? "night" : "day");
      (sd ?? []).forEach((s: { id: string; name: string; staff_type: string; shift?: string }) => {
        map[s.id] = { name: s.name, role: s.staff_type, shift: asShift(s.shift) };
      });
      (hd ?? []).forEach((h: { id: string; name: string; help_type: string; shift?: string }) => {
        map[h.id] = { name: h.name, role: h.help_type, shift: asShift(h.shift) };
      });
    }

    setNameMap(map);
    setLogs(fetched);
    setLoading(false);
  }, [societyId, month, year, filterStaffId, filterCategory, isAdmin, isResident]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // Grouped by the Indian day, not the UTC date. See attendanceSummary.ts.
  const summary = summarizeAttendance(logs, nameMap);

  const avgHours = (() => {
    const withHours = summary.filter((d) => d.hours_worked !== null);
    if (withHours.length === 0) return null;
    return Math.round(withHours.reduce((s, d) => s + (d.hours_worked ?? 0), 0) / withHours.length * 10) / 10;
  })();

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Month</Label>
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{MONTHS.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Year</Label>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>{[now.getFullYear()-1, now.getFullYear()].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {showSummary && !loading && summary.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card><CardContent className="p-3 text-center">
            <Calendar className="h-4 w-4 mx-auto mb-1 text-primary-ink" />
            <p className="text-2xl font-bold">{summary.length}</p>
            <p className="text-xs text-muted-foreground">Days present</p>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <Clock className="h-4 w-4 mx-auto mb-1 text-primary-ink" />
            <p className="text-2xl font-bold">{avgHours ?? "—"}</p>
            <p className="text-xs text-muted-foreground">Avg hrs/day</p>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <TrendingUp className="h-4 w-4 mx-auto mb-1 text-primary-ink" />
            <p className="text-2xl font-bold">{logs.length}</p>
            <p className="text-xs text-muted-foreground">Total scans</p>
          </CardContent></Card>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-destructive-ink mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-destructive-ink">Attendance could not be loaded</p>
            <p className="text-xs text-muted-foreground break-words">{error}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-8 flex justify-center"><div className="h-6 w-6 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : error ? null : summary.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No attendance records for this period.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40">
              <tr>
                <th className="text-left p-2 font-medium text-muted-foreground text-xs">Date</th>
                {!filterStaffId && <th className="text-left p-2 font-medium text-muted-foreground text-xs">Name</th>}
                <th className="text-left p-2 font-medium text-muted-foreground text-xs">Shift</th>
                <th className="text-left p-2 font-medium text-muted-foreground text-xs">In</th>
                <th className="text-left p-2 font-medium text-muted-foreground text-xs">Out</th>
                <th className="text-left p-2 font-medium text-muted-foreground text-xs">Hrs</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((d, i) => (
                <tr key={i} className="border-t border-border/50">
                  <td className="p-2 text-xs text-muted-foreground">{formatIstDate(d.date)}</td>
                  {!filterStaffId && <td className="p-2"><p className="font-medium text-xs">{d.staff_name}</p><p className="text-xs text-muted-foreground">{d.staff_role}</p></td>}
                  <td className="p-2 text-xs">
                    {d.shift === "night"
                      ? <span className="text-muted-foreground" title="Attendance day runs 9 AM to 9 AM">Night</span>
                      : <span className="text-muted-foreground">Day</span>}
                  </td>
                  <td className="p-2 font-mono text-xs">{d.first_entry ? formatIstTime(d.first_entry) : "—"}</td>
                  <td className="p-2 font-mono text-xs">{d.last_exit ? formatIstTime(d.last_exit) : "—"}</td>
                  <td className="p-2 font-mono text-xs">{d.hours_worked !== null ? `${d.hours_worked}h` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default StaffAttendanceLog;
