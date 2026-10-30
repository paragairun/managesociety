/**
 * The guard app's theme: the shared ManageSociety palette, at gate size.
 *
 * Colours come from @core/brand, which converts the website's own
 * tokens in src/index.css — amber on deep navy, the same as the
 * launcher icon. They are NOT defined here, and must not be: this file
 * previously carried a hand-picked blue (#06ACEA) that appeared in
 * neither the website nor the icon, and the app shipped looking like a
 * different product.
 *
 * What IS decided here is sizing, because a gate is a specific and
 * unusual place:
 *   - outdoors, often in direct sun, read at arm's length
 *   - one-handed, by someone standing and in a hurry, frequently at night
 * Hence the `gate` scales: 56px touch targets rather than the 44px
 * minimum, and type a step larger than a phone app would use.
 */
import { palette, space, radius, typeScale, touch } from "@core/brand";

export const colors = palette;
export { space, radius };

export const type = typeScale.gate;

/** Minimum height for anything tappable. Gloves, haste, bad light. */
export const TOUCH = touch.gate;
