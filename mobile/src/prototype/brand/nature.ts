// The brand kit's nature line art (fronds, curls, vines) as typed path
// builders, for the corner motif on Today's display-only cards. Same seeded
// wobble as the share kit, so a card draws the same plant on every render.
import { jitter, leaf, type Point, rng, smooth } from "./scribble"

const r1 = (n: number) => Math.round(n * 10) / 10

/** A leaf with its midrib, as the kit draws it in line art. */
function ribbedLeaf(
  x: number,
  y: number,
  len: number,
  ang: number,
  wid = 0.36,
) {
  return `${leaf(x, y, len, ang, wid)} M${r1(x)} ${r1(y)} L${r1(x + Math.cos(ang) * len * 0.78)} ${r1(y + Math.sin(ang) * len * 0.78)}`
}

/** A spiral that curls in from (x, y) heading at `ang`; dir 1 = clockwise. */
export function curl(
  x0: number,
  y0: number,
  ang0: number,
  step0: number,
  dir = 1,
  n = 16,
  turn = 0.42,
) {
  let x = x0,
    y = y0,
    ang = ang0,
    step = step0
  const pts: Point[] = [[x, y]]
  for (let i = 0; i < n; i++) {
    ang += dir * turn
    step *= 0.88
    x += Math.cos(ang) * step
    y += Math.sin(ang) * step
    pts.push([x, y])
  }
  return smooth(pts)
}

/** A frond bent along a circle from angle a0 to a1: two make a wreath. */
export function arcFrond(
  cx: number,
  cy: number,
  R: number,
  a0: number,
  a1: number,
  n: number,
  o: { seed: number; leaf: number; wid: number },
) {
  const r = rng(o.seed),
    dir = Math.sign(a1 - a0),
    tanAt = (a: number) => a + (dir * Math.PI) / 2
  const pts = Array.from({ length: 25 }, (_, i): Point => {
    const a = a0 + ((a1 - a0) * i) / 24
    return [cx + Math.cos(a) * R, cy + Math.sin(a) * R]
  })
  let d = smooth(jitter(pts, R * 0.012, r))
  const e = pts[24]
  d += ` ${curl(e[0], e[1], tanAt(a1), R * 0.07, dir, 12, 0.5)}`
  for (let k = 0; k < n; k++) {
    const t = 0.06 + (k / n) * 0.86,
      a = a0 + (a1 - a0) * t,
      side = k % 2 ? 1 : -1,
      L = o.leaf * (1 - t * 0.4) * (0.85 + r() * 0.3)
    d += ` ${ribbedLeaf(cx + Math.cos(a) * R, cy + Math.sin(a) * R, L, tanAt(a) - dir * side * 0.85, o.wid)}`
  }
  return d
}

/** A fern frond: a bending stem with leaflets that shrink toward the tip,
 * ending in a fiddlehead curl. */
export function frond(
  x: number,
  y: number,
  len: number,
  ang: number,
  bend: number,
  n: number,
  o: { seed: number; leaf: number; rib?: boolean },
) {
  const r = rng(o.seed),
    ex = x + Math.cos(ang) * len,
    ey = y + Math.sin(ang) * len,
    px = -Math.sin(ang),
    py = Math.cos(ang),
    cx = (x + ex) / 2 + px * len * bend,
    cy = (y + ey) / 2 + py * len * bend
  const at = (t: number): Point => [
    (1 - t) ** 2 * x + 2 * (1 - t) * t * cx + t * t * ex,
    (1 - t) ** 2 * y + 2 * (1 - t) * t * cy + t * t * ey,
  ]
  const tan = (t: number) =>
    Math.atan2(
      2 * (1 - t) * (cy - y) + 2 * t * (ey - cy),
      2 * (1 - t) * (cx - x) + 2 * t * (ex - cx),
    )
  const pts = Array.from({ length: 25 }, (_, i) => at(i / 24))
  let d = smooth(jitter(pts, len * 0.012, r))
  d += ` ${curl(ex, ey, tan(1), len * 0.07, bend >= 0 ? 1 : -1, 14, 0.5)}`
  for (let i = 0; i < n; i++) {
    const t = 0.12 + (i / n) * 0.78,
      [lx, ly] = at(t),
      s = i % 2 ? 1 : -1,
      L = o.leaf * (1 - t * 0.75) * (0.85 + r() * 0.3)
    d +=
      o.rib === false
        ? ` ${leaf(lx, ly, L, tan(t) + s * 0.95, 0.32)}`
        : ` ${ribbedLeaf(lx, ly, L, tan(t) + s * 0.95, 0.32)}`
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
  amp: number,
  waves: number,
  o: { seed: number; leaf: number; tendrils?: boolean },
) {
  const r = rng(o.seed),
    dx = x1 - x0,
    dy = y1 - y0,
    L = Math.hypot(dx, dy),
    ux = dx / L,
    uy = dy / L,
    N = waves * 8
  const wave = (t: number) => Math.sin(t * waves * Math.PI * 2) * amp
  const pts = Array.from({ length: N + 1 }, (_, i): Point => {
    const t = i / N
    return [x0 + dx * t - uy * wave(t), y0 + dy * t + ux * wave(t)]
  })
  let d = smooth(jitter(pts, amp * 0.15, r))
  const base = Math.atan2(dy, dx)
  for (let k = 0; k < waves * 2; k++) {
    const t = (k + 0.25) / (waves * 2),
      x = x0 + dx * t - uy * wave(t),
      y = y0 + dy * t + ux * wave(t),
      s = k % 2 ? 1 : -1
    d +=
      o.tendrils && k % 3 === 2
        ? ` ${curl(x, y, base + s * 1.2, o.leaf * 0.45, s, 12, 0.55)}`
        : ` ${ribbedLeaf(x, y, o.leaf * (0.8 + r() * 0.4), base + s * 1.05, 0.38)}`
  }
  return d
}

export type CornerKind = "vine" | "sprig"
/** The kit's card motif (DECO at 9:11, 360 × 360 units), kept to the top
 * right so it never sits under a number. */
export function cornerPath(kind: CornerKind, seed: number) {
  const H = 360
  return kind === "vine"
    ? `${vine(372, -8, 300, H * 0.62, 12, 3, { seed, leaf: 13, tendrils: true })} ${vine(250, -6, 372, 70, 6, 2, { seed: seed + 2, leaf: 9 })}`
    : `${frond(380, H - 30, 150, -2.55, 0.18, 9, { seed, leaf: 26 })} ${frond(352, H + 10, 110, -1.75, -0.15, 7, { seed: seed + 9, leaf: 18 })} ${frond(372, 30, 90, 2.6, -0.2, 6, { seed: seed + 3, leaf: 14 })}`
}
