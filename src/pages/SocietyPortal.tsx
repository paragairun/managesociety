import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Building2, ArrowRight, Shield, ScanLine, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { APP_NAME, APP_DOMAIN } from "@/lib/app-url";

interface Society {
  id: string;
  name: string;
  slug: string;
  city: string;
  state: string;
}

const ROLE_META: Record<string, { label: string; icon: typeof Shield; tint: string }> = {
  admin: { label: "Society Admin", icon: Shield, tint: "bg-warning/15 text-warning" },
  guard: { label: "Security Guard", icon: ScanLine, tint: "bg-primary/15 text-primary" },
  resident: { label: "Resident", icon: Users, tint: "bg-success/15 text-success" },
};

/**
 * Step 2 of the 2-step login: role is already known (either chosen on the
 * previous screen, or passed in directly by our native apps, which each
 * link straight here since they already know their own role) -- this screen
 * shows nothing but the society picker, on purpose.
 */
const SocietyPortal = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const role = searchParams.get("role");
  const roleMeta = role ? ROLE_META[role] : undefined;

  const [societies, setSocieties] = useState<Society[]>([]);
  const [selectedSociety, setSelectedSociety] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // No valid role -- this screen doesn't make sense on its own, send back to step 1.
    if (!roleMeta) {
      navigate("/login", { replace: true });
      return;
    }
    void supabase
      .from("societies")
      .select("id, name, slug, city, state")
      .eq("status", "active")
      .order("name")
      .then(({ data }) => {
        setSocieties((data ?? []) as Society[]);
        setLoading(false);
      });
  }, [roleMeta, navigate]);

  if (!roleMeta) return null;

  const society = societies.find((s) => s.id === selectedSociety);
  const RoleIcon = roleMeta.icon;

  const handleContinue = () => {
    if (!society || !role) return;
    navigate(`/${society.slug}/${role}`);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-primary/15 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <span className="font-bold text-foreground text-lg">{APP_NAME}</span>
          </Link>
          <Button asChild variant="outline" size="sm">
            <Link to="/register-society">Register Society</Link>
          </Button>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center pb-2">
            <div className={`h-14 w-14 rounded-2xl flex items-center justify-center mx-auto mb-3 ${roleMeta.tint}`}>
              <RoleIcon className="h-7 w-7" />
            </div>
            <CardTitle className="text-2xl">Signing in as {roleMeta.label}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Now, select your society</p>
          </CardHeader>

          <CardContent className="space-y-5 pt-4">
            <div className="space-y-2">
              <Label>Your Society</Label>
              {loading ? (
                <div className="h-10 rounded-md border border-border animate-pulse bg-secondary/40" />
              ) : societies.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active societies found.</p>
              ) : (
                <Select value={selectedSociety} onValueChange={setSelectedSociety}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select your society..." />
                  </SelectTrigger>
                  <SelectContent>
                    {societies.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="font-medium">{s.name}</span>
                        <span className="text-muted-foreground ml-2 text-xs">{s.city}, {s.state}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <Button className="w-full gap-2" onClick={handleContinue} disabled={!selectedSociety}>
              Continue to Login <ArrowRight className="h-4 w-4" />
            </Button>

            {society && (
              <p className="text-xs text-center text-muted-foreground">
                You'll be taken to{" "}
                <span className="font-mono text-foreground">{APP_DOMAIN}/{society.slug}/{role}</span>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SocietyPortal;
