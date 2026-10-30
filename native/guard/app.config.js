/**
 * Makes the app's version settable from the environment, for Play Store
 * builds. Everything else still lives in app.json, which Expo passes in
 * here as `config` — this file overrides two fields and nothing more.
 *
 * WHY THIS EXISTS
 * Google Play refuses a bundle whose versionCode it has already seen, or
 * one lower than the highest it holds. The Capacitor apps solve that in
 * build-release-aabs.yml by passing -PappVersionCode into Gradle, but
 * Expo writes versionCode into the generated Android project from
 * app.json at prebuild time, so a Gradle property arrives too late to
 * matter. The value has to be in the config Expo reads.
 *
 * The scheme is the same one the Capacitor workflow uses — minutes since
 * 2024-01-01 UTC — so codes from both workflows share one timeline and
 * can never collide or go backwards. That matters here specifically:
 * this app and the Capacitor guard app publish to the SAME Play listing
 * under in.managesociety.guard, and this one is meant to replace it.
 *
 * Unset, the app.json values apply, which is what every local run and
 * every development build wants.
 */
module.exports = ({ config }) => {
  const code = process.env.APP_VERSION_CODE;
  const name = process.env.APP_VERSION_NAME;

  // Number() on undefined gives NaN, and NaN in versionCode produces an
  // Android project that fails to build with a confusing Gradle error
  // rather than a clear one. Parse only when something was given.
  const versionCode = code ? Number(code) : config.android?.versionCode;
  if (code && !Number.isInteger(versionCode)) {
    throw new Error(`APP_VERSION_CODE must be a whole number, got "${code}"`);
  }

  return {
    ...config,
    version: name || config.version,
    android: {
      ...config.android,
      versionCode,
    },
  };
};
