import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Check, X, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import VehicleNumberInput from "@/components/VehicleNumberInput";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import StatusBadge from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables } from "@/integrations/supabase/types";
import { createOpaqueVehicleQrCode } from "@/lib/qr-code";
import { useSocietyStructure } from "@/hooks/useSocietyStructure";

type ChangeRequest = Tables<"vehicle_change_requests">;

interface Props {
  onChanged?: () => void;
}

const VehicleChangeRequestsAdmin = ({ onChanged }: Props) => {
  const { toast } = useToast();
  const { societyId } = useAuth();
  const { formatFlat } = useSocietyStructure(societyId);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ChangeRequest | null>(null);
  const [form, setForm] = useState({
    owner_name: "",
    vehicle_number: "",
    vehicle_type: "car",
    wing: "A",
    flat_number: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);

  const fetchRequests = useCallback(async () => {
    const { data, error } = await supabase
      .from("vehicle_change_requests")
      .select("*")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast({ title: "Could not load requests", description: error.message, variant: "destructive" });
      return;
    }
    setRequests((data ?? []) as ChangeRequest[]);
  }, [toast]);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  const openReview = (r: ChangeRequest) => {
    setEditing(r);
    setForm({
      owner_name: r.owner_name,
      vehicle_number: r.vehicle_number,
      vehicle_type: r.vehicle_type,
      wing: r.wing,
      flat_number: r.flat_number,
      notes: r.notes ?? "",
    });
  };

  const closeReview = () => {
    setEditing(null);
  };

  const approve = async () => {
    if (!editing) return;
    setBusy(true);

    const userResp = await supabase.auth.getUser();
    const adminId = userResp.data.user?.id ?? null;

    if (editing.request_type === "add") {
      const normalized = form.vehicle_number.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const { data: existing } = await supabase.from("vehicles").select("vehicle_number, owner_name, wing, flat_number");
      const dup = (existing ?? []).find(
        (v) => v.vehicle_number.toUpperCase().replace(/[^A-Z0-9]/g, "") === normalized,
      );
      if (dup) {
        setBusy(false);
        toast({
          title: "Duplicate vehicle",
          description: `${dup.vehicle_number} is already registered to ${dup.owner_name} (${formatFlat(dup.wing, dup.flat_number)}).`,
          variant: "destructive",
        });
        return;
      }
      if (!societyId) { setBusy(false); toast({ title: "Society not loaded", variant: "destructive" }); return; }
      const qr = createOpaqueVehicleQrCode();
      const { error: insertErr } = await supabase.from("vehicles").insert({
        owner_name: form.owner_name.trim(),
        vehicle_number: form.vehicle_number.trim().toUpperCase(),
        vehicle_type: form.vehicle_type,
        wing: form.wing,
        flat_number: form.flat_number.trim(),
        qr_code: qr,
        society_id: societyId,
      });
      if (insertErr) {
        setBusy(false);
        toast({ title: "Approval failed", description: insertErr.message, variant: "destructive" });
        return;
      }
    } else {
      // remove
      if (editing.target_vehicle_id) {
        const { error: delErr } = await supabase
          .from("vehicles")
          .delete()
          .eq("id", editing.target_vehicle_id);
        if (delErr) {
          setBusy(false);
          toast({ title: "Approval failed", description: delErr.message, variant: "destructive" });
          return;
        }
      }
    }

    const { error: updErr } = await supabase
      .from("vehicle_change_requests")
      .update({
        owner_name: form.owner_name.trim(),
        vehicle_number: form.vehicle_number.trim().toUpperCase(),
        vehicle_type: form.vehicle_type,
        wing: form.wing,
        flat_number: form.flat_number.trim(),
        notes: form.notes.trim() || null,
        status: "approved",
        reviewed_at: new Date().toISOString(),
        reviewed_by: adminId,
      })
      .eq("id", editing.id);

    setBusy(false);
    if (updErr) {
      toast({ title: "Could not mark approved", description: updErr.message, variant: "destructive" });
      return;
    }
    toast({ title: "Request approved" });
    closeReview();
    await fetchRequests();
    onChanged?.();
  };

  const reject = async () => {
    if (!editing) return;
    setBusy(true);
    const userResp = await supabase.auth.getUser();
    const adminId = userResp.data.user?.id ?? null;
    const { error } = await supabase
      .from("vehicle_change_requests")
      .update({
        status: "rejected",
        notes: form.notes.trim() || null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: adminId,
      })
      .eq("id", editing.id);
    setBusy(false);
    if (error) {
      toast({ title: "Could not reject", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Request rejected" });
    closeReview();
    await fetchRequests();
  };

  const pending = requests.filter((r) => r.status === "pending");
  const recent = requests.filter((r) => r.status !== "pending").slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ClipboardCheck className="h-5 w-5 text-primary-ink" />
          Vehicle Change Requests
          {pending.length > 0 && (
            <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-warning/20 text-warning-ink border border-warning/30">
              {pending.length} pending
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>
        ) : pending.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No pending requests</p>
        ) : (
          pending.map((r) => (
            <div key={r.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase border ${r.request_type === "add" ? "bg-success/15 text-success-ink border-success/30" : "bg-destructive/15 text-destructive-ink border-destructive/30"}`}>
                    {r.request_type}
                  </span>
                  <p className="font-bold text-foreground">{r.vehicle_number}</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {r.owner_name} • {formatFlat(r.wing, r.flat_number)} • {r.vehicle_type}
                </p>
                <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => openReview(r)} className="touch-target gap-1">
                <Pencil className="h-4 w-4" />
                Review
              </Button>
            </div>
          ))
        )}

        {recent.length > 0 && (
          <div className="pt-3 space-y-2 border-t border-border">
            <p className="text-xs font-medium text-muted-foreground">Recently processed</p>
            {recent.map((r) => (
              <div key={r.id} className="flex items-center justify-between p-2 rounded-md bg-secondary/30 border border-border text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs uppercase text-muted-foreground">{r.request_type}</span>
                  <span className="font-medium truncate">{r.vehicle_number}</span>
                  <span className="text-xs text-muted-foreground truncate">{formatFlat(r.wing, r.flat_number)}</span>
                </div>
                <StatusBadge status={r.status as "approved" | "rejected"} />
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && closeReview()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Review {editing?.request_type === "add" ? "Add Vehicle" : "Remove Vehicle"} Request
            </DialogTitle>
            <DialogDescription>
              {editing?.request_type === "add"
                ? "You can edit any field before approving."
                : "Confirm the vehicle to be removed. You can update notes before deciding."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Owner Name</Label>
              <Input
                value={form.owner_name}
                disabled={editing?.request_type === "remove"}
                onChange={(e) => setForm((p) => ({ ...p, owner_name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Vehicle Number</Label>
              <VehicleNumberInput
                value={form.vehicle_number}
                disabled={editing?.request_type === "remove"}
                onChange={(v) => setForm((p) => ({ ...p, vehicle_number: v }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Wing</Label>
              <Select
                value={form.wing}
                onValueChange={(v) => setForm((p) => ({ ...p, wing: v }))}
                disabled={editing?.request_type === "remove"}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["A", "B", "C", "D", "E", "F", "G", "H"].map((w) => (
                    <SelectItem key={w} value={w}>Wing {w}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Flat Number</Label>
              <Input
                value={form.flat_number}
                disabled={editing?.request_type === "remove"}
                onChange={(e) => setForm((p) => ({ ...p, flat_number: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Vehicle Type</Label>
              <Select
                value={form.vehicle_type}
                onValueChange={(v) => setForm((p) => ({ ...p, vehicle_type: v }))}
                disabled={editing?.request_type === "remove"}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="car">Car</SelectItem>
                  <SelectItem value="bike">Bike</SelectItem>
                  <SelectItem value="scooty">Scooty</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea
              placeholder="Reason or comments"
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button variant="destructive" onClick={() => void reject()} disabled={busy} className="gap-1">
              <X className="h-4 w-4" />
              Reject
            </Button>
            <Button onClick={() => void approve()} disabled={busy} className="gap-1">
              <Check className="h-4 w-4" />
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default VehicleChangeRequestsAdmin;