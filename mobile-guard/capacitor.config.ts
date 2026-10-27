import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // appId is the permanent Play/Firebase identity: keep it (see android/app/build.gradle).
  appId: 'in.managesociety.guard',
  appName: 'ManageSociety Guard',
  webDir: 'www',
  // Thin native shell around the live site -- always loads the current
  // deployed web app, no bundled copy to keep in sync. Rebuilding the .apk
  // is only needed if the native shell itself changes (icon, permissions,
  // app name), not for ordinary web app updates.
  server: {
    // utm_source is overwritten per platform at build time by
    // scripts/configure-ios.mjs, so the analytics can tell an iPhone
    // from an Android phone. This value is the Android default.
    url: 'https://managesociety.in/guard?utm_source=android_app&utm_medium=app',
    cleartext: false,
  },

  ios: {
    // Served over https from managesociety.in, so App Transport
    // Security needs no exceptions. Do not add any: an ATS exception
    // is a question at App Review this app has no reason to answer.
    //
    // contentInset 'always' keeps the web content clear of the status
    // bar and the home indicator on notched iPhones. It matters more
    // here than on the resident app: a guard works one-handed at a
    // gate and the scan controls sit at the bottom of the screen.
    contentInset: 'always',
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
