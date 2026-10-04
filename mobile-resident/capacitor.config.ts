import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // appId is the permanent Play/Firebase identity: keep it (see android/app/build.gradle).
  appId: 'in.visitorpasses.resident',
  appName: 'ManageSociety Resident',
  webDir: 'www',
  // This app is a thin native shell around the live site -- it always loads
  // the real, currently-deployed web app rather than bundling a copy of it.
  // That means ordinary web app updates (new features, bug fixes) show up
  // immediately for everyone with the app installed, with no app-store-style
  // update needed. The .apk only needs rebuilding if the native shell itself
  // changes (icon, permissions, app name).
  server: {
    url: 'https://managesociety.in/login/society?role=resident',
    cleartext: false,
  },
};

export default config;
