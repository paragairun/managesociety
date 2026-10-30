/**
 * The ManageSociety palette, in hex, for the native apps.
 *
 * SOURCE OF TRUTH: src/index.css. The website defines these as HSL
 * custom properties that Tailwind reads; React Native has neither
 * custom properties nor Tailwind, so the values are converted here
 * once. Each line names the token it came from, so a change on the
 * website can be followed through, and brand.test.ts re-derives them
 * from index.css on every run rather than trusting this file.
 *
 * The brand is AMBER on near-white. That is what --primary has always
 * said and what the launcher icon has always been; an earlier version
 * of the guard app used a blue that appears in neither, which is the
 * mistake this file exists to make impossible to repeat.
 *
 * LIGHT by default, matching the website. The values below come from
 * the default `:root` block, not `.dark`.
 */

export const palette = {
  /** --background: 210 30% 98% */
  background: "#F8FAFB",
  /** --card: 0 0% 100% */
  surface: "#FFFFFF",
  /** --secondary: 220 15% 92% — list rows, chips, inputs. */
  surfaceRaised: "#E8EAEE",
  /** --muted: 220 15% 94% */
  muted: "#EDEFF2",
  /** --border: 220 15% 88% */
  border: "#DCDFE5",

  /** --foreground: 230 25% 12% */
  text: "#171A26",
  /** --muted-foreground: 220 10% 40%. Clears 5:1 on every surface above. */
  textMuted: "#5C6370",
  /**
   * For timestamps and hints only — below the 4.5:1 bar on purpose, so
   * it must never carry information not also stated elsewhere on the
   * screen.
   */
  textFaint: "#8A909C",

  /** --primary: 36 100% 48%. The amber in the launcher icon. */
  brand: "#F59300",
  /** A step darker, for pressed states. */
  brandDark: "#D17E00",

  /**
   * --primary-foreground: 230 25% 12%.
   *
   * This token used to be white, which on the amber is 2.32:1 — a
   * failure on every primary button in the product. The apps diverged
   * from it, then the website was corrected to match, so the two now
   * agree and brand.test.ts checks the pair rather than excusing it.
   * 7.47:1, and the same navy-on-amber the launcher icon uses.
   */
  onBrand: "#171A26",

  /** --accent: 160 60% 40% */
  accent: "#29A37A",
  /** --accent-foreground: 230 25% 12%. White here was 3.17:1. */
  onAccent: "#171A26",

  /** --success: 142 71% 40% */
  success: "#1EAE53",
  /** --success-foreground: 230 25% 12%. White here was 2.90:1. */
  onSuccess: "#171A26",

  /** --warning: 36 100% 48% — the same amber as the brand. */
  warning: "#F59300",

  /** --destructive: 0 72% 51% */
  danger: "#DC2828",
  /**
   * --destructive-foreground: 0 0% 100%. The one status colour white
   * actually works on — 4.80:1, against 3.61:1 for the dark foreground
   * — so this one stayed white when the others were corrected.
   */
  onDanger: "#FFFFFF",

  /**
   * Status tints for filled cards and banners: each status hue at 95%
   * lightness.
   *
   * Text on these is `text`, never the status colour — success on its
   * own tint is 2.69:1. The status is carried by the border and the
   * icon instead, which is also what a colour-blind reader needs, since
   * colour alone was never going to tell them anything.
   */
  successBg: "#EAFAF0",
  warningBg: "#FEF5E7",
  dangerBg: "#FBEAEA",
  brandBg: "#FEF5E7",

  /**
   * The same four hues, darkened until they are legible AS TEXT.
   *
   * On a light theme a status colour can fill a shape or draw a border,
   * but it cannot be type: the amber is 2.32:1 on white and the green
   * 2.69:1 on its own tint, both far below the 4.5:1 bar. Each ink
   * below is its hue at the first lightness that clears 4.5:1 against
   * white, the page background AND its own tint, so one value is safe
   * everywhere the status appears.
   *
   * The rule, then: `brand`/`success`/`warning`/`danger` for fills,
   * borders, dots and bars; `*Ink` whenever the colour is a letterform.
   * Dark themes do not need this distinction, which is why it did not
   * exist before.
   */
  brandInk: "#A36200",
  successInk: "#157E3C",
  warningInk: "#A36200",
  dangerInk: "#CE2222",

  /**
   * A QR code is dark-on-light whatever the theme does. Not themeable:
   * an inverted or tinted code is one that fails at a gate at night.
   */
  qrLight: "#FFFFFF",
  qrDark: "#171A26",

  /**
   * Controls laid over a live camera feed.
   *
   * Also not themeable, and for the same kind of reason as the QR
   * colours: the background here is whatever the camera is pointed at,
   * not a surface this palette controls. A dark scrim with light text
   * is the right pairing over a viewfinder — it stays legible against
   * both a white delivery van in sun and a dark driveway at night, and
   * it does not blind a guard scanning a pass at 2am the way a bright
   * panel would.
   *
   * These exist because switching the apps to a light theme turned the
   * text on both camera overlays near-black on a dark scrim.
   */
  scrim: "rgba(23,26,38,0.85)",
  onScrim: "#F0F2F5",
  scrimBorder: "rgba(240,242,245,0.35)",
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/**
 * Two type scales, because the two apps are used in different places.
 *
 * `gate` is a step larger throughout: that device is outdoors, often in
 * sun, read at arm's length by someone standing and in a hurry.
 * `phone` is ordinary sizing for a resident holding their own phone,
 * and fits more on screen — which matters when a flat has four vehicles
 * and a page of dues.
 */
export const typeScale = {
  gate: { title: 24, heading: 19, body: 16, label: 14, caption: 12 },
  phone: { title: 22, heading: 17, body: 15, label: 13, caption: 11 },
} as const;

/**
 * Minimum height for anything tappable.
 *
 * The gate's 56 is deliberate: gloves, haste, bad light. 48 is the
 * ordinary comfortable minimum, above the 44 floor. `urgent` is for a
 * decision somebody is physically waiting on — the resident's
 * approve/reject for a delivery agent standing at the gate — which gets
 * the gate's size on a resident's phone too.
 */
export const touch = {
  gate: 56,
  phone: 48,
  urgent: 56,
} as const;
