/**
 * What a delivery visit is, what makes one valid, and how a guard's
 * list of them is arranged.
 *
 * Shared between the website and the native guard app. The catalogue of
 * delivery types matters more than it looks: the `value` strings are
 * written into delivery_visits.delivery_type, so two apps offering
 * different lists would produce rows the other cannot label. The
 * validation matters for a plainer reason — a delivery registered
 * without a flat number notifies nobody, and the guard finds out only
 * when the agent is still standing there ten minutes later.
 */

export interface DeliveryType {
  value: string;
  label: string;
  icon: string;
}

export const DELIVERY_TYPES: DeliveryType[] = [
  { value: "amazon", label: "Amazon", icon: "📦" },
  { value: "flipkart", label: "Flipkart", icon: "🛒" },
  { value: "zomato", label: "Zomato", icon: "🍕" },
  { value: "swiggy", label: "Swiggy", icon: "🛵" },
  { value: "blinkit", label: "Blinkit", icon: "⚡" },
  { value: "zepto", label: "Zepto", icon: "🟣" },
  { value: "milk", label: "Milk Delivery", icon: "🥛" },
  { value: "grocery", label: "Grocery", icon: "🛍️" },
  { value: "courier", label: "Courier / Parcel", icon: "📮" },
  { value: "other", label: "Other", icon: "📬" },
];

const FALLBACK_ICON = "📬";

/** The icon for a stored delivery_type, including one this build does not know. */
export const deliveryIcon = (value: string): string =>
  DELIVERY_TYPES.find((t) => t.value === value)?.icon ?? FALLBACK_ICON;

/**
 * The label for a stored delivery_type.
 *
 * Falls back to the raw value rather than "Unknown", so a type added to
 * the database before an app is updated still reads as itself.
 */
export const deliveryLabel = (value: string): string =>
  DELIVERY_TYPES.find((t) => t.value === value)?.label ?? value;

export type DeliveryStatus =
  | "pending_approval" | "approved" | "rejected" | "completed" | "expired";

export type StatusTone = "waiting" | "good" | "bad" | "done";

/**
 * Status wording, written from the guard's point of view.
 *
 * "Approved — let in" rather than "Approved", because the guard's
 * question is never what the status is, it is what to do with the
 * person in front of them.
 */
export const STATUS_DISPLAY: Record<DeliveryStatus, { label: string; tone: StatusTone }> = {
  pending_approval: { label: "Awaiting approval", tone: "waiting" },
  approved: { label: "Approved — let in", tone: "good" },
  rejected: { label: "Rejected by resident", tone: "bad" },
  completed: { label: "Exited", tone: "done" },
  expired: { label: "Expired", tone: "done" },
};

export const statusDisplay = (status: string): { label: string; tone: StatusTone } =>
  STATUS_DISPLAY[status as DeliveryStatus] ?? { label: status, tone: "done" };

export interface DeliveryVisit {
  id: string;
  mobile: string;
  photo_base64: string | null;
  delivery_type: string;
  agent_name: string | null;
  wing: string;
  flat_number: string;
  status: string;
  entry_time: string;
  exit_time: string | null;
  expires_at: string;
}

export interface DeliveryDraft {
  mobile: string;
  agent_name: string;
  delivery_type: string;
  photo_base64: string;
  wing: string;
  flat_number: string;
}

export const emptyDraft = (): DeliveryDraft => ({
  mobile: "", agent_name: "", delivery_type: "", photo_base64: "", wing: "", flat_number: "",
});

/** Digits only, capped at ten. Indian mobile numbers, typed in a hurry. */
export const normalizeMobile = (raw: string): string =>
  raw.replace(/\D/g, "").slice(0, 10);

/**
 * The first thing wrong with a draft, or null if it is ready to save.
 *
 * Returns ONE message rather than a list: the guard fixes one field,
 * taps Register again, and is told the next thing. A wall of red on a
 * phone at a gate gets read as "broken" and abandoned.
 *
 * Checked in the order the form presents them, so the message always
 * points at or below where the guard is looking.
 */
export const validateDraft = (draft: DeliveryDraft): string | null => {
  const mobile = normalizeMobile(draft.mobile);
  if (!mobile) return "Enter the agent's mobile number.";
  // Ten digits, because this number is what the resident sees and what
  // anyone would call if the parcel goes missing. A partial number is
  // worse than none: it looks answered.
  if (mobile.length < 10) return "The mobile number needs 10 digits.";
  if (!draft.delivery_type) return "Choose what is being delivered.";
  if (!draft.wing || !draft.flat_number) return "Choose the flat it is going to.";
  return null;
};

/** The row to insert, from a validated draft. Trimmed, with blanks as null. */
export const draftToRow = (draft: DeliveryDraft) => ({
  mobile: normalizeMobile(draft.mobile),
  agent_name: draft.agent_name.trim() || null,
  delivery_type: draft.delivery_type,
  photo_base64: draft.photo_base64 || null,
  wing: draft.wing,
  flat_number: draft.flat_number,
});

/** Whole minutes until a pending visit expires; never negative. */
export const minutesLeft = (expiresAt: string, now: number = Date.now()): number =>
  Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 60000));

/** Matches a visit against the guard's search box. Empty query matches all. */
export const matchesQuery = (v: DeliveryVisit, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    v.mobile.includes(q) ||
    (v.agent_name ?? "").toLowerCase().includes(q) ||
    v.flat_number.toLowerCase().includes(q) ||
    v.wing.toLowerCase().includes(q) ||
    v.delivery_type.toLowerCase().includes(q) ||
    deliveryLabel(v.delivery_type).toLowerCase().includes(q)
  );
};

export interface DeliveryGroups {
  pending: DeliveryVisit[];
  approved: DeliveryVisit[];
  rejected: DeliveryVisit[];
  total: number;
}

/**
 * Split the list into the three sections a guard reads, in the order
 * they need them: who is waiting on a resident, who may be let in, and
 * who was refused.
 */
export const groupVisits = (visits: DeliveryVisit[], query = ""): DeliveryGroups => {
  const filtered = visits.filter((v) => matchesQuery(v, query));
  return {
    pending: filtered.filter((v) => v.status === "pending_approval"),
    approved: filtered.filter((v) => v.status === "approved"),
    rejected: filtered.filter((v) => v.status === "rejected"),
    total: filtered.length,
  };
};
