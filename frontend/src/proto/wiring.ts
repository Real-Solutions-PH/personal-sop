"use client"

import { toast } from "sonner"
import { onWorkoutFinished } from "./fitness/actions"
import { autoCheckWorkoutHabits } from "./habits/actions"

// Cross-module side effects (IA ruling X-7): finishing a workout ticks habits
// linked to "any workout logged". Imported once by the shell.
onWorkoutFinished(() => {
  const logs = autoCheckWorkoutHabits()
  if (logs.length)
    toast.success(`Habit checked: ${logs.length} linked to workouts`)
})
