import { parseCapture } from "@domain/capture/parse"
import type { ModuleKey } from "@domain/contract"
import { dashStore } from "@domain/dash/store"
import * as FA from "@domain/finance/actions"
import * as N from "@domain/finance/calc"
import { finStore } from "@domain/finance/store"
import * as FO from "@domain/focus/actions"
import { type FocusMode, PRESETS } from "@domain/focus/data"
import { focusStore } from "@domain/focus/store"
import { money } from "@domain/lib/money"
import { privacyStore } from "@domain/lib/privacy"
import { flushStores } from "@domain/lib/store"
import { ask } from "@/prototype/companion/brain"
import {
  answering,
  companionStore,
  type Msg,
  replying,
} from "@/prototype/companion/store"
import { widgetRoute } from "./links"
import { drainRequests, replyRequest, type ShortcutRequest } from "./native"

// What Shortcuts, Siri, the Action button and Back Tap ask the app for
// (plugins/app-intents/UnfurlAppIntents.swift). Each request calls the
// action the in-app control calls, so it lands in the same store, outbox and
// sync, and the reply is what the intent shows: a sentence the person reads,
// or ``error`` with the reason it did not happen.

export type Reply = Record<string, unknown>

export interface RequestDeps {
  /** Opens a route (expo-router's push in the app). */
  navigate: (route: string) => void
  /** How long Ask Fern waits for the reply; the intent itself gives up a
   * little later and opens the app. */
  fernTimeoutMs?: number
  pollMs?: number
}

const enabled = (k: ModuleKey) => !!dashStore.get().enabled[k]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// MARK: Quick expense

/** "₱250 lunch", "250 grab to work", "1.2k groceries gcash": logged the
 * way Finance's quick add logs, with today's spend against the day's cap. */
export function quickExpense(text: string): Reply {
  if (!enabled("finance"))
    return { error: "Turn on Finance in Unfurl to log spending." }
  const draft = parseCapture(text, {
    hint: "expense",
    source: "shortcut",
    at: new Date().toISOString(),
  }).find((d) => d.t === "record" && d.kind === "expense")
  const p = draft?.t === "record" ? draft.payload : null
  const amount = p && "amount" in p ? Number(p.amount) : 0
  if (!p || !(amount > 0))
    return {
      error: `I couldn't find an amount in “${text}”. Try something like “250 lunch”.`,
    }
  const categoryId =
    "categoryId" in p && typeof p.categoryId === "string"
      ? p.categoryId
      : undefined
  const payee =
    "payee" in p && typeof p.payee === "string" ? p.payee : undefined
  const accountId =
    "accountId" in p && typeof p.accountId === "string"
      ? p.accountId
      : undefined
  FA.logExpense({
    amount,
    categoryId,
    accountId,
    payee,
    note: text,
    source: "quick-add",
  })
  flushStores()

  const s = finStore.get()
  const cat = categoryId
    ? s.categories.find((c) => c.id === categoryId)?.name
    : undefined
  const day = N.today()
  const spentToday = N.spendIn(s, day, day, null)
  const overall = s.budgets.find((b) => !b.archived && b.categoryIds === null)
  const cap = overall
    ? N.todayAllowance(N.budgetView(s, overall), spentToday)
    : null
  return {
    amount: money(amount),
    what: cat ?? payee ?? "",
    spentToday: money(spentToday),
    cap: cap === null ? null : money(cap),
    share: cap ? Math.min(1, spentToday / cap) : 0,
    over: cap !== null && spentToday > cap,
    hidden: privacyStore.get().hidden,
  }
}

// MARK: Focus

export function focusStart(mode?: unknown): Reply {
  if (!enabled("focus")) return { error: "Turn on Focus in Unfurl first." }
  if (FO.current(focusStore.get()))
    return { text: "Focus is already running. Say “Stop focus” to end it." }
  const st = focusStore.get().settings
  const m: FocusMode =
    mode === "pomodoro" || mode === "stopwatch" ? mode : st.mode
  FO.startFocus({ mode: m })
  flushStores()
  if (m === "stopwatch")
    return { text: "Focus started. It counts up until you stop it." }
  const [work, rest] =
    st.preset !== "custom"
      ? PRESETS[st.preset].lengths
      : [st.focusMin, st.shortBreakMin]
  return {
    text: `Focus started: ${work} minutes, then a ${rest}-minute break.`,
  }
}

export function focusStop(): Reply {
  if (!FO.current(focusStore.get()))
    return { text: "No focus session is running." }
  FO.stopFocus()
  flushStores()
  return { text: "Focus stopped. Your time is saved." }
}

// MARK: Ask Fern

/** Steps whose card waits for the person (Confirm, or a question back). */
const WAITING = new Set(["proposed", "needs_input"])

function needsApp(m: Msg): boolean {
  for (const b of m.blocks ?? [])
    if (b.t === "steps")
      for (const s of b.items) {
        if (s.state && WAITING.has(s.state)) return true
        if (s.cards?.some((c) => WAITING.has(c.state))) return true
      }
  return false
}

/** Siri gives an intent about ten seconds before it says "Something went
 * wrong" (the Shortcuts app waits longer), so Ask Fern answers within this
 * and otherwise hands over to the app, where the reply goes on. */
export const FERN_SHORTCUT_WAIT_MS = 7_000

/** Longest answer Siri reads aloud. */
const SPOKEN_MAX = 200
/** Lines on the card under it; the rest is in the chat. */
const LINES_MAX = 8

export type ShortcutAnswer = {
  /** Read aloud and shown: the first sentence, or the whole answer. */
  spoken: string
  /** The rest, one item or sentence a line, never repeating ``spoken``. */
  lines: string[]
  /** More is in the chat than these show. */
  more: boolean
}

const cut = (s: string, max: number) =>
  s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}…`

/** Fern's reply as Siri and Shortcuts show it: a short spoken answer, and
 * the rest as lines on the card (FernReplySnippet in
 * plugins/app-intents/UnfurlAppIntents.swift). */
export function shortcutAnswer(text: string): ShortcutAnswer {
  const parts = text
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:[•*-]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    .flatMap((l) => l.split(/(?<=[.!?])\s+(?=\S)/))
    .map((l) => l.trim())
    .filter(Boolean)
  const whole = parts.join(" ")
  if (whole.length <= SPOKEN_MAX && parts.length <= 2)
    return { spoken: whole, lines: [], more: false }
  const [first = "", ...rest] = parts
  const spoken = cut(first, SPOKEN_MAX)
  return {
    spoken,
    lines: rest.slice(0, LINES_MAX),
    more: rest.length > LINES_MAX || spoken !== first,
  }
}

/** Fern's finished reply to the question asked after ``before`` was taken,
 * or null while she is still on it. */
export function fernReply(before: Set<string>): Reply | null {
  const fresh = companionStore.get().messages.filter((m) => !before.has(m.id))
  const me = fresh.find((m) => m.role === "me")
  if (me?.status === "failed")
    return { error: "Fern couldn't answer just now. Try again in a moment." }
  if (me?.status === "queued")
    return {
      error:
        "You're offline. Fern will answer in Unfurl once you're back online.",
    }
  const sol = fresh.filter((m) => m.role === "sol").at(-1)
  if (!sol) return null
  if (replying.getState().id || answering.getState().id) return null
  const text = (sol.text ?? "").trim()
  return {
    text: text.length > 900 ? `${text.slice(0, 897).trimEnd()}…` : text,
    ...shortcutAnswer(text),
    needsApp: needsApp(sol),
  }
}

export async function askFern(
  text: string,
  {
    fernTimeoutMs = FERN_SHORTCUT_WAIT_MS,
    pollMs = 250,
  }: Partial<RequestDeps> = {},
): Promise<Reply> {
  const before = new Set(companionStore.get().messages.map((m) => m.id))
  ask(text)
  const deadline = Date.now() + fernTimeoutMs
  while (Date.now() < deadline) {
    await sleep(pollMs)
    const r = fernReply(before)
    if (r) return r
  }
  // Still writing: the intent opens the app, where the reply goes on.
  return { pending: true }
}

// MARK: Dispatch

export async function handleRequest(
  r: ShortcutRequest,
  deps: RequestDeps,
): Promise<Reply | null> {
  switch (r.type) {
    case "open": {
      const path = typeof r.path === "string" ? r.path : "/today"
      deps.navigate(widgetRoute(path) ?? path)
      return null
    }
    case "askFern":
      return typeof r.text === "string" && r.text.trim()
        ? askFern(r.text.trim(), deps)
        : { error: "Ask Fern something first." }
    case "expense":
      return typeof r.text === "string" && r.text.trim()
        ? quickExpense(r.text.trim())
        : { error: "Say how much, and for what." }
    case "focusStart":
      return focusStart(r.mode)
    case "focusStop":
      return focusStop()
    default:
      return { error: "Update Unfurl to use this shortcut." }
  }
}

/** Answers every queued request, started oldest first; each replies as
 * soon as it is done, so a quick expense never waits behind Fern. An open
 * request only moves the app, so it gets no reply. */
export async function runShortcutRequests(deps: RequestDeps): Promise<number> {
  const queued = drainRequests().sort((a, b) => a.at - b.at)
  await Promise.all(
    queued.map(async (r) => {
      let reply: Reply | null
      try {
        reply = await handleRequest(r, deps)
      } catch {
        reply = { error: "Something went wrong in Unfurl. Try it in the app." }
      }
      if (reply) replyRequest(r.id, reply)
    }),
  )
  return queued.length
}
