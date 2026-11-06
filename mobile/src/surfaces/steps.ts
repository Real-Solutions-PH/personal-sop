import { useEffect, useState } from "react"
import { AppState } from "react-native"
import {
  healthAsked,
  healthAvailable,
  localDay,
  readDays,
} from "@/prototype/health"
import type { StepsReading } from "./snapshot"

// Today's step count for the Steps widgets, from the same Apple Health read
// the Steps card on Fitness makes. The app reads it only while it is open:
// on start, on coming back to the foreground, and every few minutes in
// between. The widget itself adds the phone's own motion count between
// those reads (targets/widget/Steps.swift), so nothing here runs in the
// background.

/** Minutes between reads while the app stays open. */
export const STEPS_EVERY_MIN = 5

/** The newest reading, or null with no Health here (Android, web) or before
 * its sheet was answered. ``minute`` is the bridge's clock tick. */
export function useTodaySteps(minute: number): StepsReading | null {
  const available = healthAvailable()
  const [reading, setReading] = useState<StepsReading | null>(null)
  const slot = Math.floor(minute / STEPS_EVERY_MIN)
  // ``slot`` re-runs the read every STEPS_EVERY_MIN minutes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: slot is the clock tick
  useEffect(() => {
    if (!available) return
    let current = true
    const read = async () => {
      // Asked again each time: the sheet may have been answered (or Health
      // switched off for Unfurl in Settings) since the last read.
      if (!(await healthAsked())) {
        if (current) setReading(null)
        return
      }
      const day = localDay(new Date())
      const [today] = await readDays([day])
      // A failed read keeps the last count rather than showing 0.
      if (current && today) setReading({ day, count: today.steps })
    }
    void read()
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void read()
    })
    return () => {
      current = false
      sub.remove()
    }
  }, [available, slot])
  return reading
}
