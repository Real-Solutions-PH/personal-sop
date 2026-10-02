import "../../global.css"
import * as Sentry from "@sentry/react-native"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { scrubSentryEvent } from "@/lib/sentry-scrub"
import { prototypeMode } from "@/prototype/mode"
import { PrototypeProviders } from "@/prototype/providers"

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

function RootLayout() {
  const Providers = prototypeMode
    ? PrototypeProviders
    : require("@/components/providers").Providers
  return (
    <Providers>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={prototypeMode}>
          <Stack.Screen name="(sop)" />
        </Stack.Protected>
        <Stack.Protected guard={!prototypeMode}>
          <Stack.Screen name="(app)" />
          <Stack.Screen name="login" />
          <Stack.Screen name="signup" />
          <Stack.Screen name="recover-password" />
          <Stack.Screen name="reset-password" />
        </Stack.Protected>
      </Stack>
    </Providers>
  )
}

export default sentryDsn ? Sentry.wrap(RootLayout) : RootLayout
