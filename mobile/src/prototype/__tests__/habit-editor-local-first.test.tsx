import * as A from "@domain/habits/actions"
import type { Habit, HabitLog } from "@domain/habits/data"
import * as L from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayOffset } from "@domain/lib/day"
import {
  configureStorage,
  flushStores,
  resetAll,
  type StorageAdapter,
} from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { SyncEngine } from "@/live/engine"
import type { Http } from "@/live/http"
import { habitsMappers } from "@/live/mappers/habits"
import { createOutbox, type SyncOp } from "@/live/outbox"
import { AUTOSAVE_MS } from "../autosave"
import { HabitForm } from "../screens/habits"
import { deferWrite, WRITE_DELAY_MS } from "../storage"

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
  withDelay: (_: number, value: unknown) => value,
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

const USER = "00000000-0000-4000-8000-000000000001"
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)

/** The app's storage as the providers configure it: writes deferred. */
function memoryStorage() {
  const m = new Map<string, string>()
  const writes: string[] = []
  const adapter: StorageAdapter = {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      writes.push(k)
      m.set(k, v)
    },
    removeItem: (k) => void m.delete(k),
  }
  return { adapter, writes, saved: (k: string) => m.get(k) }
}
const savedHabits = (saved: (k: string) => string | undefined) =>
  JSON.parse(saved("sop-proto:habits") ?? "null")

/** Offline until `online.on` is set; every request is recorded. */
function network() {
  const online = { on: false }
  const requests: { method: string; path: string; body: unknown }[] = []
  const http: Http = {
    request: async <T,>(method: string, path: string, body?: unknown) => {
      if (!online.on) throw new Error("offline: nothing may wait on this")
      requests.push({ method, path, body })
      if (path === "/sync/push")
        return {
          results: (body as { ops: SyncOp[] }).ops.map((o) => ({
            op_id: o.op_id,
            status: "applied",
          })),
        } as T
      return { changes: [], cursor: 1, truncated: false } as T
    },
    raw: async () => {
      throw new Error("unused")
    },
  }
  return { online, requests, http }
}

let store: ReturnType<typeof memoryStorage>
beforeEach(() => {
  jest.useFakeTimers()
  store = memoryStorage()
  configureStorage(store.adapter, () => {}, { defer: deferWrite })
  resetAll()
  habitsStore.set((s) => ({ ...s, habits: [], logs: [], routines: [] }))
  jest.advanceTimersByTime(WRITE_DELAY_MS)
  store.writes.length = 0
})
afterEach(() => jest.useRealTimers())

const habitOf = (id: string) =>
  habitsStore.get().habits.find((h) => h.id === id) as Habit

test("an edit saved offline is in the store the moment typing pauses", () => {
  const net = network()
  const h = A.createHabit({ name: "Walk", icon: "🚶" })
  render(<HabitForm id={h.id} />, { wrapper })
  fireEvent.changeText(screen.getByLabelText("Name"), "Long walk")
  fireEvent.press(screen.getByRole("switch", { name: "Reminder" }))
  fireEvent.press(screen.getByText("# Count"))
  // The editor saves itself once typing pauses.
  act(() => {
    jest.advanceTimersByTime(AUTOSAVE_MS)
  })
  // No request made: the save is local.
  expect(habitOf(h.id)).toMatchObject({
    name: "Long walk",
    reminder: !h.reminder,
    type: "count",
  })
  expect(net.requests).toHaveLength(0)
})

test("an offline edit is written to storage after the beat and pushed once online", async () => {
  const net = network()
  const outboxStorage = memoryStorage()
  const engine = new SyncEngine({
    http: net.http,
    storage: outboxStorage.adapter,
    outbox: createOutbox(outboxStorage.adapter),
    mappers: habitsMappers(USER),
    online: () => net.online.on,
  })
  const h = A.createHabit({ name: "Walk", icon: "🚶" })
  engine.start((m, onChange) => m.store.subscribe(onChange))
  jest.advanceTimersByTime(1000)
  render(<HabitForm id={h.id} />, { wrapper })
  fireEvent.changeText(screen.getByLabelText("Name"), "Evening walk")
  // The editor saves itself once typing pauses.
  act(() => {
    jest.advanceTimersByTime(AUTOSAVE_MS)
  })
  // Not written with the save; written once the beat passes.
  expect(savedHabits(store.saved)?.habits?.[0]?.name).not.toBe("Evening walk")
  jest.advanceTimersByTime(WRITE_DELAY_MS)
  expect(savedHabits(store.saved).habits[0].name).toBe("Evening walk")
  // Offline, the engine queues the edit and sends nothing.
  await act(async () => {
    jest.advanceTimersByTime(1000)
  })
  expect(net.requests).toHaveLength(0)
  // Back online: the queued edit goes out with the new name.
  net.online.on = true
  await act(async () => {
    await engine.sync()
  })
  const pushed = net.requests
    .filter((r) => r.path === "/sync/push")
    .flatMap((r) => (r.body as { ops: SyncOp[] }).ops)
  expect(
    pushed.some(
      (o) =>
        o.kind === "upsert" &&
        o.name === "habit" &&
        o.id === h.id &&
        (o.data as { name?: string }).name === "Evening walk",
    ),
  ).toBe(true)
  engine.stop()
})

test("rapid edits and ticks lose nothing and are written once", () => {
  const habits = Array.from({ length: 6 }, (_, i) =>
    A.createHabit({ name: `H${i}`, icon: "✅" }),
  )
  jest.advanceTimersByTime(WRITE_DELAY_MS)
  store.writes.length = 0
  render(<HabitForm id={habits[0].id} />, { wrapper })
  const name = screen.getByLabelText("Name")
  for (let i = 0; i < 40; i++) fireEvent.changeText(name, `Name ${i}`)
  // The editor saves itself once typing pauses.
  act(() => {
    jest.advanceTimersByTime(AUTOSAVE_MS)
  })
  // A burst of ticks across habits and days, some undone again.
  for (let d = 0; d < 10; d++)
    for (const h of habits) A.checkHabit(h.id, dayOffset(-d))
  for (const h of habits.slice(0, 3)) A.clearLog(h.id, dayOffset(-2))
  expect(store.writes).toHaveLength(0)
  jest.advanceTimersByTime(WRITE_DELAY_MS)
  expect(store.writes.filter((k) => k === "sop-proto:habits")).toHaveLength(1)
  const saved = savedHabits(store.saved)
  expect(saved.habits[0].name).toBe("Name 39")
  expect(saved.logs).toEqual(habitsStore.get().logs)
  expect(saved.logs).toHaveLength(6 * 10 - 3)
})

test("leaving the foreground writes what is still waiting", () => {
  const h = A.createHabit({ name: "Read", icon: "📚" })
  A.checkHabit(h.id)
  expect(store.writes).toHaveLength(0)
  flushStores()
  expect(savedHabits(store.saved).logs).toHaveLength(1)
  // The timer that was waiting finds nothing left to write.
  store.writes.length = 0
  jest.advanceTimersByTime(WRITE_DELAY_MS)
  expect(store.writes).toHaveLength(0)
})

// The index is patched from the previous one on a small change and the
// streak and rate figures are cached per habit; both must match a cold
// computation after any sequence of changes.
test("patched log index and cached figures match a cold computation", () => {
  let seed = 7
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    return seed % n
  }
  for (let i = 0; i < 4; i++) A.createHabit({ name: `H${i}`, icon: "✅" })
  const start = dayOffset(-40)
  habitsStore.set((s) => ({
    ...s,
    habits: s.habits.map((h) => ({ ...h, createdAt: start })),
  }))
  const today = dayOffset(0)
  for (let step = 0; step < 300; step++) {
    const h = habitsStore.get().habits[rand(4)]
    const day = dayOffset(-rand(40))
    const op = rand(4)
    if (op === 0) A.clearLog(h.id, day)
    else if (op === 1) A.logHabit({ habitId: h.id, day, status: "skipped" })
    else A.checkHabit(h.id, day)
    const { logs, habits: now } = habitsStore.get()
    const idx = L.logIndex(logs)
    const cold = new Map<string, HabitLog>(
      logs.map((l) => [L.lk(l.habitId, l.day), l]),
    )
    expect([...idx.entries()].sort()).toEqual([...cold.entries()].sort())
    for (const x of now) {
      const fresh = { ...x }
      expect(L.streaks(x, idx, today)).toEqual(L.streaks(fresh, cold, today))
      expect(L.habitStats(x, idx, start, today, today)).toEqual(
        L.habitStats(fresh, cold, start, today, today),
      )
    }
  }
})

test("a repeated habit and day keeps the full index's last-one-wins", () => {
  const h = A.createHabit({ name: "Run", icon: "🏃" })
  const first = A.checkHabit(h.id, dayOffset(-1)) as HabitLog
  L.logIndex(habitsStore.get().logs)
  // A second log for the same habit and day (as a merge could leave), put
  // before the first: the later one in the list still speaks for the day.
  const twin: HabitLog = { ...first, id: "twin", status: "skipped" }
  habitsStore.set((s) => ({ ...s, logs: [twin, ...s.logs] }))
  expect(
    L.logIndex(habitsStore.get().logs).get(L.lk(h.id, dayOffset(-1)))?.id,
  ).toBe(first.id)
  // Removing that later one hands the day to the twin.
  habitsStore.set((s) => ({ ...s, logs: s.logs.filter((l) => l !== first) }))
  expect(
    L.logIndex(habitsStore.get().logs).get(L.lk(h.id, dayOffset(-1)))?.id,
  ).toBe("twin")
})
