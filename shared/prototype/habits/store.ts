"use client"
import { createStore } from "../lib/store"
import { type HabitsState, seedHabits } from "./data"
export const habitsStore = createStore<HabitsState>("habits", seedHabits)
export const useHabitsState = () => habitsStore.use((s) => s)
