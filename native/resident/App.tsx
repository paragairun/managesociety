import "react-native-gesture-handler";
import { useCallback, useEffect, useRef, type ReactElement } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  NavigationContainer, DefaultTheme, useNavigationContainerRef,
} from "@react-navigation/native";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import { usePushNotifications } from "@/lib/notifications";
import { sectionsFor } from "@core/residentAccess";
import LoginScreen from "@/screens/LoginScreen";
import HomeScreen from "@/screens/HomeScreen";
import DeliveriesScreen from "@/screens/DeliveriesScreen";
import GuestPassScreen from "@/screens/GuestPassScreen";
import DuesScreen from "@/screens/DuesScreen";
import AmenitiesScreen from "@/screens/AmenitiesScreen";
import VehiclesScreen from "@/screens/VehiclesScreen";
import EvChargingScreen from "@/screens/EvChargingScreen";
import HouseHelpsScreen from "@/screens/HouseHelpsScreen";
import ProfileScreen from "@/screens/ProfileScreen";
import { colors, type } from "@/theme";

/**
 * The resident app's shell: providers, the auth gate, and the drawer.
 *
 * The drawer is BUILT FROM @core/residentAccess rather than written out
 * here. That module decides which sections a family or tenant login
 * gets and what they are called, and it is the same module the website
 * uses — so a section cannot appear in one app and not the other, and
 * nothing can be hidden from the menu while staying reachable.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
    },
  },
});

const Drawer = createDrawerNavigator();

/**
 * Supabase refreshes the auth token on a timer, and that timer is
 * suspended while the app is backgrounded. Without stopping and
 * restarting it the client wakes holding an expired token and every
 * query fails until something forces a refresh — which for an app
 * opened once a day to approve a delivery is the normal case rather
 * than an edge one.
 */
const useAuthRefreshOnForeground = () => {
  useEffect(() => {
    supabase.auth.startAutoRefresh();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void supabase.auth.startAutoRefresh();
      else void supabase.auth.stopAutoRefresh();
    });
    return () => {
      sub.remove();
      void supabase.auth.stopAutoRefresh();
    };
  }, []);
};

/**
 * Every section's screen, keyed by the id @core/residentAccess uses.
 *
 * A map rather than a chain of ternaries, so a section that exists in
 * the shared list but has no screen here is a missing key with a
 * visible placeholder, not a silently wrong branch — and
 * residentAccess.test.ts reads this map to check none is missing.
 */
// ReactElement imported explicitly: the global JSX namespace comes
// from the website's React types, which exist beside this app on a
// full checkout and not in CI.
const SCREENS: Record<string, () => ReactElement> = {
  guest: () => <GuestPassScreen />,
  deliveries: () => <DeliveriesScreen />,
  dues: () => <DuesScreen />,
  amenities: () => <AmenitiesScreen />,
  vehicles: () => <VehiclesScreen />,
  ev: () => <EvChargingScreen />,
  helps: () => <HouseHelpsScreen />,
  profile: () => <ProfileScreen />,
};

const Placeholder = ({ name }: { name: string }) => (
  <View style={styles.placeholder}>
    <Text style={styles.placeholderTitle}>{name}</Text>
    <Text style={styles.placeholderBody}>Not built yet.</Text>
  </View>
);

const Shell = () => {
  const { user, loading, identity } = useAuth();
  useAuthRefreshOnForeground();

  // One spinner covering both "is there a session" and "what is this
  // person allowed to do". Rendering the login form in between is what
  // made the website briefly sign correct users back out — and here it
  // would also flash a menu that a tenant then watches items vanish
  // from, since the child-account flag arrives with the profile.
  if (loading) {
    return (
      <View style={styles.booting}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  if (!user) return <LoginScreen />;

  return (
    <Drawer.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontSize: type.heading, fontWeight: "700" },
        drawerStyle: { backgroundColor: colors.surface },
        drawerActiveBackgroundColor: colors.brand,
        drawerActiveTintColor: colors.onBrand,
        drawerInactiveTintColor: colors.textMuted,
        drawerLabelStyle: { fontSize: type.body, fontWeight: "600" },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {sectionsFor(identity).map((section) => {
        if (section.id === "home") {
          return (
            <Drawer.Screen key="home" name="Home" options={{ title: section.title }}>
              {({ navigation }) => (
                <HomeScreen onNavigate={(screen) => navigation.navigate(screen as never)} />
              )}
            </Drawer.Screen>
          );
        }
        const route = section.id.charAt(0).toUpperCase() + section.id.slice(1);
        return (
          <Drawer.Screen key={section.id} name={route} options={{ title: section.title }}>
            {SCREENS[section.id] ?? (() => <Placeholder name={section.title} />)}
          </Drawer.Screen>
        );
      })}
    </Drawer.Navigator>
  );
};

/**
 * Push registration and notification taps.
 *
 * Mounted INSIDE the auth provider but OUTSIDE the navigator, with the
 * container's own ref, because of the journey this exists to serve:
 * app closed, delivery arrives, resident taps the notification. The tap
 * is delivered within milliseconds of launch, long before any screen
 * has mounted and usually before the session has resolved. A listener
 * living in a screen would never hear it — which is exactly how this
 * broke on the web build.
 *
 * So the target is captured here and held until navigation is ready,
 * then replayed once.
 */
const PushBridge = ({
  navigationRef,
}: {
  navigationRef: ReturnType<typeof useNavigationContainerRef>;
}) => {
  const { user } = useAuth();
  const pending = useRef<string | null>(null);

  const openRoute = useCallback((route: string) => {
    if (navigationRef.isReady()) navigationRef.navigate(route as never);
    else pending.current = route;
  }, [navigationRef]);

  usePushNotifications(user?.id, { onOpen: openRoute });

  // The navigator may become ready after a tap was captured — on a cold
  // start it always does — so a parked target is flushed here.
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => {
      if (pending.current && navigationRef.isReady()) {
        const route = pending.current;
        pending.current = null;
        navigationRef.navigate(route as never);
      }
    }, 300);
    return () => clearInterval(timer);
  }, [user, navigationRef]);

  return null;
};

export default function App() {
  const navigationRef = useNavigationContainerRef();

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <NavigationContainer
            ref={navigationRef}
            theme={{
              ...DefaultTheme,
              colors: {
                ...DefaultTheme.colors,
                primary: colors.brand,
                background: colors.background,
                card: colors.surface,
                text: colors.text,
                border: colors.border,
              },
            }}
          >
            <StatusBar style="dark" />
            <PushBridge navigationRef={navigationRef} />
            <Shell />
          </NavigationContainer>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  booting: {
    flex: 1, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.background,
  },
  placeholder: {
    flex: 1, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.background, gap: 8,
  },
  placeholderTitle: { color: colors.text, fontSize: type.heading, fontWeight: "700" },
  placeholderBody: { color: colors.textMuted, fontSize: type.label },
});
