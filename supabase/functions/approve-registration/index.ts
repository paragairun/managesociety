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
    const { data: isAdmin } = await adminClient.rpc("has_role", {
      _user_id: caller.id,
      _role: "admin",
    });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
    const tempPassword = userChosenPassword ?? `Triumph${Date.now().toString(36)}!`;

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
