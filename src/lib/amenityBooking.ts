/**
 * Booking an amenity: what makes a request valid before it is sent.
 *
 * Every rule here is also enforced in the database, and that is the
 * point of checking them twice. A resident who picks a two-hour slot on
 * a court capped at one should be told while they are still looking at
 * the form, not by a toast after a round trip — and the two apps must
 * tell them the same thing, in the same words.
 */

export interface Amenity {
  id: string;
  name: string;
  /** "HH:MM:SS" as Postgres time columns come back. */
  operating_hours_start: string;
  operating_hours_end: string;
  max_booking_hours: number;
}

export interface BookingDraft {
  amenityId: string;
  flatId: string;
  /** "YYYY-MM-DD". */
  date: string;
  /** "HH:MM". */
  start_time: string;
  end_time: string;
  notes: string;
}

export const todayISO = (now: Date = new Date()): string => {
  // Built from local parts rather than toISOString(), which converts to
  // UTC first: at 1am in Calcutta that is still yesterday in UTC, and a
  // resident would be offered a date that has already passed.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

export const emptyBookingDraft = (flatId: string, now: Date = new Date()): BookingDraft => ({
  amenityId: "", flatId, date: todayISO(now), start_time: "", end_time: "", notes: "",
});

/** "HH:MM:SS" or "HH:MM" to minutes since midnight; null if unreadable. */
export function minutesOfDay(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** "HH:MM:SS" to "HH:MM", for display next to a form. */
export const shortTime = (time: string): string => (time ?? "").slice(0, 5);

/**
 * The first thing wrong with a booking, or null if it is ready.
 *
 * One message at a time, in form order, as everywhere else in these
 * apps.
 */
export function validateBooking(
  draft: BookingDraft,
  amenity: Amenity | undefined,
  now: Date = new Date(),
): string | null {
  if (!amenity) return "Choose what you want to book.";
  if (!draft.flatId) return "Choose which flat this is for.";
  if (!draft.date) return "Choose a date.";

  // Yesterday cannot be booked. Compared as date STRINGS, both built
  // from local parts, so this cannot disagree with itself across a
  // timezone the way a Date comparison would.
  if (draft.date < todayISO(now)) return "That date has already passed.";

  if (!draft.start_time || !draft.end_time) return "Choose a start and end time.";

  const start = minutesOfDay(draft.start_time);
  const end = minutesOfDay(draft.end_time);
  if (start === null || end === null) return "Those times do not look right.";
  if (end <= start) return "The end time has to be after the start time.";

  const hours = (end - start) / 60;
  if (hours > amenity.max_booking_hours) {
    return `${amenity.name} can be booked for up to ${amenity.max_booking_hours} ${
      amenity.max_booking_hours === 1 ? "hour" : "hours"
    } at a time.`;
  }

  const open = minutesOfDay(amenity.operating_hours_start);
  const close = minutesOfDay(amenity.operating_hours_end);
  if (open !== null && close !== null && (start < open || end > close)) {
    return `${amenity.name} is open ${shortTime(amenity.operating_hours_start)} to ${shortTime(amenity.operating_hours_end)}.`;
  }

  return null;
}

export type BookingTone = "waiting" | "good" | "bad" | "done";

/** What a booking's status means to the resident. */
export function bookingState(status: string): { label: string; tone: BookingTone } {
  switch (status) {
    case "pending_approval": return { label: "Waiting for approval", tone: "waiting" };
    case "approved": return { label: "Approved", tone: "good" };
    case "rejected": return { label: "Rejected", tone: "bad" };
    case "cancelled": return { label: "Cancelled", tone: "done" };
    case "completed": return { label: "Done", tone: "done" };
    default: return { label: status, tone: "done" };
  }
}

/**
 * True when the resident can still call a booking off.
 *
 * Only something still ahead of them: a booking that has been used, or
 * already refused, is history rather than a plan.
 */
export function canCancel(status: string): boolean {
  return status === "pending_approval" || status === "approved";
}
