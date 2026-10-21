"use client"
import { createStore } from "./store"
export const privacyStore = createStore("privacy", () => ({ hidden: false }))
export const togglePrivacy = () =>
  privacyStore.set((s) => ({ hidden: !s.hidden }))
