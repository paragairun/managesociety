import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2, UserCheck, UserX, IdCard, Fingerprint, FileSpreadsheet, Pencil } from "lucide-react";
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
import StaffProfileFields, { emptyProfileFields, validateProfileFields, profileFieldsToRow, profileFieldsFromRow } from "@/components/StaffProfileFields";
import FingerprintEnroll from "@/components/FingerprintEnroll";
import StaffBulkUpload from "@/components/StaffBulkUpload";
import {
  rolesFor, CATEGORY_LABEL, CATEGORY_TABLE, CATEGORY_ROLE_COLUMN,
  type StaffCategory,
} from "@/lib/staffRoles";

/**
 * One screen over BOTH kinds of person. Adding a house help was simply
 * missing from the admin panel - HouseHelpsManager is mounted only on
 * the resident dashboard - so an admin could see house helps in
 * attendance and on the fingerprint mapping screen but had no way to
 * create one.
 *
 * The two tables stay separate (see staffRoles.ts for why): a house
 * help belongs to a resident and is linked to their flat. This
 * component reads both, tags each row with its category, and writes
 * back to whichever table the row came from.
 */
interface StaffMember {
  /** Which table this row came from. Not a stored column. */
  category: StaffCategory;
  /** staff_type or help_type, normalised to one field for rendering. */
  role: string;
  id: string; name: string; staff_type: string; phone: string | null;
  photo_base64: string | null; qr_code: string; is_active: boolean; fingerprint_enrolled?: boolean; created_at: string;
  // Profile columns, needed to prefill the edit dialog. fetchStaff does
  // select("*") so these already arrive; they were simply untyped before.
  gender?: string | null; date_of_birth?: string | null; address?: string | null;
  id_type?: string | null; id_number?: string | null;
  emergency_contact?: string | null; emergency_phone?: string | null;
  device_pin?: string | null;
}

const emptyForm = () => ({
  category: "society_staff" as StaffCategory,
  name: "", staff_type: "", phone: "", photo_base64: "", ...emptyProfileFields(),
});

/** Rows after the Staff / House help filter is applied. */
function applyFilter(rows: StaffMember[], filter: "all" | StaffCategory): StaffMember[] {
  return filter === "all" ? rows : rows.filter((r) => r.category === filter);
}

const SocietyStaffManager = () => {
  const { societyId, societyName } = useAuth();
  const { toast } = useToast();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  // null => the dialog is adding; an id => it is editing that person.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showIdCard, setShowIdCard] = useState<StaffMember | null>(null);
  const [form, setForm] = useState(emptyForm());
  const fileRef = useRef<HTMLInputElement>(null);
  const [fingerprintFor, setFingerprintFor] = useState<{ id: string; name: string } | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | StaffCategory>("all");

  const fetchStaff = useCallback(async () => {
    if (!societyId) return;
    setLoading(true);
    setLoadError(null);

    const [staffRes, helpRes] = await Promise.all([
      supabase.from("staff_members").select("*").eq("society_id", societyId).order("name"),
      supabase.from("house_helps").select("*").eq("society_id", societyId).order("name"),
    ]);

    // Reported rather than discarded: an empty list and a refused query
    // look identical on screen otherwise, which is how a broken RLS
    // policy can pass for "no staff yet".
    if (staffRes.error || helpRes.error) {
      setLoadError((staffRes.error ?? helpRes.error)!.message);
      setStaff([]);
      setLoading(false);
      return;
    }

    const tag = (rows: unknown[], category: StaffCategory): StaffMember[] =>
      (rows ?? []).map((r) => {
        const row = r as Record<string, unknown>;
        return {
          ...(row as unknown as StaffMember),
          category,
          role: String(row[CATEGORY_ROLE_COLUMN[category]] ?? ""),
        };
      });

    const merged = [
      ...tag(staffRes.data ?? [], "society_staff"),
      ...tag(helpRes.data ?? [], "house_help"),
    ].sort((a, b) => a.name.localeCompare(b.name));

    setStaff(merged);
    setLoading(false);
  }, [societyId]);

  useEffect(() => { void fetchStaff(); }, [fetchStaff]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((p) => ({ ...p, photo_base64: reader.result as string }));
    reader.readAsDataURL(file);
  };

  const generateQr = (category: StaffCategory) =>
    `${category === "house_help" ? "HLP" : "STF"}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm());
    setShowAdd(true);
  };

  const openEdit = (s: StaffMember) => {
    setEditingId(s.id);
    setForm({
      category: s.category,
      name: s.name,
      staff_type: s.role,
      phone: s.phone ?? "",
      photo_base64: s.photo_base64 ?? "",
      ...profileFieldsFromRow(s as unknown as Record<string, unknown>),
    });
    setShowAdd(true);
  };

  const closeDialog = () => {
    setShowAdd(false);
    setEditingId(null);
    setForm(emptyForm());
  };

  /**
   * Shared save for both modes. On edit the QR code is deliberately NOT
   * regenerated: it is printed on the person's existing ID card and the
   * guard scanner matches on it, so a new one would silently invalidate
   * a card already in their pocket.
   */
  const handleSave = async () => {
    if (!form.name.trim()) { toast({ title: "Enter staff name", variant: "destructive" }); return; }
    if (!form.staff_type) {
      toast({ title: `Select ${CATEGORY_LABEL[form.category].toLowerCase()} role`, variant: "destructive" });
      return;
    }
    const problem = validateProfileFields(form);
    if (problem) { toast({ title: problem, variant: "destructive" }); return; }
    if (!societyId) return;

    setSaving(true);
    // The role lands in staff_type or help_type depending on which
    // table the row belongs to; everything else is identical.
    const table = CATEGORY_TABLE[form.category];
    const fields = {
      name: form.name.trim(),
      [CATEGORY_ROLE_COLUMN[form.category]]: form.staff_type,
      phone: form.phone.trim() || null,
      photo_base64: form.photo_base64 || null,
      ...profileFieldsToRow(form),
    };

    // src/integrations/supabase/types.ts predates the profile columns
    // (gender, device_pin, shift and the rest) and cannot express a
    // table chosen at runtime, so it rejects this payload. The cast is
    // narrow and deliberate; regenerating types.ts removes the need for
    // it. Compiles either way - tsconfig.app.json has strict: false -
    // but an unexplained cast is worse than an explained one.
    type Writer = {
      update: (v: Record<string, unknown>) => {
        eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
      };
      insert: (v: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    };
    const writer = supabase.from(table) as unknown as Writer;

    const { error } = editingId
      ? await writer.update(fields).eq("id", editingId)
      : await writer.insert({
          ...fields, society_id: societyId, qr_code: generateQr(form.category),
        });
    setSaving(false);

    if (error) {
      // The partial unique indexes added in the biometrics migration are
      // the two collisions an admin can realistically cause.
      const pinClash = error.message.includes("society_pin_uniq");
      const docClash = error.message.includes("society_id_doc_uniq");
      toast({
        title: pinClash ? "That fingerprint ID is taken"
          : docClash ? "That ID document is already registered"
          : editingId ? "Failed to save changes" : "Failed to add staff",
        description: pinClash
          ? "Another person in this society already has that fingerprint ID."
          : docClash
          ? "Another person in this society already has that ID number."
          : error.message,
        variant: "destructive",
      });
      return;
    }

    toast({ title: editingId ? `${form.name} updated` : `${form.name} added` });
    closeDialog();
    await fetchStaff();
  };

  const toggleActive = async (s: StaffMember) => {
    await supabase.from(CATEGORY_TABLE[s.category]).update({ is_active: !s.is_active }).eq("id", s.id);
    await fetchStaff();
  };

  const deleteStaff = async (s: StaffMember) => {
    const { error } = await supabase.from(CATEGORY_TABLE[s.category]).delete().eq("id", s.id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: `${s.name} removed` });
    await fetchStaff();
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">Society Staff</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowImport((v) => !v)} className="gap-1">
            <FileSpreadsheet className="h-4 w-4" /> Import
          </Button>
          <Button size="sm" onClick={openAdd} className="gap-1">
          <Plus className="h-4 w-4" /> Add Staff
        </Button>
        </div>
      </CardHeader>
      <CardContent>
        {showImport && (
          <div className="mb-4">
            <StaffBulkUpload kind="staff" defaultRoleType="Other" onComplete={() => { setShowImport(false); void fetchStaff(); }} />
          </div>
        )}
        {loading ? (
          <div className="py-8 flex justify-center"><div className="h-6 w-6 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>
        ) : staff.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No staff registered yet.</p>
        ) : (
          <div className="space-y-2">
            {applyFilter(staff, filter).map((s) => (
              <div key={s.id} className={`flex items-center justify-between p-3 rounded-lg border ${s.is_active ? "border-border bg-secondary/30" : "border-border/40 bg-secondary/10 opacity-60"}`}>
                <div className="flex items-center gap-3">
                  {s.photo_base64 ? (
                    <img src={s.photo_base64} alt={s.name} className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
                      {s.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-sm">{s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium mr-1.5 ${
                        s.category === "house_help"
                          ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                          : "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200"
                      }`}>{CATEGORY_LABEL[s.category]}</span>
                      {s.role}{s.phone ? ` • ${s.phone}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setFingerprintFor({ id: s.id, name: s.name })} aria-label="Fingerprints" title={s.fingerprint_enrolled ? "Fingerprint enrolled" : "Enrol fingerprint"}>
                    <Fingerprint className={`h-4 w-4 ${s.fingerprint_enrolled ? "text-success" : "text-muted-foreground"}`} />
                  </Button>
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => openEdit(s)} title="Edit profile">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setShowIdCard(s)} title="View ID Card">
                    <IdCard className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => void toggleActive(s)} title={s.is_active ? "Deactivate" : "Activate"}>
                    {s.is_active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                  </Button>
                  <Button size="icon" variant="outline" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => void deleteStaff(s)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={showAdd} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? "Edit Staff Profile" : "Add Society Staff"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Full name" /></div>
            <div className="space-y-1">
              <Label>Type *</Label>
              <Select
                value={form.category}
                disabled={!!editingId}
                onValueChange={(v) =>
                  // Changing category changes which roles are valid, so
                  // the role is cleared rather than left pointing at a
                  // value the new list does not contain.
                  setForm((p) => ({ ...p, category: v as StaffCategory, staff_type: "" }))
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="society_staff">{CATEGORY_LABEL.society_staff} (employed by the society)</SelectItem>
                  <SelectItem value="house_help">{CATEGORY_LABEL.house_help} (engaged by a resident)</SelectItem>
                </SelectContent>
              </Select>
              {editingId && (
                <p className="text-xs text-muted-foreground">
                  Type cannot be changed after creation - the record lives in a different table.
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Role *</Label>
              <Select value={form.staff_type} onValueChange={(v) => setForm((p) => ({ ...p, staff_type: v }))}>
                <SelectTrigger><SelectValue placeholder="Select role..." /></SelectTrigger>
                <SelectContent>{rolesFor(form.category).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Phone (optional)</Label><Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder="+91 98765 43210" inputMode="tel" /></div>
            <div className="space-y-1">
              <Label>Photo (optional)</Label>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
              <div className="flex items-center gap-3">
                {form.photo_base64 && <img src={form.photo_base64} alt="preview" className="h-14 w-14 rounded-full object-cover border border-border" />}
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  {form.photo_base64 ? "Change photo" : "Upload photo"}
                </Button>
                {form.photo_base64 && <Button type="button" variant="ghost" size="sm" onClick={() => setForm((p) => ({ ...p, photo_base64: "" }))}>Remove</Button>}
              </div>
            </div>
          </div>
          <StaffProfileFields values={form} onChange={(v) => setForm((p) => ({ ...p, ...v }))} />
            <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button onClick={() => void handleSave()} disabled={saving}>{saving ? "Saving..." : editingId ? "Save Changes" : "Add Staff"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showIdCard} onOpenChange={(o) => !o && setShowIdCard(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>ID Card — {showIdCard?.name}</DialogTitle></DialogHeader>
          {showIdCard && (
            <StaffIdCard qrCode={showIdCard.qr_code} name={showIdCard.name} role={showIdCard.staff_type}
              category="society_staff" photoBase64={showIdCard.photo_base64} societyName={societyName}
              fileBaseName={showIdCard.name.toLowerCase().replace(/\s+/g, "-")} />
          )}
        </DialogContent>
      </Dialog>
          {fingerprintFor && (
        <FingerprintEnroll
          open={!!fingerprintFor}
          onClose={() => setFingerprintFor(null)}
          subjectId={fingerprintFor.id}
          subjectCategory="society_staff"
          subjectName={fingerprintFor.name}
          onChanged={() => void fetchStaff()}
        />
      )}
</Card>
  );
};

export default SocietyStaffManager;
