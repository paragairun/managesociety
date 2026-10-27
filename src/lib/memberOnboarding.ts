import { supabase } from "@/integrations/supabase/client";

/**
 * Creating a member account on the committee's behalf.
 *
 * Guards and residents are no longer allowed to register themselves —
 * a public form accepting them let anyone put a name, an email and a
 * flat number into a society's approval queue uninvited. The committee
 * creates these accounts instead, which means writing a registration
 * request and approving it in the same breath.
 *
 * That two-step was already how BulkResidentUpload worked. It lives
 * here now so the bulk importer and the single Add Guard form cannot
 * drift: one of them growing a validation rule or a retry that the
 * other lacks is exactly the kind of split this avoids.
 *
 * Enforced server-side by the "Committee creates members for own
 * society" policy in supabase/schema/registration_lockdown.sql — the
 * society_id below is checked against the caller's own, so this helper
 * cannot write into another society's queue however it is called.
 */
export type MemberRole = "guard" | "resident";

export interface NewMember {
  societyId: string;
  role: MemberRole;
  displayName: string;
  email: string;
  /** Residents only; ignored for guards. */
  wing?: string | null;
  flatNumber?: string | null;
}

export interface OnboardResult {
  ok: boolean;
  /** Present on success when the approval function generated one. */
  tempPassword?: string | null;
  error?: string;
}

/** Cheap shape check. The real validation is the database's. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function onboardMember(member: NewMember): Promise<OnboardResult> {
  const displayName = member.displayName?.trim() ?? "";
  const email = member.email?.trim().toLowerCase() ?? "";

  if (!member.societyId) return { ok: false, error: "Society not loaded yet." };
  if (!displayName) return { ok: false, error: "Name is required." };
  if (!looksLikeEmail(email)) return { ok: false, error: "That does not look like an email address." };

  // 1. The request. society_id is sent explicitly and the RLS policy
  //    compares it to the caller's own society, so a wrong value here
  //    is refused rather than silently accepted.
  const { data: created, error: insertError } = await supabase
    .from("registration_requests")
    .insert({
      display_name: displayName,
      email,
      requested_role: member.role,
      wing: member.role === "resident" ? member.wing ?? null : null,
      flat_number: member.role === "resident" ? member.flatNumber ?? null : null,
      status: "pending",
      society_id: member.societyId,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    return { ok: false, error: insertError?.message ?? "Could not create the request." };
  }

  // 2. Approve it immediately. This is what actually creates the auth
  //    user, the profile and the role; the request row is bookkeeping.
  const { data, error } = await supabase.functions.invoke("approve-registration", {
    body: { request_id: created.id, action: "approve" },
  });

  if (error || data?.error) {
    // The request row is left behind on purpose rather than cleaned up:
    // it is now sitting in the committee's own queue, where they can
    // see what failed and retry, instead of vanishing silently.
    return { ok: false, error: error?.message ?? data?.error ?? "Could not approve the new account." };
  }

  return { ok: true, tempPassword: data?.temp_password ?? null };
}
