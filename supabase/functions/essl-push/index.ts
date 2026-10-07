/**
 * essl-push — ADMS / iClock endpoint for eSSL and ZKTeco terminals.
 *
 * The terminal (K90 Pro, X990, uFace, AiFace, ...) matches fingerprints
 * itself and pushes the result here over HTTP. We never receive or store
 * a biometric template from these devices.
 *
 * Deploy WITHOUT JWT verification — a terminal cannot send an auth header:
 *   supabase functions deploy essl-push --no-verify-jwt
 *
 * Then on the device: Menu -> Comm -> Cloud Server / ADMS, and set the
 * server address so that the device's own "/iclock/..." suffix lands here.
 *
 * SECURITY, stated plainly: the protocol authenticates a device only by
 * the serial number in the query string, which is guessable and sent in
 * clear text if the firmware does not do HTTPS. That is a property of the
 * protocol, not of this code. Mitigations here: an unknown SN is refused,
 * a device must be switched to active by an admin before its punches are
 * accepted, and nothing it sends can create or modify a person — only a
 * punch row against a PIN an admin has already mapped.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import {
  routeEndpoint, parseAttlog, buildHandshakeResponse, okResponse,
  directionFromStatus, verifyModeLabel, punchKey,
} from "../_shared/adms.ts";

const text = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const endpoint = routeEndpoint(url.pathname);
  const sn = url.searchParams.get("SN") ?? url.searchParams.get("sn") ?? "";

  if (endpoint === "unknown") return text("Not found", 404);
  if (!sn) return text("SN required", 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // An unregistered or unapproved terminal is refused. Its serial is still
  // recorded so an admin can see it tried and approve it deliberately.
  const { data: device } = await admin
    .from("biometric_devices")
    .select("id, society_id, timezone_hours, is_active")
    .eq("serial_number", sn)
    .maybeSingle();

  if (!device) {
    console.warn(`unregistered terminal: ${sn}`);
    return text("Device not registered", 403);
  }
  if (!device.is_active) {
    console.warn(`inactive terminal: ${sn}`);
    return text("Device not active", 403);
  }

  await admin.from("biometric_devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", device.id);

  const tzMinutes = Math.round(Number(device.timezone_hours ?? 5.5) * 60);

  // ── Handshake: the device asks for its configuration ──
  if (endpoint === "cdata" && req.method === "GET") {
    return text(buildHandshakeResponse({
      serialNumber: sn,
      timezoneHours: Number(device.timezone_hours ?? 5.5),
    }));
  }

  // ── Command queue. Nothing is pushed to the device yet; "OK" means
  //    "nothing for you". Remote enrolment would be queued here later. ──
  if (endpoint === "getrequest") return text(okResponse());
  if (endpoint === "ping") return text(okResponse());
  if (endpoint === "devicecmd") return text(okResponse());

  // ── Punches ──
  if (endpoint === "cdata" && req.method === "POST") {
    const table = (url.searchParams.get("table") ?? "").toUpperCase();
    const body = await req.text();

    // OPERLOG and other tables are acknowledged but not stored; refusing
    // them would make the device retry the same payload forever.
    if (table && table !== "ATTLOG") return text(okResponse());

    const { records, skipped } = parseAttlog(body, tzMinutes);
    if (skipped.length) {
      console.warn(`${sn}: skipped ${skipped.length} line(s)`, skipped.slice(0, 5));
    }
    if (!records.length) return text(okResponse(0));

    const rows = records.map((r) => ({
      society_id: device.society_id,
      device_id: device.id,
      punch_key: punchKey(sn, r),
      device_pin: r.pin,
      punched_at: r.timestamp,
      status_code: r.status,
      verify_mode: r.verifyMode,
      direction: directionFromStatus(r.status),
      raw_line: r.raw,
    }));

    // Idempotent: a re-sent batch collides on punch_key and is ignored.
    const { data: inserted, error } = await admin
      .from("device_punches")
      .upsert(rows, { onConflict: "punch_key", ignoreDuplicates: true })
      .select("id, device_pin, punched_at, status_code, verify_mode");

    if (error) {
      // Do NOT return OK: the device will retry, which is what we want.
      console.error(`${sn}: punch insert failed`, error.message);
      return text("Error", 500);
    }

    await admin.from("biometric_devices")
      .update({ last_punch_at: records[records.length - 1].timestamp })
      .eq("id", device.id);

    await attachToStaffLogs(admin, device, sn, inserted ?? []);
    return text(okResponse(records.length));
  }

  return text(okResponse());
});

/**
 * Turn new punches into staff_logs entries for PINs that are mapped.
 * Unmapped PINs stay in device_punches and surface in the
 * unmapped_device_pins view, so nothing is lost before an admin links them.
 */
async function attachToStaffLogs(
  admin: ReturnType<typeof createClient>,
  device: { id: string; society_id: string },
  serial: string,
  punches: { id: string; device_pin: string; punched_at: string; status_code: number; verify_mode: number | null }[],
) {
  if (!punches.length) return;

  const pins = [...new Set(punches.map((p) => p.device_pin))];
  const { data: maps } = await admin
    .from("device_user_map")
    .select("device_pin, subject_category, subject_id, device_id")
    .eq("society_id", device.society_id)
    .in("device_pin", pins);

  if (!maps?.length) return;

  // A mapping for this specific device wins over a society-wide one.
  const byPin = new Map<string, { subject_category: string; subject_id: string }>();
  for (const m of maps) {
    const specific = m.device_id === device.id;
    if (specific || !byPin.has(m.device_pin)) {
      byPin.set(m.device_pin, { subject_category: m.subject_category, subject_id: m.subject_id });
    }
  }

  for (const p of punches) {
    const target = byPin.get(p.device_pin);
    if (!target) continue;

    // The device's own status code decides entry vs exit when it gives a
    // usable one; otherwise fall back to toggling on the last log, which
    // is how the QR and PC-scanner paths behave.
    let action = directionFromStatus(p.status_code);
    if (action === "unknown") {
      const { data: last } = await admin
        .from("staff_logs").select("action_type")
        .eq("staff_id", target.subject_id)
        .order("timestamp", { ascending: false }).limit(1).maybeSingle();
      action = last?.action_type === "entry" ? "exit" : "entry";
    }

    const { data: log } = await admin.from("staff_logs").insert({
      society_id: device.society_id,
      category: target.subject_category,
      staff_id: target.subject_id,
      action_type: action,
      timestamp: p.punched_at,
      logged_by: null,
      entry_method: "biometric_terminal",
      device_model: verifyModeLabel(p.verify_mode ?? 0),
      device_pin: p.device_pin,
      device_serial: serial,
    }).select("id").maybeSingle();

    await admin.from("device_punches")
      .update({ processed: true, staff_log_id: log?.id ?? null })
      .eq("id", p.id);
  }
}
