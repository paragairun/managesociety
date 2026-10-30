import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * WCAG contrast over the website's own design tokens.
 *
 * Every `--x` / `--x-foreground` pair in src/index.css is a promise
 * that the second is readable on the first, and nothing was checking
 * it. In light mode five pairs were failing at once — including
 * --primary-foreground, which is the text on every primary button in
 * the product, at 2.32:1 against a 4.5:1 bar.
 *
 * Caught by hand only because the native apps needed the same colours
 * converted, and converting them meant looking at the numbers. This
 * test means nobody has to look again.
 */

const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

function tokens(mode: "light" | "dark"): Record<string, string> {
  const marker = css.indexOf(".dark");
  const block = mode === "light" ? css.slice(0, marker) : css.slice(marker);
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g)) {
    out[m[1]] = `${m[2]} ${m[3]} ${m[4]}`;
  }
  return out;
}

function luminance(spec: string): number {
  const [h, s, l] = spec.split(/\s+/).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every pair where the second is drawn on top of the first. */
const PAIRS: [string, string][] = [
  ["background", "foreground"],
  ["card", "card-foreground"],
  ["popover", "popover-foreground"],
  ["primary", "primary-foreground"],
  ["secondary", "secondary-foreground"],
  ["muted", "muted-foreground"],
  ["accent", "accent-foreground"],
  ["destructive", "destructive-foreground"],
  ["success", "success-foreground"],
  ["warning", "warning-foreground"],
  ["sidebar-background", "sidebar-foreground"],
  ["sidebar-primary", "sidebar-primary-foreground"],
  ["sidebar-accent", "sidebar-accent-foreground"],
];

describe.each(["light", "dark"] as const)("%s theme", (mode) => {
  const t = tokens(mode);

  it("defines every token the pairs reference", () => {
    for (const [bg, fg] of PAIRS) {
      expect(t[bg], `--${bg} missing from the ${mode} block`).toBeTruthy();
      expect(t[fg], `--${fg} missing from the ${mode} block`).toBeTruthy();
    }
  });

  it.each(PAIRS)("--%s / --%s clears 4.5:1", (bg, fg) => {
    // 4.5:1 is the AA bar for normal-size text. These pairs land on
    // buttons, badges and cards at ordinary weights, so the large-text
    // 3:1 allowance does not apply to them.
    expect(contrast(t[bg], t[fg])).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps muted text readable on every surface it sits on", () => {
    // --muted-foreground is used far beyond --muted: it is the
    // secondary text on cards, list rows and the page itself. Checking
    // it only against --muted is how it ended up at 3.79:1 on
    // --secondary.
    for (const surface of ["background", "card", "secondary", "muted"]) {
      expect(
        contrast(t[surface], t["muted-foreground"]),
        `--muted-foreground on --${surface}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the focus ring visible against the page", () => {
    // A focus ring is a non-text indicator: 3:1 against what surrounds
    // it, per WCAG 1.4.11.
    expect(contrast(t["background"], t["ring"])).toBeGreaterThanOrEqual(3);
  });

  it("keeps borders distinguishable from their surfaces", () => {
    // Also non-text, but a border at 1.1:1 is decoration rather than a
    // boundary. This is deliberately a low bar — borders are allowed to
    // be subtle, just not invisible.
    expect(contrast(t["card"], t["border"])).toBeGreaterThanOrEqual(1.2);
  });
});
