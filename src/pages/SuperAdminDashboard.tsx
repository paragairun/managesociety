import { useCallback, useEffect, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { Building2, Check, X, LogOut, ShieldCheck, ClipboardList, Settings2, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import StatusBadge from "@/components/StatusBadge";
import SocietyStructureBuilder from "@/components/SocietyStructureBuilder";
import UnitTypesBuilder from "@/components/UnitTypesBuilder";
import {
  normalizeUnitTypes, toUnitTypeDrafts, isBlankUnitDrafts, emptyUnitType,
  type UnitType, type UnitTypeDraft,
} from "@/lib/societyUnits";
import {
  TowerStructure, emptyTower, normalizeStructure, toEditableState, NormalizedStructure,
} from "@/lib/societyStructure";
import { APP_DOMAIN, appUrl } from "@/lib/app-url";

interface WingRange {
  wing: string;
  flat_from: number;
  flat_to: number;
}
interface TowerRange {
  tower_name: string;
  wings: WingRange[];
}

interface SocietyRow {
  id: string; name: string; city: string; state: string; status: string; created_at: string;
  slug: string; admin_email: string | null;
}
interface RegRow {
  id: string; society_name: string; address_line: string; landmark: string | null;
  city: string; state: string; country: string; pin_code: string;
  admin_email: string; admin_display_name: string; admin_phone: string | null;
  status: string; rejection_reason: string | null; created_at: string;
  society_structure: TowerRange[] | null;
  /** Optional at registration; see supabase/schema/registration_unit_types.sql. */
  unit_types: UnitType[] | null;
}

/**
 * society_structure.unit_types is newer than the generated types.ts,
 * so selecting or upserting it narrows the row to an error type. Cast
 * the CLIENT rather than each row, as evDb.ts and SocietySetup.tsx do;
 * regenerating types.ts deletes this and nothing else.
 *
 * The column is defined in
 * supabase/schema/society_units_and_gate_mode.sql.
 */
const structureDb = supabase as unknown as {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
    upsert: (row: Record<string, unknown>, opts: { onConflict: string }) =>
      Promise<{ error: { message: string } | null }>;
  };
};

const SuperAdminDashboard = () => {
  const { toast } = useToast();
  const { signOut, user, roles, loading } = useAuth();
  const navigate = useNavigate();
  const isSuper = roles.includes("super_admin");

  const [societies, setSocieties] = useState<SocietyRow[]>([]);
  const [requests, setRequests] = useState<RegRow[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<RegRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // Structure editor (super-admin only, for approved societies)
  const [editingSociety, setEditingSociety] = useState<SocietyRow | null>(null);
  const [editingTowers, setEditingTowers] = useState<TowerStructure[]>([emptyTower()]);
  const [editingFloorWise, setEditingFloorWise] = useState(false);
  const [editingFlatsPerFloor, setEditingFlatsPerFloor] = useState("");
  const [structureLoading, setStructureLoading] = useState(false);
  const [structureSaving, setStructureSaving] = useState(false);
  const [editingUnits, setEditingUnits] = useState<UnitTypeDraft[]>([emptyUnitType()]);


  const load = useCallback(async () => {
    const [{ data: socs }, { data: reqs }] = await Promise.all([
      supabase.from("societies").select("id, name, city, state, status, created_at, slug").order("created_at", { ascending: false }),
      supabase.from("society_registration_requests").select("*").order("created_at", { ascending: false }),
    ]);

    // Join admin_email from approved registration requests by society name match
    const approvedReqs = (reqs ?? []) as unknown as RegRow[];
    const enrichedSocs = ((socs ?? []) as Omit<SocietyRow, "admin_email">[]).map((s) => {
      const req = approvedReqs.find(
        (r) => r.society_name.trim().toLowerCase() === s.name.trim().toLowerCase() && r.status === "approved"
      );
      return { ...s, admin_email: req?.admin_email ?? null } as SocietyRow;
    });

    setSocieties(enrichedSocs);
    setRequests(approvedReqs);
  }, []);

  useEffect(() => {
    if (user && isSuper) void load();
  }, [user, isSuper, load]);

  const approve = async (r: RegRow) => {
    setWorking(r.id);
    const { data, error } = await supabase.functions.invoke("approve-society", {
      body: { request_id: r.id, action: "approve" },
    });
    setWorking(null);
    if (error || data?.error) {
      toast({ title: "Approval failed", description: error?.message ?? data?.error, variant: "destructive" });
      return;
    }
    toast({ title: `Society "${r.society_name}" approved`, description: `Admin ${r.admin_email} can now log in.` });
    await load();
  };

  const reject = async () => {
    if (!rejecting) return;
    setWorking(rejecting.id);
    const { data, error } = await supabase.functions.invoke("approve-society", {
      body: { request_id: rejecting.id, action: "reject", reason: rejectReason.trim() || null },
    });
    setWorking(null);
    if (error || data?.error) {
      toast({ title: "Rejection failed", description: error?.message ?? data?.error, variant: "destructive" });
      return;
    }
    toast({ title: "Request rejected" });
    setRejecting(null); setRejectReason("");
    await load();
  };

  const [deletingSociety, setDeletingSociety] = useState<SocietyRow | null>(null);

  const deleteSociety = async () => {
    if (!deletingSociety) return;
    setWorking(deletingSociety.id);
    // Delete cascades via FK: society_structure, profiles, user_roles etc.
    const { error } = await supabase.from("societies").delete().eq("id", deletingSociety.id);
    setWorking(null);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Society "${deletingSociety.name}" deleted` });
    setDeletingSociety(null);
    await load();
  };

  const openStructureEditor = async (society: SocietyRow) => {
    setEditingSociety(society);
    setEditingTowers([emptyTower()]);
    setEditingFloorWise(false);
    setEditingFlatsPerFloor("");
    setEditingUnits([emptyUnitType()]);
    setStructureLoading(true);
    const { data, error } = await structureDb
      .from("society_structure")
      .select("structure, unit_types")
      .eq("society_id", society.id)
      .maybeSingle();
    setStructureLoading(false);
    if (error) {
      toast({ title: "Could not load structure", description: error.message, variant: "destructive" });
      return;
    }
    const normalized = (data?.structure ?? { floor_wise: false, towers: [] }) as unknown as NormalizedStructure;
    const { towers, floorWise, flatsPerFloor } = toEditableState(normalized);
    setEditingTowers(towers);
    setEditingFloorWise(floorWise);
    setEditingFlatsPerFloor(flatsPerFloor);
    setEditingUnits(toUnitTypeDrafts((data?.unit_types ?? []) as UnitType[]));
  };

  const saveStructure = async () => {
    if (!editingSociety) return;
    const result = normalizeStructure(editingTowers, editingFloorWise, editingFlatsPerFloor);
    if ("error" in result) {
      toast({ title: result.error, variant: "destructive" });
      return;
    }
    /**
     * Optional here for the same reason as on the registration form:
     * the platform team editing a society's towers should not be
     * blocked on sq ft figures only the committee has. Blank means
     * "leave the catalogue empty"; anything typed is held to the
     * full rules, because a half-filled catalogue is a mistake.
     */
    let unitTypes: UnitType[] = [];
    if (!isBlankUnitDrafts(editingUnits)) {
      const unitResult = normalizeUnitTypes(editingUnits);
      if ("error" in unitResult) {
        toast({ title: unitResult.error, variant: "destructive" });
        return;
      }
      unitTypes = unitResult.unitTypes;
    }

    setStructureSaving(true);
    const { error } = await structureDb
      .from("society_structure")
      .upsert({
        society_id: editingSociety.id,
        structure: result.structure as unknown as Json,
        unit_types: unitTypes as unknown as Json,
        locked: true,
      }, { onConflict: "society_id" });
    setStructureSaving(false);
    if (error) {
      toast({ title: "Could not save structure", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Society structure updated" });
    setEditingSociety(null);
  };

  // Redirect immediately (no spinner flash) when auth is resolved and user isn't super-admin
  if (!loading && !user) {
    return <Navigate to="/super-admin/login" replace />;
  }
  if (!loading && user && !isSuper) {
    return <Navigate to="/" replace />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const pending = requests.filter((r) => r.status === "pending");
  const processed = requests.filter((r) => r.status !== "pending").slice(0, 10);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-primary/15 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-primary-ink" />
            </div>
            <div>
              <p className="font-bold text-foreground">Platform Super Admin</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={async () => { await signOut(); navigate("/", { replace: true }); }} className="gap-1">
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="grid sm:grid-cols-3 gap-4">
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Active societies</p><p className="text-3xl font-bold">{societies.filter(s => s.status === "active").length}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Pending requests</p><p className="text-3xl font-bold">{pending.length}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total societies</p><p className="text-3xl font-bold">{societies.length}</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-primary-ink" /> Pending Society Registrations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pending.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No pending requests.</p>
            ) : pending.map((r) => (
              <div key={r.id} className="border border-border rounded-lg p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-lg text-foreground">{r.society_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {r.address_line}{r.landmark ? `, ${r.landmark}` : ""}, {r.city}, {r.state} {r.pin_code}, {r.country}
                    </p>
                    <p className="text-sm text-foreground mt-2">
                      <span className="font-semibold">Admin:</span> {r.admin_display_name} • {r.admin_email}
                      {r.admin_phone && ` • ${r.admin_phone}`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{new Date(r.created_at).toLocaleString()}</p>
                    {r.society_structure && r.society_structure.length > 0 && (
                      <div className="mt-2 text-sm">
                        <span className="font-semibold text-foreground">Structure:</span>
                        <ul className="mt-1 space-y-0.5">
                          {r.society_structure.map((tower, ti) => (
                            <li key={ti} className="text-muted-foreground">
                              <span className="text-foreground font-medium">{tower.tower_name}</span>:{" "}
                              {tower.wings.map((w) => `Wing ${w.wing} (${w.flat_from}\u2013${w.flat_to})`).join(", ")}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Shown before approval because this is the one
                        chance to notice a catalogue that reads wrong —
                        a 3BHK at 300 sq ft, say — while it can still be
                        queried with the committee rather than silently
                        becoming the basis of their bills. */}
                    {r.unit_types && r.unit_types.length > 0 && (
                      <div className="mt-2 text-sm">
                        <span className="font-semibold text-foreground">Unit types:</span>{" "}
                        <span className="text-muted-foreground">
                          {r.unit_types.map((t) =>
                            `${t.name} (${t.sizes.map((z) => `${z.sqft}`).join(", ")} sq ft)`,
                          ).join(" \u00b7 ")}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" onClick={() => void approve(r)} disabled={working === r.id} className="gap-1 bg-success hover:bg-success/80">
                      <Check className="h-4 w-4" /> Approve
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => { setRejecting(r); setRejectReason(""); }} disabled={working === r.id} className="gap-1">
                      <X className="h-4 w-4" /> Reject
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary-ink" /> Societies ({societies.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {societies.map((s) => (
              <div key={s.id} className="rounded-lg bg-secondary/40 border border-border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.city}, {s.state}</p>
                    {s.admin_email && (
                      <p className="text-xs text-muted-foreground mt-0.5">Admin: {s.admin_email}</p>
                    )}
                    {s.slug && (
                      <a
                        href={appUrl(`/${s.slug}/admin`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary-ink hover:underline inline-flex items-center gap-1 mt-0.5"
                      >
                        {APP_DOMAIN}/{s.slug}/admin <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={s.status === "active" ? "approved" : s.status === "suspended" ? "rejected" : "pending"} />
                    <Button size="sm" variant="outline" onClick={() => void openStructureEditor(s)} className="gap-1">
                      <Settings2 className="h-4 w-4" /> Structure
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => setDeletingSociety(s)} className="gap-1">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {processed.length > 0 && (
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Recently processed requests</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {processed.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-sm p-2 border border-border rounded">
                  <span className="font-medium">{r.society_name} <span className="text-muted-foreground">• {r.admin_email}</span></span>
                  <StatusBadge status={r.status === "approved" ? "approved" : "rejected"} />
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </main>

      <Dialog open={!!deletingSociety} onOpenChange={(o) => !o && setDeletingSociety(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{deletingSociety?.name}"?</DialogTitle>
            <DialogDescription>
              This permanently deletes the society, all its residents, guards, vehicles, and access logs.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingSociety(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void deleteSociety()} disabled={working !== null}>
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject "{rejecting?.society_name}"?</DialogTitle>
            <DialogDescription>Optionally tell them why so they can resubmit.</DialogDescription>
          </DialogHeader>
          <Textarea placeholder="Reason (optional)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void reject()} disabled={working !== null}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingSociety} onOpenChange={(o) => !o && setEditingSociety(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit structure &amp; units — {editingSociety?.name}</DialogTitle>
            <DialogDescription>
              Towers, wings and flat number ranges for this society. Only the platform team can edit these once a society is approved — the unit catalogue below is not locked.
            </DialogDescription>
          </DialogHeader>
          {structureLoading ? (
            <div className="py-8 flex justify-center">
              <div className="h-6 w-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <SocietyStructureBuilder
              towers={editingTowers}
              floorWise={editingFloorWise}
              flatsPerFloor={editingFlatsPerFloor}
              onChangeTowers={setEditingTowers}
              onChangeFloorWise={setEditingFloorWise}
              onChangeFlatsPerFloor={setEditingFlatsPerFloor}
              disabled={structureSaving}
            />
          )}

          {structureLoading ? null : (
            <div className="space-y-2 pt-2 border-t border-border">
              <div>
                <h4 className="font-semibold text-foreground text-sm">
                  Unit types and sizes{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  What kinds of flat this society has, and the sizes each comes in.
                  Maintenance charges can be set per unit type or per square foot once
                  this exists. The society's own admin can also edit it from Society
                  Setup — unlike the structure above, it is not locked.
                </p>
              </div>
              <UnitTypesBuilder
                drafts={editingUnits}
                onChange={setEditingUnits}
                disabled={structureSaving}
                idPrefix="super-unit"
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingSociety(null)} disabled={structureSaving}>Cancel</Button>
            <Button onClick={() => void saveStructure()} disabled={structureSaving || structureLoading}>
              {structureSaving ? "Saving..." : "Save structure"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SuperAdminDashboard;
