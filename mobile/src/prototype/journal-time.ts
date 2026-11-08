// Journal writing time, measured the smallest honest way: the seconds
// between keystrokes in the journal editor, on the day they were typed. A
// gap longer than GAP_MS (the person stopped to think, or left the screen
// open) is not counted, and the first keystroke after one counts nothing.
// So this is time spent typing, not time the editor was open, and voice
// entries add no time. It is kept on this phone only (no server field
// yet), from the first keystroke after this build on.

import { dayKey } from "@domain/lib/day"
import { createStore } from "@domain/lib/store"
import { useRef } from "react"

export const GAP_MS = 60_000
export type JournalTimeState = {
  /** The day the first second was counted, or null before any. */
  since: string | null
  /** Seconds typed per day (YYYY-MM-DD). */
  days: Record<string, number>
}
export const journalTimeStore = createStore<JournalTimeState>(
  "journal-time",
  () => ({ since: null, days: {} }),
)
/** The milliseconds one keystroke adds, after the last one at ``last``. */
export function typed(last: number | null, now: number): number {
  if (last === null) return 0
  const gap = now - last
  return gap > 0 && gap <= GAP_MS ? gap : 0
}
/** Adds ``ms`` of typing to ``day``; whole seconds are kept, the rest is
 * carried by the caller. */
export function addTyping(s: JournalTimeState, day: string, sec: number) {
  if (sec <= 0) return s
  return {
    since: s.since ?? day,
    days: { ...s.days, [day]: (s.days[day] ?? 0) + sec },
  }
}
/** A keystroke handler for the editor: call it on every change of the
 * entry's text. */
export function useTypingClock(): () => void {
  const last = useRef<number | null>(null),
    carry = useRef(0)
  return () => {
    const now = Date.now()
    carry.current += typed(last.current, now)
    last.current = now
    const sec = Math.floor(carry.current / 1000)
    if (sec < 1) return
    carry.current -= sec * 1000
    journalTimeStore.set((s) => addTyping(s, dayKey(), sec))
  }
}
