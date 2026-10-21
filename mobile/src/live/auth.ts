// Live-mode account actions: the same functions the auth screens already
// call (src/prototype/session.ts delegates here when liveMode), backed by
// Supabase GoTrue (ADR-0005). Errors are mapped to the screens' AuthError
// fields; GoTrue's own messages are never shown verbatim.

import type { AuthError as GoTrueError } from "@supabase/supabase-js"
import { getSupabase } from "@/lib/supabase"
import { createHttp, type TokenSource } from "./http"

let sessionLost: (() => void) | null = null

/** Called once the auth server refuses to refresh the session (signed out
 * elsewhere, revoked, expired refresh token). A network failure is not a
 * lost session: the request is simply retried later. */
export function onSessionLost(handler: (() => void) | null) {
  sessionLost = handler
}

export const tokens: TokenSource = {
  async current() {
    const { data } = await getSupabase().auth.getSession()
    return data.session?.access_token ?? null
  },
  async refresh() {
    const { data, error } = await getSupabase().auth.refreshSession()
    const token = data.session?.access_token ?? null
    // supabase-js names a transport failure AuthRetryableFetchError.
    if (!token && error?.name !== "AuthRetryableFetchError") sessionLost?.()
    return token
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

/** Sign-up's "is this handle free?" check, asked before the account exists
 * (a public endpoint, limited per device address). Any failure — offline,
 * rate limited, a server error — reads as "unknown", never "available". */
export async function checkHandle(
  username: string,
): Promise<"available" | "taken" | "unknown"> {
  try {
    const { status } = await http.request<{ status: string }>(
      "GET",
      `/profile/signup/handle-available?handle=${encodeURIComponent(username)}`,
    )
    return status === "available" || status === "taken" ? status : "unknown"
  } catch {
    return "unknown"
  }
}

/** Claim the handle and name after the email code is accepted. A taken
 * handle is reported to the screen as a username error; anything else as a
 * retryable error. The Supabase session stays signed in either way. */
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
      throw new LiveAuthError(`@${username} is already taken`, "username")
    throw new LiveAuthError(
      "Could not finish setting up your account. Check your connection and try again.",
    )
  }
}
