"use client"
import { createStore } from "../lib/store"
import { DEFAULT_SETTINGS, type FocusState, seedFocus } from "./data"
export const focusStore = createStore<FocusState>("focus", seedFocus, {
  // A setting added after a build saved its state gets its default.
  upgrade: (s) => ({ ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings } }),
})
export const useFocusState = () => focusStore.use((s) => s)
