import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "npm:zod@3.25.76";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BodySchema = z.object({
  request_id: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
});

/**
 * A random temporary password, shown once to whoever created the
 * account so they can pass it on.
 *
 * Deliberately avoids look-alike characters (0/O, 1/l/I): this gets
 * read off a screen and typed into a phone by someone who did not
 * choose it, and an ambiguous character reads as a broken password
 * rather than a misread one. 16 characters from a 58-symbol alphabet
 * is ~93 bits, which is far past anything that matters here.
 */
function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Rejection-free modulo bias is irrelevant at this entropy, but the
  // trailing "!" is not cosmetic: it satisfies password policies that
  // demand a symbol, which Supabase can be configured to enforce.
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("") + "!";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller is admin
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await userClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // WHO IS CALLING, AND FOR WHICH SOCIETY
    //
    // Both answers are needed before anything else, because this
    // function runs with the service role and therefore bypasses RLS
    // entirely. Every restriction that protects registration_requests
    // at the database level is absent in here and has to be restated.
    //
    // A manager is included deliberately. rolesCreatableBy() offers a
    // manager the "Add a guard" form, and the insert policy in
    // registration_public_close.sql accepts a manager's guard request —
    // but this function refused them with "Admin only", so the form
    // failed on its second step and left the request sitting pending in
    // the queue. The three layers now agree: a manager may create
    // guards, and only guards (enforced below, once the requested role
    // is known).
    //
    // super_admin is intentionally still refused. They hold neither
    // role, have no society, and approve whole SOCIETIES through
    // approve-society — not individual members inside one.
    const [{ data: isAdmin }, { data: isManager }, { data: callerSocietyId }] =
      await Promise.all([
        adminClient.rpc("has_role", { _user_id: caller.id, _role: "admin" }),
        adminClient.rpc("has_role", { _user_id: caller.id, _role: "manager" }),
        adminClient.rpc("get_user_society_id", { _user_id: caller.id }),
      ]);

    if (!isAdmin && !isManager) {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!callerSocietyId) {
      return new Response(
        JSON.stringify({ error: "Your account is not linked to a society." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const parsedBody = BodySchema.safeParse(await req.json());

    if (!parsedBody.success) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { request_id, action } = parsedBody.data;

    // Get the registration request
    const { data: regRequest, error: fetchErr } = await adminClient
      .from("registration_requests")
      .select("*")
      .eq("id", request_id)
      .single();

    if (fetchErr || !regRequest) {
      return new Response(JSON.stringify({ error: "Request not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (regRequest.status !== "pending") {
      return new Response(JSON.stringify({ error: "Already processed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // THE REQUEST MUST BELONG TO THE CALLER'S OWN SOCIETY.
    //
    // request_id comes from the caller and was never checked against
    // the caller's society. Because this runs with the service role,
    // RLS could not catch it either. Any admin of any society could
    // therefore pass the id of a pending request belonging to a
    // DIFFERENT society and approve it — and the role is granted with
    // regRequest.society_id, so approving a pending 'admin' request in
    // someone else's society created a full admin over their members.
    //
    // The insert side was pinned to the caller's society in
    // registration_public_close.sql. This is the matching check on the
    // approval side, which is the half that actually creates accounts.
    if (regRequest.society_id !== callerSocietyId) {
      return new Response(
        JSON.stringify({ error: "That request belongs to another society." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // A MANAGER MAY ONLY ACT ON GUARD REQUESTS.
    //
    // Mirrors rolesCreatableBy() in src/lib/permissions.ts and the
    // insert policy: a manager is denied members.edit and admins.edit,
    // so they may neither approve nor reject anything but a guard.
    // Placed before the reject branch on purpose — letting a manager
    // reject a pending admin request is a smaller power than creating
    // one, but it is still a power over admins that they do not have.
    if (!isAdmin && regRequest.requested_role !== "guard") {
      return new Response(
        JSON.stringify({
          error: "Managers can only approve or reject guard accounts. Ask an admin.",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "reject") {
      await adminClient
        .from("registration_requests")
        .update({ status: "rejected", reviewed_by: caller.id, reviewed_at: new Date().toISOString() })
        .eq("id", request_id);

      return new Response(JSON.stringify({ success: true, action: "rejected" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Approve: use the password the user chose at registration (fallback to a temp password for legacy requests)
    const userChosenPassword: string | null =
      typeof regRequest.password === "string" && regRequest.password.length >= 8
        ? regRequest.password
        : null;
    // A temporary password has to be unguessable, because it is the
    // whole credential until the person changes it — and nothing forces
    // them to. The previous value was `Triumph<base36 of Date.now()>!`,
    // which carried the first customer's name into every society and,
    // worse, was derived entirely from the clock: anyone who knew
    // roughly when an account was created could enumerate a few
    // thousand candidates offline. Random bytes instead.
    const tempPassword = userChosenPassword ?? generateTempPassword();

    // Check if a user with this email already exists (registered under a different role)
    let existingUserId: string | null = null;
    {
      const targetEmail = regRequest.email.toLowerCase();
      const perPage = 1000;
      for (let page = 1; page <= 50; page++) {
        const { data: list, error: listErr } = await adminClient.auth.admin.listUsers({
          page,
          perPage,
        });
        if (listErr) {
          return new Response(JSON.stringify({ error: listErr.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const match = list.users.find(
          (u) => (u.email ?? "").toLowerCase() === targetEmail
        );
        if (match) {
          existingUserId = match.id;
          break;
        }
        if (list.users.length < perPage) break;
      }
    }

    let userId: string;
    let issuedTempPassword: string | null = null;

    if (existingUserId) {
      userId = existingUserId;
      // Safety check: ensure they don't already have this role (trigger should prevent this, but double-check)
      const { data: alreadyHasRole } = await adminClient.rpc("has_role", {
        _user_id: userId,
        _role: regRequest.requested_role,
      });
      if (alreadyHasRole) {
        await adminClient
          .from("registration_requests")
          .update({
            status: "rejected",
            reviewed_by: caller.id,
            reviewed_at: new Date().toISOString(),
          })
          .eq("id", request_id);
        return new Response(
          JSON.stringify({ error: "User is already registered with this role" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // If the user supplied a (new) password during this registration, reset it
      // so the credentials they just chose actually work for the new role login.
      if (userChosenPassword) {
        const { error: pwErr } = await adminClient.auth.admin.updateUserById(userId, {
          password: userChosenPassword,
        });
        if (pwErr) {
          return new Response(JSON.stringify({ error: pwErr.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    } else {
      const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
        email: regRequest.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { display_name: regRequest.display_name },
      });

      if (createErr) {
        return new Response(JSON.stringify({ error: createErr.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = newUser.user.id;
      // Only surface the password to the admin if it was an auto-generated fallback
      issuedTempPassword = userChosenPassword ? null : tempPassword;
    }

    // Server-side allow-list. The /register page restricts what can be
    // ASKED for, but that page is not the only way to create a request:
    // the insert policy is "Anyone can submit registration request", so
    // a crafted POST to the REST endpoint can name any value in the
    // app_role enum. super_admin is in that enum and is not scoped to a
    // society. Refusing here means approving a tampered request cannot
    // escalate anyone, even if the reviewer clicks approve without
    // reading the badge.
    //
    // What an ADMIN may approve — deliberately WIDER than
    // SELF_SERVICE_ROLES in src/lib/permissions.ts, which is what an
    // anonymous visitor may REQUEST. Those were one list and are now
    // two, because guards and residents can no longer self-register
    // but are still created here, by the committee, via
    // onboardMember() writing a request and approving it at once.
    //
    // Do NOT narrow this to match SELF_SERVICE_ROLES. Doing so would
    // break the admin panel's Add Guard form and the bulk resident
    // importer, which are now the only way those accounts exist.
    //
    // The outer bound is the CHECK constraint in
    // supabase/schema/registration_lockdown.sql; super_admin is absent
    // from both and must stay absent.
    const APPROVABLE_ROLES = ["guard", "resident", "admin", "manager"];
    if (!APPROVABLE_ROLES.includes(regRequest.requested_role)) {
      await adminClient
        .from("registration_requests")
        .update({ status: "rejected" })
        .eq("id", regRequest.id);
      return new Response(
        JSON.stringify({
          error: `Role "${regRequest.requested_role}" cannot be granted through registration. This request has been rejected.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { error: roleError } = await adminClient.from("user_roles").insert({
      user_id: userId,
      role: regRequest.requested_role,
      society_id: regRequest.society_id,
    });

    if (roleError) {
      return new Response(JSON.stringify({ error: roleError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existingProfile } = await adminClient
      .from("profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    const profilePayload = {
      user_id: userId,
      display_name: regRequest.display_name,
      flat_number: regRequest.requested_role === "resident" ? regRequest.flat_number : null,
      wing: regRequest.requested_role === "resident" ? regRequest.wing : null,
      society_id: regRequest.society_id,
    };

    const profileQuery = existingProfile
      ? adminClient.from("profiles").update(profilePayload).eq("user_id", userId)
      : adminClient.from("profiles").insert(profilePayload);

    const { error: profileError } = await profileQuery;

    if (profileError) {
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark request as approved
    await adminClient
      .from("registration_requests")
      .update({ status: "approved", reviewed_by: caller.id, reviewed_at: new Date().toISOString(), password: null })
      .eq("id", request_id);

    return new Response(
      JSON.stringify({
        success: true,
        action: "approved",
        temp_password: issuedTempPassword,
        existing_user: !!existingUserId,
        email: regRequest.email,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
