// When Today opens the way back: the gap since the last day anything was
// logged on this phone, shown once per gap and at most once per app session.
// Kept apart from the screen so Today does not load the composer's audio.
import { captureStore } from "@domain/capture/store"
import { dashStore } from "@domain/dash/store"
import { finStore } from "@domain/finance/store"
import { runsOf } from "@domain/fitness/runs"
import { fitStore } from "@domain/fitness/store"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { tasksStore } from "@domain/tasks/store"
import {
  activityDays,
  lastActiveDay,
  shouldShowWayBack,
  wayBackGap,
} from "@domain/way-back"

type Activity = Parameters<typeof activityDays>[0]

/** Everything on this phone that counts as having logged something. */
export function activityNow(): Activity {
  const fit = fitStore.get()
  const cap = captureStore.get()
  return {
    logs: habitsStore.get().logs,
    taskEvents: tasksStore.get().events,
    records: finStore.get().records,
    workouts: fit.workouts,
    runs: runsOf(fit),
    meals: fit.meals,
    journal: cap.journal,
    captures: cap.captures,
  }
}

/** The gap to welcome someone back over, if there is one to show. */
export function wayBackNow(today = dayKey(), activity = activityNow()) {
  const last = lastActiveDay(activityDays(activity), today)
  const gap = wayBackGap(last, today)
  const seen = dashStore.get().wayBackSeenFor ?? ""
  return { last, gap, show: shouldShowWayBack(gap, seen, last) }
}

let openedThisSession = false
/** Today asks once per app session: open the way back when it is due. */
export function maybeOpenWayBack(open: (href: string) => void) {
  if (openedThisSession) return
  if (!wayBackNow().show) return
  openedThisSession = true
  open("/today/welcome-back")
}
