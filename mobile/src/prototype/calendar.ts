// The phone's calendars, read-only: today's events from every visible event
// calendar, for the card on Today. Nothing is synced or changed.
import { Platform } from "react-native"

type Calendar = typeof import("expo-calendar")
// Loaded on first use, not at import: a binary built before the calendar
// module was added (reached by an over-the-air update) has no native
// module, and an import would crash the app instead of hiding the card.
let mod: Calendar | null | undefined
function load(): Calendar | null {
  if (mod === undefined)
    try {
      mod = require("expo-calendar") as Calendar
    } catch {
      mod = null
    }
  return mod
}

export interface DayEvent {
  id: string
  title: string
  start: Date
  end: Date
  allDay: boolean
}
export type CalendarStatus =
  | "granted"
  | "denied"
  | "undetermined"
  | "unavailable"

export async function calendarStatus(): Promise<CalendarStatus> {
  const c = Platform.OS === "web" ? null : load()
  if (!c) return "unavailable"
  try {
    const { status } = await c.getCalendarPermissions()
    return status === "granted" || status === "denied" ? status : "undetermined"
  } catch {
    return "unavailable"
  }
}

/** Shows the system prompt; true when reading is allowed. */
export async function connectCalendar(): Promise<boolean> {
  const c = Platform.OS === "web" ? null : load()
  if (!c) return false
  try {
    return (await c.requestCalendarPermissions()).status === "granted"
  } catch {
    return false
  }
}

/** Events on `now`'s calendar day, all-day first, then by start. null
 * without access or when the calendar can't answer. */
export async function readEvents(now: Date): Promise<DayEvent[] | null> {
  if ((await calendarStatus()) !== "granted") return null
  const c = load() as Calendar
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  try {
    const cals = (await c.getCalendars(c.EntityTypes.EVENT))
      .filter((x) => x.isVisible !== false)
      .map((x) => x.id)
    if (!cals.length) return []
    const events = await c.listEvents(cals, start, end)
    return events
      .map((e) => ({
        id: e.id,
        title: e.title || "Untitled event",
        start: new Date(e.startDate),
        end: new Date(e.endDate),
        allDay: e.allDay,
      }))
      .sort(
        (a, b) =>
          Number(b.allDay) - Number(a.allDay) ||
          a.start.getTime() - b.start.getTime(),
      )
  } catch {
    return null
  }
}

/** What's still ahead or on now; all-day events stay all day. */
export const upcoming = (events: readonly DayEvent[], now: Date) =>
  events.filter((e) => e.allDay || e.end.getTime() > now.getTime())
