// Apple Health: reads activity and sleep (the day's steps, active energy,
// walking+running distance, workout count and the night's sleep), and writes
// workouts when the person opts in. Nothing here is synced; only an eat-back
// the user taps (setBurnAdjustment) reaches the server.
import type { WorkoutActivityType } from "@kingstinct/react-native-healthkit"
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
  WORKOUT = "HKWorkoutTypeIdentifier",
  SLEEP = "HKCategoryTypeIdentifierSleepAnalysis",
  READ = [STEPS, ENERGY, DISTANCE, WORKOUT, SLEEP] as const,
  WRITE = [WORKOUT] as const
// HKAuthorizationStatus.sharingAuthorized. Unlike reading, iOS does say
// whether writing is allowed.
const SHARING_AUTHORIZED = 2
// WorkoutActivityType.traditionalStrengthTraining and .mixedCardio.
const STRENGTH = 50 as WorkoutActivityType,
  CARDIO = 73 as WorkoutActivityType

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

/** The calendar date (YYYY-MM-DD) of `at` on this device. Health's days run
 * midnight to midnight, unlike the app's dayKey (which rolls at 04:00). */
export function localDay(at: Date): string {
  const p = (v: number) => String(v).padStart(2, "0")
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`
}

export type DayActivity = Omit<Activity, "workouts">

/** Steps, active energy and distance for consecutive calendar `days`
 * (oldest first) in one daily-total query per metric, not one per day.
 * A day with no samples is 0; null for every day when Health can't answer. */
export async function readDays(
  days: readonly string[],
): Promise<(DayActivity | null)[]> {
  if (expoGo())
    return days.map((d) => {
      const { workouts: _, ...rest } = sample(d)
      return rest
    })
  const first = days[0],
    last = days.at(-1)
  if (!healthAvailable() || !first || !last) return days.map(() => null)
  const hk = load() as HealthKit
  const at = (day: string, plus = 0) => {
    const [y, m, d] = day.split("-").map(Number) as [number, number, number]
    return new Date(y, m - 1, d + plus)
  }
  const start = at(first),
    filter = { date: { startDate: start, endDate: at(last, 1) } }
  const daily = async (
    id: typeof STEPS | typeof ENERGY | typeof DISTANCE,
    unit: "count" | "kcal" | "km",
  ) => {
    const rows = await hk.queryStatisticsCollectionForQuantity(
      id,
      ["cumulativeSum"],
      start,
      { day: 1 },
      { filter, unit },
    )
    const by = new Map<string, number>()
    for (const r of rows)
      if (r.startDate)
        by.set(localDay(r.startDate), r.sumQuantity?.quantity ?? 0)
    return by
  }
  try {
    const [steps, kcal, km] = await Promise.all([
      daily(STEPS, "count"),
      daily(ENERGY, "kcal"),
      daily(DISTANCE, "km"),
    ])
    return days.map((d) => ({
      steps: Math.round(steps.get(d) ?? 0),
      activeKcal: Math.round(kcal.get(d) ?? 0),
      distanceKm: Math.round((km.get(d) ?? 0) * 100) / 100,
    }))
  } catch {
    return days.map(() => null)
  }
}

export interface SleepSample {
  startDate: Date
  endDate: Date
  value: number
}
// CategoryValueSleepAnalysis: asleep (1), core (3), deep (4), REM (5).
// In bed (0) and awake (2) are not sleep.
const ASLEEP = new Set([1, 3, 4, 5])

/** Minutes asleep within [from, to). Watch and iPhone often record the same
 * night, so overlapping samples are merged before summing. */
export function asleepMinutes(
  samples: readonly SleepSample[],
  from: Date,
  to: Date,
): number {
  const spans = samples
    .filter((s) => ASLEEP.has(s.value))
    .map((s): [number, number] => [
      Math.max(s.startDate.getTime(), from.getTime()),
      Math.min(s.endDate.getTime(), to.getTime()),
    ])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  let total = 0,
    end = -Infinity
  for (const [a, b] of spans) {
    if (b <= end) continue
    total += b - Math.max(a, end)
    end = b
  }
  return Math.round(total / 60_000)
}

/** Minutes asleep for each night, oldest first. A night belongs to the day
 * you wake: day D's night runs 18:00 the evening before to 18:00 on D. One
 * query for the whole run; null for every night when Health can't answer. */
export async function readSleep(
  days: readonly string[],
): Promise<(number | null)[]> {
  if (expoGo()) return days.map((d) => 380 + (Number(d.slice(-2)) % 5) * 25)
  const first = days[0],
    last = days.at(-1)
  if (!healthAvailable() || !first || !last) return days.map(() => null)
  const evening = (day: string, plus = 0) => {
    const [y, m, d] = day.split("-").map(Number) as [number, number, number]
    return new Date(y, m - 1, d + plus, 18)
  }
  try {
    const samples = await (load() as HealthKit).queryCategorySamples(SLEEP, {
      limit: 0,
      filter: {
        date: { startDate: evening(first, -1), endDate: evening(last) },
      },
    })
    return days.map((d) => asleepMinutes(samples, evening(d, -1), evening(d)))
  } catch {
    return days.map(() => null)
  }
}

/** Whether the Health sheet has been answered. iOS hides allow vs deny, so
 * true means "asked", not "allowed": a denied read shows up as zeros. */
export async function healthAsked(): Promise<boolean> {
  if (expoGo()) return true
  if (!healthAvailable()) return false
  try {
    const status = await (load() as HealthKit).getRequestStatusForAuthorization(
      { toRead: READ },
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
      toRead: READ,
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

/** Whether this device can offer saving workouts: a real build with Health
 * (Expo Go has no HealthKit of its own, only sample reads). */
export const canOfferWorkoutWrite = () => !expoGo() && healthAvailable()

/** Whether Unfurl may write workouts now (false once revoked in Health). */
export function canWriteWorkouts(): boolean {
  if (!canOfferWorkoutWrite()) return false
  try {
    return (
      (load() as HealthKit).authorizationStatusFor(WORKOUT) ===
      SHARING_AUTHORIZED
    )
  } catch {
    return false
  }
}

/** Shows the Health sheet asking to write workouts (and read, as the
 * Connect card does). True only when writing ended up allowed. */
export async function connectWorkoutWrite(): Promise<boolean> {
  if (!canOfferWorkoutWrite()) return false
  try {
    await (load() as HealthKit).requestAuthorization({
      toShare: WRITE,
      toRead: READ,
    })
  } catch {
    return false
  }
  return canWriteWorkouts()
}

/** Writes one finished workout, duration only: no calories (Unfurl does
 * not measure them, and the eat-back reads Health's active energy). The
 * sync identifier makes Health itself refuse a second copy. Returns the
 * Health sample's uuid, or null when the save failed. */
export async function saveWorkout(input: {
  id: string
  name: string
  start: Date
  end: Date
  cardio: boolean
}): Promise<string | null> {
  if (!canOfferWorkoutWrite()) return null
  try {
    const saved = await (load() as HealthKit).saveWorkoutSample(
      input.cardio ? CARDIO : STRENGTH,
      [],
      input.start,
      input.end,
      undefined,
      {
        HKMetadataKeySyncIdentifier: `unfurl-workout-${input.id}`,
        HKMetadataKeySyncVersion: 1,
        HKMetadataKeyWorkoutBrandName: "Unfurl",
        HKMetadataKeyExternalUUID: input.id,
        UnfurlWorkoutName: input.name,
      },
    )
    return saved.uuid
  } catch {
    return null
  }
}

/** Removes a workout this app wrote. False when Health refused. */
export async function deleteSavedWorkout(uuid: string): Promise<boolean> {
  if (!canOfferWorkoutWrite()) return false
  try {
    await (load() as HealthKit).deleteObjects(WORKOUT, { uuid })
    return true
  } catch {
    return false
  }
}
