"use client"

import { createStore } from "../lib/store"
import { type HabitsState, seedHabits } from "./data"

/** The M1 mock store (ADR-0009). Select stored references; derive with useMemo. */
export const habitsStore = createStore<HabitsState>("habits", seedHabits)

export const useHabitsState = () => habitsStore.use((s) => s)
