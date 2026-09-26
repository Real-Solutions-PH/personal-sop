import { createBrowserClient } from "@supabase/ssr"

import { getSupabaseAnonKey, getSupabaseBrowserUrl } from "@/lib/env"
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie"

// Returns the shared browser Supabase client (createBrowserClient returns a
// singleton). Sessions are stored in cookies so the Next.js middleware can
// read and refresh them. Only ever called at runtime (effects / handlers), so
// the required-env getters throw at first use rather than at build.
export function createClient() {
  return createBrowserClient(getSupabaseBrowserUrl(), getSupabaseAnonKey(), {
    cookieOptions: AUTH_COOKIE_OPTIONS,
  })
}
