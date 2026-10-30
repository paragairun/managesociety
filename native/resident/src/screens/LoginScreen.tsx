import { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { colors, radius, space, TOUCH, type } from "@/theme";

/**
 * Sign-in for a resident.
 *
 * No society picker, matching the website: a person belongs to exactly
 * one society (profiles.user_id is unique) and it is read from their
 * profile after they authenticate. The picker the website used to have
 * was also what published every society on the platform to anyone who
 * opened the page.
 *
 * No registration link either. A resident does not sign themselves up:
 * the committee approves them from the admin panel, or their flat's
 * primary resident creates them a family or tenant login. Either way
 * the credentials arrive from a person, not from this screen — so an
 * unrecognised email is a question for the committee, which is what the
 * footer says instead of offering a dead end.
 */
const LoginScreen = () => {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: signInError } = await signIn(email, password);
    setBusy(false);
    if (signInError) setError(signInError);
  };

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      // On iOS the keyboard overlays the view; on Android the window
      // resizes already, so padding there would double-count and leave
      // a gap above the keyboard.
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.badge}>
          <Text style={styles.badgeText}>MS</Text>
        </View>

        <Text style={styles.title}>Sign In</Text>
        <Text style={styles.subtitle}>ManageSociety</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            returnKeyType="next"
            editable={!busy}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            placeholderTextColor={colors.textFaint}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            editable={!busy}
          />
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [styles.button, (pressed || busy) && styles.buttonPressed]}
          onPress={() => void submit()}
          disabled={busy}
          accessibilityRole="button"
        >
          {busy
            ? <ActivityIndicator color={colors.onBrand} />
            : <Text style={styles.buttonText}>Sign In</Text>}
        </Pressable>

        <Text style={styles.footnote}>
          No account? Your committee approves residents, and your flat's primary resident can create family and tenant logins.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: space.xl, paddingTop: space.xxl * 2, gap: space.lg },

  badge: {
    alignSelf: "center",
    width: 64, height: 64, borderRadius: radius.lg,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  badgeText: { color: colors.onBrand, fontSize: type.title, fontWeight: "800" },

  title: { color: colors.text, fontSize: type.title, fontWeight: "700", textAlign: "center" },
  subtitle: {
    color: colors.textMuted, fontSize: type.label, textAlign: "center",
    marginTop: -space.md, marginBottom: space.md,
  },

  field: { gap: space.xs },
  label: { color: colors.textMuted, fontSize: type.label, fontWeight: "600" },
  input: {
    minHeight: TOUCH,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: space.lg,
    color: colors.text, fontSize: type.body,
  },

  errorBox: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1, borderColor: colors.danger,
    borderRadius: radius.md, padding: space.md,
  },
  errorText: { color: colors.text, fontSize: type.label },

  button: {
    minHeight: TOUCH,
    backgroundColor: colors.brand, borderRadius: radius.md,
    alignItems: "center", justifyContent: "center",
    marginTop: space.sm,
  },
  buttonPressed: { backgroundColor: colors.brandDark },
  buttonText: { color: colors.onBrand, fontSize: type.heading, fontWeight: "700" },

  footnote: {
    color: colors.textFaint, fontSize: type.caption,
    textAlign: "center", marginTop: space.md,
  },
});

export default LoginScreen;
