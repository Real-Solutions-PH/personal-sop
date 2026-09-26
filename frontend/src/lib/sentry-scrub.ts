// Sentry `beforeSend` scrubber (defense-in-depth for auth secrets).
//
// Installed on every Sentry.init so that, regardless of `sendDefaultPii`, no
// outbound event carries the Supabase auth cookie or the `Authorization`
// header. Kept as a named, exported, pure function so it is unit-testable.
// See ticket #71.
import type { ErrorEvent } from "@sentry/nextjs"

// The single, explicit Supabase auth-cookie name shared by every client
// (see `src/lib/supabase/cookie.ts`). `@supabase/ssr` splits large sessions
// into chunks named `sb-app-auth.0`, `sb-app-auth.1`, … so we match on the
// prefix rather than the exact name.
export const AUTH_COOKIE_NAME = "sb-app-auth"

function isAuthCookie(name: string): boolean {
  return name.startsWith(AUTH_COOKIE_NAME)
}

// Drop `sb-app-auth*` pairs from a raw `Cookie` header string. Returns the
// remaining header, or `undefined` when nothing is left (caller drops it).
function sanitizeCookieHeader(value: string): string | undefined {
  const kept = value
    .split(";")
    .map((pair) => pair.trim())
    .filter(
      (pair) => pair.length > 0 && !isAuthCookie(pair.split("=")[0].trim()),
    )
  return kept.length > 0 ? kept.join("; ") : undefined
}

export function scrubSentryEvent<T extends ErrorEvent>(event: T): T {
  const headers = event.request?.headers
  if (headers) {
    for (const key of Object.keys(headers)) {
      const lowered = key.toLowerCase()
      if (lowered === "authorization") {
        delete headers[key]
      } else if (lowered === "cookie") {
        const sanitized = sanitizeCookieHeader(String(headers[key]))
        if (sanitized === undefined) {
          delete headers[key]
        } else {
          headers[key] = sanitized
        }
      }
    }
  }

  const cookies = event.request?.cookies
  if (cookies) {
    for (const key of Object.keys(cookies)) {
      if (isAuthCookie(key)) {
        delete cookies[key]
      }
    }
  }

  return event
}
