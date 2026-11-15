// Shared goals and budgets screens: dimmed samples, okaying a withdrawal,
// joining a budget with the categories that count.

import * as G from "@domain/finance/groups"

import * as L from "@domain/finance/loans"
import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"

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
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

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

const { GoalDetail, BudgetDetail } =
  require("../screens/finance-shared-groups") as typeof import("../screens/finance-shared-groups")
const { SharedHome } =
  require("../screens/finance-shared") as typeof import("../screens/finance-shared")

const OBJ = "44444444-4444-4444-8444-444444444444"
const me = { id: "me", name: "Me" }
const them = { id: "them", name: "Mia" }

function goal(extra: Partial<G.SharedGoal> = {}): G.SharedGoal {
  const g: G.SharedGoal = {
    id: "m-goal",
    goalId: OBJ,
    role: "owner",
    myStatus: "active",
    status: "active",
    name: "Japan trip",
    currency: "PHP",
    target: 1_000_000,
    members: [
      { person: me, role: "owner", status: "active", amount: 0 },
      { person: them, role: "member", status: "active", amount: 0 },
    ],
    entries: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  }
  L.sharedStore.set({ ...L.EMPTY_SHARED, goals: [g] })
  return g
}

test("the Shared list shows dimmed samples for loans, goals and budgets", () => {
  render(<SharedHome />, { wrapper })
  expect(screen.getByText("New loan")).toBeTruthy()
  expect(screen.getByText("New goal")).toBeTruthy()
  expect(screen.getByText("New budget")).toBeTruthy()
})

test("a member okays someone's withdrawal and the balance drops", () => {
  goal({
    entries: [
      {
        id: "d1",
        kind: "deposit",
        status: "accepted",
        amount: 500_000,
        onDate: "2026-01-01",
        byId: "them",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "w1",
        kind: "withdrawal",
        status: "sent",
        amount: 200_000,
        onDate: "2026-01-02",
        byId: "them",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ],
  })
  render(<GoalDetail goalId={OBJ} />, { wrapper })
  expect(screen.getByText("Waiting for an okay")).toBeTruthy()
  fireEvent.press(screen.getByText("Okay it"))
  const g = L.sharedStore.get().goals[0]
  expect(G.goalSummary(g).balance).toBe(300_000)
})

test("an invited budget member picks categories and joins", () => {
  const cat = finStore
    .get()
    .categories.find((c) => c.kind === "expense" && !c.system && !c.parentId)!
  const b: G.SharedBudget = {
    id: "m-budget",
    budgetId: OBJ,
    role: "member",
    myStatus: "invited",
    status: "active",
    name: "Groceries",
    currency: "PHP",
    limit: 1_500_000,
    month: "2026-01",
    spent: 1_200_000,
    myCategoryIds: [],
    members: [
      { person: them, role: "owner", status: "active", amount: 1_200_000 },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
  }
  L.sharedStore.set({ ...L.EMPTY_SHARED, budgets: [b] })
  render(<BudgetDetail budgetId={OBJ} />, { wrapper })
  expect(screen.getByText("₱3,000")).toBeTruthy()
  fireEvent.press(screen.getByLabelText(`Count ${cat.name}`))
  fireEvent.press(screen.getByText("Join"))
  const now = L.sharedStore.get().budgets[0]
  expect(now.myStatus).toBe("active")
  expect(now.myCategoryIds).toEqual([cat.id])
})
