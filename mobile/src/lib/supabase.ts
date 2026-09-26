import {
  createClient,
  type SupabaseClient,
  type SupportedStorage,
} from "@supabase/supabase-js"
import { AppState, Platform } from "react-native"
import { getEncryptedSessionStore } from "@/lib/storage"

// GoTrue session storage. On native the tokens are held in an AES-256
// encrypted MMKV (key in the OS keystore); on web it stays on
// localStorage / in-memory. The backing store opens lazily and
// asynchronously, so these methods are async — GoTrue awaits them.
const sessionStorage: SupportedStorage = {
  getItem: async (key) =>
    (await getEncryptedSessionStore()).getString(key) ?? null,
  setItem: async (key, value) => {
    ;(await getEncryptedSessionStore()).set(key, value)
  },
  removeItem: async (key) => {
    ;(await getEncryptedSessionStore()).remove(key)
  },
}

let client: SupabaseClient | null = null

function createSupabaseClient(): SupabaseClient {
  const url =
    process.env.EXPO_PUBLIC_SUPABASE_URL ??
    (__DEV__ ? "http://127.0.0.1:54321" : undefined)
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and " +
        "EXPO_PUBLIC_SUPABASE_ANON_KEY (see mobile/.env.example).",
    )
  }

  const instance = createClient(url, anonKey, {
    auth: {
      storage: sessionStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      // PKCE: password-recovery (and any code-flow) links carry a `?code=`
      // that the reset screen exchanges via exchangeCodeForSession. The code
      // verifier is written to `storage` (the encrypted session store) so it
      // survives the email round-trip and app restart.
      flowType: "pkce",
    },
  })

  // On native there are no browser visibility events, so drive GoTrue's
  // token auto-refresh timer from the app foreground state instead.
  if (Platform.OS !== "web") {
    AppState.addEventListener("change", (state) => {
      if (state === "active") {
        instance.auth.startAutoRefresh()
      } else {
        instance.auth.stopAutoRefresh()
      }
    })
    instance.auth.startAutoRefresh()
  }

  return instance
}

/**
 * Lazily-initialized Supabase client. Initialization is deferred to first
 * use so that importing this module never throws (keeps static web export
 * working when EXPO_PUBLIC_SUPABASE_* is unset).
 */
export function getSupabase(): SupabaseClient {
  client ??= createSupabaseClient()
  return client
}
