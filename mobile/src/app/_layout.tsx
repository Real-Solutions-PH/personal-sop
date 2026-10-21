import "../../global.css"
import * as Sentry from "@sentry/react-native"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useReducedMotion } from "react-native-reanimated"
import { scrubSentryEvent } from "@/lib/sentry-scrub"
import { prototypeMode } from "@/prototype/mode"
import { PrototypeProviders } from "@/prototype/providers"
import { sessionStore } from "@/prototype/session"

// Error monitoring (GlitchTip, Sentry-SDK compatible).
// No-ops entirely when EXPO_PUBLIC_SENTRY_DSN is not set at build time.
const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    tracesSampleRate: 0,
    beforeSend: scrubSentryEvent,
  })
}

// Rendered inside the providers so the prototype session is read only after
// its storage has been configured.
function RootStack() {
  const signedIn = sessionStore.use((s) => s.signedIn)
  const reduced = useReducedMotion()
  const prototypeApp = prototypeMode && signedIn
  const prototypeAuth = prototypeMode && !signedIn
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: reduced ? "none" : "default",
      }}
    >
      <Stack.Protected guard={prototypeApp}>
        <Stack.Screen name="(sop)" />
      </Stack.Protected>
      <Stack.Protected guard={prototypeAuth}>
        <Stack.Screen name="welcome" />
        <Stack.Screen name="verify-email" />
      </Stack.Protected>
      <Stack.Protected guard={!prototypeMode}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!prototypeMode || prototypeAuth}>
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
        <Stack.Screen name="recover-password" />
        <Stack.Screen name="reset-password" />
      </Stack.Protected>
    </Stack>
  )
}

function RootLayout() {
  const Providers = prototypeMode
    ? PrototypeProviders
    : require("@/components/providers").Providers
  return (
    <Providers>
      <StatusBar style="auto" />
      <RootStack />
    </Providers>
  )
}

export default sentryDsn ? Sentry.wrap(RootLayout) : RootLayout
