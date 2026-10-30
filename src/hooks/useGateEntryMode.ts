import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type GateEntryMode = "qr_sticker" | "rfid";

/**
 * How vehicles get through this society's gate.
 *
 * 'rfid' means the society uses Park+ or a similar RFID system, and the
 * QR scanner is hidden: nothing there is scanned, and a dead button at
 * a gate is worse than a missing one.
 *
 * Defaults to 'qr_sticker' while loading and on any error, deliberately
 * — a failure should leave the guard with MORE tools, not fewer.
 *
 * Read through a cast because societies.gate_entry_mode is newer than
 * the generated types.ts; it is defined in
 * supabase/schema/society_units_and_gate_mode.sql.
 */
export function useGateEntryMode(societyId: string | null | undefined): GateEntryMode {
  const [mode, setMode] = useState<GateEntryMode>("qr_sticker");

  useEffect(() => {
    if (!societyId) return;
    let active = true;

    const db = supabase as unknown as {
      from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => {
        maybeSingle: () => Promise<{ data: { gate_entry_mode?: string } | null }> } } };
    };

    void db.from("societies").select("gate_entry_mode").eq("id", societyId).maybeSingle()
      .then(({ data }) => {
        if (active) setMode(data?.gate_entry_mode === "rfid" ? "rfid" : "qr_sticker");
      });

    return () => { active = false; };
  }, [societyId]);

  return mode;
}
