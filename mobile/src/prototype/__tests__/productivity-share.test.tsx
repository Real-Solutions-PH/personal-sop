// The productivity share cards (tasks today and time per task, Focus,
// journal time and words, one habit, finance shares): every layout renders
// in every size and background with normal, long and empty data, keeps the
// card anatomy, and never shows an amount; and the counts behind them.

import type { JournalEntry } from "@domain/capture/data"
import { buildSeed } from "@domain/finance/data"
import { seedFocus } from "@domain/focus/data"
import { configureStorage, resetAll } from "@domain/lib/store"
import { seedTasks, type TasksState } from "@domain/tasks/data"
import { render } from "@testing-library/react-native"
import type { ReactElement, ReactNode } from "react"
import { Text } from "react-native"
import { addTyping, GAP_MS, typed } from "../journal-time"
import {
  type FocusDay,
  financeShares,
  focusDay,
  journalTime,
  journalWords,
  taskFocusToday,
  todayCompletion,
} from "../productivity-share-calc"
import { FinanceCard, type FinanceCardData } from "../screens/finance-share"
import { FocusCard, type FocusCardData } from "../screens/focus-share"
import { HabitCard } from "../screens/habit-share"
import { JournalCard } from "../screens/journal-share"
import { TaskCard } from "../screens/task-share"
import type { CardBackdrop, CardFormat, CardLook } from "../share-kit"
import * as F from "./share-fixtures"

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
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: ReactNode }) => children,
    ScrollView: require("react-native").ScrollView,
  }
})
jest.mock("react-native-view-shot", () => ({ captureRef: jest.fn() }))
jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}))
jest.mock("../media", () => ({ copyText: jest.fn(), pickPhoto: jest.fn() }))

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

const T0 = new Date("2026-10-24T09:00:00").getTime()
const min = (m: number) => T0 + m * 60_000
const LONG = "Supercalifragilistic expialidocious quarterly planning review"

function focusDayData(
  kind: "pomodoro" | "stopwatch",
  v: "normal" | "long" | "empty",
): FocusDay {
  const base: FocusDay = {
    day: "2026-10-24",
    mode: kind,
    sessions: 0,
    sets: 0,
    focusSec: 0,
    breakSec: 0,
    pauseSec: 0,
    longestSec: 0,
    spans: [],
    items: [],
    goalSec: 7200,
    dayFocusSec: 0,
  }
  if (v === "empty") return base
  const long = v === "long"
  return {
    ...base,
    sessions: long ? 1234 : 2,
    sets: long ? 12345 : 4,
    focusSec: long ? 1234567 : 6000,
    breakSec: long ? 123456 : 900,
    pauseSec: long ? 12345 : 420,
    longestSec: long ? 123456 : 3000,
    dayFocusSec: long ? 1234567 : 6000,
    spans: [
      { start: min(0), end: min(25), kind: "focus" },
      { start: min(25), end: min(30), kind: "break" },
      { start: min(30), end: min(55), kind: "focus" },
      { start: min(55), end: min(62), kind: "pause" },
      { start: min(62), end: min(80), kind: "focus" },
      { start: min(300), end: min(360), kind: "focus" },
    ],
    items: [1, 2, 3, 4, 5].map((i) => ({
      name: long ? `${LONG} ${i}` : i === 5 ? "" : `Item ${i}`,
      sec: long ? 1234567 - i : 3600 / i,
    })),
  }
}
const focusData = (v: "normal" | "long" | "empty"): FocusCardData => ({
  pomodoro: focusDayData("pomodoro", v),
  stopwatch: focusDayData("stopwatch", v),
})
function taskData(v: "normal" | "long" | "empty") {
  const long = v === "long",
    empty = v === "empty"
  return {
    ...F.taskData(long),
    today: {
      day: "2026-10-24",
      planned: empty ? 0 : long ? 1234567 : 8,
      done: empty ? 0 : long ? 123456 : 5,
      moved: empty ? 0 : long ? 12345 : 2,
      open: empty ? 0 : long ? 1234 : 1,
      catchUp: empty ? 0 : long ? 1234 : 1,
    },
    focus: {
      day: "2026-10-24",
      avgSec: empty ? 0 : long ? 1234567 : 2520,
      totalSec: empty ? 0 : long ? 12345678 : 7560,
      rows: empty
        ? []
        : [1, 2, 3, 4, 5, 6].map((i) => ({
            id: `t${i}`,
            title: long ? `${LONG} ${i}` : `Task ${i}`,
            sec: long ? 1234567 - i : 1500 * i,
            done: i % 2 === 0,
          })),
    },
  }
}
function journalData(v: "normal" | "long" | "empty") {
  const long = v === "long",
    empty = v === "empty",
    d = F.journalData(long),
    today = "2026-10-24"
  const days: Record<string, number> = empty
    ? {}
    : Object.fromEntries(
        [0, 1, 2, 4, 5, 6].map((i) => [
          `2026-10-${String(18 + i).padStart(2, "0")}`,
          long ? 1234567 : 300 * (i + 1),
        ]),
      )
  const entries: Pick<JournalEntry, "day" | "body">[] = empty
    ? []
    : [18, 19, 21, 22, 24].map((n) => ({
        day: `2026-10-${n}`,
        body: long ? "word ".repeat(123456) : "a few honest words here",
      }))
  return {
    ...d,
    time: journalTime(days, empty ? null : "2026-10-18", today),
    words: journalWords(entries, today),
  }
}
function habitData(v: "normal" | "long" | "empty") {
  const d = F.habitData(v === "long")
  if (v === "empty" || !d.habit) return { ...d, habit: null }
  return {
    ...d,
    habit: {
      ...d.habit,
      prevRate30: v === "long" ? 0.2 : 0.9,
      history: {
        rates: [null, 0.4, 0.71, 1, 0.86, 0.5, 1, 0.33],
        total: v === "long" ? 1234567 : 64,
      },
    },
  }
}
function financeData(v: "normal" | "long" | "empty"): FinanceCardData {
  const long = v === "long",
    empty = v === "empty"
  const days = Array.from({ length: 24 }, (_, i) => ({
    key: `2026-10-${String(i + 1).padStart(2, "0")}`,
    free: i % 3 !== 0,
  }))
  return {
    month: "2026-10",
    from: "2026-10-01",
    to: "2026-10-31",
    savings: [-5, -4, -3, -2, -1, 0].map((i) => ({
      month: `2026-${String(10 + i).padStart(2, "0")}`,
      rate: empty
        ? null
        : long
          ? 123.45
          : i === -3
            ? -0.12
            : 0.1 + (i + 5) * 0.04,
    })),
    budgets: empty
      ? []
      : [1, 2, 3, 4, 5].map((i) => ({
          name: long ? `${LONG} ${i}` : `Budget ${i}`,
          used: long ? 1234.5 : i * 0.25,
          pace: 0.77,
        })),
    shares: empty
      ? []
      : [0.42, 0.21, 0.17, 0.12, 0.08].map((share, i) => ({
          name: long ? `${LONG} ${i}` : `Category ${i}`,
          share,
        })),
    noSpend: empty
      ? { days: [], count: 0, streak: 0 }
      : { days, count: days.filter((x) => x.free).length, streak: 2 },
  }
}

type Make = (look: CardLook, v: "normal" | "long" | "empty") => ReactElement
const CARDS: [string, Make][] = [
  ...(["today", "timeOnTask"] as const).map((k): [string, Make] => [
    `task ${k}`,
    (look, v) => (
      <TaskCard kind={k} width={300} look={look} data={taskData(v)} />
    ),
  ]),
  ...(["pomodoro", "stopwatch"] as const).map((k): [string, Make] => [
    `focus ${k}`,
    (look, v) => (
      <FocusCard kind={k} width={300} look={look} data={focusData(v)} />
    ),
  ]),
  ...(["time", "words"] as const).map((k): [string, Make] => [
    `journal ${k}`,
    (look, v) => (
      <JournalCard kind={k} width={300} look={look} data={journalData(v)} />
    ),
  ]),
  [
    "habit habit",
    (look, v) => (
      <HabitCard kind="habit" width={300} look={look} data={habitData(v)} />
    ),
  ],
  ...(["savings", "budgets", "categories", "nospend"] as const).map(
    (k): [string, Make] => [
      `finance ${k}`,
      (look, v) => (
        <FinanceCard kind={k} width={300} look={look} data={financeData(v)} />
      ),
    ],
  ),
]
const FORMATS: CardFormat[] = ["9:16", "4:5", "1:1"]
const BACKDROPS: CardBackdrop[] = [
  "photo",
  "fern",
  "dusk",
  "dark",
  "light",
  "custom",
  "sticker",
]
/** Every colour-valued prop in the rendered tree. */
function colours(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out
  const n = node as { props?: Record<string, unknown>; children?: unknown[] }
  const styles = [n.props?.style].flat(Infinity) as Record<string, unknown>[]
  for (const s of styles)
    if (s && typeof s === "object")
      for (const [k, v] of Object.entries(s))
        if (/colou?r$/i.test(k) && typeof v === "string") out.push(v)
  for (const k of ["stroke", "fill", "color"])
    if (typeof n.props?.[k] === "string") out.push(n.props[k] as string)
  for (const c of n.children ?? []) colours(c, out)
  return out
}
const valid =
  /^(#[0-9a-f]{6}([0-9a-f]{2})?|transparent|none|currentColor|url\(#.+\))$/i

describe.each(CARDS)("%s card", (_, make) => {
  test.each(
    FORMATS.flatMap((f) => BACKDROPS.map((b) => [f, b] as const)),
  )("renders %s on %s with normal, long and empty data", (format, backdrop) => {
    for (const v of ["normal", "long", "empty"] as const) {
      const look = { format, backdrop, photo: null, color: "#3e63dd" }
      const r = render(make(look, v))
      const words = r
        .UNSAFE_getAllByType(Text)
        .map((t) => [t.props.children].flat(Infinity).join(""))
        .join(" ")
      expect(words).not.toMatch(/₱|\$|PHP/)
      expect(words).not.toMatch(/\d{5,}/)
      expect(words).not.toMatch(/NaN|undefined|Infinity/)
      for (const c of colours(r.toJSON())) expect(c).toMatch(valid)
      expect(r.queryAllByTestId("card-accent")).toHaveLength(0)
      expect(r.getAllByTestId("card-lockup")).toHaveLength(1)
      r.unmount()
    }
  })
})

describe("honest wins and misses", () => {
  const look: CardLook = { format: "9:16", backdrop: "fern", photo: null }
  test("today's tasks: moved tasks are a cost, all done is a win", () => {
    const r = render(
      <TaskCard
        kind="today"
        width={300}
        look={look}
        data={taskData("normal")}
      />,
    )
    expect(r.getByText("2 moved to later")).toBeTruthy()
    expect(r.getByTestId("card-miss")).toBeTruthy()
    const all = taskData("normal")
    all.today = { ...all.today, planned: 5, done: 5, moved: 0, open: 0 }
    const w = render(
      <TaskCard kind="today" width={300} look={look} data={all} />,
    )
    expect(w.getByTestId("card-win")).toBeTruthy()
    expect(w.queryAllByTestId("card-cost")).toHaveLength(0)
  })
  test("focus: short of the goal is said in the miss colour", () => {
    const d = focusData("normal")
    d.pomodoro = { ...d.pomodoro, focusSec: 3600, dayFocusSec: 3600 }
    const r = render(
      <FocusCard kind="pomodoro" width={300} look={look} data={d} />,
    )
    expect(r.getByText("1h 00m short of the day's goal")).toBeTruthy()
    expect(r.getByTestId("card-cost")).toBeTruthy()
  })
  test("finance: a month that spent more than it earned is a miss", () => {
    const d = financeData("normal")
    d.savings[5] = { ...d.savings[5], rate: -0.2 }
    const r = render(
      <FinanceCard kind="savings" width={300} look={look} data={d} />,
    )
    expect(r.getByTestId("card-miss")).toBeTruthy()
  })
})

describe("counts", () => {
  test("today's completion counts done, moved and open tasks", () => {
    const today = "2026-10-24"
    const s = seedTasks()
    const mk = (
      id: string,
      due: string | null,
      status: "open" | "done",
      completedAt: string | null = null,
    ) => ({
      ...s.tasks[0],
      id,
      listId: null,
      dueDate: due,
      status,
      completedAt,
      recurrence: null,
    })
    const state: TasksState = {
      ...s,
      tasks: [
        mk("a", today, "done", `${today}T10:00:00`),
        mk("b", today, "open"),
        mk("c", "2026-10-26", "open"),
        mk("d", "2026-10-20", "done", `${today}T08:00:00`),
        mk("e", "2026-10-25", "open"),
      ],
      events: [
        {
          id: "1",
          taskId: "c",
          type: "rescheduled",
          fromDue: today,
          toDue: "2026-10-26",
          at: `${today}T09:00:00`,
        },
        // Moved on another day: not today's move.
        {
          id: "2",
          taskId: "e",
          type: "rescheduled",
          fromDue: "2026-10-23",
          toDue: "2026-10-25",
          at: "2026-10-23T09:00:00",
        },
      ],
    }
    expect(todayCompletion(state, today)).toEqual({
      planned: 3,
      done: 1,
      moved: 1,
      open: 1,
      catchUp: 1,
    })
  })
  test("focus day: the seeded morning has Pomodoros, a break and a pause", () => {
    const s = seedFocus()
    const today = new Date()
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
    const d = focusDay(s, key, "pomodoro", Date.now() + 86_400_000)
    expect(d.sessions).toBe(1)
    expect(d.focusSec).toBe(50 * 60)
    expect(d.breakSec).toBe(5 * 60)
    expect(d.pauseSec).toBe(7 * 60)
    expect(d.spans.map((x) => x.kind)).toEqual([
      "focus",
      "break",
      "focus",
      "pause",
      "focus",
    ])
    const t = taskFocusToday(s, seedTasks(), key, Date.now() + 86_400_000)
    expect(t.rows.map((r) => r.id)).toEqual(["t2"])
    expect(t.avgSec).toBe(35 * 60)
  })
  test("journal time sums today, the week and the month", () => {
    const tm = journalTime(
      {
        "2026-10-24": 60,
        "2026-10-20": 120,
        "2026-10-01": 600,
        "2026-09-01": 30,
      },
      "2026-09-01",
      "2026-10-24",
    )
    expect([tm.todaySec, tm.weekSec, tm.monthSec, tm.totalSec]).toEqual([
      60, 180, 780, 810,
    ])
    expect(tm.last7.map((x) => x.sec)).toEqual([0, 0, 120, 0, 0, 0, 60])
  })
  test("journal words count per day, the average over days written", () => {
    const w = journalWords(
      [
        { day: "2026-10-24", body: "one two  three" },
        { day: "2026-10-24", body: "four" },
        { day: "2026-10-20", body: " five six " },
      ],
      "2026-10-24",
    )
    expect([w.total, w.todayWords, w.perDay, w.daysWritten, w.best]).toEqual([
      6, 4, 3, 2, 4,
    ])
  })
  test("typing time counts only gaps up to a minute", () => {
    expect(typed(null, 1000)).toBe(0)
    expect(typed(1000, 3000)).toBe(2000)
    expect(typed(1000, 1000 + GAP_MS + 1)).toBe(0)
    const s = addTyping({ since: null, days: {} }, "2026-10-24", 5)
    expect(addTyping(s, "2026-10-24", 3)).toEqual({
      since: "2026-10-24",
      days: { "2026-10-24": 8 },
    })
  })
  test("finance shares carry no amount: every figure is a rate", () => {
    const d = financeShares(buildSeed().state)
    for (const x of d.shares) expect(x.share).toBeGreaterThanOrEqual(0)
    expect(d.shares.reduce((a, x) => a + x.share, 0)).toBeCloseTo(
      d.shares.length ? 1 : 0,
    )
    for (const b of d.budgets) expect(b.pace).toBeLessThanOrEqual(1)
    expect(d.savings).toHaveLength(6)
  })
})
