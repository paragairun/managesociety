import { describe, it, expect } from "vitest";
import { isPublicContentPath, isInApp, shouldLoadAds, ADSENSE_SRC, ADSENSE_CLIENT } from "./ads";

const ctx = (over: Partial<Parameters<typeof shouldLoadAds>[0]> = {}) => ({
  pathname: "/",
  search: "",
  userAgent: "Mozilla/5.0 (Macintosh) Chrome/120",
  hasCapacitor: false,
  appMarkerSeen: false,
  ...over,
});

describe("which pages may carry ads", () => {
  it("allows the public content pages", () => {
    for (const p of ["/", "/privacy-policy", "/register-society",
      "/article/digital-vs-paper-society-management"]) {
      expect(isPublicContentPath(p), p).toBe(true);
    }
  });

  it("refuses every dashboard", () => {
    for (const p of ["/guard/dashboard", "/resident/dashboard", "/admin/dashboard",
      "/triumph-towers-chsl/guard/dashboard", "/super-admin"]) {
      expect(isPublicContentPath(p), p).toBe(false);
    }
  });

  it("refuses login pages", () => {
    for (const p of ["/login", "/guard", "/resident", "/admin",
      "/triumph-towers-chsl/resident"]) {
      expect(isPublicContentPath(p), p).toBe(false);
    }
  });

  it("refuses the visitor form", () => {
    // A guard filling in a visitor's details at a gate does not need an
    // advertisement next to it.
    expect(isPublicContentPath("/visitor/form")).toBe(false);
    expect(isPublicContentPath("/triumph-towers-chsl/visitor/form")).toBe(false);
  });

  it("tolerates a trailing slash", () => {
    expect(isPublicContentPath("/privacy-policy/")).toBe(true);
    expect(isPublicContentPath("")).toBe(true);
  });

  it("does not let a prefix match the wrong route", () => {
    // "/article" must not make "/articles-of-association" public by
    // accident, nor "/registered" match "/register-society".
    expect(isPublicContentPath("/articles-of-association")).toBe(false);
    expect(isPublicContentPath("/register-society-admin")).toBe(false);
  });
});

describe("detecting the mobile apps", () => {
  it("spots the Capacitor bridge", () => {
    expect(isInApp(ctx({ hasCapacitor: true }))).toBe(true);
  });

  it("spots the shells' start-URL marker", () => {
    expect(isInApp(ctx({ search: "?utm_source=android_app&utm_medium=app" }))).toBe(true);
    expect(isInApp(ctx({ search: "?utm_source=ios_app" }))).toBe(true);
  });

  it("remembers the marker across a single-page navigation", () => {
    // The query string is gone after the first route change, but we are
    // still inside the app.
    expect(isInApp(ctx({ search: "", appMarkerSeen: true }))).toBe(true);
  });

  it("spots an Android WebView by its user agent", () => {
    expect(isInApp(ctx({
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A; wv) Chrome/120",
    }))).toBe(true);
  });

  it("does not mistake an ordinary browser for an app", () => {
    for (const ua of [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537.36",
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/120 Mobile Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile Safari/604.1",
    ]) {
      expect(isInApp(ctx({ userAgent: ua })), ua).toBe(false);
    }
  });

  it("does not match a desktop UA that merely contains wv", () => {
    // The token must be standalone AND on Android.
    expect(isInApp(ctx({ userAgent: "Mozilla/5.0 (Windows NT 10.0) wvision/1.0" }))).toBe(false);
  });
});

describe("the decision", () => {
  it("loads on the landing page in a browser", () => {
    expect(shouldLoadAds(ctx())).toBe(true);
  });

  it("NEVER loads inside an app, even on a public page", () => {
    // AdSense inside an application is prohibited — apps are AdMob's
    // job — and the penalty is the account, not the page.
    expect(shouldLoadAds(ctx({ pathname: "/", hasCapacitor: true }))).toBe(false);
    expect(shouldLoadAds(ctx({ pathname: "/article/x", appMarkerSeen: true }))).toBe(false);
    expect(shouldLoadAds(ctx({
      pathname: "/privacy-policy",
      userAgent: "Mozilla/5.0 (Linux; Android 14; wv) Chrome/120",
    }))).toBe(false);
  });

  it("does not load on a dashboard even in a browser", () => {
    expect(shouldLoadAds(ctx({ pathname: "/resident/dashboard" }))).toBe(false);
  });
});

describe("the script itself", () => {
  it("carries the publisher id", () => {
    expect(ADSENSE_CLIENT).toBe("ca-pub-4511019454368934");
    expect(ADSENSE_SRC).toContain(ADSENSE_CLIENT);
    expect(ADSENSE_SRC.startsWith("https://pagead2.googlesyndication.com/")).toBe(true);
  });
});
