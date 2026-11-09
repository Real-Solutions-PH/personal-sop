// Today's Fern messages, as the server counts them (GET /companion/allowance):
// the free allowance, or Unfurl Plus's fair-use hard stops. The chat shows
// how many are left once few remain, and at zero when they come back and an
// "Unfurl Plus" button. A refused message (402 fern_daily_allowance_reached
// or fern_monthly_limit_reached) also lands here, from its error body.

import { num } from "@domain/lib/num"
import { createStore } from "@domain/lib/store"
import { liveMode } from "@/live/config"

export interface Allowance {
  /** False when a message would not count (the person's own AI key, or
   * the AI off): nothing is shown. */
  applies: boolean
  plan: "free" | "plus"
  limit: number
  used: number
  remaining: number
  /** ISO instant today's count starts again. */
  resetsAt: string
  /** Plus at its monthly limit, and the ISO instant it lifts. */
  monthStopped: boolean
  monthResetsAt: string | null
}

/** Shown from this many messages left. */
export const FEW_LEFT = 3

export const allowanceStore = createStore<Allowance | null>(
  "fern-allowance",
  () => null,
)

const str = (v: unknown) => (typeof v === "string" && v ? v : null)
const int = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0

/** The server's answer as the phone keeps it; null when it is not one. */
export function allowanceFromServer(
  row: Record<string, unknown>,
): Allowance | null {
  const resetsAt = str(row.resets_at)
  if (!resetsAt) return null
  return {
    applies: row.applies === true,
    plan: row.plan === "plus" ? "plus" : "free",
    limit: int(row.limit),
    used: int(row.used),
    remaining: int(row.remaining),
    resetsAt,
    monthStopped: row.month_stopped === true,
    monthResetsAt: str(row.month_resets_at),
  }
}

export const ALLOWANCE_CODES = [
  "fern_daily_allowance_reached",
  "fern_monthly_limit_reached",
] as const

/** A refused message's error body: today's (or this month's) limit is
 * reached. Keeps what the store knew and marks it used up. */
export function noteRefusal(code: string, details: unknown): boolean {
  if (!(ALLOWANCE_CODES as readonly string[]).includes(code)) return false
  const d = (details ?? {}) as Record<string, unknown>
  const resetsAt = str(d.resets_at)
  allowanceStore.set((prev) => {
    const monthly = code === "fern_monthly_limit_reached"
    const base: Allowance = prev ?? {
      applies: true,
      plan: d.plan === "plus" ? "plus" : "free",
      limit: int(d.limit),
      used: int(d.limit),
      remaining: 0,
      resetsAt: resetsAt ?? new Date().toISOString(),
      monthStopped: false,
      monthResetsAt: null,
    }
    return monthly
      ? {
          ...base,
          applies: true,
          monthStopped: true,
          monthResetsAt: resetsAt ?? base.monthResetsAt,
        }
      : {
          ...base,
          applies: true,
          used: base.limit || base.used,
          remaining: 0,
          resetsAt: resetsAt ?? base.resetsAt,
        }
  })
  // The server's own figures follow.
  void refreshAllowance()
  return true
}

type Fetcher = () => Promise<Record<string, unknown>>
let fetcher: Fetcher | null = null
/** Tests set how the server is asked; live mode GETs the allowance. */
export function setAllowanceFetcher(f: Fetcher | null) {
  fetcher = f
}
function ask(): Fetcher | null {
  if (fetcher) return fetcher
  if (!liveMode) return null
  try {
    const http = (
      require("@/live/auth") as Partial<typeof import("@/live/auth")>
    ).http
    return http
      ? async () =>
          (await http.request("GET", "/companion/allowance")) as Record<
            string,
            unknown
          >
      : null
  } catch {
    return null
  }
}

/** Asks the server where today's messages stand and keeps the answer. A
 * failed ask leaves what was known. */
export async function refreshAllowance(): Promise<void> {
  const get = ask()
  if (!get) return
  try {
    const next = allowanceFromServer(await get())
    if (next) allowanceStore.set(next)
  } catch {
    // Offline or refused: the last answer stands until the next reply.
  }
}

export type AllowanceView =
  | { kind: "none" }
  | { kind: "few"; text: string }
  | { kind: "out"; text: string }

function clockTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

/** "at 4:00 AM" today, "tomorrow at 4:00 AM", else "on Dec 1". */
export function whenText(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return "soon"
  const sameDay = at.toDateString() === now.toDateString()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (sameDay) return `at ${clockTime(at)}`
  if (at.toDateString() === tomorrow.toDateString())
    return `tomorrow at ${clockTime(at)}`
  return `on ${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
}

/** What the chat shows for ``a``: nothing, how many are left (3 or fewer),
 * or that they are used up and when they come back. */
export function allowanceView(
  a: Allowance | null,
  name: string,
  now: Date = new Date(),
): AllowanceView {
  if (!a?.applies) return { kind: "none" }
  if (a.monthStopped && a.monthResetsAt)
    return {
      kind: "out",
      text: `${name} has reached this month's fair-use limit. Messages come back ${whenText(a.monthResetsAt, now)}.`,
    }
  if (a.remaining <= 0)
    return {
      kind: "out",
      text: `That's all of today's messages with ${name}. They come back ${whenText(a.resetsAt, now)}.`,
    }
  if (a.remaining <= FEW_LEFT)
    return {
      kind: "few",
      text: `${num(a.remaining, 0)} ${a.remaining === 1 ? "message" : "messages"} left today`,
    }
  return { kind: "none" }
}

/** Whether this build can open the paywall: the Plus row is shown only
 * once the store key is set (EXPO_PUBLIC_REVENUECAT_IOS_KEY). */
export function plusAvailable(): boolean {
  return !!process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
}

/** Where the paywall lives (Me → Unfurl Plus). */
export const PLUS_HREF = "/me/plan"
