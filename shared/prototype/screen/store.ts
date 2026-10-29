"use client"
import { createStore } from "../lib/store"
import { type ScreenState, seedScreen } from "./data"
export const screenStore = createStore<ScreenState>("screen", seedScreen)
export const useScreen = () => screenStore.use((s) => s)
