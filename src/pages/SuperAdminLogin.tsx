import { useState } from "react";
import { Navigate } from "react-router-dom";
import { ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { appUrl } from "@/lib/app-url";
import { ThemeToggle } from "@/components/ThemeToggle";

const SuperAdminLogin = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [sendingReset, setSendingReset] = useState(false);
  const { signIn, user, roles, loading } = useAuth();
  const { toast } = useToast();

  if (!loading && user && roles.includes("super_admin")) {
    return <Navigate to="/super-admin" replace />;
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
    }
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
          <div className="mx-auto h-16 w-16 rounded-2xl flex items-center justify-center bg-primary/15 text-primary-ink">
            <ShieldCheck className="h-8 w-8" />
          </div>
          <CardTitle className="text-xl">Platform Super Admin</CardTitle>
          <p className="text-muted-foreground text-sm">Manage societies and approve registrations</p>
        </CardHeader>
        <CardContent>
          {showForgot ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Enter your email and we'll send you a link to reset your password.</p>
              <div className="space-y-2">
                <Label htmlFor="forgot-email">Email</Label>
                <Input id="forgot-email" type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} className="touch-target" autoComplete="email" />
              </div>
              <Button onClick={() => void handleForgotPassword()} size="lg" className="w-full touch-target" disabled={sendingReset}>
                {sendingReset ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending...</> : "Send Reset Link"}
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setShowForgot(false)}>Back to Login</Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="Enter your email" value={email} onChange={(e) => setEmail(e.target.value)} className="touch-target" autoComplete="email" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <button type="button" onClick={() => { setShowForgot(true); setForgotEmail(email); }} className="text-xs text-primary-ink hover:underline">
                    Forgot password?
                  </button>
                </div>
                <Input id="password" type="password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} className="touch-target" autoComplete="current-password" />
              </div>
              <Button type="submit" size="lg" className="w-full touch-target text-lg font-bold" disabled={isLoading}>
                {isLoading ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SuperAdminLogin;
