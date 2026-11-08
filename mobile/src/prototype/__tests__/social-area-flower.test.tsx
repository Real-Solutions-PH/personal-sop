import { render, screen } from "@testing-library/react-native"
import { ScoreCard } from "../social/profile"
import type { Scorecard } from "../social/store"

// The profile imports the shared Sheet, which loads sonner.
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
  withTiming: (value: unknown) => value,
  useReducedMotion: () => true,
}))

const card = (over: Partial<Scorecard> = {}): Scorecard => ({
  life: 38,
  delta: 2,
  streak: 0,
  best: 0,
  rates: { habits: 0.06, tasks: 0.5, fitness: 0.41 },
  stats: [],
  trophies: [],
  ...over,
})
const facet = (key: string, module: "habits" | "tasks" | "fitness") => ({
  key,
  label: key[0].toUpperCase() + key.slice(1),
  module,
  value: 0.4,
  prev: 0.3,
  off: false,
  href: "",
})

test("a friend's profile shows their area flower, not bars", () => {
  render(
    <ScoreCard
      card={card({
        facets: [facet("habits", "habits"), facet("tasks", "tasks")],
      })}
      name="Ervin Piol"
      mine={false}
    />,
  )
  expect(screen.getByTestId("profile-area-flower")).toBeTruthy()
  expect(screen.queryByText("Finance")).toBeNull()
})

test("from a server older than the flower, only the shared areas show as bars", () => {
  render(<ScoreCard card={card()} name="Ervin Piol" mine={false} />)
  expect(screen.queryByTestId("profile-area-flower")).toBeNull()
  expect(screen.getByText("Habits")).toBeTruthy()
  expect(screen.getByText("Fitness")).toBeTruthy()
  // Finance was switched off, so it is not drawn as a 0% bar.
  expect(screen.queryByText("Finance")).toBeNull()
})
