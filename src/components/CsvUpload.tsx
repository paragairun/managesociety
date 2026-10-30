import { useRef, useState } from "react";
import { Upload, FileSpreadsheet, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { createOpaqueVehicleQrCode } from "@/lib/qr-code";
import { useSocietyStructure } from "@/hooks/useSocietyStructure";

interface ParsedRow {
  owner_name: string;
  vehicle_number: string;
  wing: string;
  flat_number: string;
  vehicle_type: string;
}

const REQUIRED_COLS = ["owner_name", "vehicle_number", "wing", "flat_number"];

const CsvUpload = ({ onComplete }: { onComplete: () => void }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();
  const { societyId } = useAuth();
  const { formatFlat } = useSocietyStructure(societyId);

  const parseCSV = (text: string): { parsed: ParsedRow[]; errs: string[] } => {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return { parsed: [], errs: ["File must have a header row and at least one data row"] };

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
    const missing = REQUIRED_COLS.filter((c) => !headers.includes(c));
    if (missing.length) return { parsed: [], errs: [`Missing columns: ${missing.join(", ")}`] };

    const parsed: ParsedRow[] = [];
    const errs: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(",").map((v) => v.trim());
      if (vals.length < headers.length) {
        errs.push(`Row ${i + 1}: not enough columns`);
        continue;
      }
      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => (obj[h] = vals[idx] || ""));

      if (!obj.owner_name || !obj.vehicle_number || !obj.wing || !obj.flat_number) {
        errs.push(`Row ${i + 1}: missing required fields`);
        continue;
      }

      parsed.push({
        owner_name: obj.owner_name,
        vehicle_number: obj.vehicle_number.toUpperCase(),
        wing: obj.wing.toUpperCase(),
        flat_number: obj.flat_number,
        vehicle_type: obj.vehicle_type || "car",
      });
    }

    return { parsed, errs };
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      const { parsed, errs } = parseCSV(text);
      setRows(parsed);
      setErrors(errs);
    };
    reader.readAsText(file);
  };

  const handleUpload = async () => {
    if (!rows.length) return;
    if (!societyId) { toast({ title: "Society not loaded", variant: "destructive" }); return; }
    setUploading(true);

    const normalize = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");

    // Detect duplicates within the CSV itself
    const seen = new Map<string, number>();
    const inFileDups: string[] = [];
    rows.forEach((r) => {
      const k = normalize(r.vehicle_number);
      seen.set(k, (seen.get(k) ?? 0) + 1);
    });
    seen.forEach((count, k) => {
      if (count > 1) inFileDups.push(k);
    });

    // Detect duplicates against the database (already society-scoped via RLS)
    const { data: existing } = await supabase.from("vehicles").select("vehicle_number");
    const existingSet = new Set((existing ?? []).map((v) => normalize(v.vehicle_number)));
    const dbDups = rows.filter((r) => existingSet.has(normalize(r.vehicle_number))).map((r) => r.vehicle_number);

    if (inFileDups.length || dbDups.length) {
      setUploading(false);
      const msgs: string[] = [];
      if (inFileDups.length) msgs.push(`Duplicate within file: ${inFileDups.join(", ")}`);
      if (dbDups.length) msgs.push(`Already registered: ${dbDups.join(", ")}`);
      toast({ title: "Duplicate vehicles detected", description: msgs.join(" | "), variant: "destructive" });
      setErrors(msgs);
      return;
    }

    const vehiclesWithQr = rows.map((r) => ({
      ...r,
      qr_code: createOpaqueVehicleQrCode(),
      society_id: societyId,
    }));

    const { error } = await supabase.from("vehicles").insert(vehiclesWithQr);
    setUploading(false);

    if (error) {
      const isDup = (error as { code?: string }).code === "23505" || /duplicate|unique/i.test(error.message);
      toast({
        title: isDup ? "Duplicate vehicle in upload" : "Upload failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    toast({ title: "Success", description: `${vehiclesWithQr.length} vehicles uploaded` });
    setRows([]);
    setErrors([]);
    if (fileRef.current) fileRef.current.value = "";
    onComplete();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileSpreadsheet className="h-5 w-5 text-primary-ink" />
          Bulk Upload (CSV)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Upload a CSV with columns: <code className="text-xs bg-secondary px-1 py-0.5 rounded">owner_name, vehicle_number, wing, flat_number, vehicle_type</code>
        </p>

        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleFile}
            className="hidden"
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()} className="touch-target gap-2">
            <Upload className="h-4 w-4" />
            Select CSV File
          </Button>
          {rows.length > 0 && (
            <span className="text-sm text-muted-foreground">{rows.length} valid rows</span>
          )}
        </div>

        {errors.length > 0 && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 space-y-1">
            <div className="flex items-center gap-2 text-destructive-ink text-sm font-medium">
              <AlertCircle className="h-4 w-4" />
              {errors.length} issue(s)
            </div>
            {errors.slice(0, 5).map((err, i) => (
              <p key={i} className="text-xs text-destructive-ink/80">{err}</p>
            ))}
            {errors.length > 5 && <p className="text-xs text-destructive-ink/60">...and {errors.length - 5} more</p>}
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div className="max-h-40 overflow-auto rounded border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50 sticky top-0">
                  <tr>
                    <th className="text-left p-2">Owner</th>
                    <th className="text-left p-2">Vehicle</th>
                    <th className="text-left p-2">Location</th>
                    <th className="text-left p-2">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 10).map((r, i) => (
                    <tr key={i} className="border-t border-border/50">
                      <td className="p-2">{r.owner_name}</td>
                      <td className="p-2 font-mono">{r.vehicle_number}</td>
                      <td className="p-2">{formatFlat(r.wing, r.flat_number)}</td>
                      <td className="p-2">{r.vehicle_type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 10 && <p className="text-xs text-muted-foreground text-center py-2">Showing 10 of {rows.length}</p>}
            </div>

            <Button onClick={handleUpload} disabled={uploading} className="touch-target gap-2">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? "Uploading..." : `Upload ${rows.length} Vehicles`}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default CsvUpload;
