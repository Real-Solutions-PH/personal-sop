import { useEffect } from "react"
import { getSupabase } from "@/lib/supabase"
import { useAuthStore } from "@/stores/auth-store"

/**
 * Mirrors the Supabase auth session into the zustand auth store, which the
 * rest of the app (route guards, screens) reads. The store stays the single
 * app-side source of truth; Supabase drives it.
 */
export function useSupabaseAuthSync() {
  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    try {
      const { data } = getSupabase().auth.onAuthStateChange(
        (event, session) => {
          if (session?.user) {
            useAuthStore.getState().setAuthenticated({
              id: session.user.id,
              email: session.user.email ?? "",
              full_name:
                (session.user.user_metadata?.full_name as string) ?? null,
            })
          } else if (event === "SIGNED_OUT" || event === "INITIAL_SESSION") {
            // No session on startup (or explicit sign-out): clear any stale
            // persisted auth state so guards route back to login.
            useAuthStore.getState().clearAuth()
          }
        },
      )
      unsubscribe = () => data.subscription.unsubscribe()
    } catch (err) {
      // Supabase env unset — leave auth actions to surface the error.
      console.warn("Supabase auth sync disabled:", err)
    }
    return unsubscribe
  }, [])
}
