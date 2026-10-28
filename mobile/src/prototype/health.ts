// Apple Health, read-only: the day's steps, active energy, walking+running
// distance and workout count. Nothing here is synced; only an eat-back the
// user taps (setBurnAdjustment) reaches the server.
import {
  isHealthDataAvailable,
  queryStatisticsForQuantity,
  queryWorkoutSamples,
  requestAuthorization,
} from "@kingstinct/react-native-healthkit"
import { Platform } from "react-native"

export interface Activity {
  steps: number
  activeKcal: number
  distanceKm: number
  workouts: number
}

const STEPS = "HKQuantityTypeIdentifierStepCount",
  ENERGY = "HKQuantityTypeIdentifierActiveEnergyBurned",
  DISTANCE = "HKQuantityTypeIdentifierDistanceWalkingRunning",
  WORKOUT = "HKWorkoutTypeIdentifier"

export function healthAvailable(): boolean {
  try {
    return Platform.OS === "ios" && isHealthDataAvailable()
  } catch {
    return false
  }
}

/** Shows the system Health sheet. iOS never says whether reading was
 * allowed, so a denied read later shows up as zeros, not an error. */
export async function connectHealth(): Promise<boolean> {
  if (!healthAvailable()) return false
  try {
    return await requestAuthorization({
      toRead: [STEPS, ENERGY, DISTANCE, WORKOUT],
    })
  } catch {
    return false
  }
}

/** `day` is a dayKey (YYYY-MM-DD) in the device's own time zone, the same
 * day Health sums over. null: no Health here, or it failed to answer. */
export async function readActivity(day: string): Promise<Activity | null> {
  if (!healthAvailable()) return null
  const [y, m, d] = day.split("-").map(Number) as [number, number, number]
  const date = {
    startDate: new Date(y, m - 1, d),
    endDate: new Date(y, m - 1, d + 1),
  }
  const sum = async (
    id: typeof STEPS | typeof ENERGY | typeof DISTANCE,
    unit: "count" | "kcal" | "km",
  ) =>
    (
      await queryStatisticsForQuantity(id, ["cumulativeSum"], {
        filter: { date },
        unit,
      })
    ).sumQuantity?.quantity ?? 0
  try {
    const [steps, kcal, km, workouts] = await Promise.all([
      sum(STEPS, "count"),
      sum(ENERGY, "kcal"),
      sum(DISTANCE, "km"),
      queryWorkoutSamples({ filter: { date }, limit: 0 }),
    ])
    return {
      steps: Math.round(steps),
      activeKcal: Math.round(kcal),
      distanceKm: Math.round(km * 100) / 100,
      workouts: workouts.length,
    }
  } catch {
    return null
  }
}
