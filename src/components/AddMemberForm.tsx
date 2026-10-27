import { useMemo, useState } from "react";
import { UserPlus, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { onboardMember, type MemberRole } from "@/lib/memberOnboarding";
import { rolesCreatableBy, ROLE_LABEL, type AppRole } from "@/lib/permissions";

/**
 * Creating an account for somebody, from inside the admin panel.
 *
 * Nobody registers themselves any more, so this is the only way any
 * account below super-admin comes into existence. It is one component
 * rather than one per registry: the Users tab offers every role the
 * signed-in person may create, the Guard registry pins it to guards,
 * and both go through onboardMember so validation and error handling
 * cannot drift apart.
 *
 * The role list is NOT a security boundary — it mirrors
 * rolesCreatableBy(), which mirrors the RLS policy in
 * supabase/schema/registration_public_close.sql. The database refuses
 * what this form declines to offer; showing a manager an "Admin"
 * option they cannot use would just produce a confusing failure.
 */
interface AddMemberFormProps {
  /** Restrict the offer further, e.g. ["guard"] inside the guard registry. */
  only?: MemberRole[];
  /** Heading above the form. */
  title?: string;
  /** Called after a successful create, so the surrounding list can refresh. */
  onCreated?: () => void;
}

const AddMemberForm = ({ only, title = "Add a user", onCreated }: AddMemberFormProps) => {
  const { societyId, roles } = useAuth();
  const { toast } = useToast();

  const available = useMemo(() => {
    const allowed = rolesCreatableBy(roles as AppRole[]) as string[];
    const list = (only ? allowed.filter((r) => (only as string[]).includes(r)) : allowed) as MemberRole[];
    return list;
  }, [roles, only]);

  const [role, setRole] = useState<MemberRole | "">(available.length === 1 ? available[0] : "");
  const [form, setForm] = useState({ display_name: "", email: "", wing: "", flat_number: "" });
  const [busy, setBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);

  // Someone with no creation rights at all — a guard looking at a
  // shared screen, say — should not see a form they cannot submit.
  if (available.length === 0) return null;

  const isResident = role === "resident";
  const ready =
    !!role && !!societyId &&
    form.display_name.trim().length > 0 &&
    form.email.trim().length > 0 &&
    (!isResident || form.flat_number.trim().length > 0);

  const submit = async () => {
    if (!role || !societyId) return;
    setBusy(true);
    setTempPassword(null);

    const result = await onboardMember({
      societyId,
      role,
      displayName: form.display_name,
      email: form.email,
      wing: isResident ? form.wing : null,
      flatNumber: isResident ? form.flat_number : null,
    });
    setBusy(false);

    if (!result.ok) {
      toast({ title: "Could not create the account", description: result.error, variant: "destructive" });
      return;
    }

    toast({ title: `${ROLE_LABEL[role] ?? role} account created for ${form.email.trim()}` });
    // Held on screen rather than put in a toast: the approval function
    // returns this once and never again, so a message that fades would
    // lose the only copy.
    if (result.tempPassword) {
      setTempPassword({ email: form.email.trim(), password: result.tempPassword });
    }
    setForm({ display_name: "", email: "", wing: "", flat_number: "" });
    if (available.length > 1) setRole("");
    onCreated?.();
  };

  return (
    <div className="mb-4 p-3 rounded-lg border border-border bg-secondary/20 space-y-3">
      <p className="text-sm font-medium flex items-center gap-2">
        <UserPlus className="h-4 w-4" /> {title}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {available.length > 1 && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as MemberRole)}>
              <SelectTrigger className="touch-target"><SelectValue placeholder="Choose a role" /></SelectTrigger>
              <SelectContent>
                {available.map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABEL[r] ?? r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="member-name" className="text-xs">Full name</Label>
          <Input
            id="member-name"
            placeholder="e.g. Ramesh Patil"
            value={form.display_name}
            onChange={(e) => setForm((p) => ({ ...p, display_name: e.target.value }))}
            className="touch-target"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="member-email" className="text-xs">Email</Label>
          <Input
            id="member-email"
            type="email"
            placeholder="name@example.com"
            value={form.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            className="touch-target"
          />
        </div>

        {isResident && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="member-wing" className="text-xs">Wing</Label>
              <Input
                id="member-wing"
                placeholder="Optional"
                value={form.wing}
                onChange={(e) => setForm((p) => ({ ...p, wing: e.target.value }))}
                className="touch-target"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-flat" className="text-xs">Flat number</Label>
              <Input
                id="member-flat"
                placeholder="e.g. 402"
                value={form.flat_number}
                onChange={(e) => setForm((p) => ({ ...p, flat_number: e.target.value }))}
                className="touch-target"
              />
            </div>
          </>
        )}
      </div>

      <Button
        onClick={() => void submit()}
        disabled={busy || !ready}
        className="w-full sm:w-auto touch-target"
      >
        {busy
          ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Creating…</>
          : "Create account"}
      </Button>

      {tempPassword && (
        <div className="rounded-md border border-success/40 bg-success/10 p-3">
          <p className="text-xs text-muted-foreground">
            Temporary password for {tempPassword.email} — shown once. Pass it
            on and ask them to change it after signing in.
          </p>
          <p className="font-mono text-sm mt-1 break-all">{tempPassword.password}</p>
        </div>
      )}
    </div>
  );
};

export default AddMemberForm;
