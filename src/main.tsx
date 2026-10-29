import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ThemeProvider } from "./components/ThemeProvider";
import { startPushTapCapture } from "@/lib/pushTarget";

// Started BEFORE React renders, deliberately.
//
// When a notification tap launches a closed app, the plugin fires its
// action event within milliseconds — long before auth resolves and a
// dashboard mounts. A listener registered inside a dashboard is far too
// late and the deep link is simply lost, which is why tapping a
// delivery notification used to drop the resident on Home. This is the
// earliest point in the app's life at which a listener can exist.
//
// Not awaited: the app must boot regardless, and the listener only has
// to be in place before the event arrives, not before this line
// returns. A no-op in a browser tab.
void startPushTapCapture();

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
);
