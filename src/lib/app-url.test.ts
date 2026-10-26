/**
 * The canonical app URL used for auth email redirects.
 *
 * The bug these cover: APP_URL was left pointing at visitorpasses.in
 * after the move to managesociety.in. Supabase only honours a
 * `redirectTo` whose origin is on the project's Redirect URLs list, and
 * it discards a non-matching one SILENTLY — no error, no warning. Every
 * password-reset mail therefore came through pointing at the project's
 * Site URL with the /reset-password path stripped off, and nothing in
 * the app or the logs said why.
 *
 * A stale domain here is invisible at build time, invisible at runtime,
 * and only shows up in a user's inbox. So it is pinned.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { APP_URL, APP_NAME, APP_DOMAIN, SUPPORT_EMAIL, appUrl } from "./app-url";

describe("APP_URL", () => {
  it("points at the live domain", () => {
    expect(APP_URL).toBe("https://managesociety.in");
  });

  it("is not the retired visitorpasses.in domain", () => {
    expect(APP_URL).not.toContain("visitorpasses");
  });

  it("has no trailing slash, so appUrl() cannot produce a double slash", () => {
    expect(APP_URL.endsWith("/")).toBe(false);
  });

  it("is https, since Supabase rejects a plain-http redirect target", () => {
    expect(APP_URL.startsWith("https://")).toBe(true);
  });
});

describe("appUrl", () => {
  it("builds the password-reset target the auth mail depends on", () => {
    expect(appUrl("/reset-password")).toBe("https://managesociety.in/reset-password");
  });

  it("adds the missing leading slash", () => {
    expect(appUrl("reset-password")).toBe("https://managesociety.in/reset-password");
  });

  it("returns the bare origin when given nothing", () => {
    expect(appUrl()).toBe("https://managesociety.in");
    expect(appUrl("")).toBe("https://managesociety.in");
  });

  it("never emits a double slash after the origin", () => {
    for (const p of ["/reset-password", "reset-password", "", "/"]) {
      expect(appUrl(p).replace("https://", "")).not.toContain("//");
    }
  });
});

describe("the other identity constants", () => {
  it("names the product and its domain", () => {
    expect(APP_NAME).toBe("ManageSociety");
    expect(APP_DOMAIN).toBe("managesociety.in");
  });

  it("derives APP_URL and SUPPORT_EMAIL from the domain, so they cannot disagree", () => {
    expect(APP_URL).toBe(`https://${APP_DOMAIN}`);
    expect(SUPPORT_EMAIL).toBe(`noreply@${APP_DOMAIN}`);
  });

  it("carries no bare domain in APP_DOMAIN — scheme and path belong to appUrl()", () => {
    expect(APP_DOMAIN).not.toContain("://");
    expect(APP_DOMAIN).not.toContain("/");
  });
});

describe("no file hard-codes the retired domain or brand", () => {
  // The real protection. Every one of these drifted independently once
  // — ID cards, the privacy policy, a marketing page, the super-admin
  // links and a transactional email — because each held its own copy.
  // A constant only helps while nobody types the literal again, and
  // nothing else in the pipeline would notice if they did: it compiles,
  // it renders, and it is only wrong in a user's inbox or on a printed
  // card.
  // vitest runs from the project root, so resolve from there rather
  // than from import.meta.url, which does not give a usable filesystem
  // path under the vite transform pipeline.
  const SRC = join(process.cwd(), "src");
  const EXEMPT = ["app-url.ts", "app-url.test.ts"];

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry) && !EXEMPT.includes(entry)) out.push(full);
    }
    return out;
  }

  it("finds no occurrence anywhere under src/", () => {
    const offenders = walk(SRC)
      .filter((f) => /visitorpasses/i.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length));

    expect(offenders, `hard-coded old domain/brand in: ${offenders.join(", ")}`).toEqual([]);
  });
});
