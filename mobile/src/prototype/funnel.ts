// Onboarding funnel events: which steps a new person sees, finishes or
// skips, and which modules they tick or untick. Most of it happens before
// the account exists, so events carry a random id made on this phone, never
// the account, and nothing typed. Kept in a queue on the phone and sent in
// small batches to the public POST /funnel/events (live mode only); a
// failed send stays queued for the next one.
import { newId } from "@domain/lib/ids"
import { createStore } from "@domain/lib/store"
import { liveMode } from "@/live/config"

export type FunnelStep =
  | "identity"
  | "about"
  | "modules"
  | "capture"
  | "targets"
  | "when"
  | "building"
  | "pledge"
  | "account"
  | "notifications"
  | "done"
  | "setup"
export type FunnelModule =
  | "habits"
  | "tasks"
  | "fitness"
  | "nutrition"
  | "focus"
  | "finance"
  | "screen"
  | "journal"
  | "social"

export type FunnelEvent =
  | {
      event: "step_view" | "step_complete" | "step_skip"
      step: FunnelStep
      module?: FunnelModule
    }
  | {
      /** A tick changed (toggle), or its state when the step was left
       * (choice). */
      event: "module_toggle" | "module_choice"
      step: FunnelStep
      module: FunnelModule
      turned_on: boolean
    }

type Queued = FunnelEvent & { at: string }

const QUEUE_LIMIT = 200
const BATCH = 50

export const funnelStore = createStore<{
  installId: string
  queue: Queued[]
}>("funnel", () => ({ installId: "", queue: [] }))

/** The random id this install sends, made on first use. */
export function installId(): string {
  const cur = funnelStore.get().installId
  if (cur) return cur
  const id = newId()
  funnelStore.set((s) => ({ ...s, installId: id }))
  return id
}

type Post = (path: string, body: unknown) => Promise<unknown>
let post: Post | null = null
/** Tests and the live runtime set how a batch is sent. */
export function setFunnelSender(p: Post | null) {
  post = p
}
function sender(): Post | null {
  if (post) return post
  if (!liveMode) return null
  const { http } = require("@/live/auth") as typeof import("@/live/auth")
  return (path, body) => http.request("POST", path, body)
}

let timer: ReturnType<typeof setTimeout> | null = null
let sending = false

/** Records one event and sends the queue shortly after. */
export function logFunnel(e: FunnelEvent, at = new Date()) {
  if (!liveMode && !post) return
  installId()
  funnelStore.set((s) => ({
    ...s,
    queue: [...s.queue, { ...e, at: at.toISOString() }].slice(-QUEUE_LIMIT),
  }))
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void flushFunnel()
  }, 1500)
}

/** Sends what is queued, a batch at a time; stops at the first failure. */
export async function flushFunnel(): Promise<number> {
  const send = sender()
  if (!send || sending) return 0
  sending = true
  let sent = 0
  try {
    for (;;) {
      const batch = funnelStore.get().queue.slice(0, BATCH)
      if (!batch.length) break
      try {
        await send("/funnel/events", {
          install_id: installId(),
          events: batch,
        })
      } catch {
        break
      }
      sent += batch.length
      funnelStore.set((s) => ({ ...s, queue: s.queue.slice(batch.length) }))
    }
  } finally {
    sending = false
  }
  return sent
}
