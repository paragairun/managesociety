/**
 * The society's public visitor form, and what the guard can do with a
 * visitor who has no pass.
 *
 * Two routes in, and a guard at a gate needs both within one tap:
 *
 *   PRE-APPROVED — the resident made a guest pass in advance and the
 *   visitor has the QR. The guard scans it and the barrier opens.
 *
 *   IMPROMPTU — somebody has simply turned up. There is no pass to
 *   scan, so their details are taken on the society's visitor form and
 *   the resident is asked from there.
 *
 * The form lives on the website rather than in the app on purpose: it
 * is the same form a visitor can be sent a link to and fill in
 * themselves while walking up, and keeping one copy means the fields
 * cannot drift between the two.
 */

export const SITE_ORIGIN = "https://managesociety.in";

/**
 * Where this society's visitor form lives.
 *
 * Per society, because the URL carries the slug —
 * /triumph-towers-chsl/visitor/form. Returns null when the society has
 * no slug yet, which is a real state for one still being set up: the
 * caller shows the scan option alone rather than a link that 404s.
 */
export function visitorFormUrl(societySlug: string | null | undefined): string | null {
  const slug = (societySlug ?? "").trim();
  if (!slug) return null;
  // Slugs come from the database, but this builds a URL a guard's phone
  // will open, so anything that could escape the path is refused rather
  // than encoded — a slug with a slash in it is a bug upstream, not
  // something to paper over.
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) return null;
  return `${SITE_ORIGIN}/${slug}/visitor/form`;
}

export type GateAction = "scan" | "visitor_form";

export interface GateActionSpec {
  id: GateAction;
  title: string;
  /** One line under the title, saying when to use it. */
  subtitle: string;
}

/**
 * What the guard is offered when somebody arrives on foot or by car
 * without a delivery.
 *
 * On a society using RFID boom barriers nobody scans anything, so the
 * scan option is withheld entirely rather than shown and failing. A
 * dead button at a gate is worse than a missing one: the guard tries
 * it, waits, and then looks for the thing that works.
 */
export function gateActions(opts: {
  gateEntryMode: "qr_sticker" | "rfid";
  formUrl: string | null;
}): GateActionSpec[] {
  const actions: GateActionSpec[] = [];

  if (opts.gateEntryMode !== "rfid") {
    actions.push({
      id: "scan",
      title: "Scan a guest pass",
      subtitle: "The resident approved them in advance",
    });
  }

  if (opts.formUrl) {
    actions.push({
      id: "visitor_form",
      title: "Register a visitor",
      subtitle: "Nobody is expecting them — take their details and ask the flat",
    });
  }

  return actions;
}
