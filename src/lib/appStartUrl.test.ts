import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_DOMAIN } from "./app-url";

/**
 * The URL each Android and iOS shell opens must be a route this app
 * actually serves.
 *
 * THE BUG THIS EXISTS TO PREVENT
 * Both apps were shipped opening /login/society?role=resident|guard.
 * That route was then deleted — login stopped asking which society you
 * belong to, because the picker published every society on the platform
 * — and the apps became dead on launch: install, tap, land on a page
 * that no longer exists. The config was corrected the same day, but
 * anybody running an older build stayed broken, and nothing in the repo
 * would have caught the mismatch in the first place.
 *
 * The release workflow does assert the start URL, but only against an
 * EXPECTED_URL hardcoded in the workflow itself. Delete the /resident
 * route again and the config, the workflow and the app would all three
 * agree with each other while pointing at a 404. This test is the
 * missing side of that triangle: it compares the shells against
 * src/App.tsx, which is the only real authority on what routes exist.
 *
 * Pure file reading, no build, no device.
 */

// vitest runs from the project root; import.meta.url is not a usable
// filesystem path under this config. Same approach as app-url.test.ts.
const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

/** Every path= in App.tsx, minus the catch-all. */
function declaredRoutes(): string[] {
  const src = read("src", "App.tsx");
  return [...src.matchAll(/path="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((p) => p !== "*");
}

/** Does any declared route match this pathname? ":param" matches a segment. */
function routeExists(pathname: string, routes: string[]): boolean {
  return routes.some((route) => {
    const pattern = "^" +
      route.split("/").map((seg) => (seg.startsWith(":") ? "[^/]+" : seg
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/") +
      "/?$";
    return new RegExp(pattern).test(pathname);
  });
}

const SHELLS = [
  { role: "resident", dir: "mobile-resident" },
  { role: "guard", dir: "mobile-guard" },
] as const;

describe.each(SHELLS)("the $role app's start URL", ({ role, dir }) => {
  const config = read(dir, "capacitor.config.ts");
  const match = config.match(/url:\s*'([^']+)'/);

  it("is declared in capacitor.config.ts", () => {
    expect(match, `no server.url found in ${dir}/capacitor.config.ts`).not.toBeNull();
  });

  const url = new URL(match![1]);

  it("points at the live domain", () => {
    // Catches a half-finished domain move, which is how the retired
    // domain survived in these two files for three weeks after the
    // rename. Compared against APP_DOMAIN rather than a literal, so
    // the next move updates one constant.
    //
    // (The retired name is deliberately not written out here: a
    // separate guard in app-url.test.ts fails if it appears anywhere
    // under src/, and weakening that guard to let a comment through
    // would be the wrong trade.)
    expect(url.hostname).toBe(APP_DOMAIN);
  });

  it("opens a route that exists in App.tsx", () => {
    const routes = declaredRoutes();
    expect(routes.length).toBeGreaterThan(5);
    expect(
      routeExists(url.pathname, routes),
      `${dir} opens ${url.pathname}, which matches no route in src/App.tsx. ` +
      `Either fix the shell's server.url or restore the route. Declared: ${routes.join(", ")}`,
    ).toBe(true);
  });

  it("opens this role's own login page", () => {
    // A shell pointing at the other role's login, or at the generic
    // /login picker, would still pass the route check above.
    expect(url.pathname).toBe(`/${role}`);
  });

  it("is https, since the shell forbids cleartext", () => {
    expect(url.protocol).toBe("https:");
    expect(config).toMatch(/cleartext:\s*false/);
  });

  it("carries the utm tags the analytics expect", () => {
    expect(url.searchParams.get("utm_source")).toBe("android_app");
    expect(url.searchParams.get("utm_medium")).toBe("app");
  });
});

describe("there is one source of truth per shell", () => {
  it("no hand-made capacitor.config.json sits beside the .ts", () => {
    // Each app used to carry both, kept in step by hand. cap sync reads
    // the .ts and nothing in CI ever read the .json, so it was a second
    // copy of the start URL that could drift silently — and the start
    // URL drifting is the exact failure above.
    for (const { dir } of SHELLS) {
      let exists = true;
      try {
        read(dir, "capacitor.config.json");
      } catch {
        exists = false;
      }
      expect(exists, `${dir}/capacitor.config.json is back; cap sync reads the .ts`).toBe(false);
    }
  });
});
