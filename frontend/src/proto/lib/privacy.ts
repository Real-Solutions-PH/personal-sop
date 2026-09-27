"use client"

import { createStore } from "./store"

// App-wide privacy mode (IA ruling X-8): blurs every ₱ amount.
export const privacyStore = createStore("privacy", () => ({ hidden: false }))
export const togglePrivacy = () =>
  privacyStore.set((s) => ({ hidden: !s.hidden }))
