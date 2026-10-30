export interface GuestPassPayload {
  type: "guest_pass";
  request_id: string;
  visitor_name: string;
  phone: string;
  vehicle_number: string;
  purpose: string | null;
  flat_number: string;
  wing: string;
  owner_name: string;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const encodeGuestPass = (payload: GuestPassPayload) => JSON.stringify(payload);

export const decodeGuestPass = (value: string): GuestPassPayload | null => {
  try {
    const parsed = JSON.parse(value);

    if (
      parsed?.type !== "guest_pass" ||
      !isNonEmptyString(parsed.request_id) ||
      !isNonEmptyString(parsed.visitor_name) ||
      !isNonEmptyString(parsed.phone) ||
      !isNonEmptyString(parsed.vehicle_number) ||
      !isNonEmptyString(parsed.flat_number) ||
      !isNonEmptyString(parsed.wing) ||
      !isNonEmptyString(parsed.owner_name)
    ) {
      return null;
    }

    return {
      type: "guest_pass",
      request_id: parsed.request_id,
      visitor_name: parsed.visitor_name,
      phone: parsed.phone,
      vehicle_number: parsed.vehicle_number,
      purpose: typeof parsed.purpose === "string" && parsed.purpose.trim().length > 0 ? parsed.purpose : null,
      flat_number: parsed.flat_number,
      wing: parsed.wing,
      owner_name: parsed.owner_name,
    };
  } catch {
    return null;
  }
};
// ─── Creating one ───────────────────────────────────────────────────────────

export interface GuestPassDraft {
  visitor_name: string;
  phone: string;
  vehicle_number: string;
  purpose: string;
}

export const emptyGuestPassDraft = (): GuestPassDraft => ({
  visitor_name: "", phone: "", vehicle_number: "", purpose: "",
});

/** Digits only, capped at ten. Indian mobile numbers, typed in a hurry. */
export const normalizeGuestPhone = (raw: string): string =>
  raw.replace(/\D/g, "").slice(0, 10);

/** Upper case, letters and digits only — the form a plate is read in. */
export const normalizePlate = (raw: string): string =>
  raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

/**
 * The first thing wrong with a draft, or null if it is ready.
 *
 * ONE message at a time, in the order the form presents the fields, for
 * the same reason as the delivery form: a wall of red on a phone reads
 * as "broken" and gets abandoned.
 *
 * The vehicle number is required even though a guest may well arrive on
 * foot, because it is what the guard matches at the gate — the pass is
 * scanned against a vehicle. A pass with no plate is one the guard
 * cannot check anything against. ("NA" and the like are a resident's
 * own business; this only insists on something.)
 */
export const validateGuestPassDraft = (draft: GuestPassDraft): string | null => {
  if (!draft.visitor_name.trim()) return "Who is visiting?";
  const phone = normalizeGuestPhone(draft.phone);
  if (!phone) return "Enter your guest's mobile number.";
  // Ten digits, because this is the number the guard rings if the
  // visitor turns up and something does not match. A partial number is
  // worse than none: it looks answered.
  if (phone.length < 10) return "The mobile number needs 10 digits.";
  if (!normalizePlate(draft.vehicle_number)) return "Enter the vehicle number.";
  return null;
};

/** The body for the resident-guest-passes create call, from a valid draft. */
export const guestPassCreateBody = (draft: GuestPassDraft, flatId?: string) => ({
  action: "create" as const,
  visitor_name: draft.visitor_name.trim(),
  phone: normalizeGuestPhone(draft.phone),
  vehicle_number: normalizePlate(draft.vehicle_number),
  purpose: draft.purpose.trim() || null,
  ...(flatId ? { flat_id: flatId } : {}),
});

/**
 * Statuses a pass moves through, and what each means to the resident.
 *
 * `guest_pass` is the one that matters: issued and not yet used. The
 * guard's scanner flips it to `entered` on the way in, which is how a
 * pass is single-use — see claimGuestPass in gatePorts.
 */
export const guestPassStatus = (status: string): { label: string; usable: boolean } => {
  switch (status) {
    case "guest_pass": return { label: "Ready to scan", usable: true };
    case "entered": return { label: "Used — your guest is inside", usable: false };
    case "approved": return { label: "Approved at the gate", usable: false };
    case "rejected": return { label: "Turned away", usable: false };
    case "pending": return { label: "Waiting at the gate", usable: false };
    default: return { label: status, usable: false };
  }
};
