import { Link, useNavigate } from "react-router-dom";
import { Building2, Shield, ScanLine, Users, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/app-url";

const ROLES = [
  { key: "admin", label: "Society Admin", icon: Shield, description: "Manage residents, vehicles, staff and billing", tint: "bg-warning/15 text-warning-ink" },
  { key: "guard", label: "Security Guard", icon: ScanLine, description: "Scan QR codes for vehicles, guests and staff at the gate", tint: "bg-primary/15 text-primary-ink" },
  { key: "resident", label: "Resident", icon: Users, description: "Guest passes, dues, deliveries and amenities", tint: "bg-success/15 text-success-ink" },
];

/**
 * Step 1 of a 2-step login: pick a role, then (on the next screen) pick a
 * society. Kept separate from the society picker so each screen only shows
 * exactly one decision -- and so our native apps (which already know their
 * own role) can skip straight past this screen to step 2.
 */
const LoginPortal = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-primary/15 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary-ink" />
            </div>
            <span className="font-bold text-foreground text-lg">{APP_NAME}</span>
          </Link>
          <Button asChild variant="outline" size="sm">
            <Link to="/register-society">Register Society</Link>
          </Button>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <div className="h-14 w-14 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-3">
              <Building2 className="h-7 w-7 text-primary-ink" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Sign In</h1>
            <p className="text-sm text-muted-foreground mt-1">First, tell us who you are</p>
          </div>

          <div className="space-y-3">
            {ROLES.map(({ key, label, icon: Icon, description, tint }) => (
              <Card
                key={key}
                className="cursor-pointer hover:border-primary/50 hover:shadow-md transition-all"
                // Straight to the role's login. The society is read from
                // the user's own profile after they authenticate, so
                // there is nothing to pick — and nothing to publish.
                onClick={() => navigate(`/${key}`)}
              >
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={`h-12 w-12 rounded-xl flex items-center justify-center shrink-0 ${tint}`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground">{label}</p>
                    <p className="text-sm text-muted-foreground">{description}</p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-center pt-6">
            <p className="text-xs text-muted-foreground">
              New society?{" "}
              <Link to="/register-society" className="text-primary-ink hover:underline">
                Register here
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPortal;
