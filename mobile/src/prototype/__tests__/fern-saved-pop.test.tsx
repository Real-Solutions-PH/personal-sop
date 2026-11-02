// A card Fern saves while it is on screen lands with a check pop and a
// success tap, and counts as a completion (so the day's moments follow);
// a card already saved when the reply appears stays quiet.
import { captureStore } from "@domain/capture/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, render, screen } from "@testing-library/react-native"
import { BlockView } from "../companion/blocks"
import type { StepItem } from "../companion/store"
import { completedRecently } from "../motion"

jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  NotificationFeedbackType: {
    Success: "success",
    Warning: "warning",
    Error: "error",
  },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}))

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

const Haptics = require("expo-haptics")
const pop = () => screen.queryByTestId("card-saved-pop")

test("saving a card on screen pops a check with a success tap", () => {
  arrive([{ id: "card-m", state: "proposed" }])
  render(<BlockView block={{ t: "steps", items: [meal] }} />)
  expect(pop()).toBeNull()
  Haptics.notificationAsync.mockClear()
  arrive([{ id: "card-m", state: "saved" }])
  expect(pop()).toBeTruthy()
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy()
  expect(Haptics.notificationAsync).toHaveBeenCalledWith("success")
  expect(completedRecently()).toBe(true)
})

test("a card already saved when the reply appears stays quiet", () => {
  arrive([{ id: "card-m", state: "saved" }])
  Haptics.notificationAsync.mockClear()
  render(<BlockView block={{ t: "steps", items: [meal] }} />)
  expect(pop()).toBeNull()
  expect(Haptics.notificationAsync).not.toHaveBeenCalled()
})
