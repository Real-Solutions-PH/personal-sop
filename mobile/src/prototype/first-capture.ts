// Onboarding's "Say one thing from today", held until the account exists.
//
// Decision: the step runs before sign-up, when there is no account for
// Fern's capture endpoint to write to, so the words are kept in the
// onboarding draft (on this phone only). Sign-up moves them here
// (applyDraft), and once live mode has started for the new account they go
// through the ordinary capture path, sendCapture: online it streams to the
// server and Fern logs it; offline the capture is queued and the sync
// outbox sends it on reconnect, like any other capture. The finish step
// then shows what Fern saved. Nothing is sent before the account exists.
import type { CaptureSource } from "@domain/capture/data"
import { sendCapture } from "@domain/capture/engine"
import { createStore } from "@domain/lib/store"

export interface HeldCapture {
  text: string
  source: Extract<CaptureSource, "text" | "voice">
}

export const firstCaptureStore = createStore<{
  /** Waiting for live mode to start for the new account. */
  pending: HeldCapture | null
  /** The capture it became, for the finish step. */
  sentId: string | null
}>("first-capture", () => ({ pending: null, sentId: null }))

export const holdFirstCapture = (c: HeldCapture | null) =>
  firstCaptureStore.set({ pending: c?.text.trim() ? c : null, sentId: null })

export const forgetFirstCapture = () =>
  firstCaptureStore.set({ pending: null, sentId: null })

/** Sends the held capture once; a no-op with nothing held. Returns the
 * capture's id. */
export function replayFirstCapture(): string | null {
  const { pending } = firstCaptureStore.get()
  if (!pending) return null
  // Cleared first: a send that throws must not send it twice later.
  firstCaptureStore.set({ pending: null, sentId: null })
  const id = sendCapture({ text: pending.text.trim(), source: pending.source })
  firstCaptureStore.set({ pending: null, sentId: id })
  return id
}
