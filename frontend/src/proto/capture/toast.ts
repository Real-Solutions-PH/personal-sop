"use client"

import { type ExternalToast, toast as sonner } from "sonner"

// Capture toasts sit at the top so they never cover the composer / sheet.
const top = (o?: ExternalToast): ExternalToast => ({
  position: "top-center",
  ...o,
})

export const toast = Object.assign(
  (m: string, o?: ExternalToast) => sonner(m, top(o)),
  {
    success: (m: string, o?: ExternalToast) => sonner.success(m, top(o)),
  },
)
