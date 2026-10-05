import { useCallback, useEffect, useState } from "react";
import { Fingerprint, Loader2, Trash2, ShieldCheck, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  getFingerprintDriver, assertEnrollable, FingerprintError,
  FINGER_LABELS, BRIDGE_PRESETS, rememberDriverChoice,
  type FingerPosition,
} from "@/lib/fingerprint";

/**
 * Enrol one or more fingers for a staff member or house help.
 *
 * Several fingers per person is deliberate: fingertips get damaged on a
 * worksite, and a second enrolled finger is the difference between a
 * working gate and a queue. Consent is captured explicitly because a
 * fingerprint template is sensitive personal data under the DPDP Act.
 */

interface EnrolledRow {
  id: string;
  finger_position: number;
  quality: number | null;
  device_model: string | null;
  created_at: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  subjectId: string;
  subjectCategory: "society_staff" | "house_help";
  subjectName: string;
  onChanged?: () => void;
}

const FingerprintEnroll = ({ open, onClose, subjectId, subjectCategory, subjectName, onChanged }: Props) => {
  const { societyId, user } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<EnrolledRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [finger, setFinger] = useState<string>("2");
  const [consent, setConsent] = useState(false);
  const [deviceReady, setDeviceReady] = useState<boolean | null>(null);
  const [driverId, setDriverId] = useState<string>(
    () => (typeof localStorage !== "undefined" && localStorage.getItem("fp_driver")) || "mantra",
  );

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    const { data } = await supabase
      .from("fingerprint_enrollments")
      .select("id, finger_position, quality, device_model, created_at")
      .eq("subject_id", subjectId)
      .eq("subject_category", subjectCategory)
      .order("finger_position");
    setRows((data ?? []) as EnrolledRow[]);
    setLoading(false);
  }, [open, subjectId, subjectCategory]);

  useEffect(() => { void load(); }, [load]);

  // Probe the reader whenever the dialog opens or the device changes, so
  // the admin finds out now rather than mid-capture.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDeviceReady(null);
    void getFingerprintDriver().isAvailable().then((ok) => {
      if (!cancelled) setDeviceReady(ok);
    });
    return () => { cancelled = true; };
  }, [open, driverId]);

  const handleDriverChange = (id: string) => {
    setDriverId(id);
    rememberDriverChoice(id);
  };

  const taken = new Set(rows.map((r) => r.finger_position));

  const handleCapture = async () => {
    if (!consent) {
      toast({ title: "Consent required", description: "Record the person's consent before scanning.", variant: "destructive" });
      return;
    }
    if (!societyId) return;
    const position = Number(finger) as FingerPosition;
    if (taken.has(position)) {
      toast({ title: "Finger already enrolled", description: "Delete the existing scan first, or pick another finger.", variant: "destructive" });
      return;
    }

    setCapturing(true);
    try {
      const driver = getFingerprintDriver();
      const capture = await driver.capture();
      assertEnrollable(capture);

      const { error } = await supabase.from("fingerprint_enrollments").insert({
        society_id: societyId,
        subject_category: subjectCategory,
        subject_id: subjectId,
        finger_position: position,
        template: capture.template,
        template_format: capture.templateFormat,
        quality: Math.round(capture.quality),
        device_model: capture.deviceModel ?? null,
        consent_given: true,
        consent_at: new Date().toISOString(),
        enrolled_by: user?.id ?? null,
      });
      if (error) throw new Error(error.message);

      toast({ title: "Finger enrolled", description: `${FINGER_LABELS[position]} saved at ${Math.round(capture.quality)}% quality.` });
      await load();
      onChanged?.();
    } catch (err) {
      const fe = err as FingerprintError;
      toast({
        title: fe.code === "unavailable" ? "Scanner not reachable" : "Could not enrol",
        description: fe.message,
        variant: "destructive",
      });
    } finally {
      setCapturing(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("fingerprint_enrollments").delete().eq("id", id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Fingerprint removed" });
    await load();
    onChanged?.();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Fingerprint className="h-5 w-5" /> Fingerprints — {subjectName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Scanner</Label>
            <Select value={driverId} onValueChange={handleDriverChange}>
              <SelectTrigger className="touch-target"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.values(BRIDGE_PRESETS).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {deviceReady === false && (
              <p className="text-xs text-destructive flex items-start gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Scanner service not reachable. Start the vendor's service on this
                machine and plug in the reader.
              </p>
            )}
            {deviceReady === true && (
              <p className="text-xs text-success flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" /> Scanner ready
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Finger</Label>
            <Select value={finger} onValueChange={setFinger}>
              <SelectTrigger className="touch-target"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(FINGER_LABELS) as unknown as FingerPosition[]).map((p) => (
                  <SelectItem key={p} value={String(p)} disabled={taken.has(Number(p))}>
                    {FINGER_LABELS[p]}{taken.has(Number(p)) ? " (enrolled)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
            <Checkbox checked={consent} onCheckedChange={(c) => setConsent(c === true)} className="mt-0.5" />
            <span>
              {subjectName} has been told their fingerprint will be stored to verify
              entry at the gate, and consents. Only a template is kept, never an image.
            </span>
          </label>

          <Button onClick={() => void handleCapture()} disabled={capturing || !consent} className="w-full touch-target gap-2">
            {capturing
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Place finger on scanner…</>
              : <><Fingerprint className="h-4 w-4" /> Scan and enrol</>}
          </Button>

          <div>
            <Label className="text-xs text-muted-foreground">Enrolled fingers</Label>
            {loading ? (
              <div className="py-4 flex justify-center"><Loader2 className="h-4 w-4 animate-spin" /></div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-3">
                None yet. This person can still enter using their QR ID card.
              </p>
            ) : (
              <div className="space-y-2 mt-2">
                {rows.map((r) => (
                  <div key={r.id} className="flex items-center justify-between p-2 rounded-md border border-border bg-secondary/30">
                    <div className="text-sm">
                      <span className="font-medium">{FINGER_LABELS[r.finger_position as FingerPosition]}</span>
                      {r.quality != null && <span className="text-muted-foreground"> · {r.quality}% quality</span>}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => void handleDelete(r.id)} aria-label="Delete fingerprint">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="w-full">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FingerprintEnroll;
