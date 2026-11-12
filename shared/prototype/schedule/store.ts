import { createStore } from "../lib/store"
import type { ScheduleState } from "./data"

export const scheduleStore = createStore<ScheduleState>("schedule", () => ({
  overrides: [],
}))
