"use client"
export {
  addJournalEntry,
  answerCard,
  checkInMood,
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
export function updateAISettings(patch: Partial<AISettings>) {
  captureStore.set((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
}
