// The shared date and time field: a tap opens a picker (never a keyboard),
// the field shows the formatted day, bounds and defaults reach the picker,
// and an optional field can be cleared. Picks are local calendar days.
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import { type ReactNode, useState } from "react"
import { Platform } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import {
  clampDay,
  formatPick,
  parseDay,
  startOf,
  toClock,
  toDay,
} from "../date-pick"
import { DateField } from "../ui"

type PickerProps = {
  testID?: string
  display?: string
  mode?: string
  value: Date
  minimumDate?: Date
  maximumDate?: Date
  onChange: (e: { type: string }, d?: Date) => void
}
let mockPicker: PickerProps | null = null
jest.mock("@react-native-community/datetimepicker", () => {
  const { View } = require("react-native")
  return {
    __esModule: true,
    default: (p: PickerProps) => {
      mockPicker = p
      return <View testID={p.testID ?? "picker"} />
    },
  }
})
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
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
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: ReactNode }) => children,
  }
})

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

/** A field that holds its own value, like every form does. */
function Harness(props: {
  initial?: string
  onValue?: (v: string) => void
  extra?: Partial<Parameters<typeof DateField>[0]>
}) {
  const [v, setV] = useState(props.initial ?? "")
  return (
    <DateField
      label="End date"
      value={v}
      onChangeText={(next) => {
        setV(next)
        props.onValue?.(next)
      }}
      {...props.extra}
    />
  )
}

describe("helpers", () => {
  test("a late-evening pick stays on its local day", () => {
    // 23:30 local is the next day in UTC for any zone west of Greenwich and
    // the previous one east of it; the stored day is the local one.
    expect(toDay(new Date(2026, 10, 8, 23, 30))).toBe("2026-11-08")
    expect(toDay(new Date(2026, 10, 8, 0, 15))).toBe("2026-11-08")
    expect(toClock(new Date(2026, 10, 8, 7, 5))).toBe("07:05")
  })
  test("bounds clamp a day and ignore an unreadable bound", () => {
    expect(clampDay("2026-01-01", "2026-02-01")).toBe("2026-02-01")
    expect(clampDay("2026-03-01", undefined, "2026-02-01")).toBe("2026-02-01")
    expect(clampDay("2026-01-01", "soon")).toBe("2026-01-01")
  })
  test("the picker opens on the value, else the default, else today, inside bounds", () => {
    const today = "2026-11-02"
    expect(
      toDay(
        startOf(
          "date",
          "2026-12-25",
          "2027-01-01",
          undefined,
          undefined,
          today,
        ),
      ),
    ).toBe("2026-12-25")
    expect(
      toDay(startOf("date", "", "2027-01-01", undefined, undefined, today)),
    ).toBe("2027-01-01")
    expect(
      toDay(startOf("date", "", undefined, undefined, undefined, today)),
    ).toBe(today)
    expect(
      toDay(startOf("date", "", undefined, "2026-12-01", undefined, today)),
    ).toBe("2026-12-01")
    expect(toClock(startOf("time", "", "18:30"))).toBe("18:30")
    expect(toClock(startOf("time", "", undefined))).toBe("09:00")
  })
  test("the field shows a readable day, with the year only when it differs", () => {
    expect(formatPick("date", "2026-11-08", "2026-11-02")).toBe("Sun, Nov 8")
    expect(formatPick("date", "2027-01-08", "2026-11-02")).toBe(
      "Fri, Jan 8, 2027",
    )
    expect(formatPick("date", "garbage", "2026-11-02")).toBe("garbage")
    expect(formatPick("time", "07:30")).toBe("07:30")
    expect(parseDay("2026-02-30")).toBeNull()
  })
})

test("on iOS a tap opens a calendar sheet, not a keyboard, and Done keeps the day", () => {
  const onValue = jest.fn()
  render(
    <Harness
      onValue={onValue}
      extra={{ minimumDate: "2026-11-01", defaultValue: "2026-12-08" }}
    />,
    { wrapper },
  )
  expect(
    screen.UNSAFE_queryAllByType(require("react-native").TextInput),
  ).toHaveLength(0)
  expect(screen.getByText("Choose a date")).toBeTruthy()
  fireEvent.press(screen.getByRole("button", { name: "End date" }))
  expect(screen.getByTestId("date-wheel")).toBeTruthy()
  expect(mockPicker?.display).toBe("inline")
  expect(toDay(mockPicker!.minimumDate!)).toBe("2026-11-01")
  // Opens on the default while empty.
  expect(toDay(mockPicker!.value)).toBe("2026-12-08")
  act(() =>
    mockPicker!.onChange({ type: "set" }, new Date(2026, 11, 20, 23, 30)),
  )
  expect(onValue).not.toHaveBeenCalled()
  fireEvent.press(screen.getByText("Done"))
  expect(onValue).toHaveBeenCalledWith("2026-12-20")
  const year = dayKey().slice(0, 4) === "2026" ? "" : ", 2026"
  expect(screen.getByText(`Sun, Dec 20${year}`)).toBeTruthy()
})

test("an optional field clears, a required one has no clear", () => {
  const onValue = jest.fn()
  const { rerender } = render(
    <Harness
      initial="2026-11-08"
      onValue={onValue}
      extra={{ clearable: true, placeholder: "No date" }}
    />,
    { wrapper },
  )
  fireEvent.press(screen.getByRole("button", { name: "Clear End date" }))
  expect(onValue).toHaveBeenCalledWith("")
  expect(screen.getByText("No date")).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Clear End date" })).toBeNull()
  rerender(<Harness initial="2026-11-08" />)
  expect(screen.queryByRole("button", { name: "Clear End date" })).toBeNull()
})

test("the field announces its label, value and what a tap does", () => {
  render(<Harness initial="2026-11-08" />, { wrapper })
  const button = screen.getByRole("button", { name: "End date" })
  expect(button.props.accessibilityValue.text).toMatch(/Sun, Nov 8/)
  expect(button.props.accessibilityHint).toBe("Opens a date picker")
})

test("a time field opens the wheel on its default", () => {
  const onValue = jest.fn()
  render(
    <Harness
      onValue={onValue}
      extra={{ mode: "time", label: "Time", defaultValue: "18:00" }}
    />,
    { wrapper },
  )
  fireEvent.press(screen.getByRole("button", { name: "Time" }))
  expect(mockPicker?.display).toBe("spinner")
  expect(mockPicker?.mode).toBe("time")
  fireEvent.press(screen.getByText("Done"))
  expect(onValue).toHaveBeenCalledWith("18:00")
})

test("on Android the system dialog gets the bounds and a set writes the local day", () => {
  Platform.OS = "android"
  const onValue = jest.fn()
  render(
    <Harness
      initial="2026-11-08"
      onValue={onValue}
      extra={{ minimumDate: "2026-11-01", maximumDate: "2026-11-30" }}
    />,
    { wrapper },
  )
  expect(mockPicker).toBeNull()
  fireEvent.press(screen.getByRole("button", { name: "End date" }))
  expect(toDay(mockPicker!.maximumDate!)).toBe("2026-11-30")
  act(() => mockPicker!.onChange({ type: "set" }, new Date(2026, 10, 9, 0, 5)))
  expect(onValue).toHaveBeenCalledWith("2026-11-09")
})

// Done saves what the picker shows, even when nothing was turned: an empty
// time opens on 09:00 and an empty date on its default, and both stick.
test("Done without scrolling saves the shown time", () => {
  const onValue = jest.fn()
  render(
    <Harness onValue={onValue} extra={{ mode: "time", label: "Time" }} />,
    {
      wrapper,
    },
  )
  fireEvent.press(screen.getByRole("button", { name: "Time" }))
  fireEvent.press(screen.getByText("Done"))
  expect(onValue).toHaveBeenCalledWith("09:00")
  expect(screen.getByText("09:00")).toBeTruthy()
})

test("Done without scrolling saves the shown date", () => {
  const onValue = jest.fn()
  render(<Harness onValue={onValue} extra={{ defaultValue: "2026-12-08" }} />, {
    wrapper,
  })
  fireEvent.press(screen.getByRole("button", { name: "End date" }))
  fireEvent.press(screen.getByText("Done"))
  expect(onValue).toHaveBeenCalledWith("2026-12-08")
})

test("the compact time control saves its shown 09:00 when it had no time", () => {
  const { TimeInput } =
    require("../time-input") as typeof import("../time-input")
  const onChange = jest.fn()
  render(<TimeInput value="" onChange={onChange} label="Reminder" />, {
    wrapper,
  })
  fireEvent.press(screen.getByLabelText("Reminder"))
  fireEvent.press(screen.getByText("Done"))
  expect(onChange).toHaveBeenCalledWith("09:00")
})
