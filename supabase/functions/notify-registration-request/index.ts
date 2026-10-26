import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "npm:zod@3.25.76";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mirrors src/lib/app-url.ts, which is the single source for these in
// the app. This function runs on Deno and cannot import from src/, so
// the values are repeated here. Change them in both places.
const APP_NAME = "ManageSociety";
const APP_DOMAIN = "managesociety.in";
const APP_URL = `https://${APP_DOMAIN}`;

// The sender domain must be VERIFIED IN RESEND or the send fails with
// 403 and no registration notification goes out. Resend rejects an
// unverified from-address outright rather than falling back, and the
// only sign of it is the error logged below. If managesociety.in is
// not yet verified there, set SENDER_EMAIL back to the old verified
// address until it is.
const SENDER_EMAIL = `noreply@${APP_DOMAIN}`;

// Shape of the payload a Supabase Database Webhook sends on INSERT.
const WebhookPayloadSchema = z.object({
  type: z.literal("INSERT"),
  table: z.string(),
  record: z.object({
    id: z.string().uuid(),
    society_name: z.string(),
    admin_display_name: z.string(),
    admin_email: z.string(),
    admin_phone: z.string().nullable().optional(),
    address_line: z.string(),
    city: z.string(),
    state: z.string(),
    created_at: z.string(),
  }),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("RESEND_API_KEY is not set");
      return new Response(JSON.stringify({ error: "Email service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const parsed = WebhookPayloadSchema.safeParse(body);
    if (!parsed.success) {
      console.error("Unexpected webhook payload shape:", parsed.error);
      return new Response(JSON.stringify({ error: "Invalid payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const request = parsed.data.record;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Find every user currently holding the super_admin role.
    const { data: superAdminRoles, error: rolesError } = await adminClient
      .from("user_roles")
      .select("user_id")
      .eq("role", "super_admin");

    if (rolesError) {
      console.error("Failed to look up super_admin roles:", rolesError);
      return new Response(JSON.stringify({ error: "Could not look up recipients" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!superAdminRoles || superAdminRoles.length === 0) {
      console.warn("No super_admin users found -- nothing to notify");
      return new Response(JSON.stringify({ notified: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // auth.users isn't queryable via .from(), so resolve emails via the admin API
    // and filter down to just the super_admin ids.
    const superAdminIds = new Set(superAdminRoles.map((r) => r.user_id));
    const { data: usersPage, error: usersError } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
    if (usersError) {
      console.error("Failed to list users:", usersError);
      return new Response(JSON.stringify({ error: "Could not resolve recipient emails" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const recipientEmails = usersPage.users
      .filter((u) => superAdminIds.has(u.id) && u.email)
      .map((u) => u.email as string);

    if (recipientEmails.length === 0) {
      console.warn("Super_admin roles exist but no matching user emails were found");
      return new Response(JSON.stringify({ notified: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const submittedDate = new Date(request.created_at).toLocaleDateString("en-IN", {
      day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit",
    });

    const emailHtml = `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1a1a;">New Society Registration Request</h2>
        <p><strong>${request.society_name}</strong> has requested to join ${APP_NAME}.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 6px 0; color: #666;">Admin name</td><td style="padding: 6px 0;">${request.admin_display_name}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Admin email</td><td style="padding: 6px 0;">${request.admin_email}</td></tr>
          ${request.admin_phone ? `<tr><td style="padding: 6px 0; color: #666;">Admin phone</td><td style="padding: 6px 0;">${request.admin_phone}</td></tr>` : ""}
          <tr><td style="padding: 6px 0; color: #666;">Address</td><td style="padding: 6px 0;">${request.address_line}, ${request.city}, ${request.state}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Submitted</td><td style="padding: 6px 0;">${submittedDate}</td></tr>
        </table>
        <a href="${APP_URL}/super-admin" style="display: inline-block; background: #F5A028; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          Review Request
        </a>
      </div>
    `;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${APP_NAME} <${SENDER_EMAIL}>`,
        to: recipientEmails,
        subject: `New society registration: ${request.society_name}`,
        html: emailHtml,
      }),
    });

    if (!resendResponse.ok) {
      const errText = await resendResponse.text();
      console.error("Resend API error:", resendResponse.status, errText);
      return new Response(JSON.stringify({ error: "Failed to send email", details: errText }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ notified: recipientEmails.length }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unexpected error in notify-registration-request:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
