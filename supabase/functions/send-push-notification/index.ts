import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "npm:zod@3.25.76";

/**
 * Delivers push notifications through Firebase Cloud Messaging.
 *
 * THREE WAYS TO CALL IT
 *
 *   { drain: true }
 *       Send every message sitting in the notification_events outbox.
 *       This is what Postgres asks for: a trigger queues messages and
 *       request_notification_dispatch() makes one call per transaction
 *       saying "there is work". See supabase/schema/push_notifications.sql.
 *
 *   { event_id: "<uuid>" }
 *       Send one specific outbox row. For retrying a single failure.
 *
 *   { user_ids: [...], title, body, data? }
 *       Send immediately without touching the outbox. Kept for manual
 *       sends and for testing from the dashboard; nothing in the app
 *       uses it.
 *
 * WHY THE OUTBOX RATHER THAN A PAYLOAD PER CALL
 * Bulk operations. Generating maintenance bills for a 200-flat society
 * queues 200 messages in one transaction and results in exactly one
 * call to this function, which then drains all of them under a single
 * FCM OAuth token.
 *
 * AUTHORISATION
 * Callers must be the service role (Postgres is, via pg_net) or a super
 * admin. An ordinary resident's JWT is refused: this function can send
 * arbitrary text to any user id and bypasses RLS to read device tokens,
 * so it must not be reachable from the app.
 *
 * The service role is recognised by the `role` claim in its JWT, not by
 * comparing the bearer against SUPABASE_SERVICE_ROLE_KEY. The string
 * comparison was the first implementation and it was wrong: a perfectly
 * valid service_role JWT taken from the dashboard was rejected with a
 * bare 401, because the value Supabase injects into the function's
 * environment is not always byte-identical to the key the dashboard
 * hands you — and the newer API key system makes that more likely, not
 * less. A key rotation would have broken it too.
 *
 * Trusting the claim is sound here, and is not the same as skipping
 * verification: verify_jwt is on for this function (supabase/config.toml
 * turns it off only for essl-push), so the gateway has already checked
 * the signature against this project's JWT secret before the function
 * is invoked. An unsigned or foreign token never reaches this code, and
 * `role` is set by the auth server rather than by the user, so it
 * cannot be talked up from "authenticated".
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DirectPayload = z.object({
  user_ids: z.array(z.string().uuid()),
  title: z.string(),
  body: z.string(),
  data: z.record(z.string()).optional(),
});

const DrainPayload = z.object({
  drain: z.literal(true),
  /** Safety valve on one invocation; the next event drains the rest. */
  limit: z.number().int().positive().max(500).optional(),
});

const SinglePayload = z.object({ event_id: z.string().uuid() });

/**
 * Which Android channel an event belongs in.
 *
 * MIRRORS channelForEvent in src/lib/pushRouting.ts, which the native
 * apps use to CREATE these channels. Edge functions are deployed
 * separately from the website and cannot import from src/, so this is a
 * deliberate copy — and pushRouting.test.ts reads this file to check the
 * two have not drifted.
 */
const GATE_EVENTS = new Set([
  "delivery.at_gate",
  "visitor.at_gate",
  "gate.unregistered_vehicle",
]);
const GATE_CHANNEL_ID = "managesociety-gate";
const DEFAULT_CHANNEL_ID = "managesociety-default";

function channelForEvent(eventKey: string | null | undefined): string {
  return eventKey && GATE_EVENTS.has(eventKey) ? GATE_CHANNEL_ID : DEFAULT_CHANNEL_ID;
}

interface OutboxRow {
  id: string;
  recipient_user_ids: string[];
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  event_key: string;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Minimal FCM HTTP v1 client using a service account for OAuth2. */
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unsigned = `${enc(header)}.${enc(claims)}`;

  const keyData = sa.private_key.replace(/-----[A-Z ]+-----|\n/g, "");
  const binaryKey = Uint8Array.from(atob(keyData), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsigned),
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${sig}`,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`FCM auth failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

/**
 * FCM `data` carries strings and nothing else. A number or a nested
 * object is rejected for the whole message, so the jsonb from Postgres
 * is flattened here rather than trusted.
 */
function stringifyData(data: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

/**
 * Tokens FCM tells us are dead.
 *
 * UNREGISTERED means the app was uninstalled or the token was replaced;
 * INVALID_ARGUMENT on the token field means it was never valid. Either
 * way the row will never deliver again, and leaving it behind means
 * every future send retries it — a device that uninstalls today would
 * otherwise cost a failed HTTP request on every notification forever.
 */
/**
 * The claims of an already-verified JWT.
 *
 * No signature check, deliberately: verify_jwt is on for this function,
 * so the Supabase gateway validated the signature against the project's
 * JWT secret before this code ran. Re-deriving that here would mean
 * handling the secret, which is strictly worse. Returns null for
 * anything that is not a three-part token with a JSON payload — a
 * `sb_secret_…` style key, for instance, which is not a JWT at all.
 */
function jwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes));
    return claims && typeof claims === "object" ? claims as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function isDeadToken(status: number, errorBody: string): boolean {
  if (status === 404) return true;
  if (status === 400 && /INVALID_ARGUMENT/.test(errorBody) && /token/i.test(errorBody)) return true;
  return /UNREGISTERED|NotRegistered|MismatchSenderId/.test(errorBody);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

    // ── Authorisation ────────────────────────────────────────────
    // The bearer is either the service role key itself (Postgres) or a
    // user JWT. Only a super admin is allowed among the latter.
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    if (!bearer) return json({ error: "Missing auth" }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // The service role, by the claim the gateway already verified, or
    // by an exact match for the non-JWT key formats. Either is enough.
    const claims = jwtClaims(bearer);
    const isServiceRole =
      claims?.role === "service_role" || (bearer === serviceRoleKey && bearer.length > 0);

    if (!isServiceRole) {
      // Not the service role, so it has to be a super admin's own token.
      // getUser is the right call here and the wrong one above: a
      // service_role JWT has no `sub`, so it identifies no user and
      // would always fail this check however valid it is.
      const { data: { user } } = await adminClient.auth.getUser(bearer);
      if (!user) {
        // Says which of the two it was, because "Unauthorized" with no
        // detail cost an afternoon of guessing once already. Neither
        // branch reveals anything a caller does not already hold.
        return json({
          error: "Unauthorized",
          detail: claims
            ? `token role is "${String(claims.role ?? "none")}", need service_role or a super admin`
            : "bearer is not a recognised token",
        }, 401);
      }
      const { data: isSuper } = await adminClient.rpc("has_role", {
        _user_id: user.id,
        _role: "super_admin",
      });
      if (!isSuper) {
        // Deliberately terse. This endpoint is not for the app.
        return json({ error: "Forbidden" }, 403);
      }
    }

    const serviceAccountJson = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
    if (!serviceAccountJson) {
      console.error("FCM_SERVICE_ACCOUNT_JSON is not set");
      return json({ error: "Push service not configured" }, 500);
    }
    const serviceAccount: ServiceAccount = JSON.parse(serviceAccountJson);

    const payload = await req.json().catch(() => null);
    if (!payload) return json({ error: "Invalid JSON" }, 400);

    // ── Work out what to send ────────────────────────────────────
    let rows: OutboxRow[] = [];
    let fromOutbox = true;

    const drain = DrainPayload.safeParse(payload);
    const single = SinglePayload.safeParse(payload);
    const direct = DirectPayload.safeParse(payload);

    if (drain.success) {
      // claim_notifications(), not a SELECT. It marks the rows claimed
      // with FOR UPDATE SKIP LOCKED in one statement, so two drains
      // that overlap — a guard logging a delivery while a billing run
      // is still going — cannot both send the same message and give
      // the resident a duplicate. SKIP LOCKED cannot be expressed
      // through the REST API, which is why it lives in SQL.
      const { data, error } = await adminClient.rpc("claim_notifications", {
        _limit: drain.data.limit ?? 200,
      });
      if (error) {
        console.error("Could not claim from the outbox:", error);
        return json({ error: "Could not claim from the outbox" }, 500);
      }
      rows = (data ?? []) as OutboxRow[];
    } else if (single.success) {
      const { data, error } = await adminClient
        .from("notification_events")
        .select("id, recipient_user_ids, title, body, data, event_key")
        .eq("id", single.data.event_id)
        .maybeSingle();
      if (error || !data) return json({ error: "No such event" }, 404);
      rows = [data as OutboxRow];
    } else if (direct.success) {
      fromOutbox = false;
      rows = [{
        id: "direct",
        recipient_user_ids: direct.data.user_ids,
        title: direct.data.title,
        body: direct.data.body,
        data: direct.data.data ?? {},
        event_key: "direct",
      }];
    } else {
      return json({
        error: "Invalid payload",
        expected: "{ drain: true } | { event_id } | { user_ids, title, body }",
      }, 400);
    }

    if (rows.length === 0) return json({ drained: 0, sent: 0 });

    // One OAuth token for the whole batch. This is the main reason
    // draining beats one invocation per message.
    const accessToken = await getAccessToken(serviceAccount);
    const fcmEndpoint =
      `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;

    // Every recipient across the batch, in one query rather than one
    // per message — the same admin receives most of them.
    const everyRecipient = [...new Set(rows.flatMap((r) => r.recipient_user_ids ?? []))];
    const { data: tokenRows, error: tokenError } = await adminClient
      .from("device_push_tokens")
      .select("user_id, token")
      .in("user_id", everyRecipient);

    if (tokenError) {
      console.error("Failed to look up device tokens:", tokenError);
      return json({ error: "Could not look up device tokens" }, 500);
    }

    const tokensByUser = new Map<string, string[]>();
    for (const { user_id, token } of tokenRows ?? []) {
      const list = tokensByUser.get(user_id) ?? [];
      list.push(token);
      tokensByUser.set(user_id, list);
    }

    const deadTokens = new Set<string>();
    let totalSent = 0;
    let totalFailed = 0;

    for (const row of rows) {
      const tokens = [...new Set(
        (row.recipient_user_ids ?? []).flatMap((u) => tokensByUser.get(u) ?? []),
      )];

      let sent = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const token of tokens) {
        if (deadTokens.has(token)) continue;

        const res = await fetch(fcmEndpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: row.title, body: row.body },
              data: stringifyData(row.data),
              android: {
                // 'high' so the notification appears immediately rather
                // than being batched by Doze. A visitor at the gate is
                // worthless delivered twenty minutes late.
                priority: "high",
                notification: {
                  // Must match a channel the app creates, or Android 8+
                  // silently drops it into a system default with no
                  // sound. Which channel depends on the event: someone
                  // standing at a gate goes to the loud one, a bill does
                  // not. The mapping is shared with the apps in
                  // src/lib/pushRouting.ts (channelForEvent) so both
                  // sides cannot disagree about the id.
                  channel_id: channelForEvent(row.event_key),
                  sound: "default",
                },
              },
              apns: {
                headers: { "apns-priority": "10" },
                payload: { aps: { sound: "default" } },
              },
            },
          }),
        });

        if (res.ok) {
          sent++;
        } else {
          const text = await res.text();
          failed++;
          errors.push(text.slice(0, 300));
          if (isDeadToken(res.status, text)) deadTokens.add(token);
          console.error(`FCM refused a token for ${row.event_key}:`, text.slice(0, 500));
        }
      }

      totalSent += sent;
      totalFailed += failed;

      if (fromOutbox) {
        // Marked dispatched whatever happened, including when there
        // were no devices at all. A row that stays pending means
        // "never attempted", and conflating that with "attempted and
        // nobody had the app" would make the pending count useless as
        // an alarm.
        const { error: markError } = await adminClient
          .from("notification_events")
          .update({
            dispatched_at: new Date().toISOString(),
            sent_count: sent,
            failed_count: failed,
            error: errors.length > 0 ? errors.join(" | ").slice(0, 1000) : null,
          })
          .eq("id", row.id);
        if (markError) {
          // Worth shouting about: an unmarked row is sent again on the
          // next drain, so this is the one failure mode that produces
          // duplicate notifications.
          console.error("Sent but could not mark dispatched:", row.id, markError);
        }
      }
    }

    // Prune what FCM rejected as permanently invalid.
    if (deadTokens.size > 0) {
      const { error: pruneError } = await adminClient
        .from("device_push_tokens")
        .delete()
        .in("token", [...deadTokens]);
      if (pruneError) console.error("Could not prune dead tokens:", pruneError);
      else console.log(`Pruned ${deadTokens.size} dead device token(s)`);
    }

    return json({
      drained: fromOutbox ? rows.length : 0,
      sent: totalSent,
      failed: totalFailed,
      pruned: deadTokens.size,
    });
  } catch (err) {
    console.error("Unexpected error in send-push-notification:", err);
    return json({ error: "Internal error" }, 500);
  }
});
