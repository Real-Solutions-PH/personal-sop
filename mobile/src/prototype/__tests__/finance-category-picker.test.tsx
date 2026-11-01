// The category picker: grouped under parents, searchable with the parent
// named, adding from a search, dimmed rows when a kind has none yet; and
// the projection's minimum balance typed as money.

import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import { type ReactNode, useState } from "react"
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

const { CategoryPicker } =
  require("../screens/finance-category-picker") as typeof import("../screens/finance-category-picker")
const { Projection } =
  require("../screens/finance-projection") as typeof import("../screens/finance-projection")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const toastMock = toast as unknown as jest.Mock & { error: jest.Mock }
beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  jest.clearAllMocks()
})

function Picker({ kind = "expense" as "expense" | "income" }) {
  const [value, setValue] = useState("")
  return (
    <>
      <CategoryPicker kind={kind} value={value} onPick={setValue} />
      <PickedName id={value} />
    </>
  )
}
function PickedName({ id }: { id: string }) {
  const c = finStore.use((s) => s.categories.find((x) => x.id === id))
  const { Text } = require("react-native")
  return <Text testID="picked">{c?.name ?? ""}</Text>
}
const labels = () =>
  screen
    .getAllByRole("button")
    .map((b) => b.props.accessibilityLabel as string | undefined)
    .filter((l): l is string => !!l)

test("a search names each sub-category with its parent", () => {
  render(<Picker />, { wrapper })
  fireEvent.changeText(screen.getByLabelText("Search categories"), "mobile")
  expect(screen.getByText("Bills › Mobile plan")).toBeTruthy()
  // The footer adds what was typed.
  expect(screen.getByText("+ Add “mobile”")).toBeTruthy()
  expect(screen.queryByText("New category")).toBeNull()
})

test("adding from a search starts the form with the typed name and picks it", () => {
  render(<Picker />, { wrapper })
  fireEvent.changeText(screen.getByLabelText("Search categories"), "Gym")
  fireEvent.press(screen.getByText("+ Add “Gym”"))
  expect(screen.getByDisplayValue("Gym")).toBeTruthy()
  fireEvent.press(screen.getByText("Save"))
  const gym = finStore.get().categories.find((c) => c.name === "Gym")
  expect(gym?.kind).toBe("expense")
  expect(screen.getByTestId("picked").props.children).toBe("Gym")
  // No toast: the picked category is the feedback (toasts carry an Undo).
  expect(toastMock).not.toHaveBeenCalled()
})

test("a sub-category whose parent is archived is listed as a main one", () => {
  finStore.set((s) => ({
    ...s,
    categories: s.categories.map((c) =>
      c.id === "bills" ? { ...c, archived: true } : c,
    ),
  }))
  render(<Picker />, { wrapper })
  const names = labels()
  expect(names).toContain("Mobile plan")
  expect(names.some((l) => l.startsWith("Mobile plan, under"))).toBe(false)
})

test("an income picker adds an income category, with no kind switch", () => {
  render(<Picker kind="income" />, { wrapper })
  fireEvent.press(screen.getByText("New category"))
  expect(screen.queryByText("Expense")).toBeNull()
  fireEvent.changeText(screen.getByLabelText("Name"), "Side gigs")
  fireEvent.press(screen.getByText("Save"))
  expect(
    finStore.get().categories.find((c) => c.name === "Side gigs")?.kind,
  ).toBe("income")
})

test("a name already used under the same parent is refused", () => {
  render(<Picker />, { wrapper })
  fireEvent.press(screen.getByText("New category"))
  fireEvent.changeText(screen.getByLabelText("Name"), "bills")
  const before = finStore.get().categories.length
  fireEvent.press(screen.getByText("Save"))
  expect(toastMock.error).toHaveBeenCalledWith(
    expect.stringMatching(/^You already have “Bills”/),
  )
  expect(finStore.get().categories).toHaveLength(before)
})

test("a kind with no categories yet shows dimmed rows, not a blank list", () => {
  finStore.set((s) => ({
    ...s,
    categories: s.categories.filter((c) => c.kind !== "income"),
  }))
  render(<Picker kind="income" />, { wrapper })
  // Shown, but hidden from screen readers: they are not choices.
  const dim = screen.getAllByTestId("category-preview", {
    includeHiddenElements: true,
  })
  expect(dim.length).toBeGreaterThan(0)
  expect(screen.queryAllByTestId("category-preview")).toHaveLength(0)
  expect(screen.getByText("New category")).toBeTruthy()
})

test("the minimum balance is typed as money", () => {
  render(<Projection />, { wrapper })
  fireEvent.press(screen.getByText(/assumptions/i))
  const field = screen.getByLabelText("Minimum balance ₱")
  fireEvent.changeText(field, "12500.5")
  expect(finStore.get().settings.safetyFloor).toBe(12500.5)
  expect(screen.getByDisplayValue("12,500.5")).toBeTruthy()
  // A trailing point survives while typing.
  fireEvent.changeText(field, "12,500.")
  expect(screen.getByDisplayValue("12,500.")).toBeTruthy()
})
