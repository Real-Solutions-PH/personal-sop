// Today's day-14 card for a hidden part: the part's real card dimmed under
// what it adds, "Turn on" and "Not for me", each answered in place.
import { dashStore, setEnabled } from "@domain/dash/store"
import { dayOffset } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import { Text } from "react-native"
import { setShown } from "../extras"
import { ModuleIntroCard } from "../screens/module-intro-card"

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
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}))
jest.mock("../social/today-card", () => ({
  CommunityCard: () => require("react").createElement("Text", null, "Feed"),
}))
jest.mock("../screens/mood-check-in", () => ({
  MoodCheckIn: () => require("react").createElement("Text", null, "Mood"),
}))

const cards = { finance: () => <Text>Spending card</Text> }
const signedUp = (daysAgo: number) =>
  dashStore.set((s) => ({
    ...s,
    profile: { ...s.profile, since: dayOffset(-daysAgo) },
  }))

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  setEnabled("finance", false)
  setShown("journal", true)
  setShown("social", true)
})

test("nothing before day 14", () => {
  signedUp(13)
  render(<ModuleIntroCard cards={cards} />)
  expect(screen.queryByTestId("module-intro")).toBeNull()
})

test("day 14: the hidden module's real card, dimmed, under what it adds", () => {
  signedUp(14)
  render(<ModuleIntroCard cards={cards} />)
  expect(screen.getByText("You hid Finance. Here's what it adds")).toBeTruthy()
  expect(
    screen.getByText("Spending card", { includeHiddenElements: true }),
  ).toBeTruthy()
})

test("Turn on switches the module on and says so", () => {
  signedUp(20)
  render(<ModuleIntroCard cards={cards} />)
  fireEvent.press(screen.getByText("Turn on Finance"))
  expect(dashStore.get().enabled.finance).toBe(true)
  expect(
    screen.getByText("Finance is on. Its card is on Today now."),
  ).toBeTruthy()
})

test("Not for me keeps it hidden, for good, and says so", () => {
  signedUp(20)
  render(<ModuleIntroCard cards={cards} />)
  fireEvent.press(screen.getByText("Not for me"))
  expect(dashStore.get().enabled.finance).toBe(false)
  expect(dashStore.get().intro.dismissed).toEqual(["finance"])
  expect(screen.getByText(/won't suggest Finance again/)).toBeTruthy()
})

test("a hidden Journal previews the mood check-in and turns the extra on", () => {
  signedUp(20)
  setEnabled("finance", true)
  setShown("journal", false)
  render(<ModuleIntroCard cards={cards} />)
  expect(screen.getByText("Mood", { includeHiddenElements: true })).toBeTruthy()
  fireEvent.press(screen.getByText("Turn on Journal"))
  expect(
    screen.getByText("Journal is on. Its card is on Today now."),
  ).toBeTruthy()
})
