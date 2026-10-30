import { describe, it, expect } from "vitest";
import { visitorFormUrl, gateActions, SITE_ORIGIN } from "./visitorForm";

describe("the society's visitor form URL", () => {
  it("carries the society's slug", () => {
    expect(visitorFormUrl("triumph-towers-chsl"))
      .toBe(`${SITE_ORIGIN}/triumph-towers-chsl/visitor/form`);
  });

  it("trims surrounding whitespace", () => {
    expect(visitorFormUrl("  triumph  ")).toBe(`${SITE_ORIGIN}/triumph/visitor/form`);
  });

  it("returns null for a society with no slug yet", () => {
    // A real state for one still being set up. The caller then shows
    // the scan option alone rather than a link that 404s.
    expect(visitorFormUrl(null)).toBeNull();
    expect(visitorFormUrl(undefined)).toBeNull();
    expect(visitorFormUrl("   ")).toBeNull();
  });

  it("refuses a slug that could escape the path", () => {
    // This builds a URL a guard's phone will open. A slug with a slash
    // or a scheme in it is a bug upstream, not something to encode and
    // hope about.
    expect(visitorFormUrl("a/../admin")).toBeNull();
    expect(visitorFormUrl("https://evil.example")).toBeNull();
    expect(visitorFormUrl("a b")).toBeNull();
    expect(visitorFormUrl("-leading-dash")).toBeNull();
  });
});

describe("what the guard is offered at the gate", () => {
  const url = `${SITE_ORIGIN}/triumph/visitor/form`;

  it("offers both on a QR society", () => {
    expect(gateActions({ gateEntryMode: "qr_sticker", formUrl: url }).map((a) => a.id))
      .toEqual(["scan", "visitor_form"]);
  });

  it("withholds scanning on an RFID society", () => {
    // Nobody scans anything there. A dead button at a gate is worse
    // than a missing one: the guard tries it, waits, then looks for the
    // thing that works.
    expect(gateActions({ gateEntryMode: "rfid", formUrl: url }).map((a) => a.id))
      .toEqual(["visitor_form"]);
  });

  it("withholds the form when the society has no slug", () => {
    expect(gateActions({ gateEntryMode: "qr_sticker", formUrl: null }).map((a) => a.id))
      .toEqual(["scan"]);
  });

  it("can end up with nothing, and says so by being empty", () => {
    // RFID and no slug. The screen has to cope rather than render an
    // empty space with no explanation.
    expect(gateActions({ gateEntryMode: "rfid", formUrl: null })).toEqual([]);
  });

  it("explains each option, since the difference is the whole point", () => {
    for (const a of gateActions({ gateEntryMode: "qr_sticker", formUrl: url })) {
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.subtitle.length).toBeGreaterThan(10);
    }
  });
});

describe("the scan option and the scan route agree", () => {
  it("offers scanning on exactly the societies where the route exists", () => {
    // The guard app registers the Scan drawer screen only when the mode
    // is not rfid, and VisitorScreen offers the scan button from
    // gateActions. If these two conditions ever diverge, the button
    // navigates to a route that is not registered and the app throws at
    // a gate. Both read the same field, and this pins that.
    const offersScan = (mode: "qr_sticker" | "rfid") =>
      gateActions({ gateEntryMode: mode, formUrl: "https://x/y/visitor/form" })
        .some((a) => a.id === "scan");

    const routeExists = (mode: "qr_sticker" | "rfid") => mode !== "rfid";

    for (const mode of ["qr_sticker", "rfid"] as const) {
      expect(offersScan(mode), mode).toBe(routeExists(mode));
    }
  });
});
