"use client"
import { createStore } from "./store"
export type CaptureMode = "text" | "voice" | "photo" | "file"
export interface CaptureContext {
  mode?: CaptureMode
  hint?: string
}
export const captureUi = createStore<{
  open: boolean
  ctx: CaptureContext
}>("capture-ui", () => ({ open: false, ctx: {} }))
export const openCapture = (ctx: CaptureContext = {}) =>
  captureUi.set({ open: true, ctx })
export const closeCapture = () => captureUi.set({ open: false, ctx: {} })
