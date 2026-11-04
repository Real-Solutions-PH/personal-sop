"use client"
import { createStore } from "./store"
/** Privacy mode (money blurred), and "Help improve Fern": consent, off by
 * default, for anonymised copies of this person's chats to test Fern in a
 * private store (ADR-0034). Both sync with the profile row. */
export const privacyStore = createStore("privacy", () => ({
  hidden: false,
  fernEval: false,
}))
export const togglePrivacy = () =>
  privacyStore.set((s) => ({ ...s, hidden: !s.hidden }))
export const toggleFernEval = () =>
  privacyStore.set((s) => ({ ...s, fernEval: !s.fernEval }))
