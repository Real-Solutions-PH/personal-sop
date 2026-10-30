// Live-mode account actions: the same functions the auth screens already
// call (src/prototype/session.ts delegates here when liveMode), backed by
// Supabase GoTrue (ADR-0005). Errors are mapped to the screens' AuthError
// fields; GoTrue's own messages are never shown verbatim.

import type { AuthError as GoTrueError } from "@supabase/supabase-js"
import { getSupabase } from "@/lib/supabase"
import type { About } from "@/prototype/onboarding-draft"
import { ApiError, createHttp, NetworkError, type TokenSource } from "./http"

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
  if (code === "same_password")
    throw new LiveAuthError(
      "Choose a password different from your current one",
      "password",
    )
  if (code === "email_address_invalid" || code === "validation_failed")
    throw new LiveAuthError("Enter a valid email address", "email")
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

/** Resolves true when the account is confirmed at sign-up (the server
 * auto-confirms and returns a session), false when a code was emailed. */
export async function signUp(
  email: string,
  password: string,
  name: string,
  username: string,
) {
  const { data, error } = await getSupabase().auth.signUp({
    email,
    password,
    options: { data: { name, username } },
  })
  mapError(error)
  return data.session !== null
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

// --- Account settings ---

async function sessionEmail(): Promise<string> {
  const { data } = await getSupabase().auth.getSession()
  const email = data.session?.user.email
  if (!email) throw new LiveAuthError("Your session ended. Sign in again.")
  return email
}

/** Confirm it is really the account holder before a sensitive change: the
 * current password must sign in again. A wrong password is reported on the
 * password field, never as a generic failure. */
async function reauthenticate(password: string) {
  const { error } = await getSupabase().auth.signInWithPassword({
    email: await sessionEmail(),
    password,
  })
  if ((error as { code?: string } | null)?.code === "invalid_credentials")
    throw new LiveAuthError("That password is incorrect", "password")
  mapError(error)
}

export async function changePassword(current: string, next: string) {
  await reauthenticate(current)
  await updatePassword(next)
}

/** GoTrue mails a confirmation link to the new address; the change takes
 * effect once it is opened, and the auth webhook copies it to our user. */
export async function changeEmail(email: string) {
  const { error } = await getSupabase().auth.updateUser({ email })
  mapError(error)
}

/** Ends every session of this account, on every device. */
export async function signOutEverywhere() {
  const { error } = await getSupabase().auth.signOut({ scope: "global" })
  mapError(error)
}

/** Deletes the account on the server: its sign-in and every record it owns
 * (DELETE /users/me revokes the auth user, then cascades the data). */
export async function deleteAccount(password: string) {
  await reauthenticate(password)
  try {
    await http.request("DELETE", "/users/me")
  } catch (error) {
    if (error instanceof NetworkError)
      throw new LiveAuthError(
        "You're offline. Connect to the internet to delete your account.",
      )
    if (error instanceof ApiError && error.status === 403)
      throw new LiveAuthError(
        "This is an admin account, so it can't be deleted from the app.",
      )
    throw new LiveAuthError(
      "Couldn't delete your account. Nothing was removed; try again.",
    )
  }
  // The server already removed the sign-in; clear the local session too.
  await getSupabase()
    .auth.signOut({ scope: "local" })
    .catch(() => {})
}

/** The signed-in user. An expired access token is refreshed first; when
 * that refresh fails only because the network did (offline launch), GoTrue
 * keeps the stored session but reports none, so ``offlineUserId`` (the
 * account this device last synced) is returned instead: the person stays
 * signed in, works locally, and a later refusal from the auth server
 * (onSessionLost) decides whether the session really ended. */
export async function currentUserId(
  offlineUserId?: string | null,
): Promise<string | null> {
  const { data, error } = await getSupabase().auth.getSession()
  if (data.session) return data.session.user.id
  return error?.name === "AuthRetryableFetchError"
    ? (offlineUserId ?? null)
    : null
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
export async function completeProfile(
  name: string,
  username: string,
  about: About = {},
) {
  try {
    await http.request("POST", "/profile/complete-signup", {
      name,
      handle: username,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      // Onboarding's "about you" answers; unanswered ones are left out.
      ...(about.occupation ? { occupation: about.occupation } : {}),
      ...(about.occupationDetail
        ? { occupation_detail: about.occupationDetail }
        : {}),
      ...(about.referralSource
        ? { referral_source: about.referralSource }
        : {}),
      ...(about.referralDetail
        ? { referral_detail: about.referralDetail }
        : {}),
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
