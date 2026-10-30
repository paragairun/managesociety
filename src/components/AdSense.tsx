import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { ADSENSE_SRC, shouldLoadAds } from "@/lib/ads";

const APP_MARKER_KEY = "ms.inApp";

/**
 * Loads the AdSense script, on the pages where it is allowed to be.
 *
 * Injected from JavaScript rather than placed in index.html, which is
 * the whole point: index.html is also what the guard and resident
 * mobile apps load, and AdSense inside an application is prohibited by
 * Google's own programme policies — apps are AdMob's job, and the
 * penalty falls on the account rather than the page. A script tag in
 * the HTML would run before anything could check.
 *
 * Mounted once, near the router. It loads the script at most once per
 * page load and never removes it; AdSense is not designed to be torn
 * down and re-added as somebody navigates.
 */
const AdSense = () => {
  const { pathname, search } = useLocation();

  useEffect(() => {
    // The app marker only appears in the URL the shell starts on. One
    // route change and it is gone, so the first sighting is remembered
    // for the rest of the session.
    try {
      if (/[?&]utm_source=(android_app|ios_app)\b/.test(search)) {
        sessionStorage.setItem(APP_MARKER_KEY, "1");
      }
    } catch {
      // Private browsing, or storage disabled. The other two signals
      // still apply.
    }

    let appMarkerSeen = false;
    try {
      appMarkerSeen = sessionStorage.getItem(APP_MARKER_KEY) === "1";
    } catch { /* as above */ }

    const allowed = shouldLoadAds({
      pathname,
      search,
      userAgent: navigator.userAgent,
      hasCapacitor: typeof (window as { Capacitor?: unknown }).Capacitor !== "undefined",
      appMarkerSeen,
    });

    if (!allowed) return;
    if (document.querySelector(`script[src^="${ADSENSE_SRC.split("?")[0]}"]`)) return;

    const script = document.createElement("script");
    script.src = ADSENSE_SRC;
    script.async = true;
    script.crossOrigin = "anonymous";
    document.head.appendChild(script);
  }, [pathname, search]);

  return null;
};

export default AdSense;
