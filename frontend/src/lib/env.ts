// Required public environment. Replaces the silent `?? ""` fallbacks that let
// a missing Supabase URL / anon key or API URL fail deep inside the auth client
// with an opaque error. Validation is at FIRST USE (boot/runtime), not at module
// import: NEXT_PUBLIC_* values are frozen at `next build`, and the app is built
// to prerender WITHOUT them (see supabase/client.ts + hooks/useAuth.ts), so an
// eager module-level throw would break the build. A production/Docker build
// should additionally gate on these three vars being present.
//
// IMPORTANT: every NEXT_PUBLIC_* read below is a STATIC literal access. Next
// only inlines `process.env.NEXT_PUBLIC_FOO` written literally — a dynamic
// `process.env[name]` is undefined in the browser bundle.

/** Trim a value; treat empty / whitespace-only as absent. */
export function cleanEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/** Return the value or throw a clear error naming the missing variable. */
export function requireEnv(name: string, value: string | undefined): string {
  const cleaned = cleanEnv(value)
  if (!cleaned) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        "Set it in the frontend environment (see .env.example).",
    )
  }
  return cleaned
}

/** Supabase anon (public) key — shared by browser, server, and middleware. */
export function getSupabaseAnonKey(): string {
  return requireEnv(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}

/** Supabase URL as the BROWSER reaches it. */
export function getSupabaseBrowserUrl(): string {
  return requireEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  )
}

/**
 * Supabase URL for SERVER-side code. SUPABASE_URL overrides for container
 * networking (e.g. host.docker.internal); otherwise the public URL is used.
 */
export function getSupabaseServerUrl(): string {
  return cleanEnv(process.env.SUPABASE_URL) ?? getSupabaseBrowserUrl()
}

/**
 * Base URL for the generated OpenAPI client. The server runtime may override
 * with API_URL (the backend is reachable at a different host inside the compose
 * network than the browser uses). `OpenAPI.BASE` is a plain string set at module
 * load, so this cannot be a lazy resolver. It throws whenever no URL is
 * configured — at browser boot and at server-runtime boot alike, so a
 * misconfigured deploy fails loudly instead of firing requests at "". The only
 * exception is `next build`, where module evaluation must not throw so the
 * env-less prerender/build path is preserved.
 */
export function resolveApiBaseUrl(): string {
  const serverOverride =
    typeof window === "undefined" ? cleanEnv(process.env.API_URL) : undefined
  if (serverOverride) return serverOverride

  const publicUrl = cleanEnv(process.env.NEXT_PUBLIC_API_URL)
  if (publicUrl) return publicUrl

  // NEXT_PHASE is "phase-production-build" only while `next build` runs; a live
  // server process or the browser never sets it, so both fail fast.
  if (process.env.NEXT_PHASE === "phase-production-build") return ""

  throw new Error(
    "Missing required environment variable NEXT_PUBLIC_API_URL. " +
      "Set it in the frontend environment (see .env.example).",
  )
}
