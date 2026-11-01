import { useEffect, useRef } from "react"
import { talkLaunch } from "./launch"

// Talk to Fern (a Shortcut or Back Tap, src/surfaces/links.ts): the
// composer's dictation stops at a pause in speech, and what was said sends
// by itself once the server's second pass at the words has had a moment.
// Saying nothing sends nothing. Plain dictation and "Hey Fern" still wait
// for the person to tap Send.

/** This long without new words ends the dictation. */
export const TALK_PAUSE_MS = 1_800
/** The message sends this long after the dictation ends. */
export const TALK_SEND_MS = 1_200
/** A talk launch older than this is stale. */
const TALK_FRESH_MS = 10_000

export function useTalkAutoSend({
  text,
  listening,
  stop,
  send,
}: {
  text: string
  listening: boolean
  stop: () => void
  send: () => void
}) {
  const talking = useRef(false)
  const latest = useRef({ stop, send })
  latest.current = { stop, send }

  useEffect(() => {
    if (!talking.current || !listening || !text.trim()) return
    const id = setTimeout(() => latest.current.stop(), TALK_PAUSE_MS)
    return () => clearTimeout(id)
  }, [text, listening])

  useEffect(() => {
    if (!talking.current || listening) return
    if (!text.trim()) {
      talking.current = false
      return
    }
    const id = setTimeout(() => {
      talking.current = false
      latest.current.send()
    }, TALK_SEND_MS)
    return () => clearTimeout(id)
  }, [text, listening])

  /** Call as the composer starts dictating for a wake: takes the pending
   * talk launch, if any, and arms the auto-send for this dictation. */
  return function arm() {
    const at = talkLaunch.getState().at
    talkLaunch.setState({ at: null })
    talking.current = at !== null && Date.now() - at < TALK_FRESH_MS
  }
}
