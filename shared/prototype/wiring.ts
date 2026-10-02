import { onWorkoutFinished } from "./fitness/actions"
import { autoCheckWorkoutHabits } from "./habits/actions"
export function connectWorkoutHabits(
  notify: (count: number) => void = () => {},
) {
  return onWorkoutFinished(() => {
    const logs = autoCheckWorkoutHabits()
    if (logs.length) notify(logs.length)
  })
}
