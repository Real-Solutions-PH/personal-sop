// The brand's hand-drawn line (ADR-0032): every chart part is a stroke with a
// seeded wobble, so it reads drawn by hand and the same drawing comes back on
// every render. These are the share kit's own helpers, typed, so the app and
// the share cards draw one line.

export type Point = [number, number]

const r1 = (n: number) => Math.round(n * 10) / 10

/** A small deterministic random source (mulberry32): same seed, same wobble. */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Moves the inner points by up to `amount`, leaving both ends where they are. */
export function jitter(points: Point[], amount: number, random: () => number) {
  return points.map(
    ([x, y], i): Point =>
      i === 0 || i === points.length - 1
        ? [x, y]
        : [x + (random() - 0.5) * amount, y + (random() - 0.5) * amount],
  )
}

/** A Catmull-Rom curve through the points, as cubic Béziers. */
export function smooth(points: Point[]): string {
  if (points.length === 0) return ""
  let d = `M${r1(points[0][0])} ${r1(points[0][1])}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i],
      p1 = points[i],
      p2 = points[i + 1],
      p3 = points[i + 2] ?? p2
    d += ` C${r1(p1[0] + (p2[0] - p0[0]) / 6)} ${r1(p1[1] + (p2[1] - p0[1]) / 6)} ${r1(p2[0] - (p3[0] - p1[0]) / 6)} ${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])} ${r1(p2[1])}`
  }
  return d
}

/** A leaf from its base at (x, y), pointing at `angle` radians. */
export function leaf(
  x: number,
  y: number,
  length: number,
  angle: number,
  width = 0.42,
) {
  const tx = x + Math.cos(angle) * length,
    ty = y + Math.sin(angle) * length,
    mx = (x + tx) / 2,
    my = (y + ty) / 2,
    nx = -Math.sin(angle) * length * width,
    ny = Math.cos(angle) * length * width
  return `M${r1(x)} ${r1(y)} Q${r1(mx + nx)} ${r1(my + ny)} ${r1(tx)} ${r1(ty)} Q${r1(mx - nx)} ${r1(my - ny)} ${r1(x)} ${r1(y)}Z`
}

/** A wobbling horizontal stroke from x0 to x1 at height y (progress fills). */
export function strokeAcross(
  x0: number,
  x1: number,
  y: number,
  seed: number,
  wobble = 0.5,
) {
  const w = x1 - x0
  return smooth(
    jitter(
      [
        [x0, y],
        [x0 + w * 0.34, y - 0.8],
        [x0 + w * 0.7, y + 0.8],
        [x1, y],
      ],
      wobble,
      rng(seed),
    ),
  )
}

/** A wobbling vertical stroke from the bottom up (bar stems). */
export function strokeUp(
  x: number,
  bottom: number,
  top: number,
  seed: number,
  wobble = 0.6,
) {
  return smooth(
    jitter(
      [
        [x, bottom],
        [x + 0.5, (bottom + top) / 2],
        [x, top],
      ],
      wobble,
      rng(seed),
    ),
  )
}
