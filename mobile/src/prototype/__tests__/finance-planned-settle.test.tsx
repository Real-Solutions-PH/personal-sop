// Recording a scheduled payment's date: the full transaction editor opens
// prefilled from the plan, records nothing until Received / Paid, and a
// second save of the same date replaces its record rather than adding one.

import * as A from "@domain/finance/actions"
import type { PlannedItem } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { derivedId } from "@domain/lib/ids"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
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
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { RecordEditor } =
  require("../screens/finance") as typeof import("../screens/finance")
const { DueSheet, Planned } =
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

const DAY = "2030-01-15"
function plan(extra: Partial<PlannedItem> = {}): PlannedItem {
  const s = finStore.get()
  return A.addPlanned({
    name: "Salary",
    type: "income",
    amount: 27500,
    estimated: false,
    accountId: s.accounts[0].id,
    categoryId: s.categories.find((c) => c.kind === "income")?.id,
    schedule: { kind: "monthly", day: 15 },
    end: { kind: "never" },
    autoLog: false,
    isWhatIf: false,
    inProjection: true,
    ...extra,
  })
}
const recordsOf = (p: PlannedItem, day = DAY) =>
  finStore
    .get()
    .records.filter((r) => r.id === derivedId("planned-record", p.id, day))
function editor(p: PlannedItem, onClose = () => {}) {
  return render(<DueSheet id={p.id} day={DAY} record onClose={onClose} />, {
    wrapper,
  })
}

test("Received now opens the editor prefilled from the plan", () => {
  const p = plan(),
    count = finStore.get().records.length
  render(<Planned id={p.id} />, { wrapper })
  fireEvent.press(screen.getByText("Received now"))
  expect(screen.getByText("Record Salary")).toBeTruthy()
  expect(screen.getByDisplayValue("27,500")).toBeTruthy()
  expect(screen.getByDisplayValue("Salary")).toBeTruthy()
  expect(screen.getByText(/^Expected ₱27,500 · due /)).toBeTruthy()
  expect(screen.getByText("Received")).toBeTruthy()
  // Opening it recorded nothing.
  expect(finStore.get().records).toHaveLength(count)
})

test("the changed amount and category are recorded against that date", () => {
  const p = plan(),
    other = finStore
      .get()
      .categories.find((c) => c.kind === "income" && c.id !== p.categoryId)
  if (!other) throw new Error("demo data has two income categories")
  editor(p)
  fireEvent.changeText(screen.getByLabelText("Amount ₱"), "26,980.50")
  fireEvent.press(screen.getByLabelText("Choose category"))
  fireEvent.press(screen.getByLabelText(other.name))
  fireEvent.press(screen.getByText("Received"))
  const [r, ...more] = recordsOf(p)
  expect(more).toHaveLength(0)
  expect(r).toMatchObject({
    amount: 26980.5,
    categoryId: other.id,
    plannedId: p.id,
    plannedOn: DAY,
    source: "planned",
  })
  expect(toastMock).toHaveBeenCalledWith(
    "Recorded Salary",
    expect.objectContaining({ action: expect.any(Object) }),
  )
})

test("closing the editor without saving records nothing", () => {
  const p = plan(),
    onClose = jest.fn(),
    count = finStore.get().records.length
  editor(p, onClose)
  fireEvent.press(screen.getByLabelText("Close"))
  expect(onClose).toHaveBeenCalled()
  expect(finStore.get().records).toHaveLength(count)
  expect(toastMock).not.toHaveBeenCalled()
})

test("saving the same date twice keeps one record and updates it quietly", () => {
  const p = plan()
  editor(p).unmount()
  editor(p)
  fireEvent.press(screen.getByText("Received"))
  expect(toastMock).toHaveBeenCalledWith("Recorded Salary", expect.anything())
  screen.unmount()
  editor(p)
  fireEvent.changeText(screen.getByLabelText("Amount ₱"), "28,000")
  fireEvent.press(screen.getByText("Received"))
  // An update has no Undo, so no toast: the record itself is the feedback.
  expect(toastMock.success).not.toHaveBeenCalled()
  const rows = recordsOf(p)
  expect(rows).toHaveLength(1)
  expect(rows[0].amount).toBe(28000)
})

test("a transfer plan records one transfer and offers no fee", () => {
  const s = finStore.get(),
    [from, to] = s.accounts.filter((a) => !a.archived)
  const p = plan({
    name: "Savings",
    type: "transfer",
    amount: 5000,
    accountId: from.id,
    toAccountId: to.id,
    categoryId: undefined,
  })
  editor(p)
  expect(screen.queryByLabelText(/^Fee/)).toBeNull()
  const count = finStore.get().records.length
  fireEvent.press(screen.getByText("Paid"))
  expect(finStore.get().records).toHaveLength(count + 1)
  expect(recordsOf(p)).toEqual([
    expect.objectContaining({
      type: "transfer",
      accountId: from.id,
      toAccountId: to.id,
    }),
  ])
})

test("undo takes the recorded payment away", () => {
  const p = plan()
  editor(p)
  fireEvent.press(screen.getByText("Received"))
  expect(recordsOf(p)).toHaveLength(1)
  const [, opts] = toastMock.mock.calls.find(
    ([m]) => m === "Recorded Salary",
  ) as [string, { action: { onClick: () => void } }]
  act(() => opts.action.onClick())
  expect(recordsOf(p)).toHaveLength(0)
})

test("Review & record leaves the date's sheet, then opens the editor", async () => {
  const p = plan()
  render(<DueSheet id={p.id} day={DAY} onClose={() => {}} />, { wrapper })
  expect(screen.getByText("Skip")).toBeTruthy()
  expect(screen.getByText("Snooze")).toBeTruthy()
  fireEvent.press(screen.getByText("Review & record"))
  // Only once the first sheet is gone (iOS refuses two at once).
  expect(await screen.findByText("Record Salary")).toBeTruthy()
})

test("a plan deleted while its editor is open is reported, not recorded", () => {
  const p = plan(),
    count = finStore.get().records.length
  render(
    <RecordEditor
      open
      onClose={() => {}}
      settles={{ plannedId: p.id, day: DAY }}
      prefill={{
        type: "income",
        amount: 27500,
        accountId: p.accountId,
        categoryId: p.categoryId,
      }}
    />,
    { wrapper },
  )
  // The plan disappears underneath the open form (another device).
  act(() =>
    finStore.set((s) => ({
      ...s,
      planned: s.planned.filter((x) => x.id !== p.id),
    })),
  )
  fireEvent.press(screen.getByText("Received"))
  expect(toastMock.error).toHaveBeenCalledWith(
    "That scheduled payment no longer exists",
  )
  expect(finStore.get().records).toHaveLength(count)
})
