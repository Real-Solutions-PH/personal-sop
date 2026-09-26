import type { User } from "@supabase/supabase-js"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { useCustomToast } from "@/hooks/useCustomToast"
import { api } from "@/lib/auth"
import * as itemsDb from "@/lib/db/items"
import * as syncQueueDb from "@/lib/db/sync-queue"
import * as usersDb from "@/lib/db/users"
import { getSupabase } from "@/lib/supabase"
import { runSync } from "@/lib/sync"
import { handleError } from "@/lib/utils"
import { useAuthStore } from "@/stores/auth-store"

export interface CurrentUser {
  id: string
  email: string
  is_active: boolean
  is_superuser: boolean
  full_name?: string | null
}

interface LoginInput {
  username: string
  password: string
}

interface SignupInput {
  email: string
  password: string
  full_name?: string
}

async function loginRequest(input: LoginInput): Promise<User> {
  const { data, error } = await getSupabase().auth.signInWithPassword({
    email: input.username,
    password: input.password,
  })
  if (error) throw error
  return data.user
}

async function signupRequest(input: SignupInput): Promise<User | null> {
  const { data, error } = await getSupabase().auth.signUp({
    email: input.email,
    password: input.password,
    options: { data: { full_name: input.full_name } },
  })
  if (error) throw error
  // null session => email confirmation required before login.
  return data.session ? data.user : null
}

/**
 * Post-authentication bookkeeping: JIT-provision/fetch the backend user,
 * mirror it into the auth store and local cache, and kick off a sync.
 * Falls back to the Supabase session user when the backend is unreachable.
 */
async function completeLogin(sessionUser: User): Promise<void> {
  try {
    const { data: user } = await api.get<CurrentUser>("/api/v1/users/me")
    usersDb.upsertUser({
      id: user.id,
      email: user.email,
      full_name: user.full_name ?? null,
      is_active: user.is_active,
      is_superuser: user.is_superuser,
    })
    useAuthStore.getState().setAuthenticated(user)
    runSync()
  } catch {
    // Backend unreachable — the Supabase session is still valid, so mark
    // authenticated from the session user and sync later.
    useAuthStore.getState().setAuthenticated({
      id: sessionUser.id,
      email: sessionUser.email ?? "",
      full_name: (sessionUser.user_metadata?.full_name as string) ?? null,
    })
  }
}

export function useAuth() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const toast = useCustomToast()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  const login = useMutation({
    mutationFn: loginRequest,
    onSuccess: async (sessionUser) => {
      await completeLogin(sessionUser)
      router.replace("/(app)")
    },
    onError: (err) => toast.error(handleError(err)),
  })

  const signup = useMutation({
    mutationFn: signupRequest,
    onSuccess: async (sessionUser) => {
      if (sessionUser) {
        // Email confirmation disabled — signUp opened a session; log in.
        await completeLogin(sessionUser)
        router.replace("/(app)")
        return
      }
      toast.success(
        "Account created. Check your email to confirm, then log in.",
      )
      router.replace("/login")
    },
    onError: (err) => toast.error(handleError(err)),
  })

  async function logout() {
    try {
      await getSupabase().auth.signOut({ scope: "local" })
    } catch {
      // Offline or unconfigured — still clear local state below.
    }
    useAuthStore.getState().clearAuth()
    usersDb.clearUserCache()
    itemsDb.clearItems()
    syncQueueDb.clearSyncQueue()
    queryClient.removeQueries()
    router.replace("/login")
  }

  const user = usersDb.getCachedUser()

  return {
    user,
    isAuthenticated,
    login,
    signup,
    logout,
  }
}
