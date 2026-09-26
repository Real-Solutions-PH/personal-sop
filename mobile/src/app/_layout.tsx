import "../../global.css"
import * as Sentry from "@sentry/react-native"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { Providers } from "@/components/providers"
import { scrubSentryEvent } from "@/lib/sentry-scrub"

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
  return (
    <Providers>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(app)" />
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
        <Stack.Screen name="recover-password" />
        <Stack.Screen name="reset-password" />
      </Stack>
    </Providers>
  )
}

export default sentryDsn ? Sentry.wrap(RootLayout) : RootLayout
