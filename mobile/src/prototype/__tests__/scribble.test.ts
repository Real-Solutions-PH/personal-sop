import {
  jitter,
  leaf,
  rng,
  smooth,
  strokeAcross,
  strokeUp,
} from "../brand/scribble"

const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)

describe("the hand-drawn line", () => {
  it("draws the same wobble for the same seed, and a different one for another seed", () => {
    expect(strokeAcross(3, 120, 6, 7)).toBe(strokeAcross(3, 120, 6, 7))
    expect(strokeAcross(3, 120, 6, 7)).not.toBe(strokeAcross(3, 120, 6, 8))
  })

  it("keeps both ends of a stroke exactly where they were asked to be", () => {
    const pts = jitter(
      [
        [0, 0],
        [5, 5],
        [10, 0],
      ],
      4,
      rng(1),
    )
    expect(pts[0]).toEqual([0, 0])
    expect(pts[2]).toEqual([10, 0])
    const up = numbers(strokeUp(5, 100, 20, 3))
    expect(up.slice(0, 2)).toEqual([5, 100])
    expect(up.slice(-2)).toEqual([5, 20])
  })

  it("never puts NaN or Infinity into a path, even for an empty or one-point fill", () => {
    for (const d of [
      strokeAcross(3, 3, 6, 1),
      strokeUp(5, 40, 40, 2),
      leaf(10, 10, 0, 1),
      smooth([[1, 1]]),
    ])
      for (const n of numbers(d)) expect(Number.isFinite(n)).toBe(true)
    expect(smooth([])).toBe("")
  })

  it("closes a leaf back at its base", () => {
    const d = leaf(10, 20, 12, -1.2)
    expect(d.startsWith("M10 20")).toBe(true)
    expect(d.endsWith("10 20Z")).toBe(true)
  })
})
