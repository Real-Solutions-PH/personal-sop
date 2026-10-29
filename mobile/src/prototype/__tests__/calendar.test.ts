// Reading today's events from the phone's calendars: read-only, every
// visible event calendar, and nothing (null) whenever it can't answer.
import { Platform } from "react-native"

const at = (h: number, m = 0) => new Date(2026, 9, 29, h, m)
let mockStatus = "granted"
const mockList = jest.fn(async (_c: unknown, _s: Date, _e: Date) => [
  {
    id: "e2",
    title: "Lunch",
    startDate: at(12),
    endDate: at(13),
    allDay: false,
  },
  {
    id: "e1",
    title: "Standup",
    startDate: at(9),
    endDate: at(9, 15),
    allDay: false,
  },
  {
    id: "e3",
    title: "Holiday",
    startDate: at(0),
    endDate: at(23, 59),
    allDay: true,
  },
])
const mockRequest = jest.fn(async () => ({ status: "granted" }))
jest.mock("expo-calendar", () => ({
  EntityTypes: { EVENT: "event" },
  getCalendarPermissions: async () => ({ status: mockStatus }),
  requestCalendarPermissions: () => mockRequest(),
  getCalendars: async () => [
    { id: "work", isVisible: true },
    { id: "hidden", isVisible: false },
  ],
  listEvents: (c: unknown, s: Date, e: Date) => mockList(c, s, e),
}))

import {
  calendarStatus,
  connectCalendar,
  readEvents,
  upcoming,
} from "../calendar"

beforeEach(() => {
  mockStatus = "granted"
  Platform.OS = "ios"
  jest.clearAllMocks()
})

test("today's events from visible calendars, all-day first, then by start", async () => {
  const events = await readEvents(at(8))
  expect(events?.map((e) => e.title)).toEqual(["Holiday", "Standup", "Lunch"])
  const [cals, start, end] = mockList.mock.calls[0] ?? []
  expect(cals).toEqual(["work"])
  expect(start).toEqual(new Date(2026, 9, 29))
  expect(end).toEqual(new Date(2026, 9, 30))
})

test("without access, or when the calendar throws: null", async () => {
  mockStatus = "denied"
  expect(await readEvents(at(8))).toBeNull()
  mockStatus = "granted"
  mockList.mockRejectedValueOnce(new Error("boom"))
  expect(await readEvents(at(8))).toBeNull()
})

test("status: asked or not, allowed or not", async () => {
  expect(await calendarStatus()).toBe("granted")
  mockStatus = "undetermined"
  expect(await calendarStatus()).toBe("undetermined")
  mockStatus = "denied"
  expect(await calendarStatus()).toBe("denied")
})

test("connect asks once and reports the answer", async () => {
  expect(await connectCalendar()).toBe(true)
  expect(mockRequest).toHaveBeenCalledTimes(1)
})

test("upcoming drops what has ended, keeps what's on now and all-day", () => {
  const events = [
    { id: "a", title: "Done", start: at(9), end: at(10), allDay: false },
    { id: "b", title: "Now", start: at(11), end: at(12), allDay: false },
    { id: "c", title: "Later", start: at(15), end: at(16), allDay: false },
    { id: "d", title: "All day", start: at(0), end: at(23, 59), allDay: true },
  ]
  expect(upcoming(events, at(11, 30)).map((e) => e.title)).toEqual([
    "Now",
    "Later",
    "All day",
  ])
})

test("web: no calendar here", async () => {
  Platform.OS = "web"
  expect(await calendarStatus()).toBe("unavailable")
  expect(await readEvents(at(8))).toBeNull()
})

// Last: it swaps the module registry.
test("a build without the native module reads as no calendar", async () => {
  jest.resetModules()
  jest.doMock("expo-calendar", () => {
    throw new Error("Cannot find native module 'ExpoCalendar'")
  })
  const c = require("../calendar") as typeof import("../calendar")
  expect(await c.calendarStatus()).toBe("unavailable")
})
