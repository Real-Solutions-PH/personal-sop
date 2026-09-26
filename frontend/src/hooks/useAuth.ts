"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { type UserPublic, UsersService } from "@/client"
import { createClient } from "@/lib/supabase/client"
import useCustomToast from "./useCustomToast"

export interface LoginCredentials {
  email: string
  password: string
}

export interface SignUpData {
  email: string
  password: string
  full_name: string
}

const useAuth = () => {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const [hasSession, setHasSession] = useState(false)

  // createClient() is only called in effects and event handlers (never at
  // render time) so pages using this hook can still be prerendered without
  // Supabase env vars at build time.
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(data.session !== null)
    })
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setHasSession(session !== null)
      },
    )
    return () => subscription.subscription.unsubscribe()
  }, [])

  // The backend /users/me call JIT-provisions the local user row on the
  // first authenticated request after a Supabase signup.
  const { data: user } = useQuery<UserPublic | null, Error>({
    queryKey: ["currentUser"],
    queryFn: UsersService.readUserMe,
    enabled: hasSession,
  })

  const signUpMutation = useMutation({
    mutationFn: async (data: SignUpData) => {
      const supabase = createClient()
      const { error } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: { data: { full_name: data.full_name } },
      })
      if (error) throw error
      // Local Supabase config has email confirmations disabled, so signUp
      // starts a session immediately; sign out to keep the signup -> login
      // flow the app has always had.
      await supabase.auth.signOut({ scope: "local" })
    },
    onSuccess: () => {
      router.push("/login")
    },
    onError: (err: Error) => {
      showErrorToast(err.message)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] })
    },
  })

  const login = async ({ email, password }: LoginCredentials) => {
    const { error } = await createClient().auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
  }

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: () => {
      // Single router action on purpose: push() + refresh() in the same
      // handler batch two async router actions into one transition, and the
      // URL only commits once BOTH RSC fetches settle. On slow machines (CI
      // runners, containerized next dev compiling routes on demand) that
      // commit is delayed past test timeouts or dropped outright — the
      // browser stays on /login even though both GET /?_rsc return 200.
      // refresh() is redundant here anyway: Next 15 does not reuse dynamic
      // RSC payloads (staleTimes.dynamic = 0), so the pushed route is always
      // fetched fresh with the new session cookie.
      router.push("/")
    },
    onError: (err: Error) => {
      showErrorToast(err.message)
    },
  })

  const logout = async () => {
    // scope: "local" signs out this browser only (same semantics as the old
    // cookie clearing) — the default "global" revokes every session the user
    // has, including other devices.
    await createClient().auth.signOut({ scope: "local" })
    queryClient.clear()
    // Single router action — see loginMutation.onSuccess for why there is no
    // router.refresh() here.
    router.push("/login")
  }

  return {
    signUpMutation,
    loginMutation,
    logout,
    user,
  }
}

export default useAuth
