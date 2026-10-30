import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: 'pending' | 'approved' | 'rejected' | 'inside' | 'exited';
}

const statusStyles: Record<string, string> = {
  pending: "bg-warning/20 text-warning-ink border-warning/30",
  approved: "bg-success/20 text-success-ink border-success/30",
  rejected: "bg-destructive/20 text-destructive-ink border-destructive/30",
  inside: "bg-primary/20 text-primary-ink border-primary/30",
  exited: "bg-muted text-muted-foreground border-border",
};

const StatusBadge = ({ status }: StatusBadgeProps) => (
  <span className={cn("px-3 py-1 rounded-full text-xs font-bold uppercase border", statusStyles[status])}>
    {status}
  </span>
);

export default StatusBadge;
