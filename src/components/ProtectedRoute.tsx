import { ReactNode } from "react";
import { Navigate, useParams, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { decideRouteAccess, type AppRole } from "@/lib/routeAccess";

interface ProtectedRouteProps {
  children: ReactNode;
  requiredRole: AppRole;
  /** e.g. "resident" — paths are built as "/:societySlug/resident". */
  loginPathBase: string;
}

/**
 * Gate for every dashboard route.
 *
 * All decisions live in decideRouteAccess (src/lib/routeAccess.ts) so
 * they can be tested directly; this component only renders the outcome.
 *
 * Beyond the original role check this now also verifies that the user
 * belongs to the society named in the URL. Roles in this schema are not
 * society-scoped — user_roles is keyed on user_id alone — so holding
 * "admin" anywhere previously opened every society's admin dashboard.
 *
 * This is a client-side guard and stops honest mistakes and URL edits,
 * not a determined attacker with devtools. RLS in Postgres is the real
 * boundary.
 */
const ProtectedRoute = ({ children, requiredRole, loginPathBase }: ProtectedRouteProps) => {
  const { user, roles, loading, societySlug } = useAuth();
  const { societySlug: urlSlug } = useParams();

  const decision = decideRouteAccess({
    loading,
    hasUser: !!user,
    roles: roles as AppRole[],
    requiredRole,
    urlSlug: urlSlug ?? null,
    userSlug: societySlug ?? null,
    pathBase: loginPathBase,
  });

  if (decision.action === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (decision.action === "redirect") {
    return <Navigate to={decision.to} replace />;
  }

  if (decision.action === "deny") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 text-center">
        <div className="space-y-4 max-w-sm">
          <p className="text-2xl font-bold text-destructive">Access Denied</p>
          <p className="text-muted-foreground">{decision.message}</p>
          <Link to="/login" className="text-sm text-primary underline inline-block">
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;
