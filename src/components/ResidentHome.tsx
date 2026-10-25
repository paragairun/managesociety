import { useEffect, useState } from "react";
import {
  QrCode, Car, Wallet, Users, Package, ClipboardList,
  Sparkles, ArrowRight, LogIn, LogOut, Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

interface ResidentFlat { id: string; wing: string; flat_number: string; flat_label: string; }
interface VisitLog { id: string; vehicle_number: string; owner_name: string; entry_type: string; entry_time: string; exit_time: string | null; }

interface ResidentHomeProps {
  displayName: string;
  societyName: string;
  flats: ResidentFlat[];
  formatFlat: (wing: string, flatNumber: string) => string;
  pendingDeliveries: number;
  visitLogs: VisitLog[];
  onNavigate: (view: string) => void;
}

const money = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const TILES = [
  { id: "guest", title: "Guest Pass", icon: QrCode, tint: "bg-primary/10 text-primary" },
  { id: "vehicles", title: "My Vehicles", icon: Car, tint: "bg-accent/10 text-accent" },
  { id: "dues", title: "My Dues", icon: Wallet, tint: "bg-warning/10 text-warning" },
  { id: "deliveries", title: "Deliveries", icon: Package, tint: "bg-success/10 text-success" },
  { id: "ev", title: "EV Charging", icon: Zap, tint: "bg-primary/10 text-primary" },
  { id: "helps", title: "House Helps", icon: Users, tint: "bg-primary/10 text-primary" },
  { id: "history", title: "Visit History", icon: ClipboardList, tint: "bg-accent/10 text-accent" },
];

const ResidentHome = ({ displayName, societyName, flats, formatFlat, pendingDeliveries, visitLogs, onNavigate }: ResidentHomeProps) => {
  const [outstanding, setOutstanding] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.from("maintenance_bills").select("total_amount, amount_paid").then(({ data }) => {
      if (!active) return;
      if (!data) { setOutstanding(null); return; }
      const total = data.reduce((sum, b) => sum + Math.max(0, b.total_amount - b.amount_paid), 0);
      setOutstanding(total);
    });
    return () => { active = false; };
  }, []);

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  })();

  const primaryFlatLabel = flats[0] ? formatFlat(flats[0].wing, flats[0].flat_number) : null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{greeting}{displayName ? `, ${displayName.split(" ")[0]}` : ""}</h2>
        <p className="text-sm text-muted-foreground">{societyName}{primaryFlatLabel ? ` · ${primaryFlatLabel}` : ""}</p>
      </div>

      {/* Dues hero card */}
      <Card
        className="cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-primary"
        onClick={() => onNavigate("dues")}
      >
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Outstanding dues</p>
            {outstanding === null ? (
              <p className="text-2xl font-bold text-muted-foreground">—</p>
            ) : (
              <p className={`text-2xl font-bold ${outstanding > 0 ? "text-foreground" : "text-success"}`}>
                {outstanding > 0 ? money(outstanding) : "All clear ✓"}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 text-sm text-primary font-medium">
            View <ArrowRight className="h-4 w-4" />
          </div>
        </CardContent>
      </Card>

      {/* Quick actions */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Quick actions</h3>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {TILES.map((tile) => {
            const Icon = tile.icon;
            const badge = tile.id === "deliveries" && pendingDeliveries > 0 ? pendingDeliveries : null;
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

          {/* Amenities -- now live */}
          <button
            onClick={() => onNavigate("amenities")}
            className="flex flex-col items-center gap-2 p-3 rounded-xl border border-border bg-card hover:bg-secondary/50 transition-colors relative touch-target"
          >
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
            <button onClick={() => onNavigate("history")} className="text-xs text-primary font-medium flex items-center gap-1">
              See all <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          {visitLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No recent activity yet.</p>
          ) : (
            <div className="space-y-3">
              {visitLogs.slice(0, 3).map((log) => (
                <div key={log.id} className="flex items-center gap-3 text-sm">
                  <span className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${log.exit_time ? "bg-muted text-muted-foreground" : "bg-success/10 text-success"}`}>
                    {log.exit_time ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{log.owner_name || log.vehicle_number}</p>
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

export default ResidentHome;
