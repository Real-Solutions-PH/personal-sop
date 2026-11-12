// Onboarding's "Tell me one thing from today". The account already exists
// (account first), so the step holds the words here and sends them at once
// through the ordinary capture path, sendCapture: online it streams to the
// server and Fern answers on the same screen; offline the capture is queued
// and the sync outbox sends it on reconnect. A capture still held when live
// mode starts (the app closed mid-send) is sent then; one left from an
// unfinished sign-up is dropped at sign-up and sign-in, never sent into
// another account.
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
