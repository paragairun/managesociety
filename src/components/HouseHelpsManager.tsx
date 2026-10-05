import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2, IdCard, Fingerprint, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import StaffIdCard from "@/components/StaffIdCard";
import StaffProfileFields, { emptyProfileFields, validateProfileFields, profileFieldsToRow } from "@/components/StaffProfileFields";
import FingerprintEnroll from "@/components/FingerprintEnroll";
import StaffBulkUpload from "@/components/StaffBulkUpload";
import { useSocietyStructure } from "@/hooks/useSocietyStructure";

const HELP_TYPES = ["Maid", "Driver", "Cook", "Nurse", "Nanny", "Personal Security", "Other"];

interface HouseHelp {
  id: string; name: string; help_type: string; phone: string | null;
  photo_base64: string | null; qr_code: string; is_active: boolean; fingerprint_enrolled?: boolean;
  flats: { wing: string; flat_number: string }[];
}

interface ResidentFlat { id: string; wing: string; flat_number: string; flat_label: string; }

const emptyForm = () => ({ name: "", help_type: "", phone: "", photo_base64: "", ...emptyProfileFields() });

const HouseHelpsManager = ({ residentFlats }: { residentFlats: ResidentFlat[] }) => {
  const { societyId, user, societyName } = useAuth();
  const { formatFlat } = useSocietyStructure(societyId);
  const { toast } = useToast();
  const [helps, setHelps] = useState<HouseHelp[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showIdCard, setShowIdCard] = useState<HouseHelp | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [fingerprintFor, setFingerprintFor] = useState<{ id: string; name: string } | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [selectedFlatId, setSelectedFlatId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchHelps = useCallback(async () => {
    if (!user || !societyId) return;
    setLoading(true);
    const { data: linkData } = await supabase.from("house_help_flats").select("house_help_id, wing, flat_number").eq("resident_id", user.id);
    if (!linkData || linkData.length === 0) { setHelps([]); setLoading(false); return; }
    const helpIds = [...new Set(linkData.map((l: { house_help_id: string }) => l.house_help_id))];
    const { data: helpData } = await supabase.from("house_helps").select("*").in("id", helpIds).eq("society_id", societyId);
    setHelps((helpData ?? []).map((h) => ({
      ...h,
      flats: linkData.filter((l: { house_help_id: string; wing: string; flat_number: string }) => l.house_help_id === h.id).map((l: { wing: string; flat_number: string }) => ({ wing: l.wing, flat_number: l.flat_number })),
    })));
    setLoading(false);
  }, [user, societyId]);

  useEffect(() => { void fetchHelps(); }, [fetchHelps]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((p) => ({ ...p, photo_base64: reader.result as string }));
    reader.readAsDataURL(file);
  };

  const generateQr = () => `HLP-${crypto.randomUUID().replace(/-/g,"").slice(0,12).toUpperCase()}`;

  const handleAdd = async () => {
    if (!form.name.trim()) { toast({ title: "Enter name", variant: "destructive" }); return; }
    if (!form.help_type) { toast({ title: "Select type", variant: "destructive" }); return; }
    if (!selectedFlatId) { toast({ title: "Select which flat they work for", variant: "destructive" }); return; }
    const problem = validateProfileFields(form);
    if (problem) { toast({ title: problem, variant: "destructive" }); return; }
    if (!societyId || !user) return;
    const flat = residentFlats.find((f) => f.id === selectedFlatId);
    if (!flat) return;
    setSaving(true);
    const { data: newHelp, error: helpErr } = await supabase.from("house_helps").insert({
      society_id: societyId, name: form.name.trim(), help_type: form.help_type,
      phone: form.phone.trim() || null, photo_base64: form.photo_base64 || null, qr_code: generateQr(),
      ...profileFieldsToRow(form),
    }).select("id").single();
    if (helpErr || !newHelp) { setSaving(false); toast({ title: "Failed to add", description: helpErr?.message, variant: "destructive" }); return; }
    await supabase.from("house_help_flats").insert({ house_help_id: newHelp.id, resident_id: user.id, wing: flat.wing, flat_number: flat.flat_number });
    setSaving(false);
    toast({ title: `${form.name} registered` });
    setForm(emptyForm()); setSelectedFlatId(""); setShowAdd(false);
    await fetchHelps();
  };

  const removeHelp = async (help: HouseHelp) => {
    if (!user) return;
    await supabase.from("house_help_flats").delete().eq("house_help_id", help.id).eq("resident_id", user.id);
    toast({ title: `${help.name} removed from your flats` });
    await fetchHelps();
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">My House Helps</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowImport((v) => !v)} className="gap-1">
            <FileSpreadsheet className="h-4 w-4" /> Import
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1">
          <Plus className="h-4 w-4" /> Add Help
        </Button>
        </div>
      </CardHeader>
      <CardContent>
        {showImport && (
          <div className="mb-4">
            <StaffBulkUpload kind="house_help" defaultRoleType="Other" onComplete={() => { setShowImport(false); void fetchHelps(); }} />
          </div>
        )}
        {loading ? (
          <div className="py-8 flex justify-center"><div className="h-6 w-6 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>
        ) : helps.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No house helps registered yet.</p>
        ) : (
          <div className="space-y-2">
            {helps.map((h) => (
              <div key={h.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/30">
                <div className="flex items-center gap-3">
                  {h.photo_base64 ? (
                    <img src={h.photo_base64} alt={h.name} className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
                      {h.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-sm">{h.name}</p>
                    <p className="text-xs text-muted-foreground">{h.help_type}{h.flats.length > 0 ? ` • ${h.flats.map((f) => formatFlat(f.wing, f.flat_number)).join(", ")}` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setFingerprintFor({ id: h.id, name: h.name })} aria-label="Fingerprints" title={h.fingerprint_enrolled ? "Fingerprint enrolled" : "Enrol fingerprint"}>
                    <Fingerprint className={`h-4 w-4 ${h.fingerprint_enrolled ? "text-success" : "text-muted-foreground"}`} />
                  </Button>
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setShowIdCard(h)} title="View ID Card"><IdCard className="h-4 w-4" /></Button>
                  <Button size="icon" variant="outline" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => void removeHelp(h)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={showAdd} onOpenChange={(o) => !o && setShowAdd(false)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Register House Help</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Full name" /></div>
            <div className="space-y-1">
              <Label>Type *</Label>
              <Select value={form.help_type} onValueChange={(v) => setForm((p) => ({ ...p, help_type: v }))}>
                <SelectTrigger><SelectValue placeholder="Select type..." /></SelectTrigger>
                <SelectContent>{HELP_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Works for flat *</Label>
              <Select value={selectedFlatId} onValueChange={setSelectedFlatId}>
                <SelectTrigger><SelectValue placeholder="Select flat..." /></SelectTrigger>
                <SelectContent>{residentFlats.map((f) => <SelectItem key={f.id} value={f.id}>{formatFlat(f.wing, f.flat_number)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Phone (optional)</Label><Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder="+91 98765 43210" inputMode="tel" /></div>
            <div className="space-y-1">
              <Label>Photo (optional)</Label>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
              <div className="flex items-center gap-3">
                {form.photo_base64 && <img src={form.photo_base64} alt="preview" className="h-14 w-14 rounded-full object-cover border border-border" />}
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>{form.photo_base64 ? "Change photo" : "Upload photo"}</Button>
                {form.photo_base64 && <Button type="button" variant="ghost" size="sm" onClick={() => setForm((p) => ({ ...p, photo_base64: "" }))}>Remove</Button>}
              </div>
            </div>
          </div>
          <StaffProfileFields values={form} onChange={(v) => setForm((p) => ({ ...p, ...v }))} />
            <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={() => void handleAdd()} disabled={saving}>{saving ? "Adding..." : "Register"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showIdCard} onOpenChange={(o) => !o && setShowIdCard(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>ID Card — {showIdCard?.name}</DialogTitle></DialogHeader>
          {showIdCard && (
            <StaffIdCard qrCode={showIdCard.qr_code} name={showIdCard.name} role={showIdCard.help_type}
              category="house_help" photoBase64={showIdCard.photo_base64} societyName={societyName}
              flats={showIdCard.flats.map((f) => formatFlat(f.wing, f.flat_number))}
              fileBaseName={showIdCard.name.toLowerCase().replace(/\s+/g, "-")} />
          )}
        </DialogContent>
      </Dialog>
          {fingerprintFor && (
        <FingerprintEnroll
          open={!!fingerprintFor}
          onClose={() => setFingerprintFor(null)}
          subjectId={fingerprintFor.id}
          subjectCategory="house_help"
          subjectName={fingerprintFor.name}
          onChanged={() => void fetchHelps()}
        />
      )}
</Card>
  );
};

export default HouseHelpsManager;
