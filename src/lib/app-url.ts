// Canonical app URL used for auth email redirects (password reset, signup confirmation).
// Hard-coded to the live custom domain so emails always send users to the production site,
// regardless of whether the link was triggered from a preview, a GitHub Pages URL, or localhost.
//
// IMPORTANT: whatever value is used here must also be listed under
// Supabase Dashboard -> Authentication -> URL Configuration -> Redirect URLs
// (i.e. https://managesociety.in/**). If it is not allow-listed, Supabase
// silently ignores `redirectTo` and falls back to the project's Site URL.
//
// That is precisely what went wrong: this was still set to the old
// visitorpasses.in domain after the move, so every password-reset mail
// asked Supabase to redirect to a host that is no longer allow-listed,
// Supabase discarded the request without erroring, and the link in the
// email came through as redirect_to=https://managesociety.in/ — the
// Site URL — dropping /reset-password.
//
// Changing this value alone is not enough. The new domain has to be in
// that Redirect URLs list, or the same silent fallback happens again.
// The domain move left the old name scattered across a dozen files —
// ID cards, the privacy policy, the super-admin links, a marketing
// page and a transactional email — and each one drifted on its own.
// Everything that names the product or its domain now reads from here.
export const APP_DOMAIN = "managesociety.in";
export const APP_NAME = "ManageSociety";
export const APP_URL = `https://${APP_DOMAIN}`;

// Shown to users as the contact address in the privacy policy, and
// used as the sender for transactional mail. The Edge Function keeps
// its own copy because it runs on Deno and cannot import from src/ —
// see supabase/functions/notify-registration-request/index.ts.
export const SUPPORT_EMAIL = `noreply@${APP_DOMAIN}`;

export const appUrl = (path: string = "") => {
  const suffix = path.startsWith("/") ? path : path ? `/${path}` : "";
  return `${APP_URL}${suffix}`;
};
