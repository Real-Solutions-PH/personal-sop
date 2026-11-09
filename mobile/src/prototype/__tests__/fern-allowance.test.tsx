// Fern's daily allowance in the chat: nothing while plenty is left, how
// many are left from 3 down, and at zero when they come back plus an
// "Unfurl Plus" button (the paywall, or "coming soon" in a build that
// cannot buy yet).
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import {
  type Allowance,
  allowanceFromServer,
  allowanceStore,
  allowanceView,
  noteRefusal,
  setAllowanceFetcher,
  whenText,
} from "../companion/allowance"
import { AllowanceNote } from "../companion/allowance-note"

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  withSequence: (...values: unknown[]) => values[values.length - 1],
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}))

// 2:00 PM local on 3 Nov; the count resets at 4:00 AM local on 4 Nov.
const NOW = new Date(2026, 10, 3, 14, 0)
const RESET = new Date(2026, 10, 4, 4, 0).toISOString()

const left = (
  remaining: number,
  extra: Partial<Allowance> = {},
): Allowance => ({
  applies: true,
  plan: "free",
  limit: 5,
  used: 5 - remaining,
  remaining,
  resetsAt: RESET,
  monthStopped: false,
  monthResetsAt: null,
  ...extra,
})

afterEach(() => {
  setAllowanceFetcher(null)
  act(() => allowanceStore.set(null))
  delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
})

test("plenty left shows nothing; 3, 2 and 1 say how many", () => {
  expect(allowanceView(left(4), "Fern", NOW)).toEqual({ kind: "none" })
  expect(allowanceView(left(3), "Fern", NOW)).toEqual({
    kind: "few",
    text: "3 messages left today",
  })
  expect(allowanceView(left(1), "Fern", NOW)).toEqual({
    kind: "few",
    text: "1 message left today",
  })
})

test("at zero it says when they come back", () => {
  expect(allowanceView(left(0), "Fern", NOW)).toEqual({
    kind: "out",
    text: "That's all of today's messages with Fern. They come back tomorrow at 4:00 AM.",
  })
  // After midnight, before the day starts: later the same calendar day.
  const early = new Date(2026, 10, 4, 1, 0)
  expect(whenText(RESET, early)).toBe("at 4:00 AM")
})

test("Plus at its monthly limit says when the month turns", () => {
  const view = allowanceView(
    left(40, {
      plan: "plus",
      monthStopped: true,
      monthResetsAt: new Date(2026, 11, 1, 4, 0).toISOString(),
    }),
    "Fern",
    NOW,
  )
  expect(view).toEqual({
    kind: "out",
    text: "Fern has reached this month's fair-use limit. Messages come back on Dec 1.",
  })
})

test("a message that does not count (own key, AI off) shows nothing", () => {
  expect(allowanceView(left(0, { applies: false }), "Fern", NOW)).toEqual({
    kind: "none",
  })
  expect(allowanceView(null, "Fern", NOW)).toEqual({ kind: "none" })
})

test("the server's answer is read, and anything else is ignored", () => {
  expect(
    allowanceFromServer({
      applies: true,
      plan: "free",
      limit: 5,
      used: 4,
      remaining: 1,
      resets_at: RESET,
      month_stopped: false,
      month_resets_at: null,
    }),
  ).toEqual(left(1))
  expect(allowanceFromServer({ plan: "plus" })).toBeNull()
})

test("a refused message marks the allowance used up with its reset", () => {
  setAllowanceFetcher(() => new Promise(() => {}))
  act(() => allowanceStore.set(left(2)))
  expect(
    noteRefusal("fern_daily_allowance_reached", { resets_at: RESET }),
  ).toBe(true)
  expect(allowanceStore.get()).toMatchObject({ remaining: 0, resetsAt: RESET })
  expect(noteRefusal("busy", undefined)).toBe(false)
})

test("at zero the note offers Unfurl Plus; without the store key it is coming soon", async () => {
  setAllowanceFetcher(() => new Promise(() => {}))
  act(() => allowanceStore.set(left(0)))
  render(<AllowanceNote name="Fern" />)
  expect(
    screen.getByText(/That's all of today's messages with Fern/),
  ).toBeTruthy()
  fireEvent.press(screen.getByText("Unfurl Plus"))
  expect(screen.getByText(/Unfurl Plus is coming soon/)).toBeTruthy()
})

test("with 3 left the note says so, and refreshes from the server", async () => {
  const fetch = jest.fn(async () => ({
    applies: true,
    plan: "free",
    limit: 5,
    used: 2,
    remaining: 3,
    resets_at: RESET,
    month_stopped: false,
    month_resets_at: null,
  }))
  setAllowanceFetcher(fetch)
  render(<AllowanceNote name="Fern" />)
  expect(await screen.findByText("3 messages left today")).toBeTruthy()
  expect(fetch).toHaveBeenCalled()
})
