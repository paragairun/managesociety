import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Package, Search, LogOut, Clock, CheckCircle, XCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSocietyStructure } from "@/hooks/useSocietyStructure";
import FlatPicker from "@/components/FlatPicker";
import {
  DELIVERY_TYPES, deliveryIcon, deliveryLabel, statusDisplay, emptyDraft,
  normalizeMobile, validateDraft, draftToRow, minutesLeft, groupVisits,
  type DeliveryVisit, type StatusTone,
} from "@/lib/deliveries";

/**
 * The delivery catalogue, the validation and the grouping now live in
 * @/lib/deliveries, shared with the native guard app. The type `value`
 * strings go into delivery_visits.delivery_type, so two apps offering
 * different lists would write rows the other cannot label.
 */
const TONE_CLASS: Record<StatusTone, string> = {
  waiting: "text-warning",
  good: "text-success",
  bad: "text-destructive",
  done: "text-muted-foreground",
};

interface DeliveryManagerProps {
  /** Bump this number (e.g. from a parent's state) to open the registration
   * form immediately -- lets other screens (like a Home dashboard) jump
   * straight to registering a delivery instead of landing on the list. */
  autoOpenTrigger?: number;
}

const DeliveryManager = ({ autoOpenTrigger }: DeliveryManagerProps = {}) => {
  const { societyId, user } = useAuth();
  const { formatFlat } = useSocietyStructure(societyId);
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [visits, setVisits] = useState<DeliveryVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyDraft());
  const [cameraOpen, setCameraOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [exitingId, setExitingId] = useState<string | null>(null);

  useEffect(() => {
    if (autoOpenTrigger) setShowForm(true);
  }, [autoOpenTrigger]);

  const loadVisits = useCallback(async (expire = false) => {
    if (!societyId) return;
    // Auto-expire stale pending visits
    if (expire) await supabase.rpc("expire_delivery_visits", { p_society_id: societyId });

    const { data } = await supabase
      .from("delivery_visits")
      .select("*")
      .eq("society_id", societyId)
      .not("status", "in", '("completed","expired")')
      .order("entry_time", { ascending: false });
    setVisits((data ?? []) as DeliveryVisit[]);
    setLoading(false);
  }, [societyId]);

  useEffect(() => {
    void loadVisits(true);
  }, [loadVisits]);

  // The background refresh PAUSES while the registration form is open.
  //
  // This is why the keyboard kept closing on the guard. Every 10
  // seconds this refetched and called setVisits, re-rendering the list
  // behind the dialog. On Android a re-render that changes the page's
  // layout while the soft keyboard is up makes the WebView dismiss the
  // keyboard — so a guard typing a 10-digit mobile number was thrown
  // out roughly every other digit and had to tap the field again.
  //
  // Nothing is lost by pausing: the list is read-only while the form is
  // open, and it refreshes the moment the dialog closes, which is also
  // when a new row has just been added.
  useEffect(() => {
    if (showForm) return;
    const interval = window.setInterval(() => void loadVisits(true), 10000);
    return () => window.clearInterval(interval);
  }, [loadVisits, showForm]);

  // Camera
  const startCamera = async () => {
    setCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      toast({ title: "Camera not available", variant: "destructive" });
      setCameraOpen(false);
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")!.drawImage(videoRef.current, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    setForm((p) => ({ ...p, photo_base64: dataUrl }));
    stopCamera();
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraOpen(false);
  };

  const handleSubmit = async () => {
    // One message at a time, from the shared validator: the guard fixes
    // one field, taps Register again, and is told the next thing.
    const problem = validateDraft(form);
    if (problem) { toast({ title: problem, variant: "destructive" }); return; }
    if (!societyId) { toast({ title: "Society not loaded", variant: "destructive" }); return; }

    setSaving(true);
    const { error } = await supabase.from("delivery_visits").insert({
      ...draftToRow(form),
      society_id: societyId,
      guard_id: user?.id ?? null,
    });
    setSaving(false);

    if (error) { toast({ title: "Failed to register delivery", description: error.message, variant: "destructive" }); return; }

    toast({ title: "Delivery registered", description: "Waiting for resident approval." });
    setForm(emptyDraft()); setShowForm(false);
    await loadVisits(false);
  };

  const handleExit = async (id: string) => {
    setExitingId(id);
    const { error } = await supabase.from("delivery_visits")
      .update({ status: "completed", exit_time: new Date().toISOString() })
      .eq("id", id);
    setExitingId(null);
    if (error) { toast({ title: "Exit update failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Exit logged" });
    await loadVisits(false);
  };

  const { pending, approved, rejected, total } = groupVisits(visits, searchQuery);

  const VisitCard = ({ v }: { v: DeliveryVisit }) => {
    const statusInfo = statusDisplay(v.status);
    const icon = deliveryIcon(v.delivery_type);
    const typeLabel = deliveryLabel(v.delivery_type);
    const timeStr = new Date(v.entry_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    const expiresIn = minutesLeft(v.expires_at);

    return (
      <div className={`rounded-lg border p-3 space-y-2 ${v.status === "approved" ? "border-success/50 bg-success/5" : v.status === "rejected" ? "border-destructive/30 bg-destructive/5" : "border-border bg-secondary/30"}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            {v.photo_base64 ? (
              <img src={v.photo_base64} alt="agent" className="h-12 w-12 rounded-lg object-cover" />
            ) : (
              <div className="h-12 w-12 rounded-lg bg-primary/20 flex items-center justify-center text-2xl">{icon}</div>
            )}
            <div>
              <p className="font-semibold text-sm">{icon} {typeLabel}</p>
              <p className="text-xs text-muted-foreground">{v.mobile}{v.agent_name ? ` • ${v.agent_name}` : ""}</p>
              <p className="text-xs text-muted-foreground">{formatFlat(v.wing, v.flat_number)} • {timeStr}</p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className={`text-xs font-medium ${TONE_CLASS[statusInfo.tone]}`}>{statusInfo.label}</p>
            {v.status === "pending_approval" && expiresIn > 0 && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end mt-0.5">
                <Clock className="h-3 w-3" /> {expiresIn}m left
              </p>
            )}
          </div>
        </div>
        {v.status === "approved" && (
          <Button size="sm" variant="outline" className="w-full gap-1 border-success/50 text-success hover:bg-success hover:text-white"
            onClick={() => void handleExit(v.id)} disabled={exitingId === v.id}>
            <LogOut className="h-4 w-4" /> Mark Exit
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search by mobile, flat, type..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <Button onClick={() => void loadVisits(true)} variant="outline" size="icon" title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button onClick={() => setShowForm(true)} className="gap-1">
          <Package className="h-4 w-4" /> Register Delivery
        </Button>
      </div>

      {loading ? (
        <div className="py-8 flex justify-center"><div className="h-6 w-6 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-4">
          {pending.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-warning flex items-center gap-1">
                <Clock className="h-4 w-4" /> Awaiting Approval ({pending.length})
              </p>
              {pending.map((v) => <VisitCard key={v.id} v={v} />)}
            </div>
          )}
          {approved.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-success flex items-center gap-1">
                <CheckCircle className="h-4 w-4" /> Approved — Inside ({approved.length})
              </p>
              {approved.map((v) => <VisitCard key={v.id} v={v} />)}
            </div>
          )}
          {rejected.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-destructive flex items-center gap-1">
                <XCircle className="h-4 w-4" /> Rejected ({rejected.length})
              </p>
              {rejected.map((v) => <VisitCard key={v.id} v={v} />)}
            </div>
          )}
          {total === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No active deliveries.</p>
          )}
        </div>
      )}

      {/* Registration dialog */}
      <Dialog open={showForm} onOpenChange={(o) => { if (!o) { setForm(emptyDraft()); stopCamera(); } setShowForm(o); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Register Delivery</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {/* Photo */}
            <div className="space-y-2">
              <Label>Agent Photo (optional)</Label>
              {form.photo_base64 ? (
                <div className="flex items-center gap-3">
                  <img src={form.photo_base64} alt="agent" className="h-20 w-20 rounded-lg object-cover border border-border" />
                  <div className="space-y-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => void startCamera()}>Retake</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setForm((p) => ({ ...p, photo_base64: "" }))}>Remove</Button>
                  </div>
                </div>
              ) : (
                <Button type="button" variant="outline" className="gap-2 w-full" onClick={() => void startCamera()}>
                  <Camera className="h-4 w-4" /> Take Photo
                </Button>
              )}
            </div>

            {/* Mobile
                autoComplete="off" with a name the browser does not
                recognise as a standard field. Without it, Chrome offers
                its saved-value dropdown over the field — those are the
                "existing numbers" that appeared — and on Android that
                dropdown opening and closing fights the soft keyboard
                for the same screen space. A gate terminal is shared by
                every guard on every shift, so the browser remembering
                what the last one typed is wrong regardless of the
                keyboard. */}
            <div className="space-y-1">
              <Label htmlFor="delivery-mobile">Mobile Number *</Label>
              <Input
                id="delivery-mobile"
                name="agent-contact-digits"
                inputMode="numeric"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                value={form.mobile}
                onChange={(e) => setForm((p) => ({ ...p, mobile: normalizeMobile(e.target.value) }))}
                placeholder="98765 43210"
              />
            </div>

            {/* Agent name — same treatment: a saved-name dropdown over
                this field has the identical effect one row down. */}
            <div className="space-y-1">
              <Label htmlFor="delivery-agent-name">Agent Name (optional)</Label>
              <Input
                id="delivery-agent-name"
                name="agent-person-label"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                value={form.agent_name}
                onChange={(e) => setForm((p) => ({ ...p, agent_name: e.target.value }))}
                placeholder="Rajan, delivery agent, etc."
              />
            </div>

            {/* Delivery type */}
            <div className="space-y-1">
              <Label>Delivery Type *</Label>
              <Select value={form.delivery_type} onValueChange={(v) => setForm((p) => ({ ...p, delivery_type: v }))}>
                <SelectTrigger><SelectValue placeholder="Select type..." /></SelectTrigger>
                <SelectContent>
                  {DELIVERY_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.icon} {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Flat picker */}
            <div className="space-y-1">
              <Label>Delivering to *</Label>
              <FlatPicker
                societyId={societyId}
                wing={form.wing}
                flatNumber={form.flat_number}
                onChange={(wing, flat_number) => setForm((p) => ({ ...p, wing, flat_number }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); setForm(emptyDraft()); }}>Cancel</Button>
            <Button onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? "Registering..." : "Register & Notify Resident"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Camera dialog */}
      <Dialog open={cameraOpen} onOpenChange={(o) => { if (!o) stopCamera(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Take Photo</DialogTitle></DialogHeader>
          <video ref={videoRef} autoPlay playsInline className="w-full rounded-lg" />
          <canvas ref={canvasRef} className="hidden" />
          <DialogFooter>
            <Button variant="outline" onClick={stopCamera}>Cancel</Button>
            <Button onClick={capturePhoto} className="gap-1"><Camera className="h-4 w-4" /> Capture</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DeliveryManager;
