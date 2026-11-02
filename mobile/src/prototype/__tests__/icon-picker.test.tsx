// The shared icon picker: suggestions for the name being typed, search
// with a clear button and closest matches, labelled icons, a light tap on
// each pick, and recent picks remembered when the sheet closes.

import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import * as Haptics from "expo-haptics"
import { type ReactNode, useState } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"

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
    ScrollView: require("react-native").ScrollView,
  }
})
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => {
  const { View } = require("react-native")
  return ({ children }: { children: ReactNode }) => <View>{children}</View>
})
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "s", Error: "e", Warning: "w" },
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}))

const { IconField, IconPickerSheet } =
  require("../icon-picker") as typeof import("../icon-picker")
const { recentIcons } =
  require("../icons/search") as typeof import("../icons/search")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  jest.clearAllMocks()
})

function Field({ name, start = "✅" }: { name: string; start?: string }) {
  const [icon, setIcon] = useState(start)
  const { Text } = require("react-native")
  return (
    <>
      <IconField
        value={icon}
        onChange={setIcon}
        name={name}
        accent="hab"
        fallback={["📖", "💧"]}
      />
      <Text testID="icon">{icon}</Text>
    </>
  )
}
function Picker({ name = "" }: { name?: string }) {
  const [icon, setIcon] = useState("✅"),
    [open, setOpen] = useState(true)
  const { Text } = require("react-native")
  return (
    <>
      <IconPickerSheet
        open={open}
        onClose={() => setOpen(false)}
        value={icon}
        onChange={setIcon}
        name={name}
        accent="hab"
        fallback={["📖", "💧"]}
      />
      <Text testID="icon">{icon}</Text>
      <Text testID="open">{open ? "open" : "closed"}</Text>
    </>
  )
}

test("the form row suggests icons for the name, current pick first", () => {
  render(<Field name="Run" />, { wrapper })
  const radios = screen.getAllByRole("radio")
  expect(radios[0].props.accessibilityLabel).toBe("Check mark")
  expect(radios[0].props.accessibilityState).toEqual({ selected: true })
  expect(radios[1].props.accessibilityLabel).toBe("Running")
  fireEvent.press(screen.getByLabelText("Running"))
  expect(screen.getByTestId("icon").props.children).toBe("🏃")
  expect(Haptics.impactAsync).toHaveBeenCalledWith("light")
  expect(recentIcons.get().icons[0]).toBe("🏃")
  expect(
    screen.getByLabelText(/^All icons, \d{3} to choose from$/),
  ).toBeTruthy()
})

test("a saved icon outside the catalogue still shows as selected", () => {
  render(<Field name="" start="🦄" />, { wrapper })
  expect(screen.getByLabelText("Selected icon: 🦄")).toBeTruthy()
})

test("the sheet opens on Suggested for the typed name, with every area to jump to", () => {
  render(<Picker name="Read" />, { wrapper })
  expect(screen.getByText("Suggested for “Read”")).toBeTruthy()
  expect(screen.getByLabelText("Selected icon: Check mark")).toBeTruthy()
  for (const area of ["Health", "Fitness", "Food & drink", "Misc"])
    expect(screen.getAllByText(area).length).toBeGreaterThan(0)
  // No picks yet: no Recent chip, rather than an empty one.
  expect(screen.queryByText("Recent")).toBeNull()
})

test("search matches synonyms and clears with ×", () => {
  render(<Picker />, { wrapper })
  fireEvent.changeText(screen.getByLabelText("Search icons"), "gym")
  expect(screen.getByLabelText("Weight lifter")).toBeTruthy()
  expect(screen.getByLabelText("Flexed biceps")).toBeTruthy()
  expect(screen.queryByText("Fitness")).toBeNull()
  fireEvent.press(screen.getByLabelText("Clear search"))
  expect(screen.getByLabelText("Search icons").props.value).toBe("")
  expect(screen.queryByLabelText("Clear search")).toBeNull()
})

test("a search with no matches offers the closest icons", () => {
  render(<Picker />, { wrapper })
  fireEvent.changeText(screen.getByLabelText("Search icons"), "cofee")
  expect(screen.getByText("No icons match “cofee”. The closest:")).toBeTruthy()
  // A thin answer is topped up with the usual suggestions.
  expect(screen.getByText("Suggested")).toBeTruthy()
  expect(screen.getByLabelText("Open book")).toBeTruthy()
  fireEvent.press(screen.getByLabelText("Hot drink"))
  expect(screen.getByTestId("icon").props.children).toBe("☕")
})

test("a pick applies at once and is remembered when the sheet closes", () => {
  render(<Picker />, { wrapper })
  fireEvent.changeText(screen.getByLabelText("Search icons"), "coffee")
  fireEvent.press(screen.getByLabelText("Hot drink"))
  expect(screen.getByLabelText("Selected icon: Hot drink")).toBeTruthy()
  expect(recentIcons.get().icons).toEqual([])
  fireEvent.press(screen.getByLabelText("Done"))
  expect(screen.getByTestId("open").props.children).toBe("closed")
  expect(recentIcons.get().icons).toEqual(["☕"])
})
