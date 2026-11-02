// A scheduled payment's "Ends: On a date" is a date picker: it cannot open
// before the start, opens on the next occurrence while empty, and saves
// the picked local day. A count never leaks into the date and back.
import * as A from "@domain/finance/actions"
import type { PlannedItem } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { Platform, TextInput } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toDay } from "../date-pick"

type PickerProps = {
  value: Date
  minimumDate?: Date
  onChange: (e: { type: string }, d?: Date) => void
}
let mockPicker: PickerProps | null = null
jest.mock("@react-native-community/datetimepicker", () => {
  const { View } = require("react-native")
  return {
    __esModule: true,
    default: (p: PickerProps) => {
      mockPicker = p
      return <View />
    },
  }
})
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
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
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({}))

const { PlannedEditor, nextAfterStart } =
  require("../screens/finance-planned-editor") as typeof import("../screens/finance-planned-editor")

const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider
    initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 44, left: 0, right: 0, bottom: 34 },
    }}
  >
    {children}
  </SafeAreaProvider>
)
jest.setTimeout(30000)
beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  mockPicker = null
  Platform.OS = "ios"
})

function plan(extra: Partial<PlannedItem> = {}): PlannedItem {
  const s = finStore.get()
  return A.addPlanned({
    name: "Rent",
    type: "expense",
    amount: 12000,
    estimated: false,
    accountId: s.accounts[0].id,
    categoryId: s.categories.find((c) => c.kind === "expense")?.id,
    schedule: { kind: "monthly", day: 15 },
    start: "2030-01-01",
    end: { kind: "never" },
    autoLog: false,
    isWhatIf: false,
    inProjection: true,
    ...extra,
  })
}
const endFieldIsText = () =>
  screen
    .UNSAFE_queryAllByType(TextInput)
    .some((i) => i.props.accessibilityLabel === "End date")

test("the next occurrence after the start is where an empty end opens", () => {
  expect(nextAfterStart({ kind: "monthly", day: 15 }, "2030-01-01")).toBe(
    "2030-02-15",
  )
  expect(
    nextAfterStart(
      { kind: "weekly", every: 2, anchor: "2030-01-01" },
      "2030-01-01",
    ),
  ).toBe("2030-01-15")
  expect(
    nextAfterStart({ kind: "once", date: "2030-01-01" }, "2030-01-01"),
  ).toBe(undefined)
})

test("On a date picks an end date no earlier than the start and saves it", () => {
  const p = plan()
  render(<PlannedEditor id={p.id} open onClose={() => {}} />, { wrapper })
  fireEvent.press(screen.getByText("On a date"))
  expect(endFieldIsText()).toBe(false)
  fireEvent.press(screen.getByRole("button", { name: "End date" }))
  expect(toDay(mockPicker!.minimumDate!)).toBe("2030-01-01")
  expect(toDay(mockPicker!.value)).toBe("2030-02-15")
  act(() => mockPicker!.onChange({ type: "set" }, new Date(2030, 5, 15, 12)))
  fireEvent.press(screen.getByText("Done"))
  expect(screen.getByText("Sat, Jun 15, 2030")).toBeTruthy()
  fireEvent.press(screen.getByText("Save"))
  expect(finStore.get().planned.find((x) => x.id === p.id)?.end).toEqual({
    kind: "date",
    date: "2030-06-15",
  })
})

test("a count and an end date are kept apart when Ends changes", () => {
  const p = plan({ end: { kind: "count", n: 12 } })
  render(<PlannedEditor id={p.id} open onClose={() => {}} />, { wrapper })
  const count = screen.getByLabelText("Occurrences")
  expect(count.props.value).toBe("12")
  expect(count.props.keyboardType).toBe("number-pad")
  fireEvent.press(screen.getByText("On a date"))
  expect(
    screen.getByRole("button", { name: "End date" }).props.accessibilityValue
      .text,
  ).toBe("Not set")
  fireEvent.press(screen.getByText("After N times"))
  expect(screen.getByLabelText("Occurrences").props.value).toBe("12")
})
