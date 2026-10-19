import { dashStore, updateProfile } from "@domain/dash/store"
import { createStore } from "@domain/lib/store"
import { liveMode } from "@/live/config"

// Live mode backs these same actions with Supabase + the API server
// (src/live). Loaded lazily so prototype mode never initialises Supabase.
const live = () => require("@/live/auth") as typeof import("@/live/auth")
const runtime = () =>
  require("@/live/runtime") as typeof import("@/live/runtime")
const storage = () =>
  (require("./storage") as typeof import("./storage")).prototypeStorage()

async function viaLive<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const e = error as { message?: string; field?: AuthError["field"] }
    throw new AuthError(
      e.message ?? "Something went wrong. Please try again.",
      e.field,
    )
  }
}

/** Live mode: start sync for the signed-in Supabase user. */
export async function startLiveSession() {
  const uid = await live().currentUserId()
  if (uid) runtime().startLive(uid, storage())
  return uid
}

// Simulated account session for the UX prototype. Nothing leaves the device:
// every call resolves locally after a short delay so loading states are visible.

export type User = { name: string; username: string; email: string }
export type Session = {
  signedIn: boolean
  user: User | null
  rememberedEmail: string
  /** Account created on sign-up, waiting for its email verification code. */
  pending: User | null
  /** Address a password-reset link was sent to. */
  resetEmail: string
}

const signedOut = (): Session => ({
  signedIn: false,
  user: null,
  rememberedEmail: "",
  pending: null,
  resetEmail: "",
})
export const sessionStore = createStore<Session>("auth-session", signedOut)
// "Reset demo data" calls resetAll() for every store; that restores sample
// records but must not sign the person out, so this store opts out.
sessionStore.reset = () => {}

export const LATENCY = 700
const wait = (ms = LATENCY) => new Promise((done) => setTimeout(done, ms))
export class AuthError extends Error {
  constructor(
    message: string,
    readonly field?: "email" | "password" | "username" | "code",
  ) {
    super(message)
  }
}

// --- Validation (pure; used inline by the screens) ---
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export function emailError(value: string) {
  const email = value.trim()
  if (!email) return "Enter your email address"
  if (!EMAIL.test(email)) return "Enter a valid email, like name@example.com"
  return undefined
}
export function nameError(value: string) {
  return value.trim().length < 2 ? "Enter your name" : undefined
}
export function usernameError(value: string) {
  if (value.length < 3) return "Use at least 3 characters"
  if (value.length > 20) return "Use 20 characters or fewer"
  if (!/^[a-z0-9._]+$/.test(value))
    return "Use lowercase letters, numbers, dots or underscores"
  return undefined
}
export const passwordRules = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  {
    label: "Upper and lowercase letters",
    test: (p: string) => /[a-z]/.test(p) && /[A-Z]/.test(p),
  },
  { label: "A number", test: (p: string) => /\d/.test(p) },
  {
    label: "A symbol, like ! or #",
    test: (p: string) => /[^A-Za-z0-9]/.test(p),
  },
] as const
export function passwordStrength(password: string) {
  const checks = passwordRules.map((r) => ({
    label: r.label,
    ok: r.test(password),
  }))
  const passed = checks.filter((c) => c.ok).length
  const score = !password
    ? 0
    : Math.min(4, passed + (password.length >= 12 ? 1 : 0))
  return {
    checks,
    score,
    label: ["Too short", "Weak", "Fair", "Good", "Strong"][score],
    /** The minimum the forms accept: 8+ characters and every rule but one. */
    acceptable: checks[0].ok && passed >= 3,
  }
}
export function maskEmail(email: string) {
  const [local, domain] = email.trim().split("@")
  if (!domain) return email
  const shown = local.length <= 2 ? local[0] : local.slice(0, 2)
  return `${shown}${"•".repeat(Math.max(1, Math.min(6, local.length - shown.length)))}@${domain}`
}

// --- Simulated directory ---
const TAKEN_EMAILS = ["taken@example.com"]
const TAKEN_USERNAMES = ["kai", "kai.sop", "admin", "taken", "personal.sop"]
const nameFromEmail = (email: string) => {
  const local = email
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .trim()
  return local ? local.replace(/\b\w/g, (c) => c.toUpperCase()) : "Friend"
}
export async function checkUsername(username: string) {
  await wait(450)
  return TAKEN_USERNAMES.includes(username) ? "taken" : "available"
}

// --- Actions ---
export async function signIn({
  email,
  password,
  remember,
}: {
  email: string
  password: string
  remember: boolean
}) {
  const address = email.trim().toLowerCase()
  if (liveMode) {
    if (emailError(address) || !password)
      throw new AuthError("Enter your email and password")
    await viaLive(() => live().signIn(address, password))
    await startLiveSession()
  } else {
    await wait()
    if (emailError(address) || !password)
      throw new AuthError("Enter your email and password")
    if (password === "wrong")
      throw new AuthError("Incorrect email or password", "password")
  }
  sessionStore.set((s) => ({
    ...s,
    signedIn: true,
    pending: null,
    user: { name: nameFromEmail(address), username: "", email: address },
    rememberedEmail: remember ? address : "",
  }))
}
export async function continueWith(provider: "apple" | "google") {
  if (liveMode)
    throw new AuthError(
      `${provider === "apple" ? "Apple" : "Google"} sign-in isn't available yet. Use your email instead.`,
    )
  await wait()
  sessionStore.set((s) => ({
    ...s,
    signedIn: true,
    pending: null,
    user: {
      name: dashStore.get().profile.name,
      username: dashStore.get().profile.handle.replace(/^@/, ""),
      email: `you@${provider === "apple" ? "icloud.com" : "gmail.com"}`,
    },
  }))
}
export async function signUp(user: User & { password: string }) {
  const email = user.email.trim().toLowerCase()
  if (liveMode) {
    await viaLive(() =>
      live().signUp(email, user.password, user.name.trim(), user.username),
    )
    sessionStore.set((s) => ({
      ...s,
      pending: { name: user.name.trim(), username: user.username, email },
    }))
    return
  }
  await wait()
  if (TAKEN_EMAILS.includes(email))
    throw new AuthError(
      "An account with this email already exists. Sign in instead?",
      "email",
    )
  if (TAKEN_USERNAMES.includes(user.username))
    throw new AuthError("That username was just taken", "username")
  sessionStore.set((s) => ({
    ...s,
    pending: { name: user.name.trim(), username: user.username, email },
  }))
}
export async function resendCode() {
  const pending = sessionStore.get().pending
  if (liveMode && pending)
    return viaLive(() => live().resendSignUp(pending.email))
  await wait(500)
}
export async function verifyEmail(code: string) {
  if (liveMode) {
    const pending = sessionStore.get().pending
    if (!pending)
      throw new AuthError("Your sign-up expired. Please start again.")
    await viaLive(() => live().verifySignUp(pending.email, code))
    return
  }
  await wait()
  if (code === "000000")
    throw new AuthError("That code is incorrect or has expired", "code")
  if (!sessionStore.get().pending)
    throw new AuthError("Your sign-up expired. Please start again.")
}
/** Signs in the verified account. Kept separate from verifyEmail so the
 * screen can show its success state before the auth routes unmount. */
export function completeSignUp() {
  const user = sessionStore.get().pending
  if (!user) return
  updateProfile({ name: user.name, handle: `@${user.username}` })
  sessionStore.set((s) => ({ ...s, signedIn: true, user, pending: null }))
  if (liveMode) {
    void startLiveSession()
    void live()
      .completeProfile(user.name, user.username)
      .catch(() => {
        // The handle stays editable in Me → Profile; sign-in already worked.
      })
  }
}
export async function requestPasswordReset(email: string) {
  if (liveMode)
    await viaLive(() => live().requestReset(email.trim().toLowerCase()))
  else await wait()
  sessionStore.set((s) => ({ ...s, resetEmail: email.trim().toLowerCase() }))
}
export async function resetPassword(password: string) {
  if (liveMode) await viaLive(() => live().updatePassword(password))
  else await wait()
  sessionStore.set((s) => ({
    ...s,
    rememberedEmail: s.resetEmail || s.rememberedEmail,
  }))
}
export function signOut() {
  if (liveMode) {
    // Push what is still queued, then forget this account's data on the
    // device so the next account starts clean.
    const engine = runtime().engine()
    void (engine ? engine.sync() : Promise.resolve()).finally(() => {
      runtime().stopLive()
      void live().signOut()
      for (const key of [
        "sop-live:outbox",
        "sop-live:snapshot",
        "sop-live:cursor",
        "sop-live:owner",
      ])
        storage().removeItem(key)
      ;(require("@/live/blank") as typeof import("@/live/blank")).clearToBlank()
    })
  }
  sessionStore.set((s) => ({
    ...signedOut(),
    rememberedEmail: s.rememberedEmail,
  }))
}

// Carries an email between auth screens without putting it in the URL.
let handoff = ""
export const handOffEmail = (email: string) => {
  handoff = email.trim()
}
export const takeHandoffEmail = () => {
  const email = handoff
  handoff = ""
  return email
}
