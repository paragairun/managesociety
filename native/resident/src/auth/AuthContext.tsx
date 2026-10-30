import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { roleSatisfies, type AppRole } from "@core/permissions";
import type { ResidentIdentity, ChildType } from "@core/residentAccess";
import type { Session, User } from "@supabase/supabase-js";

/**
 * Who is signed in, which society they belong to, and whether this
 * login is a child account.
 *
 * Shares its shape with the guard app's AuthContext, and the same two
 * departures from the website's: one role, checked at sign-in.
 *
 * ONE ROLE. This app is for residents. An account that is not a
 * resident is refused at sign-in and told why, rather than being let
 * into an app with nothing in it. roleSatisfies comes from
 * @core/permissions — the same table the website and the RLS policies
 * agree on.
 *
 * THE CHILD-ACCOUNT FLAG is loaded here rather than in a screen,
 * because it decides which sections exist at all. Loading it later
 * would mean briefly drawing a menu that a tenant then watches items
 * disappear from, and worse, a section they could tap into during that
 * window. What the flag then permits is decided by @core/residentAccess,
 * shared with the website.
 */

export interface AuthState {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  societyId: string | null;
  societyName: string | null;
  societySlug: string | null;
  /** Whether this login was created by another resident, and as what. */
  identity: ResidentIdentity;
  /** The primary resident's name, when this is a child account. */
  parentName: string | null;
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
  const [identity, setIdentity] = useState<ResidentIdentity>({ isChild: false, childType: null });
  const [parentName, setParentName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Guards against a slow lookup for a signed-out user overwriting the
  // state of the one who signed in after them.
  const latestFor = useRef<string | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    const [{ data: roleRows }, { data: profile }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("profiles")
        .select("society_id, parent_user_id, child_type")
        .eq("user_id", userId).maybeSingle(),
    ]);

    const nextRoles = (roleRows ?? []).map((r) => r.role as AppRole);
    const nextSocietyId = profile?.society_id ?? null;

    // A login with a parent is a family or tenant account. The website
    // reads the same two columns.
    const parentId = (profile?.parent_user_id as string | null) ?? null;
    const nextIdentity: ResidentIdentity = {
      isChild: !!parentId,
      childType: ((profile?.child_type as ChildType | null) ?? null),
    };

    let name: string | null = null;
    let slug: string | null = null;
    if (nextSocietyId) {
      const { data: society } = await supabase
        .from("societies").select("name, slug").eq("id", nextSocietyId).maybeSingle();
      name = society?.name ?? null;
      slug = society?.slug ?? null;
    }

    // Shown on the home screen so a tenant knows whose flat they are
    // looking at, and so the restrictions read as a relationship rather
    // than as the app being broken.
    let parent: string | null = null;
    if (parentId) {
      const { data: p } = await supabase
        .from("profiles").select("display_name").eq("user_id", parentId).maybeSingle();
      parent = p?.display_name ?? null;
    }

    return { nextRoles, nextSocietyId, name, slug, nextIdentity, parent };
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
      setIdentity({ isChild: false, childType: null });
      setParentName(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    void loadProfile(userId).then(({ nextRoles, nextSocietyId, name, slug, nextIdentity, parent }) => {
      // Another sign-in overtook this one.
      if (latestFor.current !== userId) return;
      setRoles(nextRoles);
      setSocietyId(nextSocietyId);
      setSocietyName(name);
      setSocietySlug(slug);
      setIdentity(nextIdentity);
      setParentName(parent);
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

    // Checked HERE rather than after letting them in, so a guard or an
    // admin who opens the resident app gets a sentence explaining it
    // instead of an empty screen. Against the shared capability table,
    // not a local guess.
    const { nextRoles } = await loadProfile(userId);
    if (!roleSatisfies(nextRoles, "resident")) {
      await supabase.auth.signOut();
      return { error: "This account is not registered as a resident." };
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
      value={{
        session, user, roles, societyId, societyName, societySlug,
        identity, parentName, loading, signIn, signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
