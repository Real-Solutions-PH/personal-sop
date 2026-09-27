"use client"

import { useEffect, useState } from "react"
import { createStore } from "../lib/store"
import { type CaptureState, seed } from "./data"

export const captureStore = createStore<CaptureState>("capture", seed)

/** Effective connectivity: real navigator.onLine AND the prototype's simulate toggle. */
export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true
  return navigator.onLine && !captureStore.get().settings.simulateOffline
}

/** Reactive online flag (listens to online/offline events + the simulate toggle). */
export function useOnline(): boolean {
  const sim = captureStore.use((s) => s.settings.simulateOffline)
  const [net, setNet] = useState(true)
  useEffect(() => {
    const on = () => setNet(true)
    const off = () => setNet(false)
    setNet(navigator.onLine)
    window.addEventListener("online", on)
    window.addEventListener("offline", off)
    return () => {
      window.removeEventListener("online", on)
      window.removeEventListener("offline", off)
    }
  }, [])
  return net && !sim
}
