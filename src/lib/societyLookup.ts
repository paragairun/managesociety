import { supabase } from "@/integrations/supabase/client";

/**
 * Resolving a single society without being able to list them.
 *
 * `societies` used to be readable by anyone holding the publishable
 * key, which published the whole customer list. Anonymous callers now
 * have no table access at all; they get the `society_public` function,
 * which returns at most one row and only for a handle the caller
 * already has — the slug from a link their society sent them, or the
 * id printed into a visitor QR code.
 *
 * See supabase/schema/society_visibility.sql.
 */
export interface PublicSociety {
  id: string;
  name: string;
  slug: string;
  city: string;
  state: string;
}

export interface SocietyHandle {
  slug?: string | null;
  id?: string | null;
}

/**
 * The single place the app resolves a society it was handed a handle
 * for. Register and VisitorForm both go through here so neither can
 * drift back to querying the table.
 *
 * Returns null for "no such active society" and for "you gave me
 * nothing to look up" alike. Callers cannot tell the two apart, which
 * is deliberate: a different answer for a real-but-suspended society
 * would be an existence oracle.
 */
export async function resolveSociety(handle: SocietyHandle): Promise<PublicSociety | null> {
  const slug = handle.slug?.trim() || null;
  const id = handle.id?.trim() || null;

  // Nothing to resolve. Returning early also keeps a pointless request
  // off the wire on the bare /register and /visitor/form routes.
  if (!slug && !id) return null;

  // The generated Supabase types predate this function, so rpc() does
  // not know its name or shape yet. The CLIENT is cast, not the method:
  // pulling `rpc` off into a bare variable loses `this`, and supabase-js
  // then dies on `this.rest` before any request is made. Mirrors the
  // approach in evDb.ts; regenerating types.ts removes the cast.
  const client = supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, string | null>,
    ) => Promise<{ data: PublicSociety[] | null; error: { message: string } | null }>;
  };

  try {
    const { data, error } = await client.rpc("society_public", { _slug: slug, _id: id });

    // A failed lookup is indistinguishable from an unknown society on
    // purpose. The caller shows "use your society's link" either way.
    if (error) {
      console.warn("Society lookup failed:", error.message);
      return null;
    }

    return data && data.length > 0 ? data[0] : null;
  } catch (err) {
    // A rejected promise must still settle the caller's `looking` flag.
    // Without this the page sits on a loading skeleton for ever, which
    // is worse than telling the visitor to use their link.
    console.warn("Society lookup threw:", err);
    return null;
  }
}
