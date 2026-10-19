import { onWorkoutFinished } from "./fitness/actions"
import { autoCheckWorkoutHabits } from "./habits/actions"
import { dayKey } from "./lib/day"
export function connectWorkoutHabits(
  notify: (count: number) => void = () => {},
) {
  // The workout's start day and id, as the server ticks them on finish.
  return onWorkoutFinished((w) => {
    const logs = autoCheckWorkoutHabits(dayKey(new Date(w.startedAt)), w.id)
    if (logs.length) notify(logs.length)
  })
}
