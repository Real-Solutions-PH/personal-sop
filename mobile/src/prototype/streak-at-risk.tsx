// Keeps tonight's "streak at risk" reminder in step with the day: today's
// due and done habits and tasks and the on-target streak live in the stats
// hooks, so this is a component, mounted once at the shell. It renders
// nothing.

import * as D from "@domain/dash/hooks"
import { dashStore } from "@domain/dash/store"
import { tasksStore } from "@domain/tasks/store"
import { useEffect } from "react"
import { scheduleAtRiskReminder } from "./local-reminders"

export function AtRiskWatcher() {
  const target = D.useOnTarget(7)
  const threshold = dashStore.use((s) => s.targetThreshold)
  const evening = dashStore.use((s) => s.push.evening)
  const quietStart = tasksStore.use((s) => s.settings.quietStart)
  const quietEnd = tasksStore.use((s) => s.settings.quietEnd)
  const today = target.series[target.series.length - 1]
  const due = today?.due ?? 0
  const done = today?.done ?? 0
  // The streak through yesterday: today, still open, neither adds nor
  // breaks it, unless it is already on target.
  const streak = target.current - (today?.onTarget ? 1 : 0)
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        void scheduleAtRiskReminder({
          due,
          done,
          threshold,
          streak,
          evening,
          quiet: { start: quietStart, end: quietEnd },
        }).catch(() => {})
      } catch {
        // No notifications module in this build.
      }
    }, 1500)
    return () => clearTimeout(id)
  }, [due, done, threshold, streak, evening, quietStart, quietEnd])
  return null
}
