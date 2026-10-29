import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { roleSatisfies, type AppRole } from "@core/permissions";
import type { Session, User } from "@supabase/supabase-js";

/**
 * Who is signed in, and which society they belong to.
 *
 * A port of the website's AuthContext, with the same shape so the
 * screens read the same way — but with two differences that matter on
 * a gate device.
 *
 * ONE ROLE. This app is for guards. The website's login had to cope
 * with a resident typing their password on the guard page; here, an
 * account that is not a guard is refused at sign-in and told why,
 * rather than being let in to an app with nothing in it.
 *
 * roleSatisfies comes from @core/permissions — the same table the
 * website and the RLS policies agree on. Re-deciding "is this person a
 * guard" locally is how the three copies drift apart.
 */

export interface AuthState {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  societyId: string | null;
  societyName: string | null;
  societySlug: string | null;
  /** True until the first session check AND its role lookup finish. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const useAuth = (): AuthState => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [societyId, setSocietyId] = useState<string | null>(null);
  const [societyName, setSocietyName] = useState<string | null>(null);
  const [societySlug, setSocietySlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Guards against a slow lookup for a signed-out user overwriting the
  // state of the one who signed in after them.
  const latestFor = useRef<string | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    const [{ data: roleRows }, { data: profile }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("profiles").select("society_id").eq("user_id", userId).maybeSingle(),
    ]);

    const nextRoles = (roleRows ?? []).map((r) => r.role as AppRole);
    const nextSocietyId = profile?.society_id ?? null;

    let name: string | null = null;
    let slug: string | null = null;
    if (nextSocietyId) {
      const { data: society } = await supabase
        .from("societies").select("name, slug").eq("id", nextSocietyId).maybeSingle();
      name = society?.name ?? null;
      slug = society?.slug ?? null;
    }

    return { nextRoles, nextSocietyId, name, slug };
  }, []);

  const applySession = useCallback((next: Session | null) => {
    setSession(next);
    setUser(next?.user ?? null);

    const userId = next?.user?.id ?? null;
    latestFor.current = userId;

    if (!userId) {
      setRoles([]);
      setSocietyId(null);
      setSocietyName(null);
      setSocietySlug(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    void loadProfile(userId).then(({ nextRoles, nextSocietyId, name, slug }) => {
      // Another sign-in overtook this one.
      if (latestFor.current !== userId) return;
      setRoles(nextRoles);
      setSocietyId(nextSocietyId);
      setSocietyName(name);
      setSocietySlug(slug);
      setLoading(false);
    });
  }, [loadProfile]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      applySession(next);
    });

    void supabase.auth.getSession().then(({ data: { session: current } }) => {
      applySession(current);
    });

    return () => subscription.unsubscribe();
  }, [applySession]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) return { error: error.message };

    const userId = data.session?.user?.id;
    if (!userId) return { error: "Sign in failed. Try again." };

    // The role is checked HERE rather than after letting them in, so a
    // resident or an admin who opens the guard app gets a sentence
    // explaining it instead of an empty dashboard. Checked against the
    // shared capability table, not a local guess.
    const { nextRoles } = await loadProfile(userId);
    if (!roleSatisfies(nextRoles, "guard")) {
      await supabase.auth.signOut();
      return { error: "This account is not registered as a security guard." };
    }

    applySession(data.session);
    return { error: null };
  }, [applySession, loadProfile]);

  const signOut = useCallback(async () => {
    latestFor.current = null;
    await supabase.auth.signOut();
    applySession(null);
  }, [applySession]);

  return (
    <AuthContext.Provider
      value={{ session, user, roles, societyId, societyName, societySlug, loading, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
};
