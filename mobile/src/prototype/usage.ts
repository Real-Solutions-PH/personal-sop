// App usage events: the app came to the foreground, left it, a share card
// was shared, a notification was tapped, or an Unfurl Plus moment (the paywall shown, a purchase
// started, purchases restored). They measure app opens, time in app and share cards
// (docs/25-retention-kpis.md); the record tables cannot. Signed-in, live
// mode only. Each event carries the kind, the moment and, for a share, the
// card's fixed key, never anything typed. Kept in a queue on the phone and
// sent in batches to POST /usage/events; a failed send stays queued.
import { createStore } from "@domain/lib/store"
import { liveMode } from "@/live/config"
import { sessionStore } from "./session"

export type UsageEvent =
  | { kind: "app_open" | "app_close" | "paywall_shown" | "restored" }
  | { kind: "share_card"; detail: string }
  // Unfurl Plus: which product the person tapped.
  | { kind: "purchase_started"; detail: string }
  // A notification tapped: the server notification's id, or the local
  // reminder's category (notifications.ts ``pushOpenDetail``).
  | { kind: "push_open"; detail: string }

/** ``account``: whose session it was logged in, so a queue left from one
 * account is never sent as another's. Stays on the phone. */
type Queued = UsageEvent & { at: string; account: string }

const QUEUE_LIMIT = 200
const BATCH = 50

export const usageStore = createStore<{ queue: Queued[] }>("usage", () => ({
  queue: [],
}))

type Post = (path: string, body: unknown) => Promise<unknown>
let post: Post | null = null
/** Tests and the live runtime set how a batch is sent. */
export function setUsageSender(p: Post | null) {
  post = p
}
function sender(): Post | null {
  if (post) return post
  if (!liveMode) return null
  try {
    const http = (
      require("@/live/auth") as Partial<typeof import("@/live/auth")>
    ).http
    return http ? (path, body) => http.request("POST", path, body) : null
  } catch {
    return null
  }
}

function account(): string | null {
  const s = sessionStore.get()
  return s.signedIn && s.user ? s.user.email : null
}

/** A card key as the server takes it: lowercase letters, digits, - and _. */
export function cardKey(key: string): string {
  return (
    key
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .slice(0, 40) || "card"
  )
}

let timer: ReturnType<typeof setTimeout> | null = null
let sending = false

/** Records one event. ``now``: send at once (leaving the foreground, when
 * the app may not run again for a while); otherwise shortly after. */
export function logUsage(e: UsageEvent, opts: { now?: boolean } = {}) {
  const send = sender()
  const who = account()
  if (!send || !who) return
  const ev =
    e.kind === "share_card" || e.kind === "push_open"
      ? { ...e, detail: cardKey(e.detail) }
      : { ...e }
  usageStore.set((s) => ({
    queue: [
      ...s.queue,
      { ...ev, at: new Date().toISOString(), account: who },
    ].slice(-QUEUE_LIMIT),
  }))
  if (timer) clearTimeout(timer)
  if (opts.now) {
    timer = null
    flushUsage(send).catch(() => {})
    return
  }
  timer = setTimeout(() => {
    timer = null
    flushUsage(send).catch(() => {})
  }, 1500)
  ;(timer as { unref?: () => void }).unref?.()
}

/** Sends the current account's queued events a batch at a time and drops
 * any left from another account; stops at the first failure. */
export async function flushUsage(
  send: Post | null = sender(),
): Promise<number> {
  const who = account()
  if (!send || !who || sending) return 0
  sending = true
  let sent = 0
  try {
    usageStore.set((s) => ({
      queue: s.queue.filter((q) => q.account === who),
    }))
    for (;;) {
      const batch = usageStore.get().queue.slice(0, BATCH)
      if (!batch.length) break
      try {
        await send("/usage/events", {
          events: batch.map(({ account: _, ...rest }) => rest),
        })
      } catch {
        break
      }
      sent += batch.length
      usageStore.set((s) => ({ queue: s.queue.slice(batch.length) }))
    }
  } finally {
    sending = false
  }
  return sent
}
