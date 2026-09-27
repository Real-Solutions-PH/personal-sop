"use client"

// Public write API for M5 Capture & AI. Today (evening wrap-up), Me and Stats
// call these; the thread UI uses the same functions.
// ponytail: each becomes an API call (AG-UI turn / REST) when the backend lands.

export {
  /** Create a journal entry — the Today evening wrap-up line calls this (X-3). */
  addJournalEntry,
  answerCard,
  clearThread,
  confirmAll,
  confirmCard,
  deleteCapture,
  deleteJournalEntry,
  discardCard,
  editCard,
  logQuickAdd,
  processQueue,
  redoCard,
  rerunCapture,
  restoreJournalEntry,
  retryCapture,
  sendCapture,
  skipAsk,
  undoCard,
  updateJournalEntry,
} from "./engine"

import type { AISettings } from "./data"
import { captureStore } from "./store"

/** Patch AI settings (CAP-17). */
export function updateAISettings(patch: Partial<AISettings>) {
  captureStore.set((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
}
