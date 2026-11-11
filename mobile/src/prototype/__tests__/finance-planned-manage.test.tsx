// A scheduled payment's detail: History never shows a date before the plan
// starts, and every upcoming date can be changed on its own (amount, date),
// skipped and restored, without touching the plan's own rule.

import * as A from "@domain/finance/actions"
import * as C from "@domain/finance/calc"
import type { PlannedItem } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"

jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}))
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
  interpolateColor: (_: number, __: number[], output: string[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: ReactNode }) => children,
    ScrollView: require("react-native").ScrollView,
  }
})
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => {
  const { View } = require("react-native")
  return ({ children }: { children: ReactNode }) => <View>{children}</View>
})
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { Planned } =
  require("../screens/finance-planned") as typeof import("../screens/finance-planned")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const toastMock = toast as unknown as jest.Mock & {
  success: jest.Mock
  error: jest.Mock
}
beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  jest.clearAllMocks()
})

const today = dayKey()
function plan(extra: Partial<PlannedItem> = {}): PlannedItem {
  const s = finStore.get()
  return A.addPlanned({
    name: "BYD EM7",
    type: "expense",
    amount: 26667,
    estimated: false,
    accountId: s.accounts[0].id,
    categoryId: s.categories.find((c) => c.kind === "expense")?.id,
    schedule: { kind: "monthly", day: 8 },
    end: { kind: "count", n: 60 },
    autoLog: false,
    isWhatIf: false,
    isInstallment: true,
    inProjection: true,
    ...extra,
  })
}
const firstDates = (p: PlannedItem, n: number) =>
  C.occurrences(p, p.start, C.addDays(p.start, 400)).slice(0, n)

test("a plan that has not started shows no history dated before its start", () => {
  const p = plan({ start: C.addDays(today, 60) })
  render(<Planned id={p.id} />, { wrapper })
  const empty = within(screen.getByTestId("planned-history-empty"))
  // The dimmed sample never invents dates the plan cannot have had.
  // (Dimmed rows are hidden from screen readers, so look past that.)
  const hidden = { includeHiddenElements: true }
  for (const n of [1, 2, 3])
    expect(
      empty.queryByText(C.shortDate(C.addDays(today, -30 * n)), hidden),
    ).toBeNull()
  for (const d of firstDates(p, 3))
    expect(empty.getByText(C.shortDate(d), hidden)).toBeTruthy()
  const first = firstDates(p, 1)[0]
  expect(
    empty.getByText(new RegExp(`Starts ${C.dayLabel(first)}`)),
  ).toBeTruthy()
  // The sample claims no state for dates still ahead.
  expect(empty.queryByText("paid", hidden)).toBeNull()
  // Nothing is recorded as paid for it.
  expect(screen.queryByText("Times paid")).toBeNull()
})

const planOf = (id: string) => {
  const p = finStore.get().planned.find((x) => x.id === id)
  if (!p) throw new Error("plan gone")
  return p
}
function openDate(p: PlannedItem, orig: string) {
  render(<Planned id={p.id} />, { wrapper })
  fireEvent.press(screen.getByLabelText(new RegExp(`^${C.dayLabel(orig)}, `)))
}

test("a date gets its own amount without changing the plan", () => {
  const p = plan({ start: C.addDays(today, 20) }),
    [first, second] = firstDates(p, 2)
  openDate(p, second)
  const amount = screen.getByLabelText("Amount for this date")
  fireEvent.changeText(amount, "27,500")
  fireEvent(amount, "endEditing")
  expect(planOf(p.id).amounts).toEqual({ [second]: 27500 })
  expect(planOf(p.id).amount).toBe(26667)
  // The projection's occurrences carry it for that date only.
  const occ = C.occurrencesIn(finStore.get(), today, C.addDays(today, 120))
  const mine = occ.filter((o) => o.item.id === p.id)
  expect(mine.find((o) => o.orig === second)?.amount).toBe(27500)
  expect(mine.find((o) => o.orig === first)?.amount).toBe(26667)
  // The sheet says what the plan expects, with a way back.
  expect(screen.getByText(/^Plan: ₱26,667/)).toBeTruthy()
  fireEvent.press(screen.getByText("Reset"))
  expect(planOf(p.id).amounts).toEqual({})
  expect(toastMock).not.toHaveBeenCalled()
})

test("a zero amount is refused with an error, not saved", () => {
  const p = plan({ start: C.addDays(today, 20) }),
    [first] = firstDates(p, 1)
  openDate(p, first)
  const amount = screen.getByLabelText("Amount for this date")
  fireEvent.changeText(amount, "0")
  fireEvent(amount, "endEditing")
  expect(planOf(p.id).amounts ?? {}).toEqual({})
  expect(toastMock.error).toHaveBeenCalled()
})

test("skipping a date keeps it on the list, struck, and Restore brings it back", () => {
  const p = plan({ start: C.addDays(today, 20) }),
    [first] = firstDates(p, 1)
  openDate(p, first)
  fireEvent.press(screen.getByText("Skip"))
  expect(planOf(p.id).skipped).toEqual([first])
  // Still listed, so the skip can be undone where it is shown.
  const row = screen.getByLabelText(
    new RegExp(`^${C.dayLabel(first)}, skipped`),
  )
  fireEvent.press(row)
  fireEvent.press(screen.getByText("Restore"))
  expect(planOf(p.id).skipped).toEqual([])
})

test("Pay now and Skip next act on the first date that is not skipped", () => {
  const p = plan({ start: C.addDays(today, 20) }),
    [first, second] = firstDates(p, 2)
  A.skipOccurrence(p.id, first)
  render(<Planned id={p.id} />, { wrapper })
  fireEvent.press(screen.getByText("Skip next"))
  expect(planOf(p.id).skipped).toEqual([first, second])
})

test("a date moved earlier shows in History on the day it fell, never as a later date", () => {
  // Scheduled 5 days ahead, moved to 3 days ago: overdue now.
  const orig = C.addDays(today, 5),
    p = plan({
      start: orig,
      schedule: { kind: "monthly", day: Number(orig.slice(8, 10)) },
    })
  expect(A.adjustOccurrence(p.id, orig, { day: C.addDays(today, -3) })).toBe(
    true,
  )
  render(<Planned id={p.id} />, { wrapper })
  // History lists it, even though it moved before the plan's start, under
  // the day it fell on, not the scheduled day still ahead.
  expect(screen.getByText(C.shortDate(C.addDays(today, -3)))).toBeTruthy()
  expect(screen.queryByText(C.shortDate(orig))).toBeNull()
})

test("an amount still being typed is kept when an action is pressed", () => {
  const p = plan({ start: C.addDays(today, 20) }),
    [first] = firstDates(p, 1)
  openDate(p, first)
  fireEvent.changeText(screen.getByLabelText("Amount for this date"), "30,000")
  // No blur: straight to Skip.
  fireEvent.press(screen.getByText("Skip"))
  expect(planOf(p.id).amounts).toEqual({ [first]: 30000 })
})

test("snoozing never pushes a date past two weeks from its scheduled day", () => {
  const p = plan({ start: C.addDays(today, 20) }),
    [first] = firstDates(p, 1)
  A.adjustOccurrence(p.id, first, { day: C.addDays(first, C.MOVE_DAYS) })
  A.snoozeOccurrence(p.id, first)
  expect(planOf(p.id).snoozed[first]).toBe(C.addDays(first, C.MOVE_DAYS))
})
