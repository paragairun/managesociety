import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * A static check over the native apps' styles.
 *
 * On a light theme a status colour can fill a shape, draw a border or
 * be a dot, but it cannot be a letterform: the brand amber is 2.32:1 on
 * white and the success green 2.69:1 on its own tint. The palette
 * carries darker `*Ink` variants for text, and this test enforces the
 * split — because when the apps moved from dark to light, exactly this
 * mistake appeared in eleven places across six files at once, and every
 * one of them looked fine in a diff.
 *
 * It reads the source rather than rendering anything, so it costs
 * nothing and catches the mistake at the point it is written.
 */

const FILL_ONLY = ["brand", "success", "warning", "danger", "accent"];

function tsxFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFilesUnder(full));
    else if (full.endsWith(".tsx") || full.endsWith(".ts")) out.push(full);
  }
  return out;
}

const roots = ["native/guard", "native/resident"]
  .map((d) => resolve(process.cwd(), d))
  .filter(existsSync);

const files = roots.flatMap((r) => [
  ...tsxFilesUnder(join(r, "src")),
  ...(existsSync(join(r, "App.tsx")) ? [join(r, "App.tsx")] : []),
]);

describe("native style usage", () => {
  it("finds the native apps to check", () => {
    // If this fails the whole suite is vacuous, which is worse than a
    // failure: it would pass forever while checking nothing.
    expect(files.length).toBeGreaterThan(0);
  });

  it("never uses a fill colour as text", () => {
    const offences: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, i) => {
        // `color:` but not `backgroundColor:`, `borderColor:`,
        // `tintColor:`, `shadowColor:` and the rest.
        const m = line.match(/(?<![A-Za-z])color:\s*colors\.([A-Za-z]+)/);
        if (!m) return;
        if (FILL_ONLY.includes(m[1])) {
          offences.push(
            `${file.replace(process.cwd() + "/", "")}:${i + 1}  color: colors.${m[1]}  -> use colors.${m[1]}Ink`,
          );
        }
      });
    }

    expect(offences, `\n${offences.join("\n")}\n`).toEqual([]);
  });

  it("never hardcodes a hex colour outside the theme file", () => {
    // Every colour comes from @core/brand. A literal in a screen is how
    // the guard app ended up shipping a blue that was in neither the
    // website nor the launcher icon.
    const offences: string[] = [];

    for (const file of files) {
      if (file.endsWith("theme.ts")) continue;
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, i) => {
        if (line.trim().startsWith("*") || line.trim().startsWith("//")) return;
        if (/#[0-9A-Fa-f]{6}\b/.test(line) || /\brgba?\(\s*\d+/.test(line)) {
          offences.push(`${file.replace(process.cwd() + "/", "")}:${i + 1}  ${line.trim()}`);
        }
      });
    }

    expect(offences, `\n${offences.join("\n")}\n`).toEqual([]);
  });
});

/**
 * The same split, enforced on the website.
 *
 * Tailwind's `text-primary` resolves to --primary, the FILL colour. In
 * light mode that is 2.32:1 on white; the readable variant is
 * `text-primary-ink`. These were fine while the site defaulted to dark
 * and became wrong the moment light became the default — 278 of them,
 * across 53 files.
 */
describe("website style usage", () => {
  const FILLS = ["primary", "success", "warning", "accent", "destructive"];

  const webFiles = tsxFilesUnder(resolve(process.cwd(), "src"))
    .filter((f) => f.endsWith(".tsx"));

  it("finds the website source", () => {
    expect(webFiles.length).toBeGreaterThan(0);
  });

  it("never colours text with a fill token", () => {
    const offences: string[] = [];
    // `text-<fill>` not followed by -ink or -foreground, in any variant
    // position (hover:, dark:, group-hover: and so on).
    const pattern = new RegExp(
      String.raw`\btext-(${FILLS.join("|")})\b(?!-)`,
      "g",
    );

    for (const file of webFiles) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        for (const m of line.matchAll(pattern)) {
          offences.push(
            `${file.replace(process.cwd() + "/", "")}:${i + 1}  ${m[0]}  -> ${m[0]}-ink`,
          );
        }
      });
    }

    expect(offences, `\n${offences.slice(0, 40).join("\n")}\n`).toEqual([]);
  });

  it("never pairs a fill background with hardcoded white text", () => {
    // White on the amber is 2.32:1 and on the green 2.90:1. The paired
    // --*-foreground token is the colour that belongs there.
    const offences: string[] = [];
    for (const file of webFiles) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        const bg = new RegExp(String.raw`\bbg-(${FILLS.join("|")})\b(?!-)`).test(line);
        if (bg && /\btext-white\b/.test(line)) {
          offences.push(`${file.replace(process.cwd() + "/", "")}:${i + 1}  ${line.trim().slice(0, 100)}`);
        }
      });
    }
    expect(offences, `\n${offences.join("\n")}\n`).toEqual([]);
  });
});
