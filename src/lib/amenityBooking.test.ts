import { describe, it, expect } from "vitest";
import {
  todayISO, minutesOfDay, shortTime, validateBooking,
  bookingState, canCancel, emptyBookingDraft,
  type Amenity, type BookingDraft,
} from "./amenityBooking";

const court: Amenity = {
  id: "a1",
  name: "Tennis court",
  operating_hours_start: "06:00:00",
  operating_hours_end: "22:00:00",
  max_booking_hours: 2,
};

const NOW = new Date("2026-04-15T10:30:00+05:30");

const draft = (over: Partial<BookingDraft> = {}): BookingDraft => ({
  amenityId: "a1",
  flatId: "f1",
  date: "2026-04-16",
  start_time: "18:00",
  end_time: "19:00",
  notes: "",
  ...over,
});

describe("todayISO", () => {
  it("uses the local date, not UTC", () => {
    // At 1am in Calcutta it is still yesterday in UTC. toISOString()
    // would offer the resident a date that has already passed.
    const earlyMorning = new Date("2026-04-15T01:00:00+05:30");
    expect(todayISO(earlyMorning)).toBe("2026-04-15");
  });

  it("pads single-digit months and days", () => {
    expect(todayISO(new Date("2026-01-05T12:00:00+05:30"))).toBe("2026-01-05");
  });
});

describe("minutesOfDay", () => {
  it("reads both the Postgres and the form shape", () => {
    expect(minutesOfDay("06:00:00")).toBe(360);
    expect(minutesOfDay("06:00")).toBe(360);
    expect(minutesOfDay("18:30")).toBe(1110);
    expect(minutesOfDay("00:00")).toBe(0);
  });

  it("returns null for anything unreadable", () => {
    expect(minutesOfDay("")).toBeNull();
    expect(minutesOfDay("nonsense")).toBeNull();
    expect(minutesOfDay("25:00")).toBeNull();
    expect(minutesOfDay("10:75")).toBeNull();
  });

  it("shortens a Postgres time for display", () => {
    expect(shortTime("06:00:00")).toBe("06:00");
  });
});

describe("validating a booking", () => {
  it("accepts a good one", () => {
    expect(validateBooking(draft(), court, NOW)).toBeNull();
  });

  it("asks for the missing piece, in form order", () => {
    expect(validateBooking(draft(), undefined, NOW)).toBe("Choose what you want to book.");
    expect(validateBooking(draft({ flatId: "" }), court, NOW)).toBe("Choose which flat this is for.");
    expect(validateBooking(draft({ date: "" }), court, NOW)).toBe("Choose a date.");
    expect(validateBooking(draft({ start_time: "" }), court, NOW)).toBe("Choose a start and end time.");
  });

  it("refuses a date that has passed", () => {
    expect(validateBooking(draft({ date: "2026-04-14" }), court, NOW))
      .toBe("That date has already passed.");
  });

  it("allows today", () => {
    // A resident booking the court for this evening is the common case.
    expect(validateBooking(draft({ date: "2026-04-15" }), court, NOW)).toBeNull();
  });

  it("refuses an end before or equal to the start", () => {
    expect(validateBooking(draft({ start_time: "19:00", end_time: "18:00" }), court, NOW))
      .toBe("The end time has to be after the start time.");
    expect(validateBooking(draft({ start_time: "18:00", end_time: "18:00" }), court, NOW))
      .toBe("The end time has to be after the start time.");
  });

  it("enforces the amenity's cap, and says what it is", () => {
    expect(validateBooking(draft({ start_time: "18:00", end_time: "21:00" }), court, NOW))
      .toBe("Tennis court can be booked for up to 2 hours at a time.");
  });

  it("gets the plural right for a one-hour cap", () => {
    expect(validateBooking(
      draft({ start_time: "18:00", end_time: "20:00" }),
      { ...court, max_booking_hours: 1 }, NOW,
    )).toBe("Tennis court can be booked for up to 1 hour at a time.");
  });

  it("allows exactly the cap", () => {
    expect(validateBooking(draft({ start_time: "18:00", end_time: "20:00" }), court, NOW)).toBeNull();
  });

  it("keeps the booking inside opening hours, and says what they are", () => {
    expect(validateBooking(draft({ start_time: "05:00", end_time: "06:30" }), court, NOW))
      .toBe("Tennis court is open 06:00 to 22:00.");
    expect(validateBooking(draft({ start_time: "21:30", end_time: "22:30" }), court, NOW))
      .toBe("Tennis court is open 06:00 to 22:00.");
  });

  it("allows a booking flush against opening and closing", () => {
    expect(validateBooking(draft({ start_time: "06:00", end_time: "08:00" }), court, NOW)).toBeNull();
    expect(validateBooking(draft({ start_time: "20:00", end_time: "22:00" }), court, NOW)).toBeNull();
  });

  it("rejects an unreadable time rather than letting it through", () => {
    expect(validateBooking(draft({ start_time: "nonsense" }), court, NOW))
      .toBe("Those times do not look right.");
  });

  it("does not require notes", () => {
    expect(validateBooking(draft({ notes: "" }), court, NOW)).toBeNull();
  });
});

describe("an empty draft", () => {
  it("starts on today and carries the flat", () => {
    const d = emptyBookingDraft("f1", NOW);
    expect(d.date).toBe("2026-04-15");
    expect(d.flatId).toBe("f1");
    expect(d.amenityId).toBe("");
  });
});

describe("booking status", () => {
  it("names each state", () => {
    expect(bookingState("pending_approval")).toEqual({ label: "Waiting for approval", tone: "waiting" });
    expect(bookingState("approved").tone).toBe("good");
    expect(bookingState("rejected").tone).toBe("bad");
    expect(bookingState("completed").tone).toBe("done");
  });

  it("renders an unknown status rather than nothing", () => {
    expect(bookingState("expired")).toEqual({ label: "expired", tone: "done" });
  });

  it("allows cancelling only something still ahead", () => {
    expect(canCancel("pending_approval")).toBe(true);
    expect(canCancel("approved")).toBe(true);
    // History, not a plan.
    expect(canCancel("completed")).toBe(false);
    expect(canCancel("rejected")).toBe(false);
    expect(canCancel("cancelled")).toBe(false);
  });
});
