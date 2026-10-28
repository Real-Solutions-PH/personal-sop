// Apple Health, read-only: the day's steps, active energy, walking+running
// distance and workout count. Nothing here is synced; only an eat-back the
// user taps (setBurnAdjustment) reaches the server.
import Constants from "expo-constants"
import { Platform } from "react-native"

type HealthKit = typeof import("@kingstinct/react-native-healthkit")
// Loaded on first use, not at import: a binary built before HealthKit was
// added (reached by an over-the-air update) has no native module, and an
// import would crash the whole app instead of hiding the card.
let kit: HealthKit | null | undefined
function load(): HealthKit | null {
  if (kit === undefined)
    try {
      kit = require("@kingstinct/react-native-healthkit") as HealthKit
    } catch {
      kit = null
    }
  return kit
}

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

// Expo Go ships without HealthKit (Apple grants it per app), so there the
// card shows sample activity instead, to try the eat-back flow. Real builds
// are "standalone" or "bare" and never see it.
const expoGo = () => Constants.executionEnvironment === "storeClient"

/** Sample activity for Expo Go: it grows through the day (40 kcal an hour),
 * so "add more" can be tried; a past day is a whole day. */
function sample(day: string): Activity {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number]
  const h = Math.min(
    24,
    Math.max(0, (Date.now() - new Date(y, m - 1, d).getTime()) / 3_600_000),
  )
  // Steps vary by date so the week's chart has shape.
  const steps = Math.round(h * 450 * (0.6 + (d % 5) * 0.2))
  return {
    steps,
    activeKcal: Math.round(h * 40),
    distanceKm: Math.round(steps * 0.075) / 100,
    workouts: h >= 7 ? 1 : 0,
  }
}

export function healthAvailable(): boolean {
  if (expoGo()) return true
  try {
    return Platform.OS === "ios" && !!load()?.isHealthDataAvailable()
  } catch {
    return false
  }
}

/** Whether the Health sheet has been answered. iOS hides allow vs deny, so
 * true means "asked", not "allowed": a denied read shows up as zeros. */
export async function healthAsked(): Promise<boolean> {
  if (expoGo()) return true
  if (!healthAvailable()) return false
  try {
    const status = await (load() as HealthKit).getRequestStatusForAuthorization(
      { toRead: [STEPS, ENERGY, DISTANCE, WORKOUT] },
    )
    return status === 2 // AuthorizationRequestStatus.unnecessary
  } catch {
    return false
  }
}

/** Shows the system Health sheet. iOS never says whether reading was
 * allowed, so a denied read later shows up as zeros, not an error. */
export async function connectHealth(): Promise<boolean> {
  if (expoGo()) return true
  if (!healthAvailable()) return false
  try {
    return await (load() as HealthKit).requestAuthorization({
      toRead: [STEPS, ENERGY, DISTANCE, WORKOUT],
    })
  } catch {
    return false
  }
}

/** `day` is a dayKey (YYYY-MM-DD) in the device's own time zone, the same
 * day Health sums over. null: no Health here, or it failed to answer. */
export async function readActivity(day: string): Promise<Activity | null> {
  if (expoGo()) return sample(day)
  if (!healthAvailable()) return null
  const hk = load() as HealthKit
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
      await hk.queryStatisticsForQuantity(id, ["cumulativeSum"], {
        filter: { date },
        unit,
      })
    ).sumQuantity?.quantity ?? 0
  try {
    const [steps, kcal, km, workouts] = await Promise.all([
      sum(STEPS, "count"),
      sum(ENERGY, "kcal"),
      sum(DISTANCE, "km"),
      hk.queryWorkoutSamples({ filter: { date }, limit: 0 }),
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
