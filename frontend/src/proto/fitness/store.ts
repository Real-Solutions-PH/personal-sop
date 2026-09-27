"use client"

import { createStore } from "../lib/store"
import { type FitnessState, seed } from "./data"

export const fitStore = createStore<FitnessState>("fitness", seed)

/** Whole state — a stored reference, safe as a selector. Derive with useMemo. */
export const useFit = () => fitStore.use((s) => s)
