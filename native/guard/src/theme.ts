/**
 * Colours and spacing for the guard app.
 *
 * Deliberately a small hand-written token set rather than a port of the
 * website's Tailwind theme. The web theme is ~40 CSS custom properties
 * driving shadcn components that do not exist here, and copying it
 * wholesale would import vocabulary this app never uses while still
 * needing every value translated.
 *
 * The brand blue is the one already baked into the Android launcher
 * icons (ic_launcher_background.xml), so the app, its icon and its
 * splash screen agree.
 *
 * DESIGNED FOR A GATE, which is a specific and unusual place:
 *   - outdoors, often in direct sun, so contrast is high and the
 *     palette avoids mid greys that disappear in glare
 *   - one-handed, at arm's length, frequently at night
 *   - the user is standing, holding something, and in a hurry
 * Hence touch targets at 56px rather than the 44px minimum, and type
 * a step larger than a phone app would normally use.
 */

export const colors = {
  brand: "#06ACEA",
  brandDark: "#0487B8",

  background: "#0F121C",
  surface: "#1A1F2E",
  surfaceRaised: "#232938",
  border: "#2E3547",

  text: "#F5F7FA",
  textMuted: "#9AA4B8",
  textFaint: "#6B7689",

  success: "#22C55E",
  successBg: "#0E2A18",
  warning: "#F5A028",
  warningBg: "#2B1D08",
  danger: "#EF4444",
  dangerBg: "#2B1010",

  onBrand: "#FFFFFF",
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

export const type = {
  // A step up from typical phone sizing: read at arm's length, in sun.
  title: 24,
  heading: 19,
  body: 16,
  label: 14,
  caption: 12,
} as const;

/** Minimum height for anything tappable. Gloves, haste, bad light. */
export const TOUCH = 56;
