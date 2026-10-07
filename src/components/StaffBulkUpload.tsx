import { useRef, useState } from "react";
import { Upload, FileSpreadsheet, Loader2, AlertCircle, Download, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { parseStaffSheet, buildTemplateCsv, type ImportRow, type RowError } from "@/lib/staffImport";

/**
 * Bulk import of staff / house helps from a spreadsheet.
 *
 * Accepts CSV and TSV (Excel: "Save As → CSV UTF-8"). Rows are validated
 * before anything is written, good rows are kept when bad rows fail, and
 * each error names the spreadsheet line so it can be fixed in place.
 * Every imported person gets a QR code generated exactly as the single-add
 * form does, so existing gate scanning keeps working unchanged.
 */

interface Props {
  kind: "staff" | "house_help";
  /** Role used for rows that leave the type column blank. */
  defaultRoleType: string;
  onComplete: () => void;
}

const StaffBulkUpload = ({ kind, defaultRoleType, onComplete }: Props) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [errors, setErrors] = useState<RowError[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();
  const { societyId } = useAuth();

  const table = kind === "staff" ? "staff_members" : "house_helps";
  const roleColumn = kind === "staff" ? "staff_type" : "help_type";
  const qrPrefix = kind === "staff" ? "STF" : "HLP";

  const generateQr = () =>
    `${qrPrefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;

  const reset = () => { setRows([]); setErrors([]); setIgnored([]); setFileName(null); };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = (evt.target?.result as string) ?? "";
      const out = parseStaffSheet(text, { defaultRoleType });
      setRows(out.rows);
      setErrors(out.errors);
      setIgnored(out.ignoredColumns);
      if (out.rows.length === 0 && out.errors.length > 0) {
        toast({ title: "Nothing to import", description: out.errors[0].message, variant: "destructive" });
      }
    };
    reader.onerror = () => toast({ title: "Could not read that file", variant: "destructive" });
    reader.readAsText(file);
  };

  const downloadTemplate = () => {
    const blob = new Blob([buildTemplateCsv(kind)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${kind === "staff" ? "staff" : "house-help"}-import-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUpload = async () => {
    if (!societyId || rows.length === 0) return;
    setUploading(true);

    const payload = rows.map((r) => ({
      society_id: societyId,
      name: r.name,
      [roleColumn]: r.role_type,
      phone: r.phone,
      gender: r.gender,
      date_of_birth: r.date_of_birth,
      address: r.address,
      id_type: r.id_type,
      id_number: r.id_number,
      emergency_contact: r.emergency_contact,
      emergency_phone: r.emergency_phone,
      device_pin: r.device_pin,
      qr_code: generateQr(),
    }));

    const { error } = await supabase.from(table).insert(payload);
    setUploading(false);

    if (error) {
      // A duplicate ID document trips the partial unique index added in
      // staff_profiles_biometrics.sql — say so in plain language.
      const duplicate = error.message.includes("society_id_doc_uniq");
      const pinClash = error.message.includes("society_pin_uniq");
      toast({
        title: pinClash ? "Duplicate fingerprint ID"
          : duplicate ? "Duplicate ID document" : "Import failed",
        description: pinClash
          ? "One of these device_pin values is already assigned to someone else in this society. No rows were imported."
          : duplicate
          ? "One of these ID numbers is already registered in this society. No rows were imported."
          : error.message,
        variant: "destructive",
      });
      return;
    }

    toast({ title: `${payload.length} ${payload.length === 1 ? "person" : "people"} imported` });
    reset();
    if (fileRef.current) fileRef.current.value = "";
    onComplete();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          Bulk import {kind === "staff" ? "staff" : "house helps"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Upload a CSV or TSV. In Excel choose <strong>Save As → CSV UTF-8</strong>.
          Only <code>name</code> is required; everything else is optional.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-1.5">
            <Download className="h-4 w-4" /> Download template
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="gap-1.5">
            <Upload className="h-4 w-4" /> Choose file
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
            onChange={handleFile}
            className="hidden"
          />
        </div>

        {fileName && (
          <p className="text-xs text-muted-foreground">Selected: {fileName}</p>
        )}

        {ignored.length > 0 && (
          <div className="text-xs text-warning flex items-start gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Ignored unrecognised columns: {ignored.join(", ")}</span>
          </div>
        )}

        {errors.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm font-medium text-destructive mb-1.5">
              {errors.length} row{errors.length === 1 ? "" : "s"} skipped
            </p>
            <ul className="text-xs text-muted-foreground space-y-0.5 max-h-40 overflow-y-auto">
              {errors.slice(0, 25).map((e, i) => (
                <li key={i}>Line {e.line}: {e.message}</li>
              ))}
              {errors.length > 25 && <li>…and {errors.length - 25} more</li>}
            </ul>
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div className="rounded-md border border-border overflow-hidden">
              <div className="px-3 py-2 bg-secondary/50 text-sm font-medium flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-success" />
                {rows.length} ready to import
              </div>
              <div className="max-h-56 overflow-y-auto divide-y divide-border">
                {rows.slice(0, 50).map((r, i) => (
                  <div key={i} className="px-3 py-2 text-xs flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{r.name}</span>
                    <span className="text-muted-foreground truncate">
                      {r.role_type}{r.phone ? ` · ${r.phone}` : ""}{r.id_type ? ` · ${r.id_type}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <Button onClick={() => void handleUpload()} disabled={uploading} className="w-full touch-target gap-2">
              {uploading
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</>
                : <>Import {rows.length} {rows.length === 1 ? "person" : "people"}</>}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default StaffBulkUpload;
