import { useEffect, useState } from "react";
import {
  Plus, Car, Users, Radio, FileSpreadsheet,
  Sparkles, ArrowRight, LogIn, LogOut, Activity, Shield } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables } from "@/integrations/supabase/types";

type EntryLog = Tables<"entry_logs">;

interface AdminStats {
  total_vehicles: number; currently_inside: number; today_entries: number;
  week_entries: number; total_residents: number; pending_requests: number;
}

interface AdminHomeProps {
  societyName: string;
  stats: AdminStats;
  recentEntries: EntryLog[];
  onNavigate: (view: string) => void;
}

const money = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const TILES = [
  { id: "register", title: "Register Vehicle", icon: Plus, tint: "bg-primary/10 text-primary" },
  { id: "registry", title: "Vehicle Registry", icon: Car, tint: "bg-accent/10 text-accent" },
  { id: "users", title: "User Registry", icon: Users, tint: "bg-primary/10 text-primary" },
  { id: "vehicle-requests", title: "Vehicle Requests", icon: FileSpreadsheet, tint: "bg-warning/10 text-warning" },
  { id: "staff", title: "Staff", icon: Users, tint: "bg-accent/10 text-accent" },
  { id: "guards", title: "Guard Registry", icon: Shield, tint: "bg-accent/10 text-accent" },
  { id: "barriers", title: "Boom Barriers", icon: Radio, tint: "bg-success/10 text-success" },
];

const AdminHome = ({ societyName, stats, recentEntries, onNavigate }: AdminHomeProps) => {
  const { societyId } = useAuth();
  const [outstanding, setOutstanding] = useState<number | null>(null);
  const [pendingAmenities, setPendingAmenities] = useState(0);

  useEffect(() => {
    if (!societyId) return;
    let active = true;
    void supabase
      .from("maintenance_bills")
      .select("total_amount, amount_paid")
      .eq("society_id", societyId)
      .neq("status", "paid")
      .then(({ data }) => {
        if (!active) return;
        if (!data) { setOutstanding(null); return; }
        setOutstanding(data.reduce((sum, b) => sum + Math.max(0, b.total_amount - b.amount_paid), 0));
      });
    void supabase
      .from("amenity_bookings")
      .select("id", { count: "exact", head: true })
      .eq("society_id", societyId)
      .eq("status", "pending_approval")
      .then(({ count }) => { if (active) setPendingAmenities(count ?? 0); });
    return () => { active = false; };
  }, [societyId]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{societyName}</h2>
        <p className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </div>

      {/* Hero row: today's activity + outstanding collections */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-l-4 border-l-success cursor-pointer hover:shadow-md transition-shadow" onClick={() => onNavigate("stats")}>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Currently inside</p>
            <p className="text-2xl font-bold flex items-center gap-2"><Activity className="h-5 w-5 text-success" /> {stats.currently_inside}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-warning cursor-pointer hover:shadow-md transition-shadow" onClick={() => onNavigate("billing-setup")}>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Dues outstanding</p>
            <p className="text-2xl font-bold">{outstanding === null ? "—" : money(outstanding)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Today's Entries</p><p className="text-xl font-semibold">{stats.today_entries}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Last 7 Days</p><p className="text-xl font-semibold">{stats.week_entries}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Residents</p><p className="text-xl font-semibold">{stats.total_residents}</p></CardContent></Card>
        <Card className={stats.pending_requests > 0 ? "cursor-pointer hover:shadow-md transition-shadow" : ""} onClick={() => stats.pending_requests > 0 && onNavigate("vehicle-requests")}>
          <CardContent className="p-3"><p className="text-xs text-muted-foreground">Pending Requests</p><p className="text-xl font-semibold">{stats.pending_requests}</p></CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Quick actions</h3>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {TILES.map((tile) => {
            const Icon = tile.icon;
            const badge = tile.id === "vehicle-requests" && stats.pending_requests > 0 ? stats.pending_requests : null;
            return (
              <button
                key={tile.id}
                onClick={() => onNavigate(tile.id)}
                className="flex flex-col items-center gap-2 p-3 rounded-xl border border-border bg-card hover:bg-secondary/50 transition-colors relative touch-target"
              >
                {badge !== null && (
                  <span className="absolute -top-1.5 -right-1.5 h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-xs font-semibold flex items-center justify-center">
                    {badge}
                  </span>
                )}
                <span className={`h-11 w-11 rounded-full flex items-center justify-center ${tile.tint}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-xs font-medium text-center leading-tight">{tile.title}</span>
              </button>
            );
          })}

          {/* Amenities -- now live: jump straight to bookings needing review */}
          <button
            onClick={() => onNavigate("amenities-bookings")}
            className="flex flex-col items-center gap-2 p-3 rounded-xl border border-border bg-card hover:bg-secondary/50 transition-colors relative touch-target"
          >
            {pendingAmenities > 0 && (
              <span className="absolute -top-1.5 -right-1.5 h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-xs font-semibold flex items-center justify-center">
                {pendingAmenities}
              </span>
            )}
            <span className="h-11 w-11 rounded-full flex items-center justify-center bg-warning/10 text-warning">
              <Sparkles className="h-5 w-5" />
            </span>
            <span className="text-xs font-medium text-center leading-tight">Amenities</span>
          </button>
        </div>
      </div>

      {/* Recent activity */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-muted-foreground">Recent activity</h3>
            <button onClick={() => onNavigate("access-logs")} className="text-xs text-primary font-medium flex items-center gap-1">
              See all <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          {recentEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No recent activity yet.</p>
          ) : (
            <div className="space-y-3">
              {recentEntries.slice(0, 5).map((log) => (
                <div key={log.id} className="flex items-center gap-3 text-sm">
                  <span className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${log.exit_time ? "bg-muted text-muted-foreground" : "bg-success/10 text-success"}`}>
                    {log.exit_time ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{log.owner_name || log.vehicle_number} · {log.wing}-{log.flat_number}</p>
                    <p className="text-xs text-muted-foreground capitalize">{log.entry_type} · {new Date(log.entry_time).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</p>
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

export default AdminHome;
