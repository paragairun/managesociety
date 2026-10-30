import { useRef, useState } from "react";
import { Upload, Users, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSocietyStructure } from "@/hooks/useSocietyStructure";
import { onboardMember } from "@/lib/memberOnboarding";


interface ParsedResident {
  display_name: string;
  email: string;
  wing: string;
  flat_number: string;
}

const REQUIRED_COLS = ["display_name", "email", "wing", "flat_number"];

const BulkResidentUpload = () => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedResident[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const { toast } = useToast();
  const { societyId } = useAuth();
  const { formatFlat } = useSocietyStructure(societyId);

  const parseCSV = (text: string): { parsed: ParsedResident[]; errs: string[] } => {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return { parsed: [], errs: ["File must have a header row and at least one data row"] };

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
    const missing = REQUIRED_COLS.filter((c) => !headers.includes(c));
    if (missing.length) return { parsed: [], errs: [`Missing columns: ${missing.join(", ")}`] };

    const parsed: ParsedResident[] = [];
    const errs: string[] = [];
    const seenEmails = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(",").map((v) => v.trim());
      if (vals.length < headers.length) {
        errs.push(`Row ${i + 1}: not enough columns`);
        continue;
      }
      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => (obj[h] = vals[idx] || ""));

      if (!obj.display_name || !obj.email || !obj.wing || !obj.flat_number) {
        errs.push(`Row ${i + 1}: missing required fields`);
        continue;
      }

      const emailLower = obj.email.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
        errs.push(`Row ${i + 1}: invalid email "${obj.email}"`);
        continue;
      }

      if (seenEmails.has(emailLower)) {
        errs.push(`Row ${i + 1}: duplicate email "${obj.email}"`);
        continue;
      }
      seenEmails.add(emailLower);

      const wing = obj.wing.toUpperCase();
      if (wing.length !== 1 || wing < "A" || wing > "H") {
        errs.push(`Row ${i + 1}: wing must be A–H`);
        continue;
      }

      parsed.push({
        display_name: obj.display_name.trim(),
        email: emailLower,
        wing,
        flat_number: obj.flat_number.trim(),
      });
    }

    return { parsed, errs };
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const { parsed, errs } = parseCSV(evt.target?.result as string);
      setRows(parsed);
      setErrors(errs);
      setProgress({ done: 0, total: 0 });
    };
    reader.readAsText(file);
  };

  const handleUpload = async () => {
    if (!rows.length) return;
    if (!societyId) { toast({ title: "Society not loaded", variant: "destructive" }); return; }
    setUploading(true);
    setProgress({ done: 0, total: rows.length });

    let successCount = 0;
    let failCount = 0;
    const passwords: string[] = [];

    for (const row of rows) {
      // Shared with the single Add Guard form — see
      // src/lib/memberOnboarding.ts. Writes the request and approves it
      // in one step, which is how a committee-created account is made.
      const result = await onboardMember({
        societyId,
        role: "resident",
        displayName: row.display_name,
        email: row.email,
        wing: row.wing,
        flatNumber: row.flat_number,
      });

      if (result.ok) {
        successCount++;
        if (result.tempPassword) passwords.push(`${row.email}: ${result.tempPassword}`);
      } else {
        failCount++;
      }

      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    setUploading(false);

    if (successCount > 0) {
      toast({
        title: `${successCount} resident(s) registered`,
        description: failCount > 0 ? `${failCount} failed` : undefined,
        duration: 10000,
      });
    }

    if (passwords.length > 0) {
      // Copy passwords to clipboard for admin reference
      const pwText = passwords.join("\n");
      try {
        await navigator.clipboard.writeText(pwText);
        toast({ title: "Temp passwords copied to clipboard", duration: 5000 });
      } catch {
        toast({
          title: "Temp passwords",
          description: passwords.slice(0, 3).join(" | ") + (passwords.length > 3 ? ` ...+${passwords.length - 3} more` : ""),
          duration: 30000,
        });
      }
    }

    if (failCount > 0 && successCount === 0) {
      toast({ title: "All registrations failed", variant: "destructive" });
    }

    setRows([]);
    setErrors([]);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="h-5 w-5 text-primary-ink" />
          Bulk Resident Registration (CSV)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Upload a CSV with columns:{" "}
          <code className="text-xs bg-secondary px-1 py-0.5 rounded">display_name, email, wing, flat_number</code>
        </p>

        <div className="flex items-center gap-3">
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
          <Button variant="outline" onClick={() => fileRef.current?.click()} className="touch-target gap-2">
            <Upload className="h-4 w-4" />
            Select CSV File
          </Button>
          {rows.length > 0 && <span className="text-sm text-muted-foreground">{rows.length} valid rows</span>}
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
                    <th className="text-left p-2">Name</th>
                    <th className="text-left p-2">Email</th>
                    <th className="text-left p-2">Location</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 10).map((r, i) => (
                    <tr key={i} className="border-t border-border/50">
                      <td className="p-2">{r.display_name}</td>
                      <td className="p-2 font-mono text-xs">{r.email}</td>
                      <td className="p-2">{formatFlat(r.wing, r.flat_number)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 10 && (
                <p className="text-xs text-muted-foreground text-center py-2">Showing 10 of {rows.length}</p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={() => void handleUpload()} disabled={uploading} className="touch-target gap-2">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                {uploading ? `Registering... (${progress.done}/${progress.total})` : `Register ${rows.length} Residents`}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default BulkResidentUpload;
