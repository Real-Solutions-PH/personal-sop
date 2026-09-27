"use client"

import { createStore } from "./store"

// Capture sheet open-state (IA: (+) opens a sheet over the current screen and
// keeps context). Module screens call openCapture({ mode, hint }).
export type CaptureMode = "text" | "voice" | "photo" | "file"

export interface CaptureContext {
  mode?: CaptureMode
  /** What the calling screen expects, e.g. "meal", "expense", "journal". */
  hint?: string
}

export const captureUi = createStore<{
  open: boolean
  ctx: CaptureContext
}>("capture-ui", () => ({ open: false, ctx: {} }))

export const openCapture = (ctx: CaptureContext = {}) =>
  captureUi.set({ open: true, ctx })
export const closeCapture = () => captureUi.set({ open: false, ctx: {} })
