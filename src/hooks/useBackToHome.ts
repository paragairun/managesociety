import { useEffect, useRef } from "react";

/**
 * Makes the Back button return to a dashboard's Home tab instead of
 * leaving the dashboard.
 *
 * THE PROBLEM
 * All three dashboards are a single route with an internal `activeView`
 * string. Switching tabs changes React state and nothing else, so the
 * browser's history still holds exactly one entry for the whole
 * session. Pressing Back from the seventh tab therefore does what Back
 * always does on a single-entry page: it leaves. In the Android shell
 * that means the app closes, from a screen the user reached by tapping
 * around inside it — which reads as the app crashing.
 *
 * HOW IT WORKS
 * The first time the user leaves Home, one history entry is pushed.
 * That entry is a decoy: it changes no URL and carries no meaning other
 * than giving the next Back press something to consume. When Back pops
 * it, this hook sends the user to Home instead of letting the page
 * unload, and disarms itself. Leaving Home again pushes a fresh decoy.
 *
 * So Back behaves like this:
 *   any tab  ->  Home
 *   Home     ->  leaves the dashboard, as it should
 *
 * WHY EXACTLY ONE ENTRY
 * Pushing one per tab change would pile up decoys, and a user who
 * visited five tabs would then need five Back presses to get out of
 * Home. Arming on the first departure keeps the history depth at one
 * however long they browse.
 *
 * NOTE ON REACT ROUTER
 * This calls history.pushState directly rather than going through the
 * router. The decoy keeps the same URL, so the router's location never
 * changes and it has nothing to re-render; the entry exists purely to
 * be popped. The alternative — making every tab its own route — is the
 * better long-term design and a much larger change than a back button
 * warrants.
 *
 * The hardware Back button in a Capacitor WebView maps to
 * history.back(), so the native apps and the website are both covered
 * by this one mechanism.
 */
export function useBackToHome(
  activeView: string,
  setActiveView: (view: string) => void,
  homeView = "home",
) {
  // Read inside the popstate listener without making the listener
  // depend on it — re-subscribing on every tab change would risk
  // missing a press mid-swap.
  const viewRef = useRef(activeView);
  viewRef.current = activeView;

  const armed = useRef(false);

  useEffect(() => {
    if (activeView !== homeView && !armed.current) {
      window.history.pushState({ dashboardTabGuard: true }, "");
      armed.current = true;
    }
  }, [activeView, homeView]);

  useEffect(() => {
    const onPop = () => {
      // Whatever was popped, our decoy is gone now.
      const wasArmed = armed.current;
      armed.current = false;

      // Only intercept when there was a decoy to consume AND the user
      // is somewhere other than Home. Without the `wasArmed` test a
      // Back press on Home would be swallowed and the user could never
      // leave the dashboard at all.
      if (wasArmed && viewRef.current !== homeView) {
        setActiveView(homeView);
      }
    };

    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [homeView, setActiveView]);
}
