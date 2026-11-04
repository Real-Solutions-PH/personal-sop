// Touch → data point on FinanceLineChart. Expected values are worked by
// hand from the chart's geometry: a 340-wide viewBox, points evenly from
// x=40 across 292, scaled to fit the box (never above 1:1 here, since the
// box is as tall as the viewBox) and centred. 13 points (Now + 12 months)
// sit 292/12 ≈ 24.33 apart.
import { pointAt, pointX, readoutLeft, viewFit } from "../chart-inspect"

const H = 190
const at = (x: number, width = 340, n = 13) => pointAt(x, width, H, H, n)

describe("nearest point", () => {
  test("on a point gives that point", () => {
    expect(at(40)).toBe(0)
    expect(at(40 + (292 / 12) * 5)).toBe(5)
    expect(at(332)).toBe(12)
  })

  test("between two points goes to the nearer, halfway to the later", () => {
    // Point 5 at 161.67, point 6 at 186.
    expect(at(173)).toBe(5)
    expect(at(173.84)).toBe(6)
    expect(at(185)).toBe(6)
  })
})

describe("edges", () => {
  test("left of the plot (over the axis labels) holds the first point", () => {
    expect(at(0)).toBe(0)
    expect(at(-30)).toBe(0)
  })

  test("past the last point holds the last", () => {
    expect(at(339)).toBe(12)
    expect(at(1000)).toBe(12)
  })

  test("one point, or a box not laid out yet, is point 0", () => {
    expect(at(200, 340, 1)).toBe(0)
    expect(at(200, 0)).toBe(0)
  })

  test("two points split at the middle of the plot (x=186)", () => {
    expect(at(185, 340, 2)).toBe(0)
    expect(at(187, 340, 2)).toBe(1)
  })
})

describe("the box scaling the drawing", () => {
  test("a wider box centres the drawing at 1:1 (390 wide: 25 px each side)", () => {
    expect(viewFit(390, H, H)).toEqual({ scale: 1, left: 25 })
    expect(at(65, 390)).toBe(0)
    expect(at(357, 390)).toBe(12)
    expect(at(25 + 40 + (292 / 12) * 7, 390)).toBe(7)
  })

  test("a narrower box shrinks it (300 wide: scale 300/340, no offset)", () => {
    expect(viewFit(300, H, H).left).toBe(0)
    // The last point lands at 332 × 300/340 ≈ 292.94.
    expect(at(292, 300)).toBe(12)
    // Point 6 at (40 + 146) × 300/340 ≈ 164.12.
    expect(at(164, 300)).toBe(6)
  })

  test("pointX is where pointAt reads back the same point", () => {
    for (const width of [300, 340, 390])
      for (let i = 0; i < 13; i++)
        expect(at(pointX(i, width, H, H, 13), width)).toBe(i)
    expect(pointX(6, 390, H, H, 13)).toBe(211)
  })
})

test("the readout sits beside the marker, on the roomier side, inside the chart", () => {
  // Left half: 10 px to the right of the marker.
  expect(readoutLeft(100, 160, 390)).toBe(110)
  // Right half: 10 px to its left.
  expect(readoutLeft(300, 160, 390)).toBe(130)
  // Near an edge it is kept inside.
  expect(readoutLeft(190, 220, 390)).toBe(170)
  expect(readoutLeft(380, 400, 390)).toBe(0)
})
