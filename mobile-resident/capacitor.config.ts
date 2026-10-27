import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // appId is the permanent Play/Firebase identity: keep it (see android/app/build.gradle).
  appId: 'in.managesociety.resident',
  appName: 'ManageSociety Resident',
  webDir: 'www',
  // The society picker this used to open (/login/society) was removed
  // when login stopped asking which society you belong to — it is read
  // from your profile after you sign in. That URL now 404s, so this
  // points at the role's own login page.
  //
  // This app is a thin native shell around the live site -- it always loads
  // the real, currently-deployed web app rather than bundling a copy of it.
  // That means ordinary web app updates (new features, bug fixes) show up
  // immediately for everyone with the app installed, with no app-store-style
  // update needed. The .apk only needs rebuilding if the native shell itself
  // changes (icon, permissions, app name).
  server: {
    // utm_source is overwritten per platform at build time by
    // scripts/configure-ios.mjs, so the analytics can tell an iPhone
    // from an Android phone. This value is the Android default.
    url: 'https://managesociety.in/resident?utm_source=android_app&utm_medium=app',
    cleartext: false,
  },

  ios: {
    // The web content is served from managesociety.in over https, so
    // App Transport Security needs no exceptions. Do not add any:
    // an ATS exception is a question at App Review and this app has
    // no reason to answer one.
    //
    // contentInset 'always' keeps the web content clear of the status
    // bar and the home indicator on notched iPhones, which a plain
    // webview does not do on its own.
    contentInset: 'always',
    // A failed load should not leave a white screen with no
    // explanation — the shell depends on the network by design.
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
