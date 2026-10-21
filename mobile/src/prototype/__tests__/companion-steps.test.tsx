// Fern's steps block (ADR-0015): a running step says what it is doing, a
// finished one shows the server's sentence, and a saved write offers Undo
// wired to its card.
import { captureStore } from "@domain/capture/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import { BlockView } from "../companion/blocks"

const mockUndo = jest.fn()
jest.mock("@domain/capture/engine", () => ({
  ...jest.requireActual("@domain/capture/engine"),
  undoCard: (...a: unknown[]) => mockUndo(...a),
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
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  mockUndo.mockReset()
})

test("running, finished and failed steps read as such; a saved write offers Undo", () => {
  captureStore.set((s) => ({
    ...s,
    captures: [
      {
        id: "cap-1",
        at: new Date().toISOString(),
        source: "chat",
        text: "add a task to buy milk",
        status: "done",
        reply: {
          items: [
            {
              t: "record",
              id: "card-1",
              kind: "task",
              state: "saved",
            } as never,
          ],
        },
      } as never,
    ],
  }))
  render(
    <BlockView
      block={{
        t: "steps",
        items: [
          { id: "a", tool: "lookup", label: "Looking it up", running: true },
          {
            id: "b",
            tool: "create_tasks",
            label: "Adding to your tasks",
            ok: true,
            summary: "Added task: Buy milk · 2026-10-23 17:00",
            card_id: "card-1",
            state: "saved",
          },
          {
            id: "c",
            tool: "log_expense",
            label: "Logging an expense",
            ok: false,
            summary: "Couldn't finish: invalid arguments",
          },
        ],
      }}
    />,
  )
  expect(screen.getByText("Looking it up…")).toBeTruthy()
  expect(
    screen.getByText("Added task: Buy milk · 2026-10-23 17:00"),
  ).toBeTruthy()
  expect(screen.getByText("Couldn't finish: invalid arguments")).toBeTruthy()
  fireEvent.press(screen.getByRole("button", { name: "Undo" }))
  expect(mockUndo).toHaveBeenCalledWith("card-1")
})

test("a write still waiting shows no action until its card has arrived", () => {
  render(
    <BlockView
      block={{
        t: "steps",
        items: [
          {
            id: "b",
            tool: "create_tasks",
            label: "Adding to your tasks",
            ok: true,
            summary: "Added task: Call mom (waiting for your OK)",
            card_id: "not-here-yet",
            state: "proposed",
          },
        ],
      }}
    />,
  )
  expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull()
})
