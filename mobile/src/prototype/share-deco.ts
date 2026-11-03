// The share cards' nature line art (docs/brand/share-and-brand-kit.pdf):
// fronds, vines and curls drawn as seeded, wobbling strokes, so the same
// drawing comes back on every render. Built on the brand's hand-drawn line
// (`brand/scribble.ts`, ADR-0032); kept beside the share kit because only the
// cards draw it.
import { jitter, type Point, rng, smooth } from "./brand/scribble"

const r1 = (n: number) => Math.round(n * 10) / 10

/** A leaf from its base at (x, y) pointing at `angle`, with a midrib. */
export function ribLeaf(
  x: number,
  y: number,
  length: number,
  angle: number,
  width = 0.36,
  rib = true,
) {
  const tx = x + Math.cos(angle) * length,
    ty = y + Math.sin(angle) * length,
    mx = (x + tx) / 2,
    my = (y + ty) / 2,
    nx = -Math.sin(angle) * length * width,
    ny = Math.cos(angle) * length * width
  const outline = `M${r1(x)} ${r1(y)} Q${r1(mx + nx)} ${r1(my + ny)} ${r1(tx)} ${r1(ty)} Q${r1(mx - nx)} ${r1(my - ny)} ${r1(x)} ${r1(y)}Z`
  return rib
    ? `${outline} M${r1(x)} ${r1(y)} L${r1(x + Math.cos(angle) * length * 0.78)} ${r1(y + Math.sin(angle) * length * 0.78)}`
    : outline
}

/** A spiral curling in from (x, y) heading at `angle`; `dir` 1 is clockwise. */
export function curl(
  x: number,
  y: number,
  angle: number,
  step: number,
  dir = 1,
  n = 16,
  turn = 0.42,
) {
  const points: Point[] = [[x, y]]
  let a = angle,
    s = step,
    px = x,
    py = y
  for (let i = 0; i < n; i++) {
    a += dir * turn
    s *= 0.88
    px += Math.cos(a) * s
    py += Math.sin(a) * s
    points.push([px, py])
  }
  return smooth(points)
}

type FrondOptions = {
  seed?: number
  leaf?: number
  curl?: boolean
  rib?: boolean
  spread?: number
  width?: number
}
/** A fern frond: a bending stem with alternating leaflets that shrink toward
 * the tip, ending in a fiddlehead curl. */
export function frond(
  x: number,
  y: number,
  length: number,
  angle: number,
  bend = 0.25,
  n = 9,
  o: FrondOptions = {},
) {
  const random = rng(o.seed ?? 7),
    leafMax = o.leaf ?? length * 0.22,
    ex = x + Math.cos(angle) * length,
    ey = y + Math.sin(angle) * length,
    px = -Math.sin(angle),
    py = Math.cos(angle),
    cx = (x + ex) / 2 + px * length * bend,
    cy = (y + ey) / 2 + py * length * bend
  const at = (t: number): Point => [
    (1 - t) ** 2 * x + 2 * (1 - t) * t * cx + t * t * ex,
    (1 - t) ** 2 * y + 2 * (1 - t) * t * cy + t * t * ey,
  ]
  const tangent = (t: number) =>
    Math.atan2(
      2 * (1 - t) * (cy - y) + 2 * t * (ey - cy),
      2 * (1 - t) * (cx - x) + 2 * t * (ex - cx),
    )
  let d = smooth(
    jitter(
      Array.from({ length: 25 }, (_, i) => at(i / 24)),
      length * 0.012,
      random,
    ),
  )
  if (o.curl !== false)
    d += ` ${curl(ex, ey, tangent(1), length * 0.07, bend >= 0 ? 1 : -1, 14, 0.5)}`
  for (let i = 0; i < n; i++) {
    const t = 0.12 + (i / n) * 0.78,
      [lx, ly] = at(t),
      side = i % 2 ? 1 : -1,
      size = leafMax * (1 - t * 0.75) * (0.85 + random() * 0.3)
    d += ` ${ribLeaf(lx, ly, size, tangent(t) + side * (o.spread ?? 0.95), o.width ?? 0.32, o.rib !== false)}`
  }
  return d
}

/** A vine: a wavy stem from A to B with leaves on the crests and the odd
 * tendril. */
export function vine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  amp = 10,
  waves = 3,
  o: { seed?: number; leaf?: number; tendrils?: boolean } = {},
) {
  const random = rng(o.seed ?? 3),
    dx = x1 - x0,
    dy = y1 - y0,
    length = Math.hypot(dx, dy),
    ux = dx / length,
    uy = dy / length,
    n = waves * 8,
    wave = (t: number) => Math.sin(t * waves * Math.PI * 2) * amp,
    base = Math.atan2(dy, dx),
    leaf = o.leaf ?? 9
  let d = smooth(
    jitter(
      Array.from({ length: n + 1 }, (_, i): Point => {
        const t = i / n
        return [x0 + dx * t - uy * wave(t), y0 + dy * t + ux * wave(t)]
      }),
      amp * 0.15,
      random,
    ),
  )
  for (let k = 0; k < waves * 2; k++) {
    const t = (k + 0.25) / (waves * 2),
      x = x0 + dx * t - uy * wave(t),
      y = y0 + dy * t + ux * wave(t),
      side = k % 2 ? 1 : -1
    d +=
      o.tendrils && k % 3 === 2
        ? ` ${curl(x, y, base + side * 1.2, leaf * 0.45, side, 12, 0.55)}`
        : ` ${ribLeaf(x, y, leaf * (0.8 + random() * 0.4), base + side * 1.05, 0.38)}`
  }
  return d
}

export type DecoKind = "frond" | "vine" | "sprig"
/** The drawing's height on a 360-wide canvas, per card shape. */
export const decoHeight = (ratio: number) =>
  ratio >= 1.7 ? 640 : ratio >= 1.2 ? 450 : 360
/** One background drawing per area family, kept to the card's edges so it
 * never sits under a number. */
export function decoPath(kind: DecoKind, height: number, seed = 1) {
  const H = height
  if (kind === "frond")
    return `${frond(372, H + 6, H * 0.62, -1.92, -0.22, 11, { seed, leaf: 30 })} ${frond(392, H * 0.55, H * 0.32, -2.3, 0.2, 7, { seed: seed + 4, leaf: 18 })}`
  if (kind === "vine")
    return `${vine(372, -8, 300, H * 0.62, 12, 3, { seed, leaf: 13, tendrils: true })} ${vine(250, -6, 372, 70, 6, 2, { seed: seed + 2, leaf: 9 })}`
  return `${frond(380, H - 30, 150, -2.55, 0.18, 9, { seed, leaf: 26 })} ${frond(352, H + 10, 110, -1.75, -0.15, 7, { seed: seed + 9, leaf: 18 })} ${frond(372, 30, 90, 2.6, -0.2, 6, { seed: seed + 3, leaf: 14 })}`
}
/** The small sprig beside a win line and a record: a 24-unit frond. */
export const SPRIG = frond(5, 21, 19, -1.05, 0.12, 5, {
  seed: 5,
  leaf: 7,
  curl: true,
  rib: false,
})
