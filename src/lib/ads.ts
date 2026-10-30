/**
 * Where Google AdSense may and may not load.
 *
 * TWO RULES, AND THE FIRST IS NOT A PREFERENCE.
 *
 * 1. NEVER INSIDE THE MOBILE APPS.
 *    The guard and resident apps are WebViews pointed at this same
 *    site — mobile-guard/capacitor.config.ts loads
 *    managesociety.in/guard. A plain <script> tag in index.html would
 *    therefore run AdSense inside an application, which Google's
 *    AdSense programme policies prohibit outright: apps are AdMob's
 *    job. The penalty is the account, not the page. So the script is
 *    injected from JavaScript, after checking, rather than sitting in
 *    the HTML where it would load before anything could stop it.
 *
 * 2. ONLY ON PUBLIC CONTENT PAGES.
 *    The landing page, the article, the privacy policy, the
 *    registration page. Not on a login screen, not on a dashboard, and
 *    not on the visitor form — a guard filling in a visitor's details
 *    at a gate does not need an advertisement next to it, and ads
 *    alongside residents' names, flats and vehicles are a bad idea
 *    quite apart from whether they are permitted.
 *
 * Both are easy to widen later; neither is easy to undo once an
 * account is flagged.
 */

export const ADSENSE_CLIENT = "ca-pub-4511019454368934";
export const ADSENSE_SRC =
  `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;

/**
 * Paths that may carry ads. Exact matches and prefixes both, since the
 * article route is one of several that could grow.
 */
const PUBLIC_CONTENT = [
  "/",
  "/privacy-policy",
  "/register-society",
  "/article",
];

export function isPublicContentPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return PUBLIC_CONTENT.some((p) => path === p || path.startsWith(`${p}/`));
}

export interface AdContext {
  pathname: string;
  /** window.location.search at the time of the check. */
  search: string;
  userAgent: string;
  /** True when the Capacitor bridge is present — i.e. we are in an app. */
  hasCapacitor: boolean;
  /** Set once if the app marker was ever seen, since SPA navigation loses it. */
  appMarkerSeen: boolean;
}

/**
 * True when this page is running inside one of the mobile apps.
 *
 * Three independent signals, because missing one costs the AdSense
 * account and a false positive costs one page view:
 *
 *   - the Capacitor bridge object, injected by the native shell;
 *   - the utm_source=android_app marker the shells append to their
 *     start URL (remembered, because a single-page navigation drops
 *     the query string);
 *   - the "wv" token Android puts in a WebView's user agent.
 */
export function isInApp(ctx: AdContext): boolean {
  if (ctx.hasCapacitor) return true;
  if (ctx.appMarkerSeen) return true;
  if (/[?&]utm_source=(android_app|ios_app)\b/.test(ctx.search)) return true;
  // "; wv)" is the Android WebView marker. Matched loosely because
  // manufacturers vary the surrounding punctuation.
  if (/\bwv\b/.test(ctx.userAgent) && /android/i.test(ctx.userAgent)) return true;
  return false;
}

/** The decision: load AdSense here, or not. */
export function shouldLoadAds(ctx: AdContext): boolean {
  if (isInApp(ctx)) return false;
  return isPublicContentPath(ctx.pathname);
}
