import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, QrCode, Car, BarChart3, Trash2, ChevronDown, ChevronUp, Link as LinkIcon, Users, ClipboardList, Upload, UserPlus, ClipboardCheck, FileSpreadsheet, Activity, TrendingUp, Check, ChevronsUpDown, Search, Radio, Download, User, Wallet, Home, Sparkles, Calendar } from "lucide-react";
import RegistrationRequests from "@/components/RegistrationRequests";
import BarrierDevicesAdmin from "@/components/BarrierDevicesAdmin";
import CsvUpload from "@/components/CsvUpload";
import BulkResidentUpload from "@/components/BulkResidentUpload";
import AccessLogsViewer from "@/components/AccessLogsViewer";
import UserRegistry from "@/components/UserRegistry";
import GuardRegistry from "@/components/GuardRegistry";
import DevicePinMapping from "@/components/DevicePinMapping";
import VehicleChangeRequestsAdmin from "@/components/VehicleChangeRequestsAdmin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import VehicleNumberInput from "@/components/VehicleNumberInput";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import QrGenerator from "@/components/QrGenerator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useSocietyStructure } from "@/hooks/useSocietyStructure";
import { createOpaqueVehicleQrCode } from "@/lib/qr-code";
import DashboardShell, { NavItem } from "@/components/DashboardShell";
import SocietyStaffManager from "@/components/SocietyStaffManager";
import StaffAttendanceLog from "@/components/StaffAttendanceLog";
import AdminProfile from "@/components/AdminProfile";
import MaintenanceBillingSetup from "@/components/MaintenanceBillingSetup";
import AmenitiesSetup from "@/components/AmenitiesSetup";
import AmenityBookingsAdmin from "@/components/AmenityBookingsAdmin";
import AdminHome from "@/components/AdminHome";

type Vehicle = Tables<"vehicles">;
type EntryLog = Tables<"entry_logs">;
type ResidentOption = { user_id: string; display_name: string; flats: { wing: string; flat_number: string }[] };

const NAV: NavItem[] = [
  { id: "home", title: "Home", icon: Home },
  { id: "stats", title: "Statistics", icon: BarChart3 },
  { id: "register", title: "Register Vehicle", icon: Plus },
  { id: "bulk-vehicles", title: "Bulk Vehicle Upload", icon: Upload },
  { id: "bulk-residents", title: "Bulk Resident Upload", icon: UserPlus },
  { id: "reg-requests", title: "User Registration Requests", icon: ClipboardCheck },
  { id: "vehicle-requests", title: "Vehicle Change Requests", icon: FileSpreadsheet },
  { id: "access-logs", title: "Access Logs", icon: ClipboardList },
  { id: "users", title: "User Registry", icon: Users },
  { id: "registry", title: "Vehicle Registry", icon: Car },
  { id: "visitor-qr", title: "Visitor Form QR", icon: LinkIcon },
  { id: "barriers", title: "Boom Barriers", icon: Radio },
  { id: "staff", title: "Staff", icon: Users },
  { id: "staff-logs", title: "Staff Attendance", icon: ClipboardList },
  { id: "billing-setup", title: "Maintenance Billing", icon: Wallet },
  { id: "amenities-setup", title: "Amenities Setup", icon: Sparkles },
  { id: "amenities-bookings", title: "Amenity Bookings", icon: Calendar },
  { id: "profile", title: "My Profile", icon: User },
];

const AdminPanel = () => {
  const [activeView, setActiveView] = useState("home");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [showQrFor, setShowQrFor] = useState<string | null>(null);
  const [justRegisteredQr, setJustRegisteredQr] = useState<string | null>(null);
  const [justRegisteredName, setJustRegisteredName] = useState<string | null>(null);
  const [newVehicle, setNewVehicle] = useState({ flat_number: "", wing: "A", vehicle_number: "", vehicle_type: "car", owner_name: "" });
  const [residents, setResidents] = useState<ResidentOption[]>([]);
  const [selectedResidentId, setSelectedResidentId] = useState<string>("");
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);
  const [stats, setStats] = useState({ total_vehicles: 0, currently_inside: 0, today_entries: 0, week_entries: 0, total_residents: 0, pending_requests: 0 });
  const [recentEntries, setRecentEntries] = useState<EntryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingVehicle, setSavingVehicle] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [vehiclesExpanded, setVehiclesExpanded] = useState(false);
  const [registrySearchQuery, setRegistrySearchQuery] = useState("");
  const { toast } = useToast();
  const { signOut, societyId, societyName, societySlug } = useAuth();
  const navigate = useNavigate();
  const adminLoginPath = societySlug ? `/${societySlug}/admin` : "/admin";
  const handleSignOut = async () => { await signOut(); navigate(adminLoginPath, { replace: true }); };
  const { formatFlat } = useSocietyStructure(societyId);

  const fetchAdminData = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(); startOfWeek.setDate(startOfWeek.getDate() - 7);

    const [vehiclesResult, insideResult, todayResult, weekResult, residentsResult, pendingResult, recentResult] = await Promise.all([
      supabase.from("vehicles").select("*").order("created_at", { ascending: false }),
      supabase.from("entry_logs").select("id", { count: "exact", head: true }).is("exit_time", null),
      supabase.from("entry_logs").select("id", { count: "exact", head: true }).gte("entry_time", startOfDay.toISOString()),
      supabase.from("entry_logs").select("id", { count: "exact", head: true }).gte("entry_time", startOfWeek.toISOString()),
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("vehicle_change_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("entry_logs").select("*").order("entry_time", { ascending: false }).limit(8),
    ]);

    if (vehiclesResult.error) toast({ title: "Could not load vehicles", description: vehiclesResult.error.message, variant: "destructive" });
    else {
      const nv = (vehiclesResult.data ?? []) as Vehicle[];
      setVehicles(nv);
      setStats((p) => ({ ...p, total_vehicles: nv.length }));
    }
    if (!insideResult.error) setStats((p) => ({ ...p, currently_inside: insideResult.count ?? 0 }));
    if (!todayResult.error) setStats((p) => ({ ...p, today_entries: todayResult.count ?? 0 }));
    if (!weekResult.error) setStats((p) => ({ ...p, week_entries: weekResult.count ?? 0 }));
    if (!residentsResult.error) setStats((p) => ({ ...p, total_residents: residentsResult.count ?? 0 }));
    if (!pendingResult.error) setStats((p) => ({ ...p, pending_requests: pendingResult.count ?? 0 }));
    if (!recentResult.error) setRecentEntries((recentResult.data ?? []) as EntryLog[]);

    if (showLoader) setLoading(false);
  }, [toast]);

  useEffect(() => {
    void fetchAdminData(true);
    const interval = window.setInterval(() => void fetchAdminData(false), 5000);
    return () => window.clearInterval(interval);
  }, [fetchAdminData]);

  useEffect(() => {
    const loadResidents = async () => {
      const [profilesRes, flatsRes] = await Promise.all([
        supabase.from("profiles").select("user_id, display_name, wing, flat_number"),
        supabase.from("resident_flats").select("user_id, wing, flat_number"),
      ]);
      const flatsByUser = new Map<string, { wing: string; flat_number: string }[]>();
      (flatsRes.data ?? []).forEach((f) => {
        const arr = flatsByUser.get(f.user_id) ?? [];
        arr.push({ wing: f.wing, flat_number: f.flat_number });
        flatsByUser.set(f.user_id, arr);
      });
      const list: ResidentOption[] = (profilesRes.data ?? [])
        .filter((p) => p.display_name && p.display_name.trim().length > 0)
        .map((p) => {
          let flats = flatsByUser.get(p.user_id) ?? [];
          if (flats.length === 0 && p.wing && p.flat_number) {
            flats = [{ wing: p.wing, flat_number: p.flat_number }];
          }
          // de-duplicate flats
          const seen = new Set<string>();
          flats = flats.filter((f) => {
            const k = `${f.wing}|${f.flat_number}`;
            if (seen.has(k)) return false;
            seen.add(k); return true;
          });
          return { user_id: p.user_id, display_name: p.display_name as string, flats };
        })
        .filter((r) => r.flats.length > 0)
        .sort((a, b) => a.display_name.localeCompare(b.display_name));
      setResidents(list);
    };
    void loadResidents();
  }, []);

  const selectedResident = useMemo(
    () => residents.find((r) => r.user_id === selectedResidentId) ?? null,
    [residents, selectedResidentId],
  );

  const filteredVehicles = useMemo(() => {
    if (!registrySearchQuery.trim()) return vehicles;
    const q = registrySearchQuery.trim().toLowerCase();
    return vehicles.filter((v) =>
      v.vehicle_number.toLowerCase().includes(q) ||
      v.owner_name.toLowerCase().includes(q) ||
      v.wing.toLowerCase().includes(q) ||
      v.flat_number.toLowerCase().includes(q) ||
      v.vehicle_type.toLowerCase().includes(q)
    );
  }, [vehicles, registrySearchQuery]);

  const vehicleBreakdown = useMemo(() => {
    const byType: Record<string, number> = {};
    const byWing: Record<string, number> = {};
    vehicles.forEach((v) => {
      byType[v.vehicle_type] = (byType[v.vehicle_type] ?? 0) + 1;
      byWing[v.wing] = (byWing[v.wing] ?? 0) + 1;
    });
    return { byType, byWing };
  }, [vehicles]);

  const addVehicle = async () => {
    if (!selectedResident) {
      toast({ title: "Select an owner from the resident list", variant: "destructive" }); return;
    }
    if (!newVehicle.flat_number || !newVehicle.vehicle_number || !newVehicle.owner_name) {
      toast({ title: "Fill all required fields", variant: "destructive" }); return;
    }
    const flatMatch = selectedResident.flats.some(
      (f) => f.wing === newVehicle.wing && f.flat_number === newVehicle.flat_number,
    );
    if (!flatMatch) {
      toast({ title: "Select a flat from the owner's registered flats", variant: "destructive" }); return;
    }
    setSavingVehicle(true);
    const normalized = newVehicle.vehicle_number.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const { data: existing } = await supabase.from("vehicles").select("vehicle_number, owner_name, wing, flat_number");
    const dup = (existing ?? []).find((v) => v.vehicle_number.toUpperCase().replace(/[^A-Z0-9]/g, "") === normalized);
    if (dup) {
      setSavingVehicle(false);
      toast({ title: "Duplicate vehicle", description: `${dup.vehicle_number} is already registered to ${dup.owner_name} (${formatFlat(dup.wing, dup.flat_number)}).`, variant: "destructive" });
      return;
    }
    if (!societyId) { setSavingVehicle(false); toast({ title: "Society not loaded", variant: "destructive" }); return; }
    const qr = createOpaqueVehicleQrCode();
    const { data, error } = await supabase.from("vehicles").insert({
      flat_number: newVehicle.flat_number.trim(), wing: newVehicle.wing,
      vehicle_number: newVehicle.vehicle_number.trim().toUpperCase(),
      vehicle_type: newVehicle.vehicle_type, owner_name: newVehicle.owner_name.trim(), qr_code: qr,
      society_id: societyId,
    }).select("*").single();
    setSavingVehicle(false);
    if (error) {
      const isDup = error.code === "23505" || /duplicate|unique/i.test(error.message);
      toast({ title: isDup ? "Duplicate vehicle" : "Vehicle registration failed",
        description: isDup ? `${newVehicle.vehicle_number.toUpperCase()} is already registered.` : error.message, variant: "destructive" });
      return;
    }
    setJustRegisteredQr(qr);
    setJustRegisteredName(`${newVehicle.wing}-${newVehicle.flat_number.trim()}-${newVehicle.vehicle_type}-${newVehicle.vehicle_number.trim().toUpperCase()}`);
    setShowQrFor(null);
    setNewVehicle({ flat_number: "", wing: "A", vehicle_number: "", vehicle_type: "car", owner_name: "" });
    setSelectedResidentId("");
    setVehicles((prev) => [data as Vehicle, ...prev]);
    await fetchAdminData(false);
    toast({ title: "Vehicle Registered", description: `QR: ${qr}` });
  };

  const allSelected = vehicles.length > 0 && selectedIds.size === vehicles.length;
  const toggleSelect = (id: string) => setSelectedIds((prev) => {
    const n = new Set(prev);
    if (n.has(id)) { n.delete(id); } else { n.add(id); }
    return n;
  });
  const toggleSelectAll = () => allSelected ? setSelectedIds(new Set()) : setSelectedIds(new Set(vehicles.map((v) => v.id)));

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    const { error } = await supabase.from("vehicles").delete().in("id", Array.from(selectedIds));
    setDeleting(false);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Deleted ${selectedIds.size} vehicle(s)` });
    setSelectedIds(new Set());
    await fetchAdminData(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const StatCard = ({ label, value, icon: Icon, accent }: { label: string; value: number; icon: typeof Car; accent?: string }) => (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${accent ?? "bg-primary/10 text-primary"}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold text-foreground leading-none">{value}</p>
          <p className="text-xs text-muted-foreground mt-1 truncate">{label}</p>
        </div>
      </CardContent>
    </Card>
  );

  const renderStats = () => (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Registered Vehicles" value={stats.total_vehicles} icon={Car} />
        <StatCard label="Currently Inside" value={stats.currently_inside} icon={Activity} accent="bg-success/10 text-success" />
        <StatCard label="Today's Entries" value={stats.today_entries} icon={QrCode} />
        <StatCard label="Last 7 Days" value={stats.week_entries} icon={TrendingUp} accent="bg-accent/10 text-accent" />
        <StatCard label="Total Residents" value={stats.total_residents} icon={Users} />
        <StatCard label="Pending Requests" value={stats.pending_requests} icon={ClipboardCheck} accent="bg-warning/10 text-warning" />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Vehicles by Type</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {Object.keys(vehicleBreakdown.byType).length === 0 ? (
              <p className="text-sm text-muted-foreground">No data</p>
            ) : Object.entries(vehicleBreakdown.byType).map(([type, count]) => {
              const pct = stats.total_vehicles ? (count / stats.total_vehicles) * 100 : 0;
              return (
                <div key={type} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="capitalize text-foreground">{type}</span>
                    <span className="text-muted-foreground">{count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Vehicles by Wing</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {Object.keys(vehicleBreakdown.byWing).length === 0 ? (
              <p className="text-sm text-muted-foreground">No data</p>
            ) : Object.entries(vehicleBreakdown.byWing).sort(([a], [b]) => a.localeCompare(b)).map(([wing, count]) => {
              const pct = stats.total_vehicles ? (count / stats.total_vehicles) * 100 : 0;
              return (
                <div key={wing} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground">Wing {wing}</span>
                    <span className="text-muted-foreground">{count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Recent Activity</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {recentEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent activity</p>
          ) : recentEntries.map((e) => (
            <div key={e.id} className="flex items-center justify-between p-2 rounded-md bg-secondary/50 border border-border">
              <div className="min-w-0">
                <p className="font-medium text-foreground text-sm truncate">{e.vehicle_number} • {e.owner_name}</p>
                <p className="text-xs text-muted-foreground">
                  {e.entry_type} {e.wing && `• ${formatFlat(e.wing, e.flat_number)}`} • {new Date(e.entry_time).toLocaleString()}
                </p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${e.exit_time ? "bg-muted text-muted-foreground" : "bg-success/15 text-success"}`}>
                {e.exit_time ? "exited" : "inside"}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );

  const renderRegister = () => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg"><Plus className="h-5 w-5 text-primary" /> Register New Vehicle</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Owner Name *</Label>
            <Popover open={ownerPickerOpen} onOpenChange={setOwnerPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={ownerPickerOpen}
                  className="touch-target w-full justify-between font-normal">
                  <span className={cn("truncate", !selectedResident && "text-muted-foreground")}>
                    {selectedResident ? selectedResident.display_name : "Search resident..."}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search by name..." />
                  <CommandList>
                    <CommandEmpty>No resident found.</CommandEmpty>
                    <CommandGroup>
                      {residents.map((r) => (
                        <CommandItem key={r.user_id} value={r.display_name}
                          onSelect={() => {
                            setSelectedResidentId(r.user_id);
                            const first = r.flats[0];
                            setNewVehicle((p) => ({
                              ...p,
                              owner_name: r.display_name,
                              wing: first?.wing ?? p.wing,
                              flat_number: first?.flat_number ?? "",
                            }));
                            setOwnerPickerOpen(false);
                          }}>
                          <Check className={cn("mr-2 h-4 w-4", selectedResidentId === r.user_id ? "opacity-100" : "opacity-0")} />
                          <span className="flex-1 truncate">{r.display_name}</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {r.flats.map((f) => `${f.wing}-${f.flat_number}`).join(", ")}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-2">
            <Label>Vehicle Number *</Label>
            <VehicleNumberInput value={newVehicle.vehicle_number} onChange={(v) => setNewVehicle((p) => ({ ...p, vehicle_number: v }))} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Flat *</Label>
            {selectedResident ? (
              selectedResident.flats.length > 1 ? (
                <Select
                  value={newVehicle.wing && newVehicle.flat_number ? `${newVehicle.wing}|${newVehicle.flat_number}` : ""}
                  onValueChange={(v) => {
                    const [wing, flat_number] = v.split("|");
                    setNewVehicle((p) => ({ ...p, wing, flat_number }));
                  }}>
                  <SelectTrigger className="touch-target"><SelectValue placeholder="Select flat" /></SelectTrigger>
                  <SelectContent>
                    {selectedResident.flats.map((f) => (
                      <SelectItem key={`${f.wing}|${f.flat_number}`} value={`${f.wing}|${f.flat_number}`}>
                        Wing {f.wing} — Flat {f.flat_number}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={`Wing ${newVehicle.wing} — Flat ${newVehicle.flat_number}`} readOnly className="touch-target bg-muted" />
              )
            ) : (
              <Input value="" readOnly placeholder="Select an owner first" className="touch-target bg-muted" />
            )}
          </div>
          <div className="space-y-2">
            <Label>Vehicle Type</Label>
            <Select value={newVehicle.vehicle_type} onValueChange={(v) => setNewVehicle((p) => ({ ...p, vehicle_type: v }))}>
              <SelectTrigger className="touch-target"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="car">Car</SelectItem>
                <SelectItem value="bike">Bike</SelectItem>
                <SelectItem value="scooty">Scooty</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={() => void addVehicle()} className="touch-target gap-2" disabled={savingVehicle}>
          <QrCode className="h-4 w-4" /> {savingVehicle ? "Saving..." : "Register & Generate QR"}
        </Button>
        {justRegisteredQr && (
          <div className="flex justify-center pt-4">
            <QrGenerator value={justRegisteredQr} label={`Vehicle QR: ${justRegisteredQr}`} size={400} societyName={societyName} fileBaseName={justRegisteredName ?? undefined} />
          </div>
        )}
      </CardContent>
    </Card>
  );

  const downloadRegistry = () => {
    const headers = ["Vehicle Number", "Owner Name", "Wing", "Flat Number", "Vehicle Type", "QR Code", "Registered At"];
    const rows = vehicles.map((v) => [
      v.vehicle_number,
      v.owner_name,
      v.wing,
      v.flat_number,
      v.vehicle_type,
      v.qr_code,
      new Date(v.created_at).toLocaleString(),
    ]);
    const escapeCsv = (value: string) => {
      const str = String(value);
      if (str.includes('"') || str.includes(",") || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    const csv = [headers.join(","), ...rows.map((r) => r.map(escapeCsv).join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vehicle-registry-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast({ title: "Download started", description: `${vehicles.length} vehicles exported.` });
  };

  const renderRegistry = () => (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg">Vehicle Registry ({filteredVehicles.length})</CardTitle>
          {filteredVehicles.length > 0 && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void downloadRegistry()} className="gap-1 text-xs">
                <Download className="h-4 w-4" /> Download
              </Button>
              <Button variant="outline" size="sm" onClick={toggleSelectAll} className="gap-1 text-xs">
                <Checkbox checked={allSelected} className="pointer-events-none" />
                {allSelected ? "Deselect All" : "Select All"}
              </Button>
              {selectedIds.size > 0 && (
                <Button variant="destructive" size="sm" onClick={() => void deleteSelected()} disabled={deleting} className="gap-1 text-xs">
                  <Trash2 className="h-4 w-4" /> {deleting ? "Deleting..." : `Delete (${selectedIds.size})`}
                </Button>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by vehicle number, owner, wing, flat, or type..."
            value={registrySearchQuery}
            onChange={(e) => setRegistrySearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="space-y-2">
          {filteredVehicles.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No vehicles found</p>
          ) : (vehiclesExpanded ? filteredVehicles : filteredVehicles.slice(0, 5)).map((v) => (
            <div key={v.id} className="space-y-2">
              <div className="flex items-center gap-3 justify-between p-3 rounded-lg bg-secondary/50 border border-border">
                <Checkbox checked={selectedIds.has(v.id)} onCheckedChange={() => toggleSelect(v.id)} className="shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-foreground">{v.vehicle_number}</p>
                  <p className="text-sm text-muted-foreground">{v.owner_name} • {formatFlat(v.wing, v.flat_number)} • {v.vehicle_type}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => {
                  if (showQrFor === v.qr_code) { setShowQrFor(null); }
                  else { setShowQrFor(v.qr_code); }
                }} className="gap-1">
                  <QrCode className="h-4 w-4" /> QR
                </Button>
              </div>
              {showQrFor === v.qr_code && (
                <div className="flex justify-center py-2">
                  <QrGenerator value={v.qr_code} label={`${v.vehicle_number} \u2022 ${formatFlat(v.wing, v.flat_number)}`} size={400} societyName={societyName} fileBaseName={`${v.wing}-${v.flat_number}-${v.vehicle_type}-${v.vehicle_number}`} />
                </div>
              )}
            </div>
          ))}
          {filteredVehicles.length > 5 && (
            <Button variant="ghost" size="sm" onClick={() => setVehiclesExpanded((v) => !v)} className="w-full gap-1 text-xs">
              {vehiclesExpanded ? <><ChevronUp className="h-4 w-4" /> Show less</> : <><ChevronDown className="h-4 w-4" /> Show {filteredVehicles.length - 5} more</>}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );

  const renderVisitorQr = () => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <LinkIcon className="h-5 w-5 text-primary" /> Visitor Form Access QR
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3 text-center">Visitors can scan this QR to open the entry form.</p>
        <div className="flex justify-center">
          <QrGenerator value={societySlug ? `${window.location.origin}/${societySlug}/visitor/form` : `${window.location.origin}/visitor/form?s=${societyId ?? ""}`} label="Visitor Form" size={400} societyName={societyName} />
        </div>
      </CardContent>
    </Card>
  );

  return (
    <DashboardShell
      brandTitle="Admin Panel"
      brandSubtitle={societyName ?? "Your Society"}
      groupLabel="Management"
      items={NAV}
      activeId={activeView}
      onSelect={setActiveView}
      onSignOut={handleSignOut}
    >
      {activeView === "home" && (
        <AdminHome societyName={societyName ?? ""} stats={stats} recentEntries={recentEntries} onNavigate={setActiveView} />
      )}
      {activeView === "stats" && renderStats()}
      {activeView === "register" && renderRegister()}
      {activeView === "registry" && renderRegistry()}
      {activeView === "bulk-vehicles" && <CsvUpload onComplete={() => { void fetchAdminData(false); }} />}
      {activeView === "bulk-residents" && <BulkResidentUpload />}
      {activeView === "reg-requests" && <RegistrationRequests />}
      {activeView === "vehicle-requests" && <VehicleChangeRequestsAdmin onChanged={() => { void fetchAdminData(false); }} />}
      {activeView === "access-logs" && <AccessLogsViewer />}
      {activeView === "users" && <UserRegistry />}
      {activeView === "guards" && <GuardRegistry />}
      {activeView === "device-pins" && <DevicePinMapping />}
      {activeView === "visitor-qr" && renderVisitorQr()}
      {activeView === "barriers" && <BarrierDevicesAdmin />}
      {activeView === "staff" && <SocietyStaffManager />}
      {activeView === "staff-logs" && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Staff Attendance</h2>
      <StaffAttendanceLog filterCategory="all" showSummary={true} />
        </div>
)}
      {activeView === "billing-setup" && <MaintenanceBillingSetup />}
      {activeView === "amenities-setup" && <AmenitiesSetup />}
      {activeView === "amenities-bookings" && <AmenityBookingsAdmin />}
      {activeView === "profile" && <AdminProfile />}
    </DashboardShell>
  );
};

export default AdminPanel;
