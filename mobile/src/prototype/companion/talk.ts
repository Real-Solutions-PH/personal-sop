import { useEffect, useRef } from "react"
import { talkLaunch } from "./launch"

// Talk to Fern (a Shortcut or Back Tap, src/surfaces/links.ts) starts
// dictating hands-free: the words fill the composer, and sending is always
// the person's call — nothing is sent until they tap Send. Kai, 2026-11-14:
// a pause used to stop the dictation and send the message by itself; a
// pause to think sent half a thought.
//
// Because the launch is hands-free, a long silence still turns the mic off
// (so it does not stay open in a pocket), but only the mic: the words stay
// in the box to edit, add to (tap the mic again) or send.

/** This long without new words stops listening on a talk launch. Long
 * enough for a pause to think; it never sends. */
export const TALK_IDLE_MS = 8_000
/** A talk launch older than this is stale. */
const TALK_FRESH_MS = 10_000

export function useTalkIdleStop({
  text,
  listening,
  stop,
}: {
  text: string
  listening: boolean
  stop: () => void
}) {
  const talking = useRef(false)
  const latest = useRef(stop)
  latest.current = stop

  // New words (``text``) restart the silence clock.
  // biome-ignore lint/correctness/useExhaustiveDependencies: text restarts the timer
  useEffect(() => {
    if (!talking.current) return
    if (!listening) {
      // This dictation is over; the next one is armed by its own launch.
      talking.current = false
      return
    }
    const id = setTimeout(() => latest.current(), TALK_IDLE_MS)
    return () => clearTimeout(id)
  }, [text, listening])

  /** Call as the composer starts dictating for a wake: takes the pending
   * talk launch, if any, and arms the idle stop for this dictation. */
  return function arm() {
    const at = talkLaunch.getState().at
    talkLaunch.setState({ at: null })
    talking.current = at !== null && Date.now() - at < TALK_FRESH_MS
  }
}
