import "react-native-gesture-handler";
import { useEffect } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import { sectionsFor } from "@core/residentAccess";
import LoginScreen from "@/screens/LoginScreen";
import HomeScreen from "@/screens/HomeScreen";
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

const Placeholder = ({ name }: { name: string }) => (
  <View style={styles.placeholder}>
    <Text style={styles.placeholderTitle}>{name}</Text>
    <Text style={styles.placeholderBody}>Not built yet.</Text>
  </View>
);

/** Section ids are lower case; drawer route names are capitalised. */
const routeFor = (sectionId: string) =>
  sectionId.charAt(0).toUpperCase() + sectionId.slice(1);

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

  const sections = sectionsFor(identity);

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
      {sections.map((section) =>
        section.id === "home" ? (
          <Drawer.Screen key="home" name="Home" options={{ title: section.title }}>
            {({ navigation }) => (
              <HomeScreen onNavigate={(screen) => navigation.navigate(screen as never)} />
            )}
          </Drawer.Screen>
        ) : (
          <Drawer.Screen
            key={section.id}
            name={routeFor(section.id)}
            options={{ title: section.title }}
          >
            {() => <Placeholder name={section.title} />}
          </Drawer.Screen>
        ),
      )}
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
