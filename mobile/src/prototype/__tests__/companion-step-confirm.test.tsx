// A step whose card waits for the person shows Confirm and Discard, even
// when the reply's capture never reached the device: the step names its
// capture, which is fetched while the real Confirm shows dimmed.
import { captureStore } from "@domain/capture/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import { BlockView } from "../companion/blocks"
import type { StepItem } from "../companion/store"

const mockConfirm = jest.fn()
const mockEnsure = jest.fn()
const mockDiscard = jest.fn()
const mockRedo = jest.fn()
const mockToast = Object.assign(jest.fn(), {
  success: jest.fn(),
  error: jest.fn(),
})
jest.mock("@domain/capture/engine", () => {
  const actual = jest.requireActual("@domain/capture/engine")
  return {
    ...actual,
    confirmCard: (...a: unknown[]) => mockConfirm(...a),
    ensureCapture: (...a: unknown[]) => mockEnsure(...a),
    redoCard: (...a: unknown[]) => mockRedo(...a),
    discardCard: (id: string) => {
      mockDiscard(id)
      actual.discardCard(id)
    },
  }
})
// A getter: the factory runs before this file's constants are set.
jest.mock("@domain/capture/toast", () => ({
  get toast() {
    return mockToast
  },
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

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  mockConfirm.mockReset()
  mockEnsure.mockReset()
  mockDiscard.mockReset()
  mockRedo.mockReset()
  mockToast.mockReset()
  mockToast.success.mockReset()
})

const meal: StepItem = {
  id: "s",
  tool: "log_meal",
  label: "Logging a meal",
  ok: true,
  summary: "Logged meal: Matcha soft-serve (waiting for your OK)",
  card_id: "card-m",
  state: "proposed",
  capture_id: "cap-m",
}

function arrive(cards: { id: string; state: string }[]) {
  act(() =>
    captureStore.set((s) => ({
      ...s,
      captures: [
        {
          id: "cap-m",
          at: new Date().toISOString(),
          source: "chat",
          text: "log this",
          status: "needs_input",
          reply: {
            items: cards.map((c) => ({
              t: "record",
              id: c.id,
              kind: "meal",
              state: c.state,
              log: [],
            })),
          },
        } as never,
      ],
    })),
  )
}

const confirm = () => screen.getByRole("button", { name: "Confirm" })

test("a waiting card not on the device shows a dimmed Confirm and is fetched once", () => {
  render(<BlockView block={{ t: "steps", items: [meal] }} />)
  expect(confirm().props.accessibilityState).toMatchObject({ disabled: true })
  fireEvent.press(confirm())
  expect(mockConfirm).not.toHaveBeenCalled()
  expect(mockEnsure).toHaveBeenCalledTimes(1)
  expect(mockEnsure).toHaveBeenCalledWith("cap-m")
})

test("once the card arrives Confirm works, with no toast", () => {
  render(<BlockView block={{ t: "steps", items: [meal] }} />)
  arrive([{ id: "card-m", state: "proposed" }])
  expect(confirm().props.accessibilityState).toMatchObject({ disabled: false })
  fireEvent.press(confirm())
  expect(mockConfirm).toHaveBeenCalledWith("card-m")
  expect(mockToast.success).not.toHaveBeenCalled()
})

test("Discard drops the card and the step reads Discarded, with no toast", () => {
  arrive([{ id: "card-m", state: "proposed" }])
  render(<BlockView block={{ t: "steps", items: [meal] }} />)
  fireEvent.press(screen.getByRole("button", { name: "Discard" }))
  expect(mockDiscard).toHaveBeenCalledWith("card-m")
  expect(mockToast).not.toHaveBeenCalled()
  expect(screen.getByText("Discarded")).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull()
})

test("a step from before steps named their capture shows no button", () => {
  const { capture_id: _, ...old } = meal
  render(<BlockView block={{ t: "steps", items: [old] }} />)
  expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull()
  expect(mockEnsure).not.toHaveBeenCalled()
})

test("each of a step's cards gets the same treatment", () => {
  const tasks: StepItem = {
    id: "t",
    tool: "create_tasks",
    label: "Adding to your tasks",
    ok: true,
    summary: "Added 2 tasks: Buy milk, Call mom (2 waiting for your OK)",
    capture_id: "cap-m",
    cards: [
      { card_id: "c-milk", state: "proposed", label: "Buy milk" },
      { card_id: "c-mom", state: "proposed", label: "Call mom" },
    ],
  }
  render(<BlockView block={{ t: "steps", items: [tasks] }} />)
  const dimmed = screen.getAllByRole("button", { name: "Confirm" })
  expect(dimmed).toHaveLength(2)
  for (const b of dimmed)
    expect(b.props.accessibilityState).toMatchObject({ disabled: true })
  expect(mockEnsure).toHaveBeenCalledWith("cap-m")
  arrive([
    { id: "c-milk", state: "proposed" },
    { id: "c-mom", state: "proposed" },
  ])
  fireEvent.press(screen.getAllByRole("button", { name: "Confirm" })[1])
  expect(mockConfirm).toHaveBeenCalledWith("c-mom")
})

test("an undone card offers Redo, which saves it again without a toast", () => {
  arrive([{ id: "card-m", state: "undone" }])
  render(<BlockView block={{ t: "steps", items: [meal] }} />)
  expect(screen.getByText("Undone")).toBeTruthy()
  fireEvent.press(screen.getByRole("button", { name: "Redo" }))
  expect(mockRedo).toHaveBeenCalledWith("card-m")
  expect(mockToast.success).not.toHaveBeenCalled()
  expect(mockToast).not.toHaveBeenCalled()
})

test("a table Fern sent shows every food, its grams, the totals and the source", () => {
  render(
    <BlockView
      block={{
        t: "table",
        title: "Portions",
        columns: ["Food", "Amount", "kcal", "Protein g", "Carbs g", "Fat g"],
        rows: [["Fried tilapia", "150 g", "270", "36", "3", "13"]],
        foot: [
          ["Meal total", "", "270", "36", "3", "13"],
          ["Left today after", "", "1,730", "-4", "217", "47"],
        ],
        note: "Fried tilapia: standard values",
      }}
    />,
  )
  for (const text of [
    "PORTIONS",
    "Fried tilapia",
    "150 g",
    "Protein g",
    "Meal total",
    "Left today after",
    "1,730",
    "-4",
    "Fried tilapia: standard values",
  ])
    expect(screen.getByText(text)).toBeTruthy()
  // Each row reads as one sentence to a screen reader.
  expect(
    screen.getByLabelText(
      "Food Fried tilapia, Amount 150 g, kcal 270, Protein g 36, Carbs g 3, Fat g 13",
    ),
  ).toBeTruthy()
})
