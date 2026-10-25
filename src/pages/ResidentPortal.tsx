import { useCallback, useEffect, useMemo, useState } from "react";
import { Car, ClipboardList, QrCode, Plus, Trash2, ClipboardCheck, User, Home, Save, Users, Copy, Package, Wallet, Sparkles, AlertTriangle , Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import VehicleNumberInput from "@/components/VehicleNumberInput";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import StatusBadge from "@/components/StatusBadge";
import QrGenerator from "@/components/QrGenerator";
import FlatPicker from "@/components/FlatPicker";
import { useSocietyStructure } from "@/hooks/useSocietyStructure";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import DashboardShell, { NavItem } from "@/components/DashboardShell";
import HouseHelpsManager from "@/components/HouseHelpsManager";
import MyDues from "@/components/MyDues";
import ResidentHome from "@/components/ResidentHome";
import AmenityBooking from "@/components/AmenityBooking";
import StaffAttendanceLog from "@/components/StaffAttendanceLog";
import ResidentDeliveryApprovals from "@/components/ResidentDeliveryApprovals";
import EvChargingResident from "@/components/EvChargingResident";

interface GuestPass {
  id: string; visitor_name: string; phone: string; vehicle_number: string;
  purpose: string | null; status: string; created_at: string; qr_payload: string;
}
interface ResidentSummary { owner_name: string; wing: string; flat_number: string; flat_label: string; }
interface ResidentFlat { id: string; wing: string; flat_number: string; is_primary: boolean; flat_label: string; }
interface ProfileSummary { display_name: string; phone: string | null; }
interface ChildAccount { user_id: string; display_name: string; phone: string | null; child_type: "family" | "tenant"; created_at: string; email?: string | null; }
interface VisitLog { id: string; vehicle_number: string; owner_name: string; entry_type: string; entry_time: string; exit_time: string | null; }
interface ResidentVehicle { id: string; vehicle_number: string; vehicle_type: string; owner_name: string; wing: string; flat_number: string; qr_code: string; }
interface ChangeRequestRow { id: string; request_type: string; vehicle_number: string; vehicle_type: string; owner_name: string; wing: string; flat_number: string; status: string; notes: string | null; created_at: string; }

const emptyForm = { visitor_name: "", phone: "", vehicle_number: "", purpose: "" };
const emptyVehicleRequest = { vehicle_number: "", vehicle_type: "car" };
const emptyChildForm = { email: "", display_name: "", child_type: "family" as "family" | "tenant" };

const PRIMARY_NAV: NavItem[] = [
  { id: "home", title: "Home", icon: Home },
  { id: "guest", title: "Guest Pass", icon: QrCode },
  { id: "vehicles", title: "My Vehicles", icon: Car },
  { id: "dues", title: "My Dues", icon: Wallet },
  { id: "amenities", title: "Amenities", icon: Sparkles },
  { id: "ev", title: "EV Charging", icon: Zap },
  { id: "profile", title: "My Profile", icon: User },
  { id: "helps", title: "House Helps", icon: Users },
  { id: "deliveries", title: "Deliveries", icon: Package },
];

const CHILD_NAV: NavItem[] = [
  { id: "home", title: "Home", icon: Home },
  { id: "guest", title: "Guest Pass", icon: QrCode },
  { id: "vehicles", title: "Flat Vehicles", icon: Car },
  { id: "history", title: "Visit History", icon: ClipboardList },
  { id: "dues", title: "My Dues", icon: Wallet },
  { id: "amenities", title: "Amenities", icon: Sparkles },
  { id: "ev", title: "EV Charging", icon: Zap },
  { id: "profile", title: "My Profile", icon: User },
];

const ResidentPortal = () => {
  const [activeView, setActiveView] = useState("home");
  const [form, setForm] = useState(emptyForm);
  const [guestPasses, setGuestPasses] = useState<GuestPass[]>([]);
  const [visitLogs, setVisitLogs] = useState<VisitLog[]>([]);
  const [resident, setResident] = useState<ResidentSummary | null>(null);
  const [showQr, setShowQr] = useState<GuestPass | null>(null);
  const [vehicles, setVehicles] = useState<ResidentVehicle[]>([]);
  const [showVehicleQr, setShowVehicleQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [vehicleReqForm, setVehicleReqForm] = useState(emptyVehicleRequest);
  const [submittingVehicleReq, setSubmittingVehicleReq] = useState(false);
  const [changeRequests, setChangeRequests] = useState<ChangeRequestRow[]>([]);
  const [removeTarget, setRemoveTarget] = useState<ResidentVehicle | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [flats, setFlats] = useState<ResidentFlat[]>([]);
  const [activeFlatId, setActiveFlatId] = useState<string>("");
  const [profileForm, setProfileForm] = useState<ProfileSummary>({ display_name: "", phone: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [newFlat, setNewFlat] = useState({ wing: "", flat_number: "" });
  const [addingFlat, setAddingFlat] = useState(false);
  const [settingPrimaryId, setSettingPrimaryId] = useState<string | null>(null);
  const [isChild, setIsChild] = useState(false);
  const [childType, setChildType] = useState<"family" | "tenant" | null>(null);
  const [parentName, setParentName] = useState<string | null>(null);
  const [children, setChildren] = useState<ChildAccount[]>([]);
  const [childForm, setChildForm] = useState(emptyChildForm);
  const [addingChild, setAddingChild] = useState(false);
  const [issuedChildCred, setIssuedChildCred] = useState<{ email: string; password: string } | null>(null);
  const [removeChildTarget, setRemoveChildTarget] = useState<ChildAccount | null>(null);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [pendingDeliveries, setPendingDeliveries] = useState(0);
  const { toast } = useToast();
  const { signOut, user, societyId, societyName, societySlug } = useAuth();
  const navigate = useNavigate();
  const residentLoginPath = societySlug ? `/${societySlug}/resident` : "/resident";
  const { formatFlat } = useSocietyStructure(societyId);

  const activeFlat = useMemo(() => flats.find((f) => f.id === activeFlatId) ?? flats[0], [flats, activeFlatId]);
  const NAV = isChild ? CHILD_NAV : PRIMARY_NAV.map((item) =>
    item.id === "deliveries" && pendingDeliveries > 0
      ? { ...item, title: `Deliveries (${pendingDeliveries})` }
      : item
  );

  const loadProfileAndChildren = useCallback(async () => {
    if (!user) return;
    const { data: prof } = await supabase
      .from("profiles")
      .select("parent_user_id, child_type")
      .eq("user_id", user.id)
      .maybeSingle();
    const child = !!prof?.parent_user_id;
    setIsChild(child);
    setChildType((prof?.child_type as "family" | "tenant" | null) ?? null);
    if (child && prof?.parent_user_id) {
      const { data: parent } = await supabase
        .from("profiles").select("display_name").eq("user_id", prof.parent_user_id).maybeSingle();
      setParentName(parent?.display_name ?? null);
    } else {
      // load my children
      const { data: kids } = await supabase
        .from("profiles")
        .select("user_id, display_name, phone, child_type, created_at")
        .eq("parent_user_id", user.id)
        .order("created_at", { ascending: true });
      setChildren((kids ?? []) as ChildAccount[]);
    }
  }, [user]);

  useEffect(() => {
    const loadGuestPasses = async () => {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("resident-guest-passes", { body: { action: "list" } });
      setLoading(false);
      if (error || data?.error) {
        toast({ title: "Could not load guest passes", description: error?.message ?? data?.error ?? "Please try again.", variant: "destructive" });
        return;
      }
      setResident(data.resident as ResidentSummary);
      setGuestPasses((data.passes ?? []) as GuestPass[]);
      setVisitLogs((data.visit_logs ?? []) as VisitLog[]);
      const fl = (data.flats ?? []) as ResidentFlat[];
      setFlats(fl);
      setActiveFlatId((prev) => prev || fl.find((f) => f.is_primary)?.id || fl[0]?.id || "");
      if (data.profile) setProfileForm({ display_name: data.profile.display_name ?? "", phone: data.profile.phone ?? "" });
    };
    if (user) {
      void loadGuestPasses();
      void loadProfileAndChildren();
    }
  }, [toast, user, loadProfileAndChildren]);

  const loadVehicles = useCallback(async () => {
    if (!activeFlat) return;
    const { data, error } = await supabase
      .from("vehicles").select("id, vehicle_number, vehicle_type, owner_name, wing, flat_number, qr_code")
      .eq("wing", activeFlat.wing).eq("flat_number", activeFlat.flat_number).order("created_at", { ascending: false });
    if (error) { toast({ title: "Could not load your vehicles", description: error.message, variant: "destructive" }); return; }
    setVehicles((data ?? []) as ResidentVehicle[]);
  }, [activeFlat, toast]);

  const loadChangeRequests = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("vehicle_change_requests")
      .select("id, request_type, vehicle_number, vehicle_type, owner_name, wing, flat_number, status, notes, created_at")
      .eq("requested_by", user.id).order("created_at", { ascending: false }).limit(10);
    if (error) return;
    setChangeRequests((data ?? []) as ChangeRequestRow[]);
  }, [user]);

  useEffect(() => { void loadVehicles(); }, [loadVehicles]);
  useEffect(() => { void loadChangeRequests(); }, [loadChangeRequests]);

  const refreshFlats = useCallback(async () => {
    if (!user) return;
    if (isChild) return;
    const { data } = await supabase
      .from("resident_flats").select("id, wing, flat_number, is_primary, created_at")
      .eq("user_id", user.id).order("is_primary", { ascending: false }).order("created_at", { ascending: true });
    const fl = (data ?? []).map((f) => ({
      id: f.id as string, wing: (f.wing as string).toUpperCase(),
      flat_number: (f.flat_number as string).toUpperCase(), is_primary: !!f.is_primary,
      flat_label: `${(f.wing as string).toUpperCase()}-${(f.flat_number as string).toUpperCase()}`,
    }));
    setFlats(fl);
    setActiveFlatId((prev) => fl.find((x) => x.id === prev)?.id || fl.find((x) => x.is_primary)?.id || fl[0]?.id || "");
  }, [user, isChild]);

  const addChild = async () => {
    if (!childForm.email.trim() || !childForm.display_name.trim()) {
      toast({ title: "Email and name are required", variant: "destructive" }); return;
    }
    setAddingChild(true);
    const { data, error } = await supabase.functions.invoke("create-child-account", {
      body: {
        email: childForm.email.trim(),
        display_name: childForm.display_name.trim(),
        child_type: childForm.child_type,
      },
    });
    setAddingChild(false);
    if (error || data?.error) {
      toast({ title: "Could not add child", description: error?.message ?? data?.error ?? "Please try again.", variant: "destructive" });
      return;
    }
    setIssuedChildCred({ email: data.email, password: data.temp_password });
    setChildForm(emptyChildForm);
    await loadProfileAndChildren();
    toast({ title: "Child account created", description: "Share the temporary password with them." });
  };

  const removeChild = async (childId: string) => {
    const { data, error } = await supabase.functions.invoke("delete-child-account", { body: { child_user_id: childId } });
    if (error || data?.error) {
      toast({ title: "Could not remove", description: error?.message ?? data?.error ?? "", variant: "destructive" });
      return;
    }
    toast({ title: "Child account removed" });
    setRemoveChildTarget(null);
    await loadProfileAndChildren();
  };

  const saveProfile = async () => {
    if (!user) return;
    if (!profileForm.display_name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSavingProfile(true);
    const { error } = await supabase.from("profiles").update({
      display_name: profileForm.display_name.trim(), phone: profileForm.phone?.trim() || null,
    }).eq("user_id", user.id);
    setSavingProfile(false);
    if (error) { toast({ title: "Could not save profile", description: error.message, variant: "destructive" }); return; }
    setResident((prev) => prev ? { ...prev, owner_name: profileForm.display_name.trim() } : prev);
    toast({ title: "Profile updated" });
  };

  const addFlat = async () => {
    if (!user) return;
    const wing = newFlat.wing.trim().toUpperCase();
    const flat_number = newFlat.flat_number.trim().toUpperCase();
    if (!wing || !flat_number) { toast({ title: "Wing and flat number required", variant: "destructive" }); return; }
    if (!societyId) { toast({ title: "Society not loaded", variant: "destructive" }); return; }
    setAddingFlat(true);
    const { error } = await supabase.from("resident_flats").insert({ user_id: user.id, wing, flat_number, is_primary: flats.length === 0, society_id: societyId });
    setAddingFlat(false);
    if (error) { toast({ title: "Could not add flat", description: error.message, variant: "destructive" }); return; }
    setNewFlat({ wing: "", flat_number: "" });
    toast({ title: "Flat added" });
    await refreshFlats();
  };
  
  const setPrimaryFlat = async (id: string) => {
    setSettingPrimaryId(id);
    const { error } = await supabase.rpc("set_primary_flat", { _flat_id: id });
    setSettingPrimaryId(null);
    if (error) { toast({ title: "Could not set primary flat", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Primary flat updated" });
    await refreshFlats();
  };
  
  const removeFlat = async (id: string) => {
    const { error } = await supabase.from("resident_flats").delete().eq("id", id);
    if (error) { toast({ title: "Could not remove flat", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Flat removed" });
    await refreshFlats();
  };

  const handleSignOut = async () => { await signOut(); navigate(residentLoginPath, { replace: true }); };

  const deleteOwnAccount = async () => {
    setDeletingAccount(true);
    const { data, error } = await supabase.functions.invoke("delete-own-account");
    setDeletingAccount(false);
    if (error || data?.error) {
      toast({ title: "Could not delete account", description: data?.error ?? error?.message, variant: "destructive" });
      return;
    }
    toast({ title: "Account deleted" });
    await signOut();
    navigate("/login", { replace: true });
  };

  const generateGuestPass = async () => {
    if (!form.visitor_name.trim() || !form.phone.trim() || !form.vehicle_number.trim()) {
      toast({ title: "Fill all required guest details", variant: "destructive" }); return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("resident-guest-passes", {
      body: { action: "create", visitor_name: form.visitor_name.trim(), phone: form.phone.trim(),
        vehicle_number: form.vehicle_number.trim().toUpperCase(), purpose: form.purpose || null,
        flat_id: activeFlat?.id || undefined },
    });
    setSubmitting(false);
    if (error || data?.error) {
      toast({ title: "Could not create guest pass", description: error?.message ?? data?.error ?? "Please try again.", variant: "destructive" });
      return;
    }
    const createdPass = data.pass as GuestPass;
    setResident(data.resident as ResidentSummary);
    setGuestPasses((prev) => [createdPass, ...prev.filter((pass) => pass.id !== createdPass.id)].slice(0, 5));
    setForm(emptyForm);
    setShowQr(createdPass);
    toast({ title: "Guest pass created", description: `${createdPass.visitor_name} can now use this QR at the gate.` });
  };

  const submitAddVehicleRequest = async () => {
    if (!activeFlat || !user) return;
    const ownerName = (profileForm.display_name || resident?.owner_name || "").trim();
    if (!vehicleReqForm.vehicle_number.trim()) { toast({ title: "Vehicle number is required", variant: "destructive" }); return; }
    if (!ownerName) { toast({ title: "Set your profile name first", variant: "destructive" }); return; }
    if (!societyId) { toast({ title: "Society not loaded", variant: "destructive" }); return; }
    setSubmittingVehicleReq(true);
    const { error } = await supabase.from("vehicle_change_requests").insert({
      request_type: "add", requested_by: user.id, wing: activeFlat.wing, flat_number: activeFlat.flat_number,
      owner_name: ownerName, vehicle_number: vehicleReqForm.vehicle_number.trim().toUpperCase(),
      vehicle_type: vehicleReqForm.vehicle_type,
      society_id: societyId,
    });
    setSubmittingVehicleReq(false);
    if (error) { toast({ title: "Could not submit request", description: error.message, variant: "destructive" }); return; }
    setVehicleReqForm(emptyVehicleRequest);
    toast({ title: "Request sent", description: "Admin will review your new vehicle request." });
    await loadChangeRequests();
  };

  const submitRemoveRequest = async () => {
    if (!resident || !user || !removeTarget) return;
    if (!societyId) { toast({ title: "Society not loaded", variant: "destructive" }); return; }
    setRemovingId(removeTarget.id);
    const { error } = await supabase.from("vehicle_change_requests").insert({
      request_type: "remove", requested_by: user.id, wing: removeTarget.wing, flat_number: removeTarget.flat_number,
      owner_name: removeTarget.owner_name, vehicle_number: removeTarget.vehicle_number,
      vehicle_type: removeTarget.vehicle_type, target_vehicle_id: removeTarget.id,
      society_id: societyId,
    });
    setRemovingId(null); setRemoveTarget(null);
    if (error) { toast({ title: "Could not submit request", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Removal requested", description: "Admin will review your request." });
    await loadChangeRequests();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const flatPicker = flats.length > 1 && (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <Label className="shrink-0 m-0">Active flat</Label>
        <Select value={activeFlatId} onValueChange={setActiveFlatId}>
          <SelectTrigger className="touch-target"><SelectValue /></SelectTrigger>
          <SelectContent>
            {flats.map((f) => (
              <SelectItem key={f.id} value={f.id}>{f.flat_label}{f.is_primary ? " (primary)" : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );

  const renderGuest = () => (
    <>
      {flatPicker}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <QrCode className="h-5 w-5 text-primary" /> Generate Guest Pass
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="guest-name">Guest Name *</Label>
              <Input id="guest-name" placeholder="Enter guest's name" value={form.visitor_name} onChange={(e) => setForm((p) => ({ ...p, visitor_name: e.target.value }))} className="touch-target" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="guest-phone">Phone Number *</Label>
              <Input id="guest-phone" placeholder="Enter phone number" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} className="touch-target" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="guest-vehicle">Vehicle Number *</Label>
              <VehicleNumberInput value={form.vehicle_number} onChange={(v) => setForm((p) => ({ ...p, vehicle_number: v }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="guest-purpose">Purpose of Visit</Label>
              <Select value={form.purpose || undefined} onValueChange={(value) => setForm((p) => ({ ...p, purpose: value }))}>
                <SelectTrigger id="guest-purpose" className="touch-target"><SelectValue placeholder="Select purpose" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Guest Visit">Guest Visit</SelectItem>
                  <SelectItem value="Delivery">Delivery</SelectItem>
                  <SelectItem value="Cab/Taxi">Cab / Taxi</SelectItem>
                  <SelectItem value="Maintenance">Maintenance</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {resident && (
            <div className="rounded-lg border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
              Entry will be created for <span className="font-medium text-foreground">{resident.owner_name}</span> • <span className="font-medium text-foreground">{activeFlat?.flat_label ?? resident.flat_label}</span>
            </div>
          )}
          <Button onClick={() => void generateGuestPass()} className="touch-target gap-2" disabled={submitting || !resident}>
            <QrCode className="h-4 w-4" /> {submitting ? "Generating..." : "Generate QR Pass"}
          </Button>
          {showQr && resident && (
            <div className="flex justify-center">
              <QrGenerator value={showQr.qr_payload} label={`${showQr.visitor_name} • ${activeFlat?.flat_label ?? resident.flat_label}`} size={400}
                societyName={societyName}
                shareText={`Hi ${showQr.visitor_name}, here is your gate entry QR for ${activeFlat?.flat_label ?? resident.flat_label}. Show this to the security guard at the gate.`}
                fileBaseName={`${activeFlat?.flat_label ?? resident.flat_label}-${showQr.vehicle_number || showQr.visitor_name}`} />
            </div>
          )}
          {guestPasses.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Latest 5 Guest QR Passes</p>
              {guestPasses.map((pass) => (
                <div key={pass.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground">{pass.visitor_name}</p>
                      <StatusBadge status={pass.status === "entered" ? "inside" : "approved"} />
                    </div>
                    <p className="text-xs text-muted-foreground">{pass.vehicle_number} • {pass.phone}</p>
                    <p className="text-xs text-muted-foreground">{pass.purpose || "Guest Visit"} • {new Date(pass.created_at).toLocaleString()}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setShowQr(pass)} className="touch-target gap-1">
                    <QrCode className="h-4 w-4" /> Open QR
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );

  const renderVehicles = () => (
    <>
      {flatPicker}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Car className="h-5 w-5 text-primary" /> My Vehicles ({vehicles.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {vehicles.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No vehicles registered to your flat yet</p>
            ) : (
              vehicles.map((v) => (
                <div key={v.id} className="space-y-2">
                  <div className="flex items-center gap-3 justify-between p-3 rounded-lg bg-secondary/50 border border-border">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-foreground">{v.vehicle_number}</p>
                      <p className="text-sm text-muted-foreground">{v.owner_name} • {formatFlat(v.wing, v.flat_number)} • {v.vehicle_type}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setShowVehicleQr(showVehicleQr === v.qr_code ? null : v.qr_code)} className="touch-target gap-1">
                        <QrCode className="h-4 w-4" /> QR
                      </Button>
                      {!isChild && (
                        <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(v)} disabled={removingId === v.id} className="touch-target gap-1 text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" /> Remove
                        </Button>
                      )}
                    </div>
                  </div>
                  {showVehicleQr === v.qr_code && (
                    <div className="flex justify-center py-2">
                      <QrGenerator value={v.qr_code} label={`${v.vehicle_number} \u2022 ${formatFlat(v.wing, v.flat_number)}`} size={400} societyName={societyName} fileBaseName={`${v.wing}-${v.flat_number}-${v.vehicle_type}-${v.vehicle_number}`} />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          {!isChild && (
          <div className="rounded-lg border border-dashed border-border p-3 space-y-3">
            <div className="flex items-center gap-2"><Plus className="h-4 w-4 text-primary" /><p className="text-sm font-medium text-foreground">Request New Vehicle</p></div>
            <p className="text-xs text-muted-foreground">Submit a request to register a new vehicle. Admin approval is required.</p>
            <p className="text-xs text-muted-foreground">
              Owner: <span className="font-medium text-foreground">{profileForm.display_name || "(set your name in My Profile)"}</span>
              {activeFlat ? <> • Flat: <span className="font-medium text-foreground">{activeFlat.flat_label}</span></> : null}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="req-vnum">Vehicle Number *</Label>
                <VehicleNumberInput value={vehicleReqForm.vehicle_number} onChange={(v) => setVehicleReqForm((p) => ({ ...p, vehicle_number: v }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="req-vtype">Type</Label>
                <Select value={vehicleReqForm.vehicle_type} onValueChange={(v) => setVehicleReqForm((p) => ({ ...p, vehicle_type: v }))}>
                  <SelectTrigger id="req-vtype" className="touch-target"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="car">Car</SelectItem>
                    <SelectItem value="bike">Bike</SelectItem>
                    <SelectItem value="scooty">Scooty</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={() => void submitAddVehicleRequest()} disabled={submittingVehicleReq || !resident} className="touch-target gap-2">
              <Plus className="h-4 w-4" /> {submittingVehicleReq ? "Submitting..." : "Send Request to Admin"}
            </Button>
          </div>
          )}
        </CardContent>
      </Card>
    </>
  );

  const renderRequests = () => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ClipboardCheck className="h-5 w-5 text-primary" /> My Vehicle Requests
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {changeRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No requests yet</p>
        ) : changeRequests.map((r) => (
          <div key={r.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase font-bold text-muted-foreground">{r.request_type}</span>
                <p className="font-medium text-foreground">{r.vehicle_number}</p>
              </div>
              <p className="text-xs text-muted-foreground">{r.owner_name} • {formatFlat(r.wing, r.flat_number)} • {new Date(r.created_at).toLocaleString()}</p>
              {r.notes && <p className="text-xs text-muted-foreground italic">Admin note: {r.notes}</p>}
            </div>
            <StatusBadge status={r.status as "pending" | "approved" | "rejected"} />
          </div>
        ))}
      </CardContent>
    </Card>
  );

  const renderHistory = () => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ClipboardList className="h-5 w-5 text-accent" /> Visit History
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {visitLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No visit history</p>
        ) : visitLogs.map((log) => (
          <div key={log.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium text-foreground">{log.owner_name}</p>
                <StatusBadge status={log.exit_time ? "exited" : "inside"} />
              </div>
              <p className="text-sm text-muted-foreground">{log.vehicle_number} • {log.entry_type} • {new Date(log.entry_time).toLocaleString()}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );

  const renderProfile = () => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <User className="h-5 w-5 text-primary" /> My Profile
          {isChild && childType && (
            <Badge variant="secondary" className="ml-2 capitalize">{childType}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isChild && (
          <div className="rounded-lg border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
            Linked to primary resident: <span className="font-medium text-foreground">{parentName ?? "—"}</span>
            {activeFlat && <> • Flat: <span className="font-medium text-foreground">{activeFlat.flat_label}</span></>}
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="profile-name">Full Name *</Label>
            <Input id="profile-name" placeholder="Your name" value={profileForm.display_name} onChange={(e) => setProfileForm((p) => ({ ...p, display_name: e.target.value }))} className="touch-target" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-phone">Mobile Number</Label>
            <Input id="profile-phone" placeholder="e.g. 9876543210" value={profileForm.phone ?? ""} onChange={(e) => setProfileForm((p) => ({ ...p, phone: e.target.value }))} className="touch-target" />
          </div>
        </div>
        <Button onClick={() => void saveProfile()} disabled={savingProfile} className="touch-target gap-2">
          <Save className="h-4 w-4" /> {savingProfile ? "Saving..." : "Save Profile"}
        </Button>
        {!isChild && (
        <>
        <div className="pt-2 border-t border-border space-y-3">
          <div className="flex items-center gap-2"><Home className="h-4 w-4 text-primary" /><p className="text-sm font-medium text-foreground">My Flats ({flats.length})</p></div>
          <div className="space-y-2">
            {flats.length === 0 ? (
              <p className="text-sm text-muted-foreground">No flats registered yet.</p>
            ) : flats.map((f) => (
              <div key={f.id} className="flex items-center justify-between p-2 rounded-md bg-secondary/50 border border-border">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-foreground">{f.flat_label}</p>
                  {f.is_primary && <span className="text-xs text-muted-foreground">(primary)</span>}
                </div>
                <div className="flex items-center gap-1">
                  {!f.is_primary && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void setPrimaryFlat(f.id)}
                      disabled={settingPrimaryId === f.id}
                      className="text-xs"
                    >
                      {settingPrimaryId === f.id ? "Setting..." : "Set as Primary"}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => void removeFlat(f.id)} disabled={!f.id} className="text-destructive hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_auto] items-end">
            <FlatPicker
              societyId={societyId}
              wing={newFlat.wing}
              flatNumber={newFlat.flat_number}
              onChange={(wing, flat_number) => setNewFlat({ wing, flat_number })}
              disabled={addingFlat}
            />
            <Button onClick={() => void addFlat()} disabled={addingFlat} className="touch-target gap-2">
              <Plus className="h-4 w-4" /> {addingFlat ? "Adding..." : "Add Flat"}
            </Button>
          </div>
        </div>
        <div className="pt-2 border-t border-border space-y-3">
          <div className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" /><p className="text-sm font-medium text-foreground">Family & Tenants ({children.length})</p></div>
          <p className="text-xs text-muted-foreground">Add accounts for family members or tenants. They can generate guest passes and view flat vehicles, but cannot edit vehicle or flat details.</p>
          <div className="space-y-2">
            {children.length === 0 ? (
              <p className="text-sm text-muted-foreground">No child accounts yet.</p>
            ) : children.map((c) => (
              <div key={c.user_id} className="flex items-center justify-between p-2 rounded-md bg-secondary/50 border border-border">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground">{c.display_name}</p>
                    <Badge variant="secondary" className="capitalize">{c.child_type}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{c.phone || "no phone"} • added {new Date(c.created_at).toLocaleDateString()}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setRemoveChildTarget(c)} className="text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="child-email">Email *</Label>
              <Input id="child-email" type="email" placeholder="user@example.com" value={childForm.email} onChange={(e) => setChildForm((p) => ({ ...p, email: e.target.value }))} className="touch-target" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="child-name">Full Name *</Label>
              <Input id="child-name" placeholder="Name" value={childForm.display_name} onChange={(e) => setChildForm((p) => ({ ...p, display_name: e.target.value }))} className="touch-target" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="child-type">Type</Label>
              <Select value={childForm.child_type} onValueChange={(v) => setChildForm((p) => ({ ...p, child_type: v as "family" | "tenant" }))}>
                <SelectTrigger id="child-type" className="touch-target"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="family">Family</SelectItem>
                  <SelectItem value="tenant">Tenant</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={() => void addChild()} disabled={addingChild} className="touch-target gap-2">
            <Plus className="h-4 w-4" /> {addingChild ? "Adding..." : "Add Child Account"}
          </Button>
          {issuedChildCred && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
              <p className="text-sm font-medium text-foreground">Share these credentials with the user:</p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Email:</span>
                <span className="font-mono">{issuedChildCred.email}</span>
              </div>
              <div className="flex items-center justify-between text-sm gap-2">
                <span className="text-muted-foreground">Password:</span>
                <span className="font-mono break-all">{issuedChildCred.password}</span>
                <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard.writeText(issuedChildCred.password); toast({ title: "Copied" }); }}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <Button size="sm" variant="outline" onClick={() => setIssuedChildCred(null)}>Dismiss</Button>
            </div>
          )}
        </div>
        </>
        )}

        <div className="pt-4 border-t border-destructive/30 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <p className="text-sm font-medium text-destructive">Danger Zone</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Deleting your account removes your profile and flat association permanently.
            {!isChild && " If you have family/tenant accounts linked to your profile, remove them first."}
            {" "}This cannot be undone.
          </p>
          <Button
            variant="outline"
            onClick={() => setDeleteAccountOpen(true)}
            className="border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground gap-2"
          >
            <Trash2 className="h-4 w-4" /> Delete My Account
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <DashboardShell
      brandTitle="Resident Portal"
      brandSubtitle={`${profileForm.display_name || resident?.owner_name || "Resident"}${activeFlat ? ` • ${activeFlat.flat_label}` : ""}`}
      groupLabel="My Account"
      items={NAV}
      activeId={activeView}
      onSelect={setActiveView}
      onSignOut={handleSignOut}
    >
      {activeView === "home" && (
        <ResidentHome
          displayName={profileForm.display_name}
          societyName={societyName ?? ""}
          flats={flats}
          formatFlat={formatFlat}
          pendingDeliveries={pendingDeliveries}
          visitLogs={visitLogs}
          onNavigate={setActiveView}
        />
      )}
      {activeView === "guest" && renderGuest()}
      {activeView === "vehicles" && (
        <>
          {renderVehicles()}
          {!isChild && renderRequests()}
          {renderHistory()}
        </>
      )}
      {activeView === "ev" && <EvChargingResident />}

      {activeView === "profile" && renderProfile()}
      {activeView === "helps" && (
        <>
          <HouseHelpsManager residentFlats={flats} />
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">House Help Attendance</h2>
            <StaffAttendanceLog filterCategory="house_help" showSummary={true} />
          </div>
        </>
      )}
      {activeView === "dues" && <MyDues residentFlats={flats} formatFlat={formatFlat} />}
      {activeView === "amenities" && <AmenityBooking residentFlats={flats} />}
      {activeView === "deliveries" && (
      <ResidentDeliveryApprovals onPendingCountChange={setPendingDeliveries} />
      )}
      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Request vehicle removal?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget && (
                <>This will send a removal request to the admin for <span className="font-semibold">{removeTarget.vehicle_number}</span> ({removeTarget.owner_name}). The vehicle stays active until the admin approves.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void submitRemoveRequest()}>Send Request</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!removeChildTarget} onOpenChange={(o) => !o && setRemoveChildTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this account?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeChildTarget && (<>This permanently deletes the account for <span className="font-semibold">{removeChildTarget.display_name}</span>. They will no longer be able to log in.</>)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => removeChildTarget && void removeChild(removeChildTarget.user_id)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleteAccountOpen} onOpenChange={(o) => { if (!o) { setDeleteAccountOpen(false); setDeleteConfirmText(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes your profile and flat association from {societyName ?? "this society"}.
              Your past visitor/vehicle activity is kept for the society's records but is no longer linked to your name.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-confirm" className="text-sm">Type <span className="font-mono font-semibold">DELETE</span> to confirm</Label>
            <Input
              id="delete-confirm"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              className="touch-target"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirmText("")}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void deleteOwnAccount()}
              disabled={deleteConfirmText !== "DELETE" || deletingAccount}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingAccount ? "Deleting..." : "Delete My Account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardShell>
  );
};

export default ResidentPortal;
