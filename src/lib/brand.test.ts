import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { palette, space, radius, typeScale, touch } from "./brand";

/**
 * These tests read src/index.css and check the converted values still
 * match the website's tokens. The palette is a hand-conversion of HSL
 * to hex, and a hand-conversion is exactly the kind of thing that goes
 * stale silently when somebody retunes the brand on the website.
 */

// Resolved from the repo root rather than import.meta.url: vitest runs
// this through a transform whose module URL is not a file: URL.
const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

/**
 * Pull a token out of the DEFAULT (light) block.
 *
 * Sliced at `.dark` so a token defined in both blocks resolves to the
 * light one — the apps are light by default, matching the website.
 */
function lightToken(name: string): string {
  const light = css.slice(0, css.indexOf(".dark"));
  const m = light.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
  if (!m) throw new Error(`No --${name} in the default block of index.css`);
  return `${m[1]} ${m[2]} ${m[3]}`;
}

function hslToHex(spec: string): string {
  const [h, s, l] = spec.split(/\s+/).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, "0").toUpperCase();
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

describe("the palette matches the website's light tokens", () => {
  const pairs: [keyof typeof palette, string][] = [
    ["background", "background"],
    ["surface", "card"],
    ["surfaceRaised", "secondary"],
    ["muted", "muted"],
    ["border", "border"],
    ["text", "foreground"],
    ["brand", "primary"],
    ["accent", "accent"],
    ["success", "success"],
    ["warning", "warning"],
    ["danger", "destructive"],
  ];

  /**
   * Compared with a one-step tolerance per channel, not exactly.
   *
   * Not slack for its own sake: --foreground (230 25% 12%) converts to
   * a green channel of exactly 25.5, and whether that lands on 25 or 26
   * depends on whether the arithmetic happens to produce 0.1 or
   * 0.09999999999999999. Both answers are the same colour, and a test
   * that fails on which side of a float a value fell would be noise.
   * A real brand change moves a channel by far more than one step.
   */
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  for (const [key, token] of pairs) {
    it(`${key} is --${token}`, () => {
      const got = channels(palette[key]);
      const want = channels(hslToHex(lightToken(token)));
      for (let i = 0; i < 3; i += 1) {
        expect(Math.abs(got[i] - want[i])).toBeLessThanOrEqual(1);
      }
    });
  }
});

describe("the brand is amber, not blue", () => {
  it("has a warm brand colour", () => {
    // The specific regression this guards: an earlier native theme used
    // #06ACEA, a blue that appears neither in index.css nor in the
    // launcher icon.
    const [r, , b] = [1, 3, 5].map((i) => parseInt(palette.brand.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(b);
    expect(palette.brand.toUpperCase()).not.toBe("#06ACEA");
  });

  it("puts dark text on the brand colour, not white", () => {
    // The website's --primary-foreground is white, which on #F59300 is
    // 2.32:1 and fails every threshold. This is the one place the apps
    // deliberately diverge from the token, and the launcher icon agrees
    // with the apps: navy artwork on amber.
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };

    expect(contrast(palette.brand, palette.onBrand)).toBeGreaterThan(4.5);
    expect(contrast(palette.brand, "#FFFFFF")).toBeLessThan(4.5);
  });

  it("keeps body text readable on every surface", () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };

    for (const bg of [palette.background, palette.surface, palette.surfaceRaised]) {
      expect(contrast(palette.text, bg)).toBeGreaterThan(7);
      // Muted text is secondary, so the bar is the 4.5:1 normal-text one
      // rather than 7:1 — but it is still a bar.
      expect(contrast(palette.textMuted, bg)).toBeGreaterThan(4.5);
    }
  });
});

describe("scales", () => {
  it("sizes the gate a step above the phone", () => {
    // The gate device is read at arm's length, outdoors, in sun.
    for (const k of ["title", "heading", "body", "label", "caption"] as const) {
      expect(typeScale.gate[k]).toBeGreaterThan(typeScale.phone[k]);
    }
    expect(touch.gate).toBeGreaterThan(touch.phone);
  });

  it("keeps every touch target at or above 44", () => {
    for (const v of Object.values(touch)) expect(v).toBeGreaterThanOrEqual(44);
  });

  it("gives an urgent decision the gate's size even on a phone", () => {
    // The resident's approve/reject for an agent standing at the gate.
    expect(touch.urgent).toBe(touch.gate);
  });

  it("has an ascending spacing scale", () => {
    const v = [space.xs, space.sm, space.md, space.lg, space.xl, space.xxl];
    for (let i = 1; i < v.length; i += 1) expect(v[i]).toBeGreaterThan(v[i - 1]);
    expect(radius.sm).toBeLessThan(radius.md);
    expect(radius.pill).toBeGreaterThan(radius.lg);
  });
});
