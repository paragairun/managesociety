import { ScanLine, UserPlus, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { gateActions, visitorFormUrl } from "@/lib/visitorForm";

interface Props {
  gateEntryMode: "qr_sticker" | "rfid";
  onScan: () => void;
}

/**
 * Somebody is at the gate with no delivery.
 *
 * Two routes in, both one tap away:
 *
 *   PRE-APPROVED — a resident made them a guest pass and they have the
 *   QR. Scan it.
 *
 *   IMPROMPTU — they have simply turned up, so their details go on the
 *   society's visitor form and the flat is asked from there.
 *
 * Which options exist comes from @/lib/visitorForm, shared with the
 * native guard app so the two cannot offer different things.
 */
const GuardVisitorOptions = ({ gateEntryMode, onScan }: Props) => {
  const { societySlug, societyName } = useAuth();

  const formUrl = visitorFormUrl(societySlug);
  const actions = gateActions({ gateEntryMode, formUrl });

  if (actions.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-1">
          <p className="font-semibold text-foreground">Nothing to do here yet</p>
          <p className="text-sm text-muted-foreground">
            {societyName ?? "This society"} has no visitor form set up, and entry is by RFID
            rather than QR. Ask your committee to finish the society's setup.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold text-foreground">Who is at the gate?</h2>

      {actions.map((action) => {
        const isScan = action.id === "scan";
        const body = (
          <span className="flex items-start gap-3 text-left">
            {isScan
              ? <ScanLine className="h-6 w-6 shrink-0 mt-0.5" />
              : <UserPlus className="h-6 w-6 shrink-0 mt-0.5 text-primary-ink" />}
            <span>
              <span className="block text-lg font-bold">{action.title}</span>
              <span className={`block text-sm ${isScan ? "opacity-90" : "text-muted-foreground"}`}>
                {action.subtitle}
              </span>
            </span>
            {!isScan && <ExternalLink className="h-4 w-4 ml-auto shrink-0 text-muted-foreground" />}
          </span>
        );

        // The visitor form is a real link rather than a scripted
        // navigation: a guard may well want to open it in another tab,
        // or long-press to copy it and send it to the visitor who is
        // still walking up.
        return isScan ? (
          <button
            key={action.id}
            type="button"
            onClick={onScan}
            className="w-full rounded-xl border-2 border-primary bg-primary p-5
                       text-primary-foreground transition hover:bg-primary/90"
          >
            {body}
          </button>
        ) : (
          <a
            key={action.id}
            href={formUrl ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full rounded-xl border border-border bg-card p-5
                       transition hover:bg-secondary/40"
          >
            {body}
          </a>
        );
      })}

      {formUrl && (
        <p className="text-xs text-muted-foreground">
          A visitor can also fill this in themselves — send them the link while they are
          walking up.
        </p>
      )}
    </div>
  );
};

export default GuardVisitorOptions;
