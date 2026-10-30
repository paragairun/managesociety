import { useCallback, useEffect, useState } from "react";
import { ScanLine, Check, X, LogOut, Car, Search, ClipboardList, Radio, Package, Home, Fingerprint, UserPlus } from "lucide-react";
import VehicleSearch from "@/components/VehicleSearch";
import GateActivity from "@/components/GateActivity";
import GuardHome from "@/components/GuardHome";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatusBadge from "@/components/StatusBadge";
import QrScanner from "@/components/QrScanner";
import FingerprintStatus from "@/components/FingerprintStatus";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { resolveGateScan, describeOutcome } from "@/lib/gateScan";
import { makeGatePorts } from "@/lib/gatePorts";
import { approveVisitor, rejectVisitor, checkOutEntry, flowFailed, flowWarning } from "@/lib/visitorFlow";
import { makeVisitorFlowPorts } from "@/lib/visitorFlowPorts";
import DashboardShell, { NavItem } from "@/components/DashboardShell";
import DeliveryManager from "@/components/DeliveryManager";
import GuardVisitorOptions from "@/components/GuardVisitorOptions";
import { useGateEntryMode } from "@/hooks/useGateEntryMode";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useBackToHome } from "@/hooks/useBackToHome";

type VisitorRequest = Tables<"visitor_requests">;
type EntryLog = Tables<"entry_logs">;

const NAV_BASE: NavItem[] = [
  { id: "home", title: "Home", icon: Home },
  { id: "visitor", title: "Visitor at the Gate", icon: UserPlus },
  { id: "scan", title: "Search & Scan", icon: Search },
  { id: "approvals", title: "Pending Approvals", icon: ClipboardList },
  { id: "live", title: "Live Inside", icon: Car },
  { id: "barriers", title: "Boom Barriers", icon: Radio },
  { id: "delivery", title: "Deliveries", icon: Package },
];

/**
 * A society on RFID boom barriers never scans anything, so the Scan
 * entry is withheld rather than shown and failing. GuardVisitorOptions
 * withholds its scan button on the same condition, both from
 * @/lib/visitorForm.
 */
const navFor = (mode: "qr_sticker" | "rfid"): NavItem[] =>
  NAV_BASE.filter((item) => !(item.id === "scan" && mode === "rfid"));

const GuardDashboard = () => {
  const [activeView, setActiveView] = useState("home");

  // Back goes to the Home tab rather than out of the dashboard.
  useBackToHome(activeView, setActiveView);
  const [scanning, setScanning] = useState(false);
  const [deliveryFormTrigger, setDeliveryFormTrigger] = useState(0);
  const [visitors, setVisitors] = useState<VisitorRequest[]>([]);
  const [liveVehicles, setLiveVehicles] = useState<EntryLog[]>([]);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const { toast } = useToast();
  const { signOut, user, societyId, societyName, societySlug } = useAuth();
  const gateEntryMode = useGateEntryMode(societyId);
  const navigate = useNavigate();

  // Registers this device for push inside the iOS or Android shell; a
  // no-op in a browser tab. Guards are the role push matters most for:
  // a resident approving the visitor standing in front of them is
  // time-critical in a way a maintenance notice is not.
  usePushNotifications(user?.id, {
    role: "guard",
    onOpen: ({ view }) => setActiveView(view),
    // Android delivers foreground notifications to the app rather than
    // the tray, so the guard would otherwise see nothing while they
    // have the dashboard open — which is most of their shift.
    onForeground: ({ title, body }) => toast({ title, description: body }),
  });
  const guardLoginPath = societySlug ? `/${societySlug}/guard` : "/guard";

  const loadDashboardData = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    // The whole vehicles table used to be fetched here as well, every
    // five seconds, so that a scan could search it in memory. The scan
    // now looks a vehicle up by qr_code through makeGatePorts, which is
    // both correct for a vehicle registered moments ago and one fewer
    // full-table read per tick on a device that sits at a gate all day.
    const [visitorsResult, entriesResult] = await Promise.all([
      supabase.from("visitor_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("entry_logs").select("*").is("exit_time", null).order("entry_time", { ascending: false }),
    ]);
    if (visitorsResult.error) toast({ title: "Could not load visitor requests", description: visitorsResult.error.message, variant: "destructive" });
    else setVisitors((visitorsResult.data ?? []) as VisitorRequest[]);
    if (entriesResult.error) toast({ title: "Could not load live entries", description: entriesResult.error.message, variant: "destructive" });
    else setLiveVehicles((entriesResult.data ?? []) as EntryLog[]);
    if (showLoader) setLoading(false);
  }, [toast]);

  useEffect(() => {
    void loadDashboardData(true);
    const interval = window.setInterval(() => void loadDashboardData(false), 5000);
    return () => window.clearInterval(interval);
  }, [loadDashboardData]);

  const handleSignOut = async () => {
    await signOut();
    navigate(guardLoginPath, { replace: true });
  };

  /**
   * One scan handler, over the shared rule in src/lib/gateScan.ts.
   *
   * Replaces three functions that used to live here — a guest-pass
   * validator, a staff logger and a dispatcher — with a call into the
   * module the native guard app also uses. What a pass means is now
   * decided in exactly one tested place rather than once per app.
   *
   * THE BUG THIS FIXES
   * The old dispatcher had no early return after the staff branch. It
   * logged the entry or exit correctly, then fell through to the
   * guest-pass check (a "STF-..." string is not JSON, so no match) and
   * the vehicle lookup (no match either), which overwrote the success
   * message with "Unknown QR code. Vehicle not registered." and raised
   * an error toast. Every staff and house-help card scan reported
   * failure while quietly succeeding.
   */
  const handleScan = async (raw: string) => {
    setScanning(false);

    if (!societyId) {
      toast({ title: "Society not loaded", variant: "destructive" });
      return;
    }

    const outcome = await resolveGateScan(
      makeGatePorts(supabase, societyId, user?.id ?? null),
      raw,
    );

    const icon =
      outcome.kind === "staff" ? (outcome.action === "entry" ? "\u2705" : "\uD83D\uDEAA")
      : outcome.kind === "guest" || outcome.kind === "vehicle" ? "\u2705"
      : outcome.kind === "error" ? "\u274C"
      : "\u26A0\uFE0F";

    setScanResult(`${icon} ${describeOutcome(outcome)}`);

    switch (outcome.kind) {
      case "staff":
        toast({
          title: outcome.action === "entry" ? "Entry logged" : "Exit logged",
          description: `${outcome.name} — ${outcome.role}`,
        });
        break;
      case "guest":
        toast({
          title: "Guest entry logged",
          description: `${outcome.visitorName} approved for ${outcome.flat}`,
        });
        break;
      case "vehicle":
        toast({ title: "Entry logged", description: describeOutcome(outcome) });
        break;
      case "rejected":
      case "unknown":
      case "error":
        toast({ title: "Not logged", description: outcome.message, variant: "destructive" });
        break;
    }

    // Only a successful entry changes what the dashboard shows.
    if (outcome.kind === "staff" || outcome.kind === "guest" || outcome.kind === "vehicle") {
      await loadDashboardData(false);
    }

    setTimeout(() => setScanResult(null), 5000);
  };

  /**
   * Approve, reject and check out, over the shared rules in
   * src/lib/visitorFlow.ts.
   *
   * The rule worth sharing is that approving a visitor ALSO writes an
   * entry log — miss it and the visitor is approved but never appears
   * in Live Inside, so the gate's count of who is on the premises is
   * quietly wrong. The native guard app answers the same requests and
   * must not disagree about what an approval means.
   *
   * Note that a failed entry log is a WARNING, not a failure: the
   * visitor really was approved, and saying otherwise sends the guard
   * to argue with someone holding a valid approval.
   */
  const handleApprove = async (id: string) => {
    const visitor = visitors.find((v) => v.id === id);
    if (!visitor) return;
    if (!societyId) { toast({ title: "Society not loaded", variant: "destructive" }); return; }

    setProcessingId(id);
    const result = await approveVisitor(
      makeVisitorFlowPorts(supabase, societyId, user?.id ?? null),
      visitor,
    );
    setProcessingId(null);

    if (flowFailed(result)) {
      toast({ title: "Approval failed", description: result.error, variant: "destructive" });
      return;
    }
    const warning = flowWarning(result);
    if (warning) toast({ title: "Approved, with a problem", description: warning, variant: "destructive" });

    await loadDashboardData(false);
    if (!warning) toast({ title: "Visitor Approved", description: visitor.visitor_name });
  };

  const handleReject = async (id: string) => {
    if (!societyId) { toast({ title: "Society not loaded", variant: "destructive" }); return; }
    setProcessingId(id);
    const result = await rejectVisitor(
      makeVisitorFlowPorts(supabase, societyId, user?.id ?? null),
      id,
    );
    setProcessingId(null);
    if (flowFailed(result)) {
      toast({ title: "Rejection failed", description: result.error, variant: "destructive" });
      return;
    }
    await loadDashboardData(false);
    toast({ title: "Visitor Rejected", variant: "destructive" });
  };

  const handleCheckout = async (id: string) => {
    if (!societyId) { toast({ title: "Society not loaded", variant: "destructive" }); return; }
    setProcessingId(id);
    const result = await checkOutEntry(
      makeVisitorFlowPorts(supabase, societyId, user?.id ?? null),
      id,
    );
    setProcessingId(null);
    if (flowFailed(result)) {
      toast({ title: "Checkout failed", description: result.error, variant: "destructive" });
      return;
    }
    await loadDashboardData(false);
    toast({ title: "Vehicle Checked Out" });
  };

  const pendingVisitors = visitors.filter((v) => v.status === "pending");

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const renderScan = () => (
    <>
      <Card className="border-primary/30 bg-gradient-to-br from-primary/10 to-transparent">
        <CardContent className="p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Scan a vehicle, staff or guest QR</p>
            <p className="text-base font-semibold text-foreground">Tap to start scanning</p>
          </div>
          <div className="flex flex-col items-center gap-3">
            <Button size="lg" onClick={() => setScanning(true)} className="gap-2 text-base font-bold animate-pulse-glow">
              <ScanLine className="h-5 w-5" /> Scan QR
            </Button>
            <FingerprintStatus />
          </div>
        </CardContent>
      </Card>
      {scanResult && (
        <Card className="border-primary/50 bg-primary/10">
          <CardContent className="p-4 text-center text-base sm:text-lg font-bold text-foreground">{scanResult}</CardContent>
        </Card>
      )}
      <VehicleSearch />
    </>
  );

  const renderApprovals = () => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <span className="h-3 w-3 rounded-full bg-warning animate-pulse" />
          Pending Approvals ({pendingVisitors.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {pendingVisitors.length === 0 ? (
          <p className="text-muted-foreground text-center py-4">No pending requests</p>
        ) : (
          pendingVisitors.map((visitor) => (
            <div key={visitor.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-secondary/50 border border-border">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-foreground truncate">{visitor.visitor_name}</p>
                <p className="text-sm text-muted-foreground">{visitor.vehicle_number} → {visitor.flat_number} • {visitor.purpose}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="icon" onClick={() => void handleApprove(visitor.id)} className="bg-success hover:bg-success/80" disabled={processingId === visitor.id}>
                  <Check className="h-5 w-5" />
                </Button>
                <Button size="icon" variant="destructive" onClick={() => void handleReject(visitor.id)} disabled={processingId === visitor.id}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );

  const renderLive = () => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Car className="h-5 w-5 text-primary-ink" />
          Live Inside ({liveVehicles.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {liveVehicles.length === 0 ? (
          <p className="text-muted-foreground text-center py-4">No active entries</p>
        ) : (
          liveVehicles.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-secondary/50 border border-border">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-foreground">{entry.vehicle_number}</p>
                  <StatusBadge status={entry.entry_type === "visitor" ? "pending" : "inside"} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {entry.owner_name} {entry.wing && `• ${entry.wing}-${entry.flat_number}`} • {new Date(entry.entry_time).toLocaleTimeString()}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void handleCheckout(entry.id)} className="gap-1 border-destructive/50 text-destructive-ink hover:bg-destructive hover:text-destructive-foreground" disabled={processingId === entry.id}>
                <LogOut className="h-4 w-4" /> Out
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );

  return (
    <DashboardShell
      brandTitle="Guard Dashboard"
      brandSubtitle={societyName ?? "Your Society"}
      groupLabel="Operations"
      items={navFor(gateEntryMode)}
      activeId={activeView}
      onSelect={setActiveView}
      onSignOut={handleSignOut}
    >
      {activeView === "home" && (
        <GuardHome
          societyName={societyName ?? "Your Society"}
          pendingApprovals={pendingVisitors.length}
          liveInside={liveVehicles.length}
          onNavigate={setActiveView}
          onRegisterDelivery={() => { setDeliveryFormTrigger((t) => t + 1); setActiveView("delivery"); }}
          gateEntryMode={gateEntryMode}
        />
      )}
      {activeView === "visitor" && (
        <GuardVisitorOptions
          gateEntryMode={gateEntryMode}
          onScan={() => setScanning(true)}
        />
      )}
      {activeView === "scan" && renderScan()}
      {activeView === "approvals" && renderApprovals()}
      {activeView === "live" && renderLive()}
      {activeView === "barriers" && <GateActivity />}
      {scanning && <QrScanner onScan={handleScan} onClose={() => setScanning(false)} />}
      {activeView === "delivery" && <DeliveryManager autoOpenTrigger={deliveryFormTrigger} />}
    </DashboardShell>
  );
};

export default GuardDashboard;
