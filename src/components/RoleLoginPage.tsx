import { useState, useEffect } from "react";
import { roleSatisfies, isCommitteeCreatedRole, type AppRole } from "@/lib/permissions";
import { Navigate, Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { appUrl } from "@/lib/app-url";
import { LucideIcon, Loader2 } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

interface RoleLoginPageProps {
  roleName: string;
  /**
   * The role this page is for. A manager signs in through the admin
   * page, because they use the admin dashboard — see roleSatisfies().
   */
  roleKey: "guard" | "resident" | "admin" | "visitor";
  icon: LucideIcon;
  accentClass: string;
  dashboardPath: string;
  description: string;
}

/**
 * Shown when someone successfully authenticates on a role-specific login
 * page (e.g. /guard) with an account that has a DIFFERENT role (e.g. a
 * resident's credentials). Rather than silently re-rendering a blank login
 * form with an unexplained active session, this signs them out immediately
 * and sends them right back to the SAME login page they started on (same
 * role, same society) so they can retry with the correct credentials --
 * not all the way back to the generic role picker.
 */
const WrongRolePage = ({ roleName, returnPath, signOut }: { roleName: string; returnPath: string; signOut: () => Promise<void> }) => {
  useEffect(() => {
    void signOut();
  }, [signOut]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 text-center">
      <div className="space-y-3 max-w-sm">
        <p className="text-2xl font-bold text-destructive">Wrong Account Type</p>
        <p className="text-muted-foreground text-sm">
          That account isn't registered as a {roleName.toLowerCase()}. You've been signed out --
          please try again with the correct credentials.
        </p>
        <Link to={returnPath} className="text-sm text-primary underline inline-block">
          Back to {roleName} Login
        </Link>
      </div>
    </div>
  );
};

const RoleLoginPage = ({ roleName, roleKey, icon: Icon, accentClass, dashboardPath, description }: RoleLoginPageProps) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [sendingReset, setSendingReset] = useState(false);
  const { signIn, signOut, user, roles, societySlug, loading } = useAuth();
  const { societySlug: urlSlug } = useParams<{ societySlug?: string }>();
  const { toast } = useToast();

  // A bare /admin, /guard or /resident is now the normal way in. The
  // society used to be chosen from a public dropdown before signing in,
  // which meant publishing every society on the platform to anyone who
  // opened the page. Nobody needs to choose: profiles.user_id is UNIQUE,
  // so a user belongs to exactly one society, and AuthContext reads it
  // from their own profile the moment they authenticate.
  //
  // The /:societySlug/role URLs keep working for bookmarks and for links
  // a committee has already circulated; when a slug IS present it is
  // checked against the user's own society below.
  const resolvedDashboardPath = societySlug ? `/${societySlug}/${roleKey}/dashboard` : dashboardPath;

  // Right after a successful sign-in, `user` becomes truthy before `roles`
  // has actually been fetched (roles starts as [] and loading stays true
  // until the fetch resolves). Without this check, every fresh login --
  // even with fully correct credentials -- would briefly look identical to
  // a wrong-role login (roles.includes(anything) is false on an empty
  // array) and get incorrectly signed back out by the check below.
  if (user && loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Super-admin should never be on a society login page — redirect to their dashboard
  if (user && roles.includes("super_admin")) {
    return <Navigate to="/super-admin" replace />;
  }

  // roleSatisfies, not roles.includes: a manager holds only 'manager'
  // and would otherwise be told they have the wrong role on the very
  // page they are supposed to use.
  if (user && roleSatisfies(roles as AppRole[], roleKey as AppRole)) {
    // Verify the user belongs to the society in the URL
    if (societySlug && urlSlug && societySlug !== urlSlug) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 text-center">
          <div className="space-y-3 max-w-sm">
            <p className="text-2xl font-bold text-destructive">Wrong Society</p>
            <p className="text-muted-foreground text-sm">
              This account does not belong to this society.
              Please use your society's correct login URL.
            </p>
            <button
              className="text-sm text-primary underline"
              onClick={() => void signOut()}
            >Sign out</button>
          </div>
        </div>
      );
    }

    // Signed in, right role, but their profile carries no society. The
    // old flow sent them to a slug-less dashboard, which now renders
    // empty anyway because every table is scoped by society_id. Say so
    // instead of showing them a blank screen they cannot explain.
    if (!societySlug) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 text-center">
          <div className="space-y-3 max-w-sm">
            <p className="text-2xl font-bold text-destructive">No Society Linked</p>
            <p className="text-muted-foreground text-sm">
              This account is not linked to any society yet. Ask your
              society admin to finish setting it up.
            </p>
            <button
              className="text-sm text-primary underline"
              onClick={() => void signOut()}
            >Sign out</button>
          </div>
        </div>
      );
    }
    return <Navigate to={resolvedDashboardPath} replace />;
  }

  // Authenticated, but with a role that doesn't match this specific login
  // page (e.g. a resident's credentials entered on the guard login page).
  if (user && !roleSatisfies(roles as AppRole[], roleKey as AppRole) && !roles.includes("super_admin")) {
    const returnPath = urlSlug ? `/${urlSlug}/${roleKey}` : `/${roleKey}`;
    return <WrongRolePage roleName={roleName} returnPath={returnPath} signOut={signOut} />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      toast({ title: "Enter email and password", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    const { error } = await signIn(email, password);
    setIsLoading(false);

    if (error) {
      toast({ title: "Login Failed", description: error, variant: "destructive" });
      return;
    }

    // societySlug will be populated by AuthContext after signIn resolves.
    // The post-login redirect check below (roles.includes(roleKey)) handles mismatched society —
    // if their slug doesn't match urlSlug, we show an error on the next render cycle via the check below.
  };

  const handleForgotPassword = async () => {
    if (!forgotEmail) {
      toast({ title: "Enter your email address", variant: "destructive" });
      return;
    }
    setSendingReset(true);
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: appUrl("/reset-password"),
    });
    setSendingReset(false);

    if (error) {
      toast({ title: "Failed to send reset email", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Reset link sent", description: "Check your email for the password reset link." });
      setShowForgot(false);
      setForgotEmail("");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <div className="absolute top-3 right-3">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center space-y-3">
          <div className={`mx-auto h-16 w-16 rounded-2xl flex items-center justify-center ${accentClass}`}>
            <Icon className="h-8 w-8" />
          </div>
          <CardTitle className="text-xl">{roleName}</CardTitle>
          <p className="text-muted-foreground text-sm">{description}</p>
        </CardHeader>
        <CardContent>
          {showForgot ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Enter your email and we'll send you a link to reset your password.</p>
              <div className="space-y-2">
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  placeholder="Enter your email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  className="touch-target"
                  autoComplete="email"
                />
              </div>
              <Button
                onClick={() => void handleForgotPassword()}
                size="lg"
                className="w-full touch-target"
                disabled={sendingReset}
              >
                {sendingReset ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending...</> : "Send Reset Link"}
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setShowForgot(false)}>
                Back to Login
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="touch-target"
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <button
                    type="button"
                    onClick={() => { setShowForgot(true); setForgotEmail(email); }}
                    className="text-xs text-primary hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="touch-target"
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" size="lg" className="w-full touch-target text-lg font-bold" disabled={isLoading}>
                {isLoading ? "Signing in..." : "Sign In"}
              </Button>
              {/* Guards and residents are created by their committee, so
                  there is nothing to link them to. Pointing them at a
                  form that now refuses their role would just waste their
                  time; tell them who to ask instead. */}
              {isCommitteeCreatedRole(roleKey) ? (
                <p className="text-center text-sm text-muted-foreground">
                  Don't have access? Your society committee creates
                  {roleKey === "guard" ? " guard " : " resident "}
                  accounts — please ask them to add you.
                </p>
              ) : (
                <p className="text-center text-sm text-muted-foreground">
                  Don't have access?{" "}
                  {/* Carry the society through when the visitor arrived on a
                      society URL. From a bare /admin there is no society to
                      carry, and the registration page will say so rather than
                      offering a list of every society on the platform. */}
                  <Link
                    to={urlSlug ? `/${urlSlug}/register?role=${roleKey}` : `/register?role=${roleKey}`}
                    className="text-primary hover:underline"
                  >Register here</Link>
                </p>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default RoleLoginPage;
