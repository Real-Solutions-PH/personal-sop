// Server/edge error monitoring (GlitchTip, Sentry-SDK compatible).
// No-ops entirely when NEXT_PUBLIC_SENTRY_DSN is not set at build time.
import * as Sentry from "@sentry/nextjs"
import { scrubSentryEvent } from "@/lib/sentry-scrub"

export function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return
  }

  if (
    process.env.NEXT_RUNTIME === "nodejs" ||
    process.env.NEXT_RUNTIME === "edge"
  ) {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0,
      beforeSend: scrubSentryEvent,
    })
  }
}

export const onRequestError = Sentry.captureRequestError
