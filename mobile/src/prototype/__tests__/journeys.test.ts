import { logWorkoutFromChat } from "@domain/fitness/actions"
import { checkHabit, clearLog, createHabit } from "@domain/habits/actions"
import { habitsStore } from "@domain/habits/store"
import { elapsedSec, startLive, stopLive } from "@domain/lib/live"
import { configureStorage, resetAll } from "@domain/lib/store"
import { completeTask, createTask, uncompleteTask } from "@domain/tasks/actions"
import { tasksStore } from "@domain/tasks/store"
import { connectWorkoutHabits } from "@domain/wiring"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})
test("task completion can be undone without losing details", () => {
  const task = createTask({ title: "Prepare demo", notes: "Keep checklist" })
  completeTask(task.id)
  expect(tasksStore.get().tasks.find((t) => t.id === task.id)?.status).toBe(
    "done",
  )
  uncompleteTask(task.id)
  expect(tasksStore.get().tasks.find((t) => t.id === task.id)).toMatchObject({
    status: "open",
    notes: "Keep checklist",
  })
})
test("habit undo removes the same logical-day log", () => {
  const habit = habitsStore.get().habits.find((h) => h.type === "check")!
  checkHabit(habit.id)
  const log = clearLog(habit.id)
  expect(log?.habitId).toBe(habit.id)
  expect(habitsStore.get().logs.some((l) => l.id === log?.id)).toBe(false)
})
test("only one live activity starts and pauses are excluded", () => {
  stopLive()
  expect(
    startLive({ kind: "timer", label: "Read", href: "/habits/read/timer" }),
  ).toBe(true)
  expect(
    startLive({ kind: "workout", label: "Train", href: "/fitness/workout" }),
  ).toBe(false)
  expect(
    elapsedSec({
      kind: "timer",
      label: "Read",
      href: "/",
      startedAt: "2026-10-02T00:00:00Z",
      pausedAt: "2026-10-02T00:02:00Z",
      pausedSec: 30,
    }),
  ).toBe(90)
})
test("workout completion checks linked habits once", () => {
  const disconnect = connectWorkoutHabits()
  const habit = createHabit({
    name: "Workout link",
    icon: "🏋️",
    type: "check",
    schedule: [{ days: [0, 1, 2, 3, 4, 5, 6] }],
    reminder: false,
    linkWorkout: true,
  })
  logWorkoutFromChat({
    name: "Session",
    exercises: [{ exercise: "Bench press", sets: [{ reps: 8, weight: 20 }] }],
  })
  expect(
    habitsStore
      .get()
      .logs.filter((l) => l.habitId === habit.id && l.source === "workout"),
  ).toHaveLength(1)
  disconnect()
})
