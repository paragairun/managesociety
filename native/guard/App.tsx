import "react-native-gesture-handler";
import { useEffect } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import LoginScreen from "@/screens/LoginScreen";
import HomeScreen from "@/screens/HomeScreen";
import ScanScreen from "@/screens/ScanScreen";
import { colors, type } from "@/theme";

/**
 * The guard app's shell: providers, the auth gate, and the drawer.
 *
 * A drawer rather than bottom tabs because there are six sections and
 * six tabs on a phone leaves each one too narrow to label — and a
 * guard needs to read the label, not decode an icon, in bad light.
 * It also matches the sidebar they already know from the website.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A gate's data is only interesting if it is current, but the
      // network at a gate is unreliable. Keep served data usable while
      // refetching rather than flashing a spinner over a working screen.
      staleTime: 30_000,
      retry: 2,
    },
  },
});

const Drawer = createDrawerNavigator();

/**
 * Supabase refreshes the auth token on a timer. On a phone that timer
 * is suspended while the app is backgrounded, and without stopping and
 * restarting it the client wakes up holding an expired token and every
 * query fails until something forces a refresh. On a gate device, which
 * lives in a pocket between uses, that is the normal case rather than
 * an edge one.
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

const Placeholder = ({ name }: { name: string }) => (
  <View style={styles.placeholder}>
    <Text style={styles.placeholderTitle}>{name}</Text>
    <Text style={styles.placeholderBody}>Not built yet.</Text>
  </View>
);

const Shell = () => {
  const { user, loading } = useAuth();
  useAuthRefreshOnForeground();

  // One spinner covering both "is there a session" and "what is this
  // person allowed to do". Rendering the login form in between is what
  // made the website briefly sign correct users back out.
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
      <Drawer.Screen name="Home" options={{ title: "Home" }}>
        {({ navigation }) => (
          <HomeScreen onNavigate={(screen) => navigation.navigate(screen as never)} />
        )}
      </Drawer.Screen>
      <Drawer.Screen name="Scan" component={ScanScreen} options={{ title: "Search & Scan" }} />
      <Drawer.Screen name="Approvals" options={{ title: "Pending Approvals" }}>
        {() => <Placeholder name="Pending Approvals" />}
      </Drawer.Screen>
      <Drawer.Screen name="Live" options={{ title: "Live Inside" }}>
        {() => <Placeholder name="Live Inside" />}
      </Drawer.Screen>
      <Drawer.Screen name="Barriers" options={{ title: "Boom Barriers" }}>
        {() => <Placeholder name="Boom Barriers" />}
      </Drawer.Screen>
      <Drawer.Screen name="Deliveries" options={{ title: "Deliveries" }}>
        {() => <Placeholder name="Deliveries" />}
      </Drawer.Screen>
    </Drawer.Navigator>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <NavigationContainer
            theme={{
              ...DarkTheme,
              colors: {
                ...DarkTheme.colors,
                primary: colors.brand,
                background: colors.background,
                card: colors.surface,
                text: colors.text,
                border: colors.border,
              },
            }}
          >
            <StatusBar style="light" />
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
