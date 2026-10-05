import { useCallback, useEffect, useState } from "react";
import { ScanLine, Check, X, LogOut, Car, Search, ClipboardList, Radio, Package, Home, Fingerprint } from "lucide-react";
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
import { logStaffMovement as logMovement } from "@/lib/staffAttendance";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { decodeGuestPass } from "@/lib/guest-pass";
import DashboardShell, { NavItem } from "@/components/DashboardShell";
import DeliveryManager from "@/components/DeliveryManager";

type VisitorRequest = Tables<"visitor_requests">;
type EntryLog = Tables<"entry_logs">;
type Vehicle = Tables<"vehicles">;

const NAV: NavItem[] = [
  { id: "home", title: "Home", icon: Home },
  { id: "scan", title: "Search & Scan", icon: Search },
  { id: "approvals", title: "Pending Approvals", icon: ClipboardList },
  { id: "live", title: "Live Inside", icon: Car },
  { id: "barriers", title: "Boom Barriers", icon: Radio },
  { id: "delivery", title: "Deliveries", icon: Package },
];

const GuardDashboard = () => {
  const [activeView, setActiveView] = useState("home");
  const [scanning, setScanning] = useState(false);
  const [deliveryFormTrigger, setDeliveryFormTrigger] = useState(0);
  const [visitors, setVisitors] = useState<VisitorRequest[]>([]);
  const [liveVehicles, setLiveVehicles] = useState<EntryLog[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const { toast } = useToast();
  const { signOut, user, societyId, societyName, societySlug } = useAuth();
  const navigate = useNavigate();
  const guardLoginPath = societySlug ? `/${societySlug}/guard` : "/guard";

  const loadDashboardData = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    const [visitorsResult, entriesResult, vehiclesResult] = await Promise.all([
      supabase.from("visitor_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("entry_logs").select("*").is("exit_time", null).order("entry_time", { ascending: false }),
      supabase.from("vehicles").select("*").order("created_at", { ascending: false }),
    ]);
    if (visitorsResult.error) toast({ title: "Could not load visitor requests", description: visitorsResult.error.message, variant: "destructive" });
    else setVisitors((visitorsResult.data ?? []) as VisitorRequest[]);
    if (entriesResult.error) toast({ title: "Could not load live entries", description: entriesResult.error.message, variant: "destructive" });
    else setLiveVehicles((entriesResult.data ?? []) as EntryLog[]);
    if (vehiclesResult.error) toast({ title: "Could not load vehicles", description: vehiclesResult.error.message, variant: "destructive" });
    else setVehicles((vehiclesResult.data ?? []) as Vehicle[]);
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

  const handleGuestPassScan = async (rawQr: string) => {
    const guestPass = decodeGuestPass(rawQr);
    if (!guestPass) return false;
    const { data: request, error: requestError } = await supabase
      .from("visitor_requests").select("*").eq("id", guestPass.request_id).maybeSingle();
    if (requestError || !request) {
      setScanResult("❌ Guest QR not found.");
      toast({ title: "Unknown guest pass", description: requestError?.message ?? "This pass was not found.", variant: "destructive" });
      return true;
    }
    const expectedFlat = `${guestPass.wing}-${guestPass.flat_number}`;
    const isMatchingPass = request.status !== "rejected" && request.visitor_name === guestPass.visitor_name && request.phone === guestPass.phone && request.vehicle_number === guestPass.vehicle_number && request.flat_number === expectedFlat;
    if (!isMatchingPass) {
      setScanResult("❌ Guest QR details do not match the saved pass.");
      toast({ title: "Invalid guest pass", description: "The scanned QR does not match the saved guest entry.", variant: "destructive" });
      return true;
    }
    if (request.status === "entered" || request.status === "used") {
      setScanResult("⚠️ This guest QR has already been used and is no longer valid.");
      toast({ title: "Pass already used", description: `${request.visitor_name}'s pass is single-use and has already been scanned.`, variant: "destructive" });
      return true;
    }
    const { data: claimed, error: claimError } = await supabase
      .from("visitor_requests").update({ status: "entered" }).eq("id", request.id).eq("status", "guest_pass").select("id").maybeSingle();
    if (claimError || !claimed) {
      setScanResult("⚠️ This guest QR has already been used and is no longer valid.");
      toast({ title: "Pass already used", description: "Single-use pass — already scanned by another guard.", variant: "destructive" });
      await loadDashboardData(false);
      return true;
    }
    if (!societyId) { toast({ title: "Society not loaded", variant: "destructive" }); return true; }
    const { error: entryError } = await supabase.from("entry_logs").insert({
      vehicle_number: request.vehicle_number, flat_number: guestPass.flat_number, wing: guestPass.wing,
      entry_type: "visitor", owner_name: `${request.visitor_name} (Guest of ${guestPass.owner_name})`,
      logged_by: user?.id ?? null,
      society_id: societyId,
    });
    if (entryError) {
      toast({ title: "Could not log guest entry", description: entryError.message, variant: "destructive" });
      return true;
    }
    setScanResult(`✅ ${request.visitor_name} — Guest of ${guestPass.owner_name} — ${guestPass.wing}-${guestPass.flat_number}`);
    await loadDashboardData(false);
    toast({ title: "Guest Entry Logged", description: `${request.visitor_name} approved for ${guestPass.wing}-${guestPass.flat_number}` });
    return true;
  };


  /**
   * QR path for staff / house helps. Delegates to the same shared logger
   * the always-on fingerprint listener uses, so the entry/exit toggle
   * cannot drift between the two.
   */
  const logStaffMovement = async (
    member: { id: string; name: string; role: string },
    category: "society_staff" | "house_help",
    method: "qr" | "fingerprint",
  ) => {
    if (!societyId) { toast({ title: "Society not loaded", variant: "destructive" }); return; }
    const result = await logMovement(supabase, {
      societyId,
      subjectId: member.id,
      category,
      loggedBy: user?.id ?? null,
      method,
    });
    if (!result.ok) {
      toast({ title: "Could not log entry", description: result.error, variant: "destructive" });
      return;
    }
    const icon = result.action === "entry" ? "\u2705 Entry" : "\uD83D\uDEAA Exit";
    setScanResult(`${icon} — ${member.name} (${member.role})`);
    toast({
      title: `${result.action === "entry" ? "Entry" : "Exit"} logged`,
      description: `${member.name} — ${member.role}`,
    });
    setTimeout(() => setScanResult(null), 5000);
  };

  const handleScan = async (result: string) => {
    setScanning(false);

    // Staff / house help QR codes (STF- or HLP- prefix)
    if (result.startsWith("STF-") || result.startsWith("HLP-")) {
      if (!societyId) { toast({ title: "Society not loaded", variant: "destructive" }); return; }
      const category = result.startsWith("STF-") ? "society_staff" as const : "house_help" as const;
      const member = category === "society_staff"
        ? await supabase.from("staff_members").select("id, name, staff_type").eq("qr_code", result).maybeSingle().then((r) => r.data ? { id: r.data.id, name: r.data.name, role: r.data.staff_type } : null)
        : await supabase.from("house_helps").select("id, name, help_type").eq("qr_code", result).maybeSingle().then((r) => r.data ? { id: r.data.id, name: r.data.name, role: r.data.help_type } : null);
      if (!member) {
        setScanResult("❌ Unknown ID card. Not registered.");
        toast({ title: "Unknown ID card", variant: "destructive" });
        setTimeout(() => setScanResult(null), 5000);
        return;
      }
      await logStaffMovement(member, category, "qr");
    }

    // Guest pass QR
    const handledGuestPass = await handleGuestPassScan(result);
    if (handledGuestPass) { setTimeout(() => setScanResult(null), 5000); return; }

    // Vehicle QR
    const vehicle = vehicles.find((v) => v.qr_code === result);
    if (vehicle) {
      if (!societyId) { toast({ title: "Society not loaded", variant: "destructive" }); return; }
      const { error } = await supabase.from("entry_logs").insert({
        vehicle_number: vehicle.vehicle_number, flat_number: vehicle.flat_number, wing: vehicle.wing,
        entry_type: "resident", owner_name: vehicle.owner_name, logged_by: user?.id ?? null,
        society_id: societyId,
      });
      if (error) { toast({ title: "Could not log entry", description: error.message, variant: "destructive" }); return; }
      setScanResult(`✅ ${vehicle.wing}-${vehicle.flat_number} — ${vehicle.vehicle_number}`);
      await loadDashboardData(false);
      toast({ title: "Entry Logged", description: `${vehicle.wing}-${vehicle.flat_number} — ${vehicle.vehicle_number}` });
    } else {
      setScanResult("❌ Unknown QR code. Vehicle not registered.");
      toast({ title: "Unknown Vehicle", description: "QR code not found in registry.", variant: "destructive" });
    }
    setTimeout(() => setScanResult(null), 5000);
  };

  const handleApprove = async (id: string) => {
    const visitor = visitors.find((v) => v.id === id);
    if (!visitor) return;
    setProcessingId(id);
    const { error: updateError } = await supabase.from("visitor_requests").update({ status: "approved" }).eq("id", id);
    if (updateError) { setProcessingId(null); toast({ title: "Approval failed", description: updateError.message, variant: "destructive" }); return; }
    if (!societyId) { setProcessingId(null); toast({ title: "Society not loaded", variant: "destructive" }); return; }
    const { error: entryError } = await supabase.from("entry_logs").insert({
      vehicle_number: visitor.vehicle_number, flat_number: visitor.flat_number, wing: "",
      entry_type: "visitor", owner_name: `${visitor.visitor_name} (Visitor)`, logged_by: user?.id ?? null,
      society_id: societyId,
    });
    setProcessingId(null);
    if (entryError) { toast({ title: "Approval saved but entry log failed", description: entryError.message, variant: "destructive" }); return; }
    await loadDashboardData(false);
    toast({ title: "Visitor Approved", description: visitor?.visitor_name });
  };

  const handleReject = async (id: string) => {
    setProcessingId(id);
    const { error } = await supabase.from("visitor_requests").update({ status: "rejected" }).eq("id", id);
    setProcessingId(null);
    if (error) { toast({ title: "Rejection failed", description: error.message, variant: "destructive" }); return; }
    await loadDashboardData(false);
    toast({ title: "Visitor Rejected", variant: "destructive" });
  };

  const handleCheckout = async (id: string) => {
    setProcessingId(id);
    const { error } = await supabase.from("entry_logs").update({ exit_time: new Date().toISOString() }).eq("id", id);
    setProcessingId(null);
    if (error) { toast({ title: "Checkout failed", description: error.message, variant: "destructive" }); return; }
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
          <Car className="h-5 w-5 text-primary" />
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
              <Button variant="outline" size="sm" onClick={() => void handleCheckout(entry.id)} className="gap-1 border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground" disabled={processingId === entry.id}>
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
      items={NAV}
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
          onStartScan={() => setScanning(true)}
          onRegisterDelivery={() => { setDeliveryFormTrigger((t) => t + 1); setActiveView("delivery"); }}
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
