import { toast } from "sonner"
import { configureNotifications } from "../../../shared/prototype/lib/platform"
import { connectWorkoutHabits } from "../../../shared/prototype/wiring"

connectWorkoutHabits((count) =>
  toast.success(`Habit checked: ${count} linked to workouts`),
)

configureNotifications((message, options) => toast(message, options))
