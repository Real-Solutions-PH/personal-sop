/** Pure helpers behind ``DateField``. Days are local calendar days
 * (``YYYY-MM-DD``) and times are ``HH:mm``: both are read and written with
 * the device's own calendar, never through ``toISOString()``, which would
 * shift a late-evening pick to the next UTC day. */
import { dayKey } from "@domain/lib/day"
import { isDay } from "./validation"

const pad = (n: number) => String(n).padStart(2, "0")
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

/** A day as a Date at local noon (clear of any DST edge); null if unreadable. */
export function parseDay(value: string): Date | null {
  if (!isDay(value)) return null
  const [y, m, d] = value.split("-").map(Number)
  return new Date(y, m - 1, d, 12)
}
/** An ``HH:mm`` as a Date on a fixed day; null if unreadable. */
export function parseClock(value: string): Date | null {
  if (!CLOCK.test(value)) return null
  const [h, m] = value.split(":").map(Number)
  return new Date(2000, 0, 1, h, m)
}
/** The local calendar day of ``d``. */
export const toDay = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const toClock = (d: Date) =>
  `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** ``day`` moved inside ``[min, max]``; either bound may be absent. */
export function clampDay(day: string, min?: string, max?: string): string {
  if (min && isDay(min) && day < min) return min
  if (max && isDay(max) && day > max) return max
  return day
}

/** Where the picker opens: the value, else the field's default, else the app's
 * today (or 09:00), always inside the field's bounds. */
export function startOf(
  mode: "date" | "time",
  value: string,
  fallback: string | undefined,
  min?: string,
  max?: string,
  today = dayKey(),
): Date {
  if (mode === "time")
    return (
      parseClock(value) ?? parseClock(fallback ?? "") ?? parseClock("09:00")!
    )
  const day = isDay(value) ? value : isDay(fallback ?? "") ? fallback! : today
  return parseDay(clampDay(day, min, max))!
}

/** What the field shows: "Sun, Nov 8" this year, "Sun, Nov 8, 2027" any
 * other; a time stays ``HH:mm``, as everywhere else in the app. An
 * unreadable value shows as itself rather than vanishing. */
export function formatPick(
  mode: "date" | "time",
  value: string,
  today = dayKey(),
): string {
  if (mode === "time") return value
  const d = parseDay(value)
  if (!d) return value
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(value.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
  })
}
