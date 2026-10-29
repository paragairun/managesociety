// Must be first: supabase-js builds URL objects, and React Native's
// URL implementation is incomplete without this shim. Importing it
// later means the client has already captured the broken one.
import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * The Supabase client for the guard app.
 *
 * Differs from the website's client (src/integrations/supabase/client.ts)
 * in three ways, each of them required rather than stylistic:
 *
 *   storage            AsyncStorage, because localStorage does not
 *                      exist here. Without it the guard is signed out
 *                      every time the app is closed — on a gate device
 *                      that is used in ten-second bursts, all day.
 *
 *   detectSessionInUrl false. There is no URL bar to read a token out
 *                      of, and leaving it on makes the client wait for
 *                      a redirect that never arrives.
 *
 *   autoRefreshToken   on, but see AppStateRefresh in App.tsx: the
 *                      refresh timer must be stopped while the app is
 *                      backgrounded or Android kills it mid-sleep and
 *                      the session silently rots.
 */
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  // Thrown at import time on purpose. A client built from undefined
  // fails later with "Invalid URL" from somewhere deep inside a query,
  // which is a much worse thing to debug than this sentence.
  throw new Error(
    "Supabase config missing. native/guard/.env must set " +
    "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
  );
}

export const supabase = createClient<Database>(url, publishableKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
