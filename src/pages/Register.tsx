import { useEffect, useState } from "react";
import { useSearchParams, useParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isSelfServiceRole, ROLE_LABEL, ROLE_BLURB } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { UserPlus, CheckCircle } from "lucide-react";
import FlatPicker from "@/components/FlatPicker";
import { resolveSociety, type PublicSociety } from "@/lib/societyLookup";

const ROLE_LABELS: Record<string, string> = {
  guard: "Security Guard",
  resident: "Resident",
  admin: "Committee Admin",
  manager: "Manager",
};

/**
 * ?role=admin opens a page where the applicant chooses between
 * Administrator and Manager, because the two are approved through the
 * same committee queue and differ only in what they may change.
 * Guards and residents keep their own single-purpose pages.
 */
const COMMITTEE_ROLES = ["admin", "manager"] as const;

const Register = () => {
  const [searchParams] = useSearchParams();
  const roleFromUrl = searchParams.get("role") || "";
  const entryRole = isSelfServiceRole(roleFromUrl) ? roleFromUrl : "";

  // On the committee page the applicant picks; everywhere else the URL
  // decides and the choice is not offered.
  const isCommitteePage = (COMMITTEE_ROLES as readonly string[]).includes(entryRole);
  const [chosenRole, setChosenRole] = useState<string>(entryRole);
  const validRole = isCommitteePage ? chosenRole : entryRole;

  // The society comes from the link the applicant followed, never
  // from a list. "looking" guards the first paint so the page does
  // not flash "no link" before the lookup returns.
  const { societySlug } = useParams<{ societySlug?: string }>();
  const [society, setSociety] = useState<PublicSociety | null>(null);
  const [looking, setLooking] = useState(true);
  const [form, setForm] = useState({
    email: "",
    display_name: "",
    flat_number: "",
    wing: "",
    society_id: "",
    password: "",
    confirm_password: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    void resolveSociety({ slug: societySlug }).then((found) => {
      if (cancelled) return;
      setSociety(found);
      setLooking(false);
      // Keep the submitted payload driven by the resolved society, so
      // the id can never disagree with the name on screen.
      setForm((p) => ({ ...p, society_id: found?.id ?? "" }));
    });
    return () => { cancelled = true; };
  }, [societySlug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.email || !form.display_name || !validRole || !form.society_id) {
      toast({ title: "Please fill all required fields, including society", variant: "destructive" });
      return;
    }

    const normalizedEmail = form.email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      toast({ title: "Please enter a valid email address", variant: "destructive" });
      return;
    }

    if (validRole === "resident" && (!form.wing || !form.flat_number.trim())) {
      toast({ title: "Wing and Flat Number are required for residents", variant: "destructive" });
      return;
    }

    if (form.password.length < 8) {
      toast({ title: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    if (form.password !== form.confirm_password) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    const { error } = await supabase.from("registration_requests").insert({
      email: normalizedEmail,
      display_name: form.display_name.trim(),
      requested_role: validRole,
      flat_number: form.flat_number.trim() || null,
      wing: form.wing || null,
      password: form.password,
      society_id: form.society_id,
    });
    setIsLoading(false);

    if (error) {
      const msg = error.message?.toLowerCase() ?? "";
      const isDuplicate = msg.includes("already registered") || msg.includes("pending registration");
      toast({
        title: isDuplicate ? "Already registered" : "Submission failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    setSubmitted(true);
  };

  const showFlatFields = validRole === "resident";

  if (!validRole) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-8 pb-6 space-y-4">
            <p className="text-xl font-bold text-foreground">Invalid Registration Link</p>
            <p className="text-muted-foreground text-sm">
              Please use the register link from your role's login page.
            </p>
            <Button variant="outline" asChild className="mt-4">
              <Link to="/login">Back to Login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-8 pb-6 space-y-4">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
            <h2 className="text-xl font-bold text-foreground">Request Submitted!</h2>
            <p className="text-muted-foreground text-sm">
              Your registration request has been sent to the committee admin for approval.
              You will receive access once approved.
            </p>
            <Button variant="outline" asChild className="mt-4">
              <Link to={`/${validRole}`}>Back to Login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No slug, or a slug that resolves to nothing. There is deliberately
  // no list to fall back to — offering one would put the whole customer
  // roster back on a public page. An unknown slug and a missing one get
  // the same wording, so this cannot be used to test whether a society
  // exists.
  if (!looking && !society) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <Card className="w-full max-w-sm">
          <CardContent className="pt-8 pb-6 space-y-4">
            <UserPlus className="h-12 w-12 text-muted-foreground mx-auto" />
            <h2 className="text-xl font-bold text-foreground">Registration Link Needed</h2>
            <p className="text-muted-foreground text-sm">
              Please use the registration link your society gave you. Your
              committee can share it from the admin panel.
            </p>
            <p className="text-xs text-muted-foreground">
              Setting up a brand new society?{" "}
              <Link to="/register-society" className="text-primary hover:underline">Register it here</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto h-16 w-16 rounded-2xl flex items-center justify-center bg-primary/20 text-primary">
            <UserPlus className="h-8 w-8" />
          </div>
          <CardTitle className="text-xl">Register as {ROLE_LABELS[validRole]}</CardTitle>
          <p className="text-muted-foreground text-sm">
            Submit a registration request to your society admin
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {isCommitteePage && (
              <div className="space-y-2">
                <Label>Role *</Label>
                <Select value={chosenRole} onValueChange={setChosenRole}>
                  <SelectTrigger className="touch-target"><SelectValue placeholder="Select a role" /></SelectTrigger>
                  <SelectContent>
                    {COMMITTEE_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{ROLE_BLURB[validRole]}</p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Society</Label>
              {looking ? (
                <div className="h-10 rounded-md border border-border animate-pulse bg-secondary/40" />
              ) : (
                <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
                  <p className="font-medium text-foreground">{society!.name}</p>
                  <p className="text-xs text-muted-foreground">{society!.city}, {society!.state}</p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Full Name *</Label>
              <Input
                placeholder="Enter your full name"
                value={form.display_name}
                onChange={(e) => setForm((p) => ({ ...p, display_name: e.target.value }))}
                className="touch-target"
              />
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input
                type="email"
                placeholder="Enter your email"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                className="touch-target"
              />
            </div>

            {showFlatFields && (
              <FlatPicker
                societyId={form.society_id || null}
                wing={form.wing}
                flatNumber={form.flat_number}
                onChange={(wing, flat_number) => setForm((p) => ({ ...p, wing, flat_number }))}
              />
            )}

            <div className="space-y-2">
              <Label>Password *</Label>
              <Input
                type="password"
                placeholder="Min 8 characters"
                value={form.password}
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                className="touch-target"
              />
            </div>
            <div className="space-y-2">
              <Label>Confirm Password *</Label>
              <Input
                type="password"
                placeholder="Re-enter password"
                value={form.confirm_password}
                onChange={(e) => setForm((p) => ({ ...p, confirm_password: e.target.value }))}
                className="touch-target"
              />
            </div>

            <Button type="submit" size="lg" className="w-full touch-target text-lg font-bold" disabled={isLoading}>
              {isLoading ? "Submitting..." : "Submit Request"}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Already have access?{" "}
              <Link to={`/login/society?role=${validRole}`} className="text-primary hover:underline">Sign in</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Register;
