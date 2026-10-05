import { Fingerprint, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useFingerprint } from "@/hooks/useFingerprint";

/**
 * Live state of the always-on fingerprint reader.
 *
 * There is no button here on purpose. The scanner arms itself whenever
 * it is plugged in and stays armed for the whole shift, so the guard only
 * needs to know that it is working and who it just read. Staff queue up
 * and touch the sensor; nobody taps the screen between people.
 */
const FingerprintStatus = () => {
  const { status, statusDetail, enrolledCount, lastScan } = useFingerprint();

  if (status === "stopped") return null;

  const tone =
    status === "armed" || status === "reading" ? "text-success"
      : status === "error" ? "text-destructive"
      : "text-muted-foreground";

  const icon =
    status === "reading" ? <Loader2 className="h-4 w-4 animate-spin" />
      : status === "error" ? <AlertCircle className="h-4 w-4" />
      : status === "searching" ? <Loader2 className="h-4 w-4 animate-spin" />
      : <Fingerprint className="h-4 w-4" />;

  const label =
    status === "armed" ? "Fingerprint scanner ready"
      : status === "reading" ? "Reading finger…"
      : status === "searching" ? "Looking for scanner…"
      : "Scanner problem";

  return (
    <div className="w-full max-w-xs rounded-lg border border-border bg-secondary/30 px-3 py-2 space-y-1">
      <div className={`flex items-center justify-center gap-2 text-sm font-medium ${tone}`}>
        {icon} {label}
      </div>

      {status === "armed" && (
        <p className="text-xs text-muted-foreground text-center">
          {enrolledCount > 0
            ? `${enrolledCount} finger${enrolledCount === 1 ? "" : "s"} enrolled · staff can scan now`
            : "No fingerprints enrolled yet"}
        </p>
      )}

      {statusDetail && status !== "armed" && (
        <p className="text-xs text-muted-foreground text-center">{statusDetail}</p>
      )}

      {lastScan && (
        <div className="flex items-center justify-center gap-1.5 text-xs text-foreground pt-1 border-t border-border/60">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          <span className="font-medium">{lastScan.name}</span>
          <span className="text-muted-foreground">
            {lastScan.action === "entry" ? "entered" : "exited"} · {lastScan.role}
          </span>
        </div>
      )}
    </div>
  );
};

export default FingerprintStatus;
