import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // appId is the permanent Play/Firebase identity: keep it (see android/app/build.gradle).
  appId: 'in.visitorpasses.guard',
  appName: 'ManageSociety Guard',
  webDir: 'www',
  // Thin native shell around the live site -- always loads the current
  // deployed web app, no bundled copy to keep in sync. Rebuilding the .apk
  // is only needed if the native shell itself changes (icon, permissions,
  // app name), not for ordinary web app updates.
  server: {
    url: 'https://managesociety.in/login/society?role=guard&utm_source=android_app&utm_medium=app',
    cleartext: false,
  },
};

export default config;
