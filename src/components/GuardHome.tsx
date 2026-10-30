import { useEffect, useState } from "react";
import {
  Search, ClipboardList, Car, Radio, Package, UserPlus,
  Sparkles, ArrowRight, LogIn, LogOut,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables } from "@/integrations/supabase/types";

type EntryLog = Tables<"entry_logs">;

interface GuardHomeProps {
  societyName: string;
  pendingApprovals: number;
  liveInside: number;
  onNavigate: (view: string) => void;
  onRegisterDelivery: () => void;
  /** Societies on RFID barriers never scan, so the Scan tile is hidden. */
  gateEntryMode: "qr_sticker" | "rfid";
}

/**
 * The two things that happen at a gate, side by side and equal.
 *
 * Almost everyone arriving is either a visitor or a delivery, and which
 * one is obvious to the guard before they look at the screen — so
 * neither should be the default and neither should be below the fold.
 */

const TILES = [
  // scanOnly: withheld on a society using RFID boom barriers, where
  // nothing is scanned and a dead tile is worse than a missing one.
  { id: "scan", title: "Search & Scan", icon: Search, tint: "bg-primary/10 text-primary-ink", scanOnly: true },
  { id: "approvals", title: "Pending Approvals", icon: ClipboardList, tint: "bg-warning/10 text-warning-ink", scanOnly: false },
  { id: "live", title: "Live Inside", icon: Car, tint: "bg-success/10 text-success-ink", scanOnly: false },
  { id: "barriers", title: "Boom Barriers", icon: Radio, tint: "bg-accent/10 text-accent-ink", scanOnly: false },
  { id: "delivery", title: "Deliveries", icon: Package, tint: "bg-success/10 text-success-ink", scanOnly: false },
];

const GuardHome = ({ societyName, pendingApprovals, liveInside, onNavigate, onRegisterDelivery, gateEntryMode }: GuardHomeProps) => {
  const { societyId } = useAuth();
  const { toast } = useToast();
  const [recentEntries, setRecentEntries] = useState<EntryLog[]>([]);

  useEffect(() => {
    if (!societyId) return;
    let active = true;
    void supabase
      .from("entry_logs")
      .select("*")
      .eq("society_id", societyId)
      .order("entry_time", { ascending: false })
      .limit(5)
      .then(({ data }) => { if (active) setRecentEntries(data ?? []); });
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

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onNavigate("visitor")}
          className="rounded-xl border-2 border-primary bg-primary/10 p-5 text-center
                     flex flex-col items-center justify-center gap-1 min-h-[132px]
                     transition hover:bg-primary/20"
        >
          <UserPlus className="h-8 w-8 text-primary-ink" />
          <span className="text-lg font-extrabold text-foreground">Visitor</span>
          <span className="text-xs text-muted-foreground">Scan a pass or register one</span>
        </button>

        <button
          type="button"
          onClick={onRegisterDelivery}
          className="rounded-xl border-2 border-success bg-success/10 p-5 text-center
                     flex flex-col items-center justify-center gap-1 min-h-[132px]
                     transition hover:bg-success/20"
        >
          <Package className="h-8 w-8 text-success-ink" />
          <span className="text-lg font-extrabold text-foreground">Delivery</span>
          <span className="text-xs text-muted-foreground">Register an agent</span>
        </button>
      </div>

      {/* Hero stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card
          className={`border-l-4 border-l-warning ${pendingApprovals > 0 ? "cursor-pointer hover:shadow-md transition-shadow" : ""}`}
          onClick={() => pendingApprovals > 0 && onNavigate("approvals")}
        >
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Pending approvals</p>
            <p className="text-2xl font-bold">{pendingApprovals}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-success cursor-pointer hover:shadow-md transition-shadow" onClick={() => onNavigate("live")}>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Currently inside</p>
            <p className="text-2xl font-bold">{liveInside}</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Quick actions</h3>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {TILES.filter((t) => !(t.scanOnly && gateEntryMode === "rfid")).map((tile) => {
            const Icon = tile.icon;
            const badge = tile.id === "approvals" && pendingApprovals > 0 ? pendingApprovals : null;
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

          {/* Amenities -- dummy placeholder, feature not built yet */}
          <button
            onClick={() => toast({ title: "Coming soon", description: "Amenity check-in is on its way!" })}
            className="flex flex-col items-center gap-2 p-3 rounded-xl border border-dashed border-border bg-muted/30 hover:bg-muted/50 transition-colors relative touch-target"
          >
            <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-semibold border border-border">
              SOON
            </span>
            <span className="h-11 w-11 rounded-full flex items-center justify-center bg-muted text-muted-foreground">
              <Sparkles className="h-5 w-5" />
            </span>
            <span className="text-xs font-medium text-center leading-tight text-muted-foreground">Amenities</span>
          </button>
        </div>
      </div>

      {/* Recent activity */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-muted-foreground">Recent activity</h3>
            <button onClick={() => onNavigate("live")} className="text-xs text-primary-ink font-medium flex items-center gap-1">
              See all <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          {recentEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No recent activity yet.</p>
          ) : (
            <div className="space-y-3">
              {recentEntries.map((log) => (
                <div key={log.id} className="flex items-center gap-3 text-sm">
                  <span className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${log.exit_time ? "bg-muted text-muted-foreground" : "bg-success/10 text-success-ink"}`}>
                    {log.exit_time ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{log.owner_name || log.vehicle_number}{log.wing && ` · ${log.wing}-${log.flat_number}`}</p>
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

export default GuardHome;
