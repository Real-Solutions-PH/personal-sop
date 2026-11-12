// What a notification does in the app: a tap opens its link, and Fern's
// "replied" push opens that chat (closing the drawer first). A banner that
// arrives while the app is open shows, except Fern's reply to the very chat
// on screen, which the person is already watching arrive.

import { captureUi, closeCapture } from "@domain/lib/capture"
import { create } from "zustand"
import { companionStore, currentThread } from "./companion/store"
import { go } from "./navigation"
import { logUsage } from "./usage"

type Notifications = typeof import("expo-notifications")
type Data = Record<string, unknown> | undefined | null

/** Fern's reply push (backend companion/notify.py). */
export const FERN_REPLY = "companion.reply"

/** The full Fern chat page is on screen (the drawer is ``captureUi``). */
export const chatPage = create<{ on: boolean }>(() => ({ on: false }))

/** The Fern chat on screen, if any. */
function chatOnScreen(): string | null {
  if (!captureUi.get().open && !chatPage.getState().on) return null
  return currentThread(companionStore.get())
}

export function showsBanner(data: Data): boolean {
  if (data?.kind !== FERN_REPLY) return true
  return data.thread_id !== chatOnScreen()
}

export function openNotification(data: Data) {
  const href = data?.href
  if (typeof href !== "string") return
  if (data?.kind === FERN_REPLY) closeCapture()
  go(href)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The reminders the phone schedules itself (local-reminders.ts and the
// workout rest alarm), by the start of their identifier.
const LOCAL =
  /^(task|habit|routine|weigh-in|bill|checkin|eat-back|workout-rest|test-reminder)/

/** What a tapped notification records (docs/26-retention-algorithms.md
 * §1.3): a push the server sent carries its inbox notification's id, which
 * is how a nudge learns it was opened; anything else records its category,
 * never its content. */
export function pushOpenDetail(identifier: string, data: Data): string {
  const id = data?.notification_id
  if (typeof id === "string" && UUID.test(id)) return id.toLowerCase()
  if (typeof data?.kind === "string") return data.kind
  const local = LOCAL.exec(identifier)
  return local ? local[1] : "other"
}

/** Record a tap on a notification (signed-in, live mode only). */
export function notePushOpen(request: {
  identifier: string
  content: { data?: Data }
}) {
  logUsage(
    {
      kind: "push_open",
      detail: pushOpenDetail(request.identifier, request.content.data),
    },
    { now: true },
  )
}

let launched: string | null = null
/** A tap that started the app reaches no listener: route it once. */
export function routeLaunchNotification(N: Notifications) {
  const r = N.getLastNotificationResponse?.()
  if (!r) return
  const id = r.notification.request.identifier
  if (id === launched) return
  launched = id
  N.clearLastNotificationResponse?.()
  notePushOpen(r.notification.request)
  openNotification(r.notification.request.content.data)
}
