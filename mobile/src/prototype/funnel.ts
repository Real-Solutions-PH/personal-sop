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
  | "welcome"
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
  // The guided tour after onboarding (tour/machine.ts).
  | "tour_fern"
  | "tour_tick"
  | "tour_plan"
  | "tour_stats"
  | "tour_remind"
  // Anywhere in the app after onboarding (first_log only).
  | "app"
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
  | {
      /** This install's first log (a message to Fern, a tick, an entry),
       * once; ``step`` is where it happened. With the first step_view it
       * gives the time from opening the app to the first log (KPI 6). */
      event: "first_log"
      step: FunnelStep
    }

type Queued = FunnelEvent & { at: string }

const QUEUE_LIMIT = 200
const BATCH = 50

export const funnelStore = createStore<{
  installId: string
  queue: Queued[]
  /** first_log was recorded for this install. */
  firstLogged?: boolean
}>("funnel", () => ({ installId: "", queue: [] }))

/** Records first_log once per install; later calls do nothing. */
export function noteFirstLog(step: FunnelStep, at = new Date()) {
  if (funnelStore.get().firstLogged) return
  funnelStore.set((s) => ({ ...s, firstLogged: true }))
  logFunnel({ event: "first_log", step }, at)
}

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
/** The live API client, or null where there is none (prototype mode, or a
 * test that mocks the auth module without it). Never throws: the send runs
 * from a timer, where a throw would surface in whatever runs next. */
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
  // The client is looked up now, while the caller is running, never from
  // the timer: a module loaded from a timer can outlive its test.
  const send = sender()
  if (!send) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    flushFunnel(send).catch(() => {})
  }, 1500)
  // Never keeps the process alive on its own (Node; a no-op elsewhere).
  ;(timer as { unref?: () => void }).unref?.()
}

/** Sends what is queued, a batch at a time; stops at the first failure. */
export async function flushFunnel(
  send: Post | null = sender(),
): Promise<number> {
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
