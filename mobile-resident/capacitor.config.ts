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
    url: 'https://managesociety.in/resident?utm_source=android_app&utm_medium=app',
    cleartext: false,
  },
};

export default config;
