// Share cards: every card renders in every size and background with normal
// and long values, numbers are grouped or abbreviated rather than spilling,
// no colour is malformed (``"#fff" + "a6"`` once made labels vanish), and no
// ₱ amount reaches a card.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render } from "@testing-library/react-native"
import type { ReactElement } from "react"
import {
  Dimensions,
  PixelRatio,
  ScrollView,
  StyleSheet,
  Text,
} from "react-native"
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
import { TaskCard } from "../screens/task-share"
import { clock, compact, fmt, group, pct, signed } from "../share-format"
import {
  alpha,
  type CardBackdrop,
  type CardFormat,
  CardFrame,
  type CardLook,
  cardInk,
  ShareComposer,
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
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
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
  expect(workout).toContain("1.2M")
  expect(workout).toContain("12.3k × 1,234")
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
  const pad = r.UNSAFE_getByType(ScrollView).props.contentContainerStyle
    .paddingHorizontal as number
  // Centring a card needs (screen − card) / 2 on each side; with less, the
  // scroll stops before the last card reaches the middle.
  expect(card).toBeGreaterThan(0)
  expect(2 * pad + card).toBeCloseTo(Dimensions.get("window").width, 5)
})

test("a body taller than its card is scaled down to fit, a short one is not", () => {
  const look: CardLook = { format: "1:1", backdrop: "dark", photo: null }
  const r = render(
    <CardFrame width={300} look={look} kicker="Test">
      <Text>body</Text>
    </CardFrame>,
  )
  const layout = (id: string, height: number) =>
    fireEvent(r.getByTestId(id), "layout", {
      nativeEvent: { layout: { height } },
    })
  const scale = () =>
    r.getByTestId("card-body-fit").props.style.transform[1].scale
  layout("card-body", 200)
  layout("card-body-fit", 150)
  expect(scale()).toBe(1)
  layout("card-body-fit", 400)
  expect(scale()).toBe(0.5)
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
            <CardFrame width={width} look={look} kicker="Test">
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
  <CardFrame width={width} look={look} kicker="Test">
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
])("the watermark on %s", (backdrop) => {
  const r = render(
    card(300, { format: "9:16", backdrop, photo: "file:///p.jpg" }),
  )
  expect(r.queryAllByTestId("card-watermark")).toHaveLength(
    backdrop === "sticker" ? 0 : 1,
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

test("autoPost opens the feed composer once, after layout", async () => {
  const { captureRef } = require("react-native-view-shot")
  captureRef.mockReset()
  captureRef.mockRejectedValue(new Error("not in tests"))
  jest.spyOn(global, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0)
    return 0
  })
  const { router } = require("expo-router")
  router.push.mockClear()
  const r = render(
    <ShareComposer
      value="card"
      onChange={() => {}}
      caption="Push A"
      autoPost
      items={[{ key: "card", label: "Card", render: card }]}
    >
      {null}
    </ShareComposer>,
  )
  for (let i = 0; i < 2; i++)
    fireEvent(
      r.getByTestId("card-export", { includeHiddenElements: true }),
      "layout",
      {
        nativeEvent: { layout: { width: 360, height: 640 } },
      },
    )
  await new Promise((done) => setTimeout(done, 0))
  expect(socialStore.get().drafts.post?.caption).toBe("Push A")
  expect(router.push).toHaveBeenCalledTimes(1)
  captureRef.mockReset()
})
