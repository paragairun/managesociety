/**
 * The resident app's theme: the shared ManageSociety palette, at phone
 * size.
 *
 * Colours come from @core/brand, which converts the website's own
 * tokens in src/index.css — amber on deep navy, the same as the
 * launcher icon. Defining colours here is what let the guard app drift
 * to a blue that was in neither.
 *
 * Sizing differs from the guard app on purpose. That device lives at a
 * gate: outdoors, in sun, read at arm's length. A resident holds their
 * own phone indoors and usually for one small errand — approve the
 * delivery, pull up a guest pass, check what is owed — so the scale is
 * ordinary and the screen fits more, which matters when a flat has four
 * vehicles and a page of dues.
 *
 * TOUCH_URGENT is the exception: the approve/reject pair for a delivery
 * gets the gate's size, because somebody is standing there waiting on
 * it and a mis-tap turns an agent away.
 */
import { palette, space, radius, typeScale, touch } from "@core/brand";

export const colors = palette;
export { space, radius };

export const type = typeScale.phone;

export const TOUCH = touch.phone;
export const TOUCH_URGENT = touch.urgent;
