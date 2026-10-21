"use client"
import { createStore } from "../lib/store"
import { type FitnessState, seed } from "./data"
export const fitStore = createStore<FitnessState>("fitness", seed)
export const useFit = () => fitStore.use((s) => s)
