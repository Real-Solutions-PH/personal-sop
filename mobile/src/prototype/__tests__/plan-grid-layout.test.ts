// The Plan hour grid's layout: blocks grow with their titles, so the hour
// axis stretches rather than letting one block run into the next. Every
// expectation here is a geometric property read off the output (no two
// blocks overlap, no column narrower than MIN_COL, every block on its own
// time's line or below it, hour lines below what started before them), not a
// copy of the algorithm's arithmetic.
import {
  BLOCK_MIN_H,
  columnsFor,
  GAP,
  type GridLayout,
  layoutGrid,
  MIN_COL,
  minuteAt,
  PX,
  type Slot,
  yAt,
} from "../screens/plan-grid-layout"

interface It {
  id: string
  at: string | null
  h?: number
}
const FROM = 4 * 60,
  TO = FROM + 24 * 60
const min = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number)
  const v = h * 60 + m
  return v < FROM ? v + 24 * 60 : v
}
// The grid inside the Plan card at 375 pt: 375 − 2×16 page − 2×12 card
// padding = 319; minus the 48 pt hour gutter and 4 pt right edge = 267.
const LANE_375 = 267

function lay(items: It[], lane = LANE_375): GridLayout<It> {
  return layoutGrid(items, {
    from: FROM,
    to: TO,
    cols: columnsFor(lane),
    minuteOf: (i) => (i.at ? min(i.at) : null),
    heightOf: (i) => i.h,
  })
}

/** Left and width as DayGrid draws them. */
const box = (p: Slot<It>, lane = LANE_375) => {
  const w = lane / p.cols
  return {
    left: w * p.col,
    right: w * p.col + w - 4,
    top: p.top,
    bottom: p.top + p.height,
  }
}

function expectNoOverlap(out: GridLayout<It>, lane = LANE_375) {
  const b = out.placed.map((p) => ({ id: p.item.id, ...box(p, lane) }))
  for (let i = 0; i < b.length; i++)
    for (let j = i + 1; j < b.length; j++) {
      const x = b[i],
        y = b[j]
      const apart =
        x.right <= y.left ||
        y.right <= x.left ||
        x.bottom <= y.top ||
        y.bottom <= x.top
      if (!apart) throw new Error(`${x.id} overlaps ${y.id}`)
    }
}

// Kai's 2026-11-14 screenshot: four items at 6 AM (one a count habit), the
// Workout at 7 AM, two at 8 AM and three at 9 AM, several with titles long
// enough to wrap to three or four lines in a narrow column.
const SCREENSHOT: It[] = [
  { id: "morning-routine", at: "06:00", h: 52 },
  { id: "fix-bed", at: "06:00", h: 36 },
  { id: "time-block", at: "06:00", h: 52 },
  { id: "magnesium", at: "06:00", h: 70 },
  { id: "workout", at: "07:00", h: 36 },
  { id: "isotretinoin", at: "08:00", h: 52 },
  { id: "fish-oil", at: "08:00", h: 68 },
  { id: "journal", at: "09:00", h: 52 },
  { id: "work-block", at: "09:00", h: 68 },
  { id: "bath", at: "09:00", h: 36 },
]

describe("the screenshot case at 375 pt", () => {
  const out = lay(SCREENSHOT)

  test("every item is on the grid; nothing is hidden", () => {
    expect(out.placed.map((p) => p.item.id).sort()).toEqual(
      SCREENSHOT.map((i) => i.id).sort(),
    )
  })

  test("no block covers another", () => {
    expectNoOverlap(out)
  })

  test("no column is narrower than MIN_COL, so titles wrap by words", () => {
    expect(columnsFor(LANE_375)).toBe(2)
    for (const p of out.placed)
      expect(LANE_375 / p.cols - 4).toBeGreaterThanOrEqual(MIN_COL - 4)
  })

  test("4 at 6 AM wrap into two rows of two; the 7 AM Workout sits below them, full width", () => {
    const six = out.placed.filter((p) => p.min === min("06:00"))
    expect(six.map((p) => [p.col, p.cols])).toEqual([
      [0, 2],
      [1, 2],
      [0, 2],
      [1, 2],
    ])
    const lowest = Math.max(...six.map((p) => p.top + p.height))
    const workout = out.placed.find((p) => p.item.id === "workout")!
    expect(workout.cols).toBe(1)
    expect(workout.top).toBeGreaterThanOrEqual(lowest + GAP)
  })

  test("3 at 9 AM: two side by side, the third gets the full width below", () => {
    const nine = out.placed.filter((p) => p.min === min("09:00"))
    expect(nine.map((p) => [p.item.id, p.col, p.cols])).toEqual([
      ["journal", 0, 2],
      ["work-block", 1, 2],
      ["bath", 0, 1],
    ])
    expect(nine[2].top).toBeGreaterThanOrEqual(
      Math.max(nine[0].top + nine[0].height, nine[1].top + nine[1].height) +
        GAP,
    )
  })

  test("each group's first row sits exactly on its time's line", () => {
    for (const p of out.placed) {
      if (p.col !== 0) continue
      const first = out.placed.find((q) => q.min === p.min)!
      if (first === p) expect(p.top).toBeCloseTo(yAt(out.axis, p.min))
      else expect(p.top).toBeGreaterThan(yAt(out.axis, p.min))
    }
  })

  test("an hour line is drawn below every block that started before it", () => {
    for (const h of out.hours)
      for (const p of out.placed)
        if (p.min < h.min)
          expect(h.y).toBeGreaterThanOrEqual(p.top + p.height + GAP)
  })

  test("the grid is tall enough to hold its lowest block", () => {
    const lowest = Math.max(...out.placed.map((p) => p.top + p.height))
    expect(out.height).toBeGreaterThan(lowest)
  })
})

test("an untouched day keeps 64 pt hours", () => {
  const out = lay([{ id: "a", at: "09:00" }])
  const ys = out.hours.map((h) => h.y)
  for (let k = 1; k < ys.length; k++) expect(ys[k] - ys[k - 1]).toBeCloseTo(64)
  expect(out.placed[0].height).toBe(BLOCK_MIN_H)
})

test("one tall block stretches only its own hour", () => {
  const out = lay([{ id: "a", at: "09:00", h: 150 }])
  const at = (m: number) => out.hours.find((h) => h.min === m)!.y
  expect(at(min("09:00")) - at(min("08:00"))).toBeCloseTo(64)
  expect(at(min("10:00")) - at(min("09:00"))).toBeCloseTo(150 + GAP)
  expect(at(min("11:00")) - at(min("10:00"))).toBeCloseTo(64)
})

test("a quarter hour after a block starts below it, never beside it", () => {
  const out = lay([
    { id: "a", at: "09:00" },
    { id: "b", at: "09:15" },
  ])
  const [a, b] = out.placed
  expect([a.cols, b.cols]).toEqual([1, 1])
  expect(b.top).toBeGreaterThanOrEqual(a.top + a.height + GAP)
  expectNoOverlap(out)
})

test("items without a time are left to the Anytime list", () => {
  expect(lay([{ id: "a", at: null }]).placed).toEqual([])
})

test("a wider lane fits more columns, never one under MIN_COL", () => {
  expect(columnsFor(100)).toBe(1)
  expect(columnsFor(MIN_COL)).toBe(1)
  expect(columnsFor(2 * MIN_COL + GAP)).toBe(2)
  expect(columnsFor(600)).toBe(4)
  const out = lay(SCREENSHOT, 600)
  expectNoOverlap(out, 600)
  const six = out.placed.filter((p) => p.min === min("06:00"))
  expect(six.every((p) => p.cols === 4 && p.top === six[0].top)).toBe(true)
})

test("many items at one minute all stay on the grid without overlapping", () => {
  const crowd = Array.from({ length: 9 }, (_, k) => ({
    id: `c${k}`,
    at: "06:00",
    h: 30 + k * 7,
  }))
  const out = lay(crowd)
  expect(out.placed).toHaveLength(9)
  expectNoOverlap(out)
})

test("the drag's minute ↔ point mapping round-trips over a stretched day", () => {
  const out = lay(SCREENSHOT)
  for (let m = FROM; m <= TO; m += 15)
    expect(minuteAt(out.axis, yAt(out.axis, m))).toBeCloseTo(m)
  // Monotonic: later is always lower.
  for (let m = FROM; m < TO; m += 5)
    expect(yAt(out.axis, m + 5)).toBeGreaterThan(yAt(out.axis, m))
  // Beyond the marks it runs at the plain rate.
  expect(yAt(out.axis, TO + 60) - yAt(out.axis, TO)).toBeCloseTo(60 * PX)
})
