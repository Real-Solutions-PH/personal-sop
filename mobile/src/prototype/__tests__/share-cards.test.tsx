// Share cards: every card renders in every size and background with normal
// and long values, numbers are grouped or abbreviated rather than spilling,
// no colour is malformed (``"#fff" + "a6"`` once made labels vanish), and no
// ₱ amount reaches a card.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, within } from "@testing-library/react-native"
import type { ReactElement, ReactNode } from "react"
import {
  Dimensions,
  Image,
  PixelRatio,
  ScrollView,
  StyleSheet,
  Text,
} from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { luminance } from "../color-picker"
import { Artwork } from "../screens/dash-share"
import { WorkoutCard } from "../screens/fitness-share"
import {
  HabitCard,
  type HabitLayout,
  milestoneOf,
} from "../screens/habit-share"
import { addDays, JournalCard, journalStats } from "../screens/journal-share"
import { FoodCard, runOf } from "../screens/nutrition-share"
import { paceChange, RunCard, runCardData } from "../screens/run-share"
import { TaskCard } from "../screens/task-share"
import { clock, compact, fmt, group, pct, signed } from "../share-format"
import {
  alpha,
  Body,
  type CardBackdrop,
  type CardFormat,
  CardFrame,
  type CardLook,
  COMPACT,
  cardInk,
  endedRun,
  FIT_SETTLE_MS,
  Figures,
  Hero,
  nextFit,
  ShareComposer,
  Sub,
  Title,
  Win,
  XBars,
} from "../share-kit"
import { socialStore } from "../social/store"
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
// The caption editor is a Sheet, which drags to close.
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

describe("share-format", () => {
  test("groups thousands", () => {
    expect(group(1234567)).toBe("1,234,567")
    expect(group(12345678.9, 2)).toBe("12,345,678.9")
    expect(group(999)).toBe("999")
    expect(group(-1234)).toBe("−1,234")
    expect(group(-0.2)).toBe("0")
    expect(group(Number.NaN)).toBe("—")
  })
  test("abbreviates past a unit, carrying 999,950 up to 1M", () => {
    expect(compact(12345)).toBe("12.3k")
    expect(compact(1234567)).toBe("1.2M")
    expect(compact(12345678.9)).toBe("12.3M")
    expect(compact(999950)).toBe("1M")
    expect(compact(123456)).toBe("123k")
    expect(compact(1234567890)).toBe("1.2B")
    expect(compact(-12345)).toBe("−12.3k")
    expect(compact(4.25)).toBe("4.3")
  })
  test("keeps a number whole while it fits, then abbreviates", () => {
    expect(fmt(1234)).toBe("1,234")
    expect(fmt(123456)).toBe("123k")
    expect(fmt(1234567)).toBe("1.2M")
    expect(fmt(72.45, 6, 1)).toBe("72.5")
  })
  test("rates, signed changes and clocks", () => {
    expect(pct(0.856)).toBe("86%")
    expect(pct(12.34)).toBe("1,234%")
    expect(pct(12345.67)).toBe("1.2M%")
    expect(pct(null)).toBe("—")
    expect(signed(1234)).toBe("+1,234")
    expect(signed(-3)).toBe("−3")
    expect(signed(0)).toBe("0")
    expect(clock(1520)).toBe("25:20")
    expect(clock(1234567)).toBe("342:56:07")
  })
})

describe("card colours", () => {
  const hex = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i
  test("alpha expands short hex instead of gluing a suffix on", () => {
    expect(alpha("#fff", 0.65)).toBe("#ffffffa6")
    expect(alpha("#1f5a43", 0.5)).toBe("#1f5a4380")
    expect(alpha("#1f5a4380", 0.5)).toBe("#1f5a4340")
  })
  test.each<CardBackdrop>([
    "fern",
    "dusk",
    "dark",
    "light",
    "custom",
    "photo",
    "sticker",
  ])("every %s colour is well formed", (backdrop) => {
    for (const color of ["#f6f5f1", "#121513", "#3e63dd"]) {
      const c = cardInk({ format: "9:16", backdrop, photo: null, color })
      const { area, dark, gradient, ...rest } = c
      for (const v of gradient?.stops ?? []) expect(v).toMatch(hex)
      for (const v of [...Object.values(rest), area("fin"), area("life")])
        expect(v).toMatch(hex)
    }
  })
  test.each([
    "#7a3fb8",
    "#3e63dd",
    "#1f8a5a",
    "#d9a441",
    "#c2185b",
  ])("on a %s ground every area keeps 3:1 or draws in ink", (color) => {
    const c = cardInk({
      format: "9:16",
      backdrop: "custom",
      photo: null,
      color,
    })
    for (const a of [
      "hab",
      "tsk",
      "fit",
      "nut",
      "foc",
      "fin",
      "scr",
      "life",
    ] as const) {
      const v = c.area(a)
      expect(v === c.ink || contrast(v, color) >= 3).toBe(true)
    }
  })
  test("a pale chosen colour gets dark ink, a deep one light ink", () => {
    const look = (color: string): CardLook => ({
      format: "1:1",
      backdrop: "custom",
      photo: null,
      color,
    })
    expect(cardInk(look("#f6f5f1")).dark).toBe(false)
    expect(cardInk(look("#1f5a43")).dark).toBe(true)
  })
  test.each([
    ["fern", 2],
    ["dusk", 3],
  ] as const)("the %s ground is a dark gradient of %i stops", (backdrop, n) => {
    const c = cardInk({ format: "9:16", backdrop, photo: null })
    expect(c.dark).toBe(true)
    expect(c.gradient?.stops).toHaveLength(n)
    for (const v of c.gradient?.stops ?? []) expect(v).toMatch(hex)
    // The ground paints its first stop before the SVG does.
    expect(c.bg).toBe(c.gradient?.stops[0])
  })
  test.each([
    "fern",
    "dusk",
  ] as const)("words on %s reach 4.5:1 against every stop", (backdrop) => {
    const c = cardInk({ format: "9:16", backdrop, photo: null })
    for (const stop of c.gradient?.stops ?? []) {
      expect(contrast(c.ink, stop)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(c.muted, stop)).toBeGreaterThanOrEqual(4.5)
    }
  })
  test("no alpha suffix is glued onto a short hex in the share kit", () => {
    const code = readFileSync(join(__dirname, "..", "share-kit.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
    expect(code).not.toMatch(/["'`]#[0-9a-f]{3}["'`]\s*\+/i)
  })
})

/** ``hex`` (``#rrggbb`` or ``#rrggbbaa``) laid over the solid ``under``. */
function over(hex: string, under: string): string {
  const a = hex.length === 9 ? Number.parseInt(hex.slice(7), 16) / 255 : 1
  return `#${[1, 3, 5]
    .map((i) => {
      const top = Number.parseInt(hex.slice(i, i + 2), 16),
        bottom = Number.parseInt(under.slice(i, i + 2), 16)
      return Math.round(top * a + bottom * (1 - a))
        .toString(16)
        .padStart(2, "0")
    })
    .join("")}`
}
/** WCAG contrast ratio of ``fg`` (alpha allowed) drawn on ``bg``. */
function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(over(fg, bg)), luminance(bg)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const FORMATS: CardFormat[] = ["9:16", "4:5", "1:1"]
const BACKDROPS: CardBackdrop[] = [
  "fern",
  "dusk",
  "dark",
  "light",
  "custom",
  "photo",
  "sticker",
]
const on = {
  level: true,
  hexagon: true,
  areas: true,
  delta: true,
  onTarget: true,
  habits: true,
  training: true,
  savings: true,
  deltas: true,
  trophy: true,
  hero: true,
  prs: true,
  streak: true,
  highlight: true,
  grid: true,
  best: true,
  spend: true,
  budgets: true,
  nospend: true,
  photo: false,
  records: true,
  identity: true,
  target: true,
  mark: true,
  handle: true,
  dates: true,
}
const flags = {
  exercises: true,
  prs: true,
  week: true,
  bodyweight: true,
  macros: true,
}
type Make = (look: CardLook, long: boolean) => ReactElement
const CARDS: [string, Make][] = [
  ...(
    [
      "life",
      "weekly",
      "monthly",
      "streak",
      "finance",
      "profile",
      "goal",
    ] as const
  ).map((k): [string, Make] => [
    `dash ${k}`,
    (look, long) => (
      <Artwork kind={k} width={300} look={look} on={on} d={F.dashData(long)} />
    ),
  ]),
  ...(
    ["streak", "milestone", "month", "routine", "scoreboard"] as HabitLayout[]
  ).map((k): [string, Make] => [
    `habit ${k}`,
    (look, long) => (
      <HabitCard kind={k} width={300} look={look} data={F.habitData(long)} />
    ),
  ]),
  ...(["summary", "streak", "followThrough"] as const).map(
    (k): [string, Make] => [
      `task ${k}`,
      (look, long) => (
        <TaskCard kind={k} width={300} look={look} data={F.taskData(long)} />
      ),
    ],
  ),
  ...(["summary", "pr", "photo"] as const).map((k): [string, Make] => [
    `workout ${k}`,
    (look, long) => (
      <WorkoutCard
        kind={k}
        width={300}
        look={look}
        data={F.workoutData(long)}
        flags={flags}
      />
    ),
  ]),
  ...(["route", "splits", "overlay"] as const).flatMap((k) =>
    [false, true].map((indoor): [string, Make] => [
      `run ${k}${indoor ? " treadmill" : ""}`,
      (look, long) => (
        <RunCard
          kind={k}
          width={300}
          look={look}
          data={F.runData(long, indoor)}
        />
      ),
    ]),
  ),
  ...(["day", "week"] as const).map((k): [string, Make] => [
    `food ${k}`,
    (look, long) => (
      <FoodCard kind={k} width={300} look={look} data={F.foodData(long)} />
    ),
  ]),
  ...(["streak", "month"] as const).map((k): [string, Make] => [
    `journal ${k}`,
    (look, long) => (
      <JournalCard
        kind={k}
        width={300}
        look={look}
        data={F.journalData(long)}
      />
    ),
  ]),
]

/** Every colour-valued style prop in the rendered tree. */
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
/** A Text inside another Text: it lays out as part of its parent's line. */
const nested = (t: { parent: unknown }) => {
  let p = t.parent as { type?: unknown; parent?: unknown } | null
  while (p) {
    if (p.type === Text || p.type === "Text") return true
    p = p.parent as typeof p
  }
  return false
}
const valid =
  /^(#[0-9a-f]{6}([0-9a-f]{2})?|transparent|none|currentColor|url\(#.+\))$/i

describe.each(CARDS)("%s card", (_, make) => {
  test.each(
    FORMATS.flatMap((f) => BACKDROPS.map((b) => [f, b] as const)),
  )("renders %s on %s with normal and long values", (format, backdrop) => {
    for (const long of [false, true]) {
      const look = { format, backdrop, photo: null, color: "#3e63dd" }
      const r = render(make(look, long))
      const text = r.UNSAFE_getAllByType(Text)
      const words = text.map((t) => [t.props.children].flat(Infinity).join(""))
      // Never a peso amount, even when a metric string carries one.
      expect(words.join(" ")).not.toMatch(/₱/)
      // No ungrouped run of 5+ digits: long numbers are grouped or short.
      expect(words.join(" ")).not.toMatch(/\d{5,}/)
      // Each line of text is capped, so it can shrink or end in "…"
      // instead of pushing the card's layout out of shape.
      for (const t of text)
        if (t.props.numberOfLines === undefined) expect(nested(t)).toBe(true)
      // iOS cuts off glyph tops on a line no taller than its font, and a
      // number's unit rides inside its one shrink-to-fit line, so "3,272 kg"
      // shrinks as one piece rather than wrapping to "3,27 / 2".
      for (const t of text) {
        if (nested(t)) continue
        const s = StyleSheet.flatten(t.props.style)
        if (s.lineHeight !== undefined)
          expect(s.lineHeight).toBeGreaterThanOrEqual(s.fontSize * 1.1 - 0.01)
        if (s.fontFamily?.startsWith("GeistMono"))
          expect(t.props.adjustsFontSizeToFit && t.props.numberOfLines).toBe(1)
      }
      for (const c of colours(r.toJSON())) expect(c).toMatch(valid)
      // The approved anatomy: no accent bar, the flat lockup (never Fern)
      // in the footer, and the motif behind every ground but the sticker
      // and a photo.
      expect(r.queryAllByTestId("card-accent")).toHaveLength(0)
      expect(r.queryAllByTestId("card-watermark")).toHaveLength(0)
      expect(r.getAllByTestId("card-lockup")).toHaveLength(1)
      expect(r.queryAllByTestId("card-deco")).toHaveLength(
        backdrop === "sticker" || backdrop === "photo" ? 0 : 1,
      )
      r.unmount()
    }
  })
})

test("long values come out grouped or abbreviated", () => {
  const look: CardLook = { format: "9:16", backdrop: "dark", photo: null }
  const words = (el: ReactElement) =>
    render(el)
      .UNSAFE_getAllByType(Text)
      .map((t) => [t.props.children].flat(Infinity).join(""))
      .join(" | ")
  expect(
    words(
      <Artwork
        kind="weekly"
        width={300}
        look={look}
        on={on}
        d={F.dashData(true)}
      />,
    ),
  ).toContain("1.2M")
  expect(
    words(
      <HabitCard
        kind="streak"
        width={300}
        look={look}
        data={F.habitData(true)}
      />,
    ),
  ).toContain("1,234")
  expect(
    words(
      <TaskCard
        kind="summary"
        width={300}
        look={look}
        data={F.taskData(true)}
      />,
    ),
  ).toContain("1.2M")
  const workout = words(
    <WorkoutCard
      kind="summary"
      width={300}
      look={look}
      data={F.workoutData(true)}
      flags={flags}
    />,
  )
  expect(workout).toContain("1.2M kg")
  // Each exercise row counts its sets beside its volume.
  expect(workout).toContain("1,234 sets · ")
  expect(
    words(
      <FoodCard kind="day" width={300} look={look} data={F.foodData(true)} />,
    ),
  ).toContain("1.2M / 2,100")
})

test("percent metrics are regrouped too", () => {
  const look: CardLook = { format: "9:16", backdrop: "dark", photo: null }
  const r = render(
    <Artwork
      kind="monthly"
      width={300}
      look={look}
      on={on}
      d={F.dashData(true)}
    />,
  )
  expect(r.getAllByText("1,234%").length).toBeGreaterThan(0)
  expect(r.queryByText("1234%")).toBeNull()
})

test.each(CARDS)("the %s card never shows a money amount", (_, make) => {
  // The long fixtures carry "₱12,345,678.90" in the savings metric and a
  // trophy's value; neither may reach any card, in any shape.
  for (const format of FORMATS) {
    const r = render(make({ format, backdrop: "fern", photo: null }, true))
    const words = r
      .UNSAFE_getAllByType(Text)
      .map((t) => [t.props.children].flat(Infinity).join(""))
      .join(" ")
    expect(words).not.toMatch(/₱|PHP|12,345,678/)
    r.unmount()
  }
})

describe("endedRun", () => {
  test("the run a miss ended, when it was longer than the run since", () => {
    expect(endedRun(F.MISSED_DAYS)).toEqual({ lost: 19, at: 38 })
  })
  test("a rest day does not break a habit's run; today may still be open", () => {
    // The run since is already longer than the one the miss ended.
    expect(endedRun(["on", "miss", "on", "on", "off"])).toBeNull()
    expect(endedRun(["on", "off", "on", "on", "miss", "on", "off"])).toEqual({
      lost: 3,
      at: 4,
    })
  })
  test("for the journal a day not written is the break", () => {
    expect(endedRun(["on", "on", "on", "off", "on", "off"], ["off"])).toEqual({
      lost: 3,
      at: 3,
    })
  })
  test("no miss, no ended run", () => {
    expect(endedRun(["none", "on", "on", "off"])).toBeNull()
    expect(endedRun([])).toBeNull()
  })
})

test("a money metric never reaches a card", () => {
  const look: CardLook = { format: "9:16", backdrop: "dark", photo: null }
  const r = render(
    <Artwork
      kind="weekly"
      width={300}
      look={look}
      on={on}
      d={F.dashData(true)}
    />,
  )
  expect(r.queryByText(/12,345,678/)).toBeNull()
})

test("food amounts stay as percent of goal until turned on", () => {
  const look: CardLook = { format: "9:16", backdrop: "dark", photo: null }
  const off = render(
    <FoodCard kind="day" width={300} look={look} data={F.foodData(false)} />,
  )
  expect(off.getByText(/94% of goal/)).toBeTruthy()
  expect(off.queryByText(/1,980/)).toBeNull()
})

describe("streak maths", () => {
  test("milestones", () => {
    expect(milestoneOf(5)).toEqual({ reached: null, next: 7 })
    expect(milestoneOf(100)).toEqual({ reached: 100, next: 150 })
    expect(milestoneOf(1234)).toEqual({ reached: 1000, next: 1500 })
    expect(milestoneOf(5000)).toEqual({ reached: 3650, next: 6000 })
  })
  test("protein run ends today or yesterday", () => {
    expect(runOf([true, true, false, true, true])).toBe(2)
    expect(runOf([true, true, true, false])).toBe(3)
    expect(runOf([true, false, false])).toBe(0)
  })
  test("journal streak counts back across months and allows today unwritten", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02")
    const days = new Set([
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
    ])
    expect(journalStats(days, "2026-10-24")).toEqual({ current: 4, best: 4 })
    expect(
      journalStats(new Set(["2026-10-01", "2026-10-02"]), "2026-10-24"),
    ).toEqual({
      current: 0,
      best: 2,
    })
  })
})

test("gradients only in share-kit's CardGround, and no raw colour", () => {
  const dir = join(__dirname, "..")
  for (const file of [
    "share-kit.tsx",
    "screens/dash-share.tsx",
    "screens/habit-share.tsx",
    "screens/task-share.tsx",
    "screens/fitness-share.tsx",
    "screens/nutrition-share.tsx",
    "screens/journal-share.tsx",
    "screens/run-share.tsx",
  ]) {
    const code = readFileSync(join(dir, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
    expect(code).not.toMatch(/RadialGradient/)
    if (file !== "share-kit.tsx") expect(code).not.toMatch(/LinearGradient/)
    expect(code).not.toMatch(/["'`]#[0-9a-fA-F]{3,8}["'`]/)
  }
})

test("the composer can centre its last card", () => {
  let card = 0
  const r = render(
    <ShareComposer
      value="c"
      onChange={() => {}}
      caption=""
      items={["a", "b", "c"].map((key) => ({
        key,
        label: key,
        render: (width: number) => {
          // The first call is the preview; the hidden export copy follows.
          card ||= width
          return null
        },
      }))}
    >
      {null}
    </ShareComposer>,
  )
  // The card carousel; the background row below it scrolls too.
  const pad = r.UNSAFE_getAllByType(ScrollView)[0].props.contentContainerStyle
    .paddingHorizontal as number
  // Centring a card needs (screen − card) / 2 on each side; with less, the
  // scroll stops before the last card reaches the middle.
  expect(card).toBeGreaterThan(0)
  expect(2 * pad + card).toBeCloseTo(Dimensions.get("window").width, 5)
})

describe("the fit rule", () => {
  const look: CardLook = { format: "1:1", backdrop: "dark", photo: null }
  const rows = Array.from({ length: 5 }, (_, i) => ({
    key: `r${i}`,
    name: `Row ${i + 1}`,
    value: 10 - i,
    label: `${10 - i} days`,
  }))
  const tall = () =>
    render(
      <CardFrame width={300} look={look}>
        <Title>Title</Title>
        <Hero value="12" unit="days" />
        <Win>The win line</Win>
        <Sub>The sub line</Sub>
        <Figures items={[{ label: "Figure", value: "3" }]} />
        <Body>
          <XBars rows={rows} color="#3e63dd" />
        </Body>
      </CardFrame>,
    )
  const layout = (r: ReturnType<typeof tall>, id: string, height: number) => {
    act(() => {
      fireEvent(r.getByTestId(id), "layout", {
        nativeEvent: { layout: { height } },
      })
    })
    // The rule reads a layout once it has held still.
    act(() => {
      jest.advanceTimersByTime(FIT_SETTLE_MS + 1)
    })
  }
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())
  test("a card with room keeps everything", () => {
    const r = tall()
    layout(r, "card-body", 200)
    layout(r, "card-body-fit", 150)
    expect(r.getAllByTestId("card-row")).toHaveLength(5)
    expect(r.getByText("The sub line")).toBeTruthy()
  })
  test("drops list rows into +N more, then the sub line, the figures and the win line, never the title or hero", () => {
    const r = tall()
    const overflow = () => {
      layout(r, "card-body", 100)
      layout(r, "card-body-fit", 400 + Math.random())
    }
    overflow()
    expect(r.getAllByTestId("card-row")).toHaveLength(4)
    expect(r.getByText("+1 more")).toBeTruthy()
    overflow()
    overflow()
    // Down to two rows before anything else goes.
    expect(r.getAllByTestId("card-row")).toHaveLength(2)
    expect(r.getByText("+3 more")).toBeTruthy()
    expect(r.getByText("The sub line")).toBeTruthy()
    overflow()
    expect(r.queryByText("The sub line")).toBeNull()
    expect(r.getByText("Figure")).toBeTruthy()
    overflow()
    expect(r.queryByText("Figure")).toBeNull()
    expect(r.getByText("The win line")).toBeTruthy()
    overflow()
    expect(r.queryByText("The win line")).toBeNull()
    overflow()
    expect(r.getAllByTestId("card-row")).toHaveLength(1)
    overflow()
    expect(r.queryByTestId("card-body")).toBeNull()
    expect(r.getByText("Title")).toBeTruthy()
    expect(r.getByTestId("card-hero")).toBeTruthy()
  })
  test("skips a kind the card does not have", () => {
    const parts = new Map([
      ["figures", 1],
      ["chart", 1],
    ] as const)
    expect(nextFit({ stage: 0, rows: 0 }, parts)).toEqual({ stage: 2, rows: 0 })
    expect(nextFit({ stage: 2, rows: 0 }, parts)).toEqual({ stage: 6, rows: 0 })
    expect(nextFit({ stage: 6, rows: 0 }, parts)).toEqual({ stage: 6, rows: 0 })
  })
})

describe("win and miss", () => {
  const look: CardLook = { format: "4:5", backdrop: "fern", photo: null }
  const text = (r: ReturnType<typeof render>) =>
    r
      .UNSAFE_getAllByType(Text)
      .map((t) => [t.props.children].flat(Infinity).join(""))
      .join(" | ")
  test("a missed day is drawn as a miss, and the streak it ended says its cost", () => {
    const data = F.habitData()
    const habit = data.habit!
    const r = render(
      <HabitCard
        kind="streak"
        width={300}
        look={look}
        data={{
          ...data,
          habit: { ...habit, current: 3, best: 31, days: F.MISSED_DAYS },
        }}
      />,
    )
    expect(r.getAllByTestId("leaf-missed").length).toBeGreaterThan(0)
    expect(r.getByTestId("card-cost")).toBeTruthy()
    expect(r.getByTestId("card-miss")).toBeTruthy()
    const words = text(r)
    expect(words).toContain("19 days lost")
    expect(words).toContain("The 19-day streak ended there.")
    expect(words).toContain("Best 31 days")
    expect(r.queryByTestId("card-win")).toBeNull()
  })
  test("an unbroken streak is a win, with no miss on it", () => {
    const r = render(
      <HabitCard kind="streak" width={300} look={look} data={F.habitData()} />,
    )
    expect(r.queryByTestId("card-cost")).toBeNull()
    expect(r.queryByTestId("card-miss")).toBeNull()
  })
  test("a week down shows a red change and the days off target", () => {
    const d = F.dashData()
    const r = render(
      <Artwork
        kind="weekly"
        width={300}
        look={look}
        on={on}
        d={{
          ...d,
          w7: {
            ...d.w7,
            prevRate: 1,
            range: d.w7.range.map((x, i) => ({ ...x, onTarget: i > 4 })),
          },
        }}
      />,
    )
    expect(r.getByTestId("card-cost")).toBeTruthy()
    expect(text(r)).toMatch(/fewer than last week/)
    expect(text(r)).toMatch(/Off target /)
  })
  test("food short of protein and over on calories", () => {
    const d = F.foodData()
    const r = render(
      <FoodCard
        kind="day"
        width={300}
        look={look}
        data={{
          ...d,
          totals: { kcal: 2600, protein: 70, carbs: 300, fat: 60 },
        }}
      />,
    )
    expect(text(r)).toContain("50% short")
    expect(text(r)).toContain("Calories 24% over goal")
  })
  test("a lift below its best is a top lift, with how far below", () => {
    const d = F.workoutData()
    const r = render(
      <WorkoutCard
        kind="pr"
        width={300}
        look={look}
        flags={flags}
        data={{
          ...d,
          focus: { ...d.focus, pr: null, e1rm: 105, best: 112.5, gain: 0 },
        }}
      />,
    )
    expect(text(r)).toContain("7.5 kg vs best")
    expect(text(r)).toContain("No record today.")
    expect(r.getByTestId("card-cost")).toBeTruthy()
  })
  test("budgets over: Rebuilding, in percent only", () => {
    const d = F.dashData()
    const r = render(
      <Artwork
        kind="finance"
        width={300}
        look={look}
        on={on}
        d={{
          ...d,
          savings30: { ...d.savings30!, value: "-6%", delta: -10 },
          budgetsPct: 67,
        }}
      />,
    )
    expect(text(r)).toContain("Rebuilding. 33% of budgets went over.")
    expect(text(r)).toContain("Spent 6% more than came in")
    expect(text(r)).toContain("10 pts vs last month")
    expect(r.getByTestId("card-cost")).toBeTruthy()
  })
})

test.each([
  ["9:16", 1920],
  ["4:5", 1350],
  ["1:1", 1080],
] as const)("a %s card exports full-bleed at 1080 wide", async (format, height) => {
  const { captureRef } = require("react-native-view-shot")
  captureRef.mockClear()
  const shareRef: { current: (() => Promise<void>) | null } = { current: null }
  render(
    <ShareComposer
      value="card"
      onChange={() => {}}
      caption=""
      shareRef={shareRef}
      formats={[format]}
      items={[
        {
          key: "card",
          label: "Card",
          render: (width: number, look: CardLook) => (
            <CardFrame width={width} look={look}>
              <Text>body</Text>
            </CardFrame>
          ),
        },
      ]}
    >
      {null}
    </ShareComposer>,
  )
  await shareRef.current?.()
  const [node, opts] = captureRef.mock.calls[0]
  // The exported node is the square card, not its rounded, bordered shell:
  // transparent corners show as notches once a PNG is posted.
  expect(node.props.testID).toBe("card-shot")
  const style = StyleSheet.flatten(node.props.style)
  expect(style.borderRadius ?? 0).toBe(0)
  expect(style.borderWidth ?? 0).toBe(0)
  expect(style.backgroundColor).toMatch(/^#[0-9a-f]{6}$/i)
  // iOS view-shot sizes in points at the screen's scale (2× here), so
  // 540 × 960 points is the 1080 × 1920 pixel PNG.
  expect(opts).toMatchObject({ format: "png", width: 540, height: height / 2 })
})

const card = (width: number, look: CardLook) => (
  <CardFrame width={width} look={look}>
    <Text>body</Text>
  </CardFrame>
)

test.each<CardBackdrop>([
  "fern",
  "dusk",
  "dark",
  "light",
  "custom",
  "photo",
  "sticker",
])("the nature motif on %s", (backdrop) => {
  const r = render(
    card(300, { format: "9:16", backdrop, photo: "file:///p.jpg" }),
  )
  // Behind every ground but the see-through sticker and a person's photo.
  expect(r.queryAllByTestId("card-deco")).toHaveLength(
    backdrop === "sticker" || backdrop === "photo" ? 0 : 1,
  )
  expect(r.queryAllByTestId("card-ground")).toHaveLength(
    backdrop === "fern" || backdrop === "dusk" ? 1 : 0,
  )
})

test.each<CardFormat>([
  "9:16",
  "4:5",
  "1:1",
])("the gradient ground reaches every edge of a %s card", (format) => {
  const r = render(card(300, { format, backdrop: "fern", photo: null }))
  const style = StyleSheet.flatten(r.getByTestId("card-ground").props.style)
  // Pinned to the four edges, never sized in percent: a percent size on
  // an absolute child of the padded card resolved against its content
  // box, leaving an unpainted strip along the right and bottom.
  expect(style).toMatchObject({
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  })
  expect(style.width).toBeUndefined()
  expect(style.height).toBeUndefined()
})

test("the gradient is drawn at the card's size after a size change", () => {
  // react-native-svg does not measure a `100%` size again when its box
  // changes shape: a card switched from Story to 4:5 or Square kept the
  // Story gradient and showed its dark base as a band.
  const r = render(card(300, { format: "9:16", backdrop: "fern", photo: null }))
  for (const format of ["4:5", "1:1", "9:16"] as const) {
    r.rerender(card(300, { format, backdrop: "fern", photo: null }))
    const ground = r.getByTestId("card-ground")
    const svg = ground.findAll(
      (n) => typeof n.props.width === "number" && n.props.fill === undefined,
    )[0]
    expect(svg?.props.width).toBe(300)
    expect(svg?.props.height).toBe(
      300 * { "9:16": 16 / 9, "4:5": 1.25, "1:1": 1 }[format],
    )
  }
})

const SAFE = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}

test("Caption opens an editor whose text is copied and posted", async () => {
  const { copyText } = require("../media")
  copyText.mockResolvedValue(true)
  const { captureRef } = require("react-native-view-shot")
  captureRef.mockReset()
  captureRef.mockRejectedValue(new Error("no image in tests"))
  const r = render(
    <SafeAreaProvider initialMetrics={SAFE}>
      <ShareComposer
        value="card"
        onChange={() => {}}
        caption="Push A · Unfurl"
        items={[{ key: "card", label: "Card", render: card }]}
      >
        {null}
      </ShareComposer>
    </SafeAreaProvider>,
  )
  fireEvent.press(r.getByText("Caption"))
  const input = r.getByTestId("caption-input")
  expect(input.props.value).toBe("Push A · Unfurl")
  fireEvent.changeText(input, "Leg day done")
  await act(async () => {
    fireEvent.press(r.getByText("Copy"))
  })
  expect(copyText).toHaveBeenCalledWith("Leg day done")
  // The button says it worked, in place of a toast.
  expect(r.getByText("Copied")).toBeTruthy()
  fireEvent.press(r.getByText("Done"))
  await act(async () => {
    fireEvent.press(r.getByText("Post"))
  })
  expect(socialStore.get().drafts.post?.caption).toBe("Leg day done")
})

test.each([
  [
    "a story card with a 4:5 size",
    ["9:16", "4:5"],
    undefined,
    "card-post",
    1350,
  ],
  [
    "a story-only card with a 4:5 post layout",
    ["9:16"],
    ["9:16", "4:5"],
    "card-post",
    1350,
  ],
  ["a story-only card", ["9:16"], undefined, "card-export", 1920],
] as const)("Post captures %s from the layout a post frame holds whole", async (_, formats, postFormats, copy, height) => {
  const { captureRef } = require("react-native-view-shot")
  captureRef.mockReset()
  captureRef.mockResolvedValue("file:///card.png")
  const formatsSeen: string[] = []
  const r = render(
    <SafeAreaProvider initialMetrics={SAFE}>
      <ShareComposer
        value="card"
        onChange={() => {}}
        caption=""
        formats={[...formats]}
        postFormats={postFormats ? [...postFormats] : undefined}
        items={[
          {
            key: "card",
            label: "Card",
            render: (width: number, look: CardLook) => {
              formatsSeen.push(look.format)
              return card(width, look)
            },
          },
        ]}
      >
        {null}
      </ShareComposer>
    </SafeAreaProvider>,
  )
  await act(async () => {
    fireEvent.press(r.getByText("Post"))
  })
  const [node, opts] = captureRef.mock.calls[0]
  const from = r.getByTestId(copy, { includeHiddenElements: true })
  expect(from.findAll((n) => n.props.testID === "card-shot")[0]?.instance).toBe(
    node,
  )
  // 2× in tests: points, not pixels.
  expect(opts).toMatchObject({ width: 540, height: height / 2 })
  expect(formatsSeen).toContain(copy === "card-post" ? "4:5" : "9:16")
  const media = socialStore.get().drafts.post?.media?.[0]
  expect(media?.ratio).toBeCloseTo(copy === "card-post" ? 0.8 : 9 / 16)
})

test("the background row scrolls, with the screen inset at both ends", () => {
  const r = render(
    <ShareComposer
      value="card"
      onChange={() => {}}
      caption=""
      items={[{ key: "card", label: "Card", render: card }]}
    >
      {null}
    </ShareComposer>,
  )
  const row = r.getByTestId("backdrop-row")
  expect(row.props.horizontal).toBe(true)
  expect(StyleSheet.flatten(row.props.contentContainerStyle)).toMatchObject({
    paddingHorizontal: 16,
  })
  // Every option is in the row, the last one included.
  expect(r.getByLabelText("Sticker background")).toBeTruthy()
})

test("the composer opens on the Fern ground", () => {
  const looks: CardLook[] = []
  render(
    <ShareComposer
      value="card"
      onChange={() => {}}
      caption=""
      onLookChange={(l) => looks.push(l)}
      items={[{ key: "card", label: "Card", render: card }]}
    >
      {null}
    </ShareComposer>,
  )
  expect(looks[0]?.backdrop).toBe("fern")
})

describe.each([3, 2])("at %i× (iOS)", (ratio) => {
  test.each([
    ["9:16", 1920],
    ["4:5", 1350],
    ["1:1", 1080],
  ] as const)("a %s card is captured from a copy laid out 1080 px wide", async (format, height) => {
    const spy = jest.spyOn(PixelRatio, "get").mockReturnValue(ratio)
    const { captureRef } = require("react-native-view-shot")
    captureRef.mockClear()
    const widths: number[] = []
    const shareRef: { current: (() => Promise<void>) | null } = {
      current: null,
    }
    const r = render(
      <ShareComposer
        value="card"
        onChange={() => {}}
        caption=""
        shareRef={shareRef}
        formats={[format]}
        items={[
          {
            key: "card",
            label: "Card",
            render: (width: number, look: CardLook) => {
              widths.push(width)
              return card(width, look)
            },
          },
        ]}
      >
        {null}
      </ShareComposer>,
    )
    await shareRef.current?.()
    const [node, opts] = captureRef.mock.calls[0]
    const exported = r.getByTestId("card-export", {
      includeHiddenElements: true,
    })
    // The captured node is the card inside the hidden export copy.
    expect(
      exported.findAll((n) => n.props.testID === "card-shot")[0]?.instance,
    ).toBe(node)
    expect(opts).toMatchObject({
      format: "png",
      width: 1080 / ratio,
      height: height / ratio,
    })
    expect(StyleSheet.flatten(exported.props.style).width).toBe(1080 / ratio)
    expect(widths).toContain(1080 / ratio)
    // A screen reader never reaches the hidden copy.
    let box = exported.parent
    while (box && box.props.accessibilityElementsHidden === undefined)
      box = box.parent
    expect(box?.props.accessibilityElementsHidden).toBe(true)
    expect(box?.props.importantForAccessibility).toBe("no-hide-descendants")
    spy.mockRestore()
  })
})

test("a failed capture shows the share error toast", async () => {
  const { captureRef } = require("react-native-view-shot")
  const { toast } = require("sonner-native")
  captureRef.mockReset()
  captureRef.mockRejectedValueOnce(new Error("no"))
  toast.error.mockClear()
  const shareRef: { current: (() => Promise<void>) | null } = { current: null }
  render(
    <ShareComposer
      value="card"
      onChange={() => {}}
      caption=""
      shareRef={shareRef}
      items={[{ key: "card", label: "Card", render: card }]}
    >
      {null}
    </ShareComposer>,
  )
  await shareRef.current?.()
  expect(toast.error).toHaveBeenCalledWith(
    "Could not share this image. You can still copy its caption.",
  )
})

describe("on the person's photo", () => {
  const photo = "file:///photo.jpg"
  test.each(
    CARDS,
  )("%s sits as a compact block over the full photo", (_, make) => {
    for (const format of FORMATS) {
      const r = render(make({ format, backdrop: "photo", photo }, false))
      // The photo is the whole ground, in the exported node, and it is
      // not dimmed by a box: only the soft gradient scrim sits over it.
      const shot = r.getByTestId("card-shot")
      expect(within(shot).getByTestId("card-photo")).toBeTruthy()
      const img = r
        .UNSAFE_getAllByType(Image)
        .find((i) => (i.props.source as { uri?: string })?.uri === photo)
      expect(img).toBeTruthy()
      // The data sits in one block under a clear room for the picture.
      expect(r.getByTestId("card-photo-room")).toBeTruthy()
      expect(within(shot).getByTestId("card-overlay")).toBeTruthy()
      expect(r.queryAllByTestId("card-deco")).toHaveLength(0)
      // Every line of words and numbers carries a shadow to hold on any
      // photo; none is boxed.
      for (const t of r.UNSAFE_getAllByType(Text)) {
        const st = StyleSheet.flatten(t.props.style)
        if (nested(t)) continue
        expect(st.textShadowColor).toMatch(valid)
      }
      r.unmount()
    }
  })

  test("chart words drawn in SVG carry an outline in the shadow colour", () => {
    const { Text: SvgText } = require("react-native-svg") as {
      Text: React.ComponentType
    }
    const look: CardLook = { format: "9:16", backdrop: "photo", photo }
    const r = render(
      <RunCard kind="splits" width={300} look={look} data={F.runData()} />,
    )
    const words = r.UNSAFE_getAllByType(SvgText)
    const outlined = words.filter(
      (w) => w.props.stroke === cardInk(look).shadow,
    )
    const filled = words.filter((w) => w.props.fill !== "none")
    expect(filled.length).toBeGreaterThan(0)
    expect(outlined).toHaveLength(filled.length)
    // Off a photo there is no outline.
    r.rerender(
      <RunCard
        kind="splits"
        width={300}
        look={{ ...look, backdrop: "fern", photo: null }}
        data={F.runData()}
      />,
    )
    expect(
      r.UNSAFE_getAllByType(SvgText).filter((w) => w.props.fill === "none"),
    ).toHaveLength(0)
  })

  test("the data is drawn smaller than on a plain ground", () => {
    const size = (look: CardLook) => {
      const r = render(
        <CardFrame width={300} look={look}>
          <Title>Evening run</Title>
        </CardFrame>,
      )
      const t = r.getByText("Evening run")
      const fs = StyleSheet.flatten(t.props.style).fontSize as number
      r.unmount()
      return fs
    }
    const plain = size({ format: "9:16", backdrop: "fern", photo: null }),
      on = size({ format: "9:16", backdrop: "photo", photo })
    expect(on).toBeCloseTo(plain * COMPACT, 3)
  })

  test("no shadow and no compact block off a photo", () => {
    const r = render(
      <CardFrame
        width={300}
        look={{ format: "4:5", backdrop: "dark", photo: null }}
      >
        <Title>Evening run</Title>
      </CardFrame>,
    )
    expect(r.queryByTestId("card-overlay")).toBeNull()
    expect(
      StyleSheet.flatten(r.getByText("Evening run").props.style)
        .textShadowColor,
    ).toBeUndefined()
  })

  test("Photo with no picture yet is still a finished card on Fern", () => {
    const c = cardInk({ format: "9:16", backdrop: "photo", photo: null })
    expect(c.gradient?.stops).toEqual(
      cardInk({ format: "9:16", backdrop: "fern", photo: null }).gradient
        ?.stops,
    )
    expect(c.shadow).toMatch(valid)
  })

  test("Photo leads the background row", () => {
    const r = render(
      <ShareComposer
        value="card"
        onChange={() => {}}
        caption=""
        items={[
          {
            key: "card",
            label: "Card",
            render: (w, look) => (
              <CardFrame width={w} look={look}>
                <Title>x</Title>
              </CardFrame>
            ),
          },
        ]}
      >
        {null}
      </ShareComposer>,
    )
    const labels = r
      .UNSAFE_queryAllByProps({ accessibilityRole: "button" })
      .map((n) => n.props.accessibilityLabel as string)
      .filter((l) => / background$/.test(l ?? ""))
    expect(labels[0]).toBe("Photo background")
  })
})

describe("the run card", () => {
  test("pace change reads in seconds under a minute, else m:ss", () => {
    expect(paceChange(-8)).toBe("8 s faster than last")
    expect(paceChange(734)).toBe("12:14 slower than last")
  })

  test("shows distance, pace, time, the change and the route", () => {
    const r = render(
      <RunCard
        kind="route"
        width={300}
        look={{ format: "4:5", backdrop: "fern", photo: null }}
        data={F.runData(false, false)}
      />,
    )
    expect(r.getByText(/^5\.23/)).toBeTruthy()
    expect(r.getByText(/5:23/)).toBeTruthy()
    expect(r.getByText("28:08")).toBeTruthy()
    expect(r.getByText("8 s slower than last")).toBeTruthy()
    expect(r.getByTestId("card-cost")).toBeTruthy()
    expect(r.getByLabelText("Route")).toBeTruthy()
  })

  test("a treadmill session draws the machine, never a route", () => {
    const r = render(
      <RunCard
        kind="route"
        width={300}
        look={{ format: "9:16", backdrop: "dark", photo: null }}
        data={F.runData(false, true)}
      />,
    )
    expect(r.getByLabelText("Treadmill at 4% incline")).toBeTruthy()
    expect(r.queryByLabelText("Route")).toBeNull()
    expect(r.getByText("12:14 faster than last")).toBeTruthy()
    expect(r.getByTestId("card-gain")).toBeTruthy()
  })

  test("its data compares against the last like session only", () => {
    const base = {
      kind: "walk" as const,
      endedAt: "2026-11-01T01:00:00.000Z",
      route: [],
      splits: [],
    }
    const runs = [
      {
        ...base,
        id: "a",
        name: "A",
        startedAt: "2026-10-30T00:00:00.000Z",
        movingSec: 1200,
        distanceM: 2000,
        indoor: true,
      },
      {
        ...base,
        id: "b",
        name: "B",
        startedAt: "2026-10-31T00:00:00.000Z",
        movingSec: 600,
        distanceM: 2000,
      },
      {
        ...base,
        id: "c",
        name: "C",
        startedAt: "2026-11-01T00:00:00.000Z",
        movingSec: 1000,
        distanceM: 2000,
        indoor: true,
      },
    ]
    const d = runCardData(runs, runs[2])
    // C's 500 s/km against treadmill A's 600, not outdoor B's 300.
    expect(d.paceDelta).toBe(-100)
    expect(d.indoor).toBe(true)
  })
})
