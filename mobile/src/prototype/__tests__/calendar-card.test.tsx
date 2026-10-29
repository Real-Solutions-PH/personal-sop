// Today's calendar card: an offer to allow access (dismissable), then the
// day's events still ahead; nothing when access was refused.
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import type { CalendarStatus, DayEvent } from "../calendar"
import { extrasStore } from "../extras"
import { CalendarCard } from "../screens/calendar-card"

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  withDelay: (_: number, value: unknown) => value,
  withSequence: (...values: unknown[]) => values[values.length - 1],
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: chain,
    GestureDetector: ({ children }: { children: ReactNode }) => children,
  }
})
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  usePathname: () => "/",
}))

let mockStatus: CalendarStatus = "granted"
let mockEvents: DayEvent[] = []
const mockConnect = jest.fn(async () => {
  mockStatus = "granted"
  return true
})
jest.mock("../calendar", () => ({
  calendarStatus: async () => mockStatus,
  connectCalendar: () => mockConnect(),
  readEvents: async () => (mockStatus === "granted" ? mockEvents : null),
  upcoming: jest.requireActual("../calendar").upcoming,
}))

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000)
const ev = (id: string, title: string, from: number, to: number): DayEvent => ({
  id,
  title,
  start: inHours(from),
  end: inHours(to),
  allDay: false,
})

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  mockStatus = "granted"
  mockEvents = []
  mockConnect.mockClear()
})

test("lists what's still ahead today, not what has ended", async () => {
  mockEvents = [ev("a", "Over", -3, -2), ev("b", "Design review", 1, 2)]
  render(<CalendarCard />)
  expect(await screen.findByText("Design review")).toBeTruthy()
  expect(screen.queryByText("Over")).toBeNull()
})

test("nothing left today says so", async () => {
  render(<CalendarCard />)
  expect(
    await screen.findByText("Nothing else on your calendar today."),
  ).toBeTruthy()
})

test("more than five: the first five and a count", async () => {
  mockEvents = Array.from({ length: 7 }, (_, i) =>
    ev(String(i), `Event ${i}`, i + 1, i + 1.5),
  )
  render(<CalendarCard />)
  expect(await screen.findByText("+2 more")).toBeTruthy()
  expect(screen.queryByText("Event 5")).toBeNull()
})

test("not asked yet: allow shows the events", async () => {
  mockStatus = "undetermined"
  mockEvents = [ev("b", "Design review", 1, 2)]
  render(<CalendarCard />)
  const allow = await screen.findByText("Allow calendar")
  await act(async () => fireEvent.press(allow))
  expect(mockConnect).toHaveBeenCalled()
  expect(await screen.findByText("Design review")).toBeTruthy()
})

test("not asked yet: dismissing turns Calendar off", async () => {
  mockStatus = "undetermined"
  render(<CalendarCard />)
  fireEvent.press(await screen.findByLabelText("Hide calendar on Today"))
  expect(extrasStore.get().calendar).toBe(false)
})

test("refused: nothing at all", async () => {
  mockStatus = "denied"
  render(<CalendarCard />)
  await act(async () => {})
  expect(screen.toJSON()).toBeNull()
})
