// Live-mode account actions: the same functions the auth screens already
// call (src/prototype/session.ts delegates here when liveMode), backed by
// Supabase GoTrue (ADR-0005). Errors are mapped to the screens' AuthError
// fields; GoTrue's own messages are never shown verbatim.

import type { AuthError as GoTrueError } from "@supabase/supabase-js"
import { getSupabase } from "@/lib/supabase"
import { createHttp, type TokenSource } from "./http"

export const tokens: TokenSource = {
  async current() {
    const { data } = await getSupabase().auth.getSession()
    return data.session?.access_token ?? null
  },
  async refresh() {
    const { data } = await getSupabase().auth.refreshSession()
    return data.session?.access_token ?? null
  },
}

export const http = createHttp(tokens)

export type Field = "email" | "password" | "username" | "code"
export class LiveAuthError extends Error {
  constructor(
    message: string,
    readonly field?: Field,
  ) {
    super(message)
  }
}

function mapError(error: GoTrueError | null): void {
  if (!error) return
  const code = (error as { code?: string }).code ?? ""
  if (code === "invalid_credentials")
    throw new LiveAuthError("Incorrect email or password", "password")
  if (code === "user_already_exists" || code === "email_exists")
    throw new LiveAuthError(
      "An account with this email already exists. Sign in instead?",
      "email",
    )
  if (code === "otp_expired" || code === "invalid_otp")
    throw new LiveAuthError("That code is incorrect or has expired", "code")
  if (code === "weak_password")
    throw new LiveAuthError("Choose a stronger password", "password")
  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit"
  )
    throw new LiveAuthError("Too many attempts. Wait a minute and try again.")
  throw new LiveAuthError("Something went wrong. Please try again.")
}

export async function signIn(email: string, password: string) {
  const { data, error } = await getSupabase().auth.signInWithPassword({
    email,
    password,
  })
  mapError(error)
  return data.user
}

export async function signUp(
  email: string,
  password: string,
  name: string,
  username: string,
) {
  const { error } = await getSupabase().auth.signUp({
    email,
    password,
    options: { data: { name, username } },
  })
  mapError(error)
}

export async function verifySignUp(email: string, code: string) {
  const { data, error } = await getSupabase().auth.verifyOtp({
    email,
    token: code,
    type: "signup",
  })
  mapError(error)
  return data.user
}

export async function resendSignUp(email: string) {
  const { error } = await getSupabase().auth.resend({ type: "signup", email })
  mapError(error)
}

export async function requestReset(email: string) {
  const { error } = await getSupabase().auth.resetPasswordForEmail(email)
  mapError(error)
}

export async function updatePassword(password: string) {
  const { error } = await getSupabase().auth.updateUser({ password })
  mapError(error)
}

export async function signOut() {
  await getSupabase().auth.signOut()
}

export async function currentUserId(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession()
  return data.session?.user.id ?? null
}

/** Claim the handle and name after the email code is accepted. A taken
 * handle is reported to the screen; the account stays signed in. */
export async function completeProfile(name: string, username: string) {
  try {
    await http.request("POST", "/profile/complete-signup", {
      name,
      handle: username,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === "handle_taken")
      throw new LiveAuthError("That username was just taken", "username")
    throw error
  }
}
