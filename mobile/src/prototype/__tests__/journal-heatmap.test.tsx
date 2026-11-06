import { render, screen } from "@testing-library/react-native"
import { StyleSheet } from "react-native"
import {
  countByDay,
  heatDays,
  heatLevel,
  JournalHeatmap,
} from "../screens/journal-heatmap"

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  useReducedMotion: () => true,
}))

// Thursday 6 November 2025: the window opens on Friday 10 October.
const today = "2025-11-06"
const fill = (id: string) =>
  StyleSheet.flatten(screen.getByTestId(id).props.style).backgroundColor

test("the grid is whole Sunday-first weeks holding the last 28 days", () => {
  const days = heatDays(today)
  expect(days.length % 7).toBe(0)
  expect(days.filter(Boolean)).toHaveLength(28)
  // Sunday 5 Oct starts the first week; 5–9 Oct are outside the window.
  expect(days.slice(0, 6)).toEqual([null, null, null, null, null, "2025-10-10"])
  // Today is followed by blanks to the end of its week (Fri, Sat).
  expect(days.slice(-3)).toEqual([today, null, null])
})

test("strength steps by entries: none, one, two, three or more", () => {
  expect([0, 1, 2, 3, 7].map(heatLevel)).toEqual([0, 1, 2, 3, 3])
})

test("an empty month draws every day as an empty cell, with the legend", () => {
  render(<JournalHeatmap counts={new Map()} today={today} />)
  expect(screen.getAllByLabelText(/nothing written/)).toHaveLength(28)
  expect(screen.getByTestId("journal-heatmap-legend")).toBeTruthy()
  expect(screen.getByText(/of 28 days written/)).toBeTruthy()
  // Each cell carries its day of the month, each row its Sunday.
  expect(screen.getByText("10")).toBeTruthy()
  expect(screen.getByText("Oct 5")).toBeTruthy()
  expect(screen.getByText("Nov 2")).toBeTruthy()
})

test("a sparse month: written days fill by count, the rest stay empty", () => {
  const counts = countByDay(["2025-11-03", "2025-11-04", "2025-11-04"])
  render(<JournalHeatmap counts={counts} today={today} />)
  const empty = fill("heat-2025-11-02"),
    one = fill("heat-2025-11-03"),
    two = fill("heat-2025-11-04")
  expect(new Set([empty, one, two]).size).toBe(3)
  expect(screen.getByLabelText(/Nov 4: 2 entries/)).toBeTruthy()
  expect(screen.getByLabelText(/Nov 3: 1 entry$/)).toBeTruthy()
  expect(screen.getAllByLabelText(/nothing written/)).toHaveLength(26)
  // Too little to name a best day.
  expect(screen.queryByText(/best on/)).toBeNull()
})

test("a full month is all full cells with today ringed", () => {
  const all = heatDays(today).filter((d): d is string => !!d)
  // Three entries every day.
  const counts = countByDay([...all, ...all, ...all])
  render(<JournalHeatmap counts={counts} today={today} />)
  expect(screen.queryAllByLabelText(/nothing written/)).toHaveLength(0)
  const full = fill("heat-2025-10-20")
  for (const d of all) expect(fill(`heat-${d}`)).toBe(full)
  const ring = StyleSheet.flatten(
    screen.getByTestId(`heat-${today}`).props.style,
  )
  expect(ring.borderWidth).toBe(2)
  expect(
    StyleSheet.flatten(screen.getByTestId("heat-2025-11-05").props.style)
      .borderWidth,
  ).toBe(0)
  expect(screen.getByLabelText(/Nov 6, today: 3 entries/)).toBeTruthy()
})

test("a weekday written most often is named", () => {
  // Every Tuesday in the window, and one Monday.
  const counts = countByDay([
    "2025-10-14",
    "2025-10-21",
    "2025-10-28",
    "2025-11-04",
    "2025-11-03",
  ])
  render(<JournalHeatmap counts={counts} today={today} />)
  expect(screen.getByText(/best on Tuesdays/)).toBeTruthy()
})
