import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "npm:zod@3.25.76";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BodySchema = z.object({
  request_id: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(500).nullable().optional(),
});

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await userClient.auth.getUser();
    if (!caller) return json({ error: "Unauthorized" }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: isSuper } = await adminClient.rpc("is_super_admin", { _user_id: caller.id });
    if (!isSuper) return json({ error: "Super-admin only" }, 403);

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: "Invalid input" }, 400);

    const { request_id, action, reason } = parsed.data;

    const { data: reqRow, error: fetchErr } = await adminClient
      .from("society_registration_requests")
      .select("*")
      .eq("id", request_id)
      .single();
    if (fetchErr || !reqRow) return json({ error: "Request not found" }, 404);
    if (reqRow.status !== "pending") return json({ error: "Already processed" }, 400);

    if (action === "reject") {
      await adminClient.from("society_registration_requests").update({
        status: "rejected",
        rejection_reason: reason ?? null,
        reviewed_by: caller.id,
        reviewed_at: new Date().toISOString(),
      }).eq("id", request_id);
      return json({ success: true, action: "rejected" });
    }

    // Approve: create society, create auth user, assign admin role, profile, mark approved
    // Generate a URL-safe slug from the society name
    const generateSlug = (name: string): string => {
      return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    };

    // Ensure slug uniqueness by checking existing slugs
    let slug = generateSlug(reqRow.society_name);
    const { data: existingSlugs } = await adminClient.from("societies").select("slug").like("slug", `${slug}%`);
    const takenSlugs = new Set((existingSlugs ?? []).map((r: { slug: string }) => r.slug));
    if (takenSlugs.has(slug)) {
      let counter = 1;
      while (takenSlugs.has(`${slug}-${counter}`)) counter++;
      slug = `${slug}-${counter}`;
    }

    const { data: society, error: socErr } = await adminClient.from("societies").insert({
      name: reqRow.society_name,
      address_line: reqRow.address_line,
      landmark: reqRow.landmark,
      city: reqRow.city,
      state: reqRow.state,
      country: reqRow.country,
      pin_code: reqRow.pin_code,
      slug,
      status: "active",
    }).select("id, slug").single();
    if (socErr || !society) return json({ error: socErr?.message ?? "Could not create society" }, 400);

    // Persist the submitted structure (towers/wings/flat ranges) as locked, super-admin-only editable
    // Non-blocking — if the table doesn't exist yet (pending migration), approval still succeeds
    //
    // unit_types rides along in the same row. It is validated at both
    // ends — normalizeUnitTypes before submission, a trigger on insert
    // — so this copies it verbatim rather than reshaping it. Dropping
    // it here would be the worst kind of bug: the committee fills in
    // the catalogue at registration, sees it accepted, and finds it
    // gone the first time they open Society Setup.
    try {
      const { error: structErr } = await adminClient.from("society_structure").insert({
        society_id: society.id,
        structure: reqRow.society_structure ?? [],
        unit_types: reqRow.unit_types ?? [],
        locked: true,
      });
      if (structErr) console.error("society_structure insert failed:", structErr.message);
    } catch (e) {
      console.error("society_structure insert exception:", e);
    }

    // Check if user already exists
    let userId: string | null = null;
    {
      const targetEmail = reqRow.admin_email.toLowerCase();
      for (let page = 1; page <= 50; page++) {
        const { data: list } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
        const m = list?.users.find((u) => (u.email ?? "").toLowerCase() === targetEmail);
        if (m) { userId = m.id; break; }
        if (!list || list.users.length < 1000) break;
      }
    }

    if (userId) {
      // Reset password to the one they chose so the credentials work
      await adminClient.auth.admin.updateUserById(userId, { password: reqRow.admin_password });
    } else {
      const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
        email: reqRow.admin_email,
        password: reqRow.admin_password,
        email_confirm: true,
        user_metadata: { display_name: reqRow.admin_display_name },
      });
      if (createErr || !created.user) return json({ error: createErr?.message ?? "Could not create admin user" }, 400);
      userId = created.user.id;
    }

    // Upsert profile with society_id + admin phone
    const { data: existingProfile } = await adminClient.from("profiles").select("id").eq("user_id", userId).maybeSingle();
    const profilePayload = {
      user_id: userId,
      display_name: reqRow.admin_display_name,
      phone: reqRow.admin_phone,
      society_id: society.id,
    };
    const { error: profileErr } = existingProfile
      ? await adminClient.from("profiles").update(profilePayload).eq("user_id", userId)
      : await adminClient.from("profiles").insert(profilePayload);
    if (profileErr) return json({ error: profileErr.message }, 400);

    // Assign admin role for this society
    const { error: roleErr } = await adminClient
      .from("user_roles")
      .upsert({ user_id: userId, role: "admin", society_id: society.id }, { onConflict: "user_id,role" });
    if (roleErr) return json({ error: roleErr.message }, 400);

    // Mark request approved and clear stored password
    await adminClient.from("society_registration_requests").update({
      status: "approved",
      reviewed_by: caller.id,
      reviewed_at: new Date().toISOString(),
      created_society_id: society.id,
    }).eq("id", request_id);

    // Clear stored password separately (non-blocking, column may not exist in older schemas)
    try {
      await adminClient.from("society_registration_requests")
        .update({ admin_password: "" })
        .eq("id", request_id);
    } catch (_) { /* ignore */ }

    return json({ success: true, action: "approved", society_id: society.id, society_slug: society.slug, admin_email: reqRow.admin_email });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unexpected error" }, 500);
  }
});
