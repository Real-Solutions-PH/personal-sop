// Fern as the C1 wreath sprite (ADR-0019 as amended by ADR-0028): an orb with
// a face, a curl on its head, leaf arms and a two-frond wreath crown. This is
// the brand kit's `fernC('sprite', …)` drawing, typed: every shape in a
// 64-unit box, per state, with no filled circle behind it. fern-sprite.tsx
// lays these shapes out in layers and moves them.

import { jitter, leaf, type Point, rng, smooth } from "../brand/scribble"

export const FERN_STATES = [
  "arriving",
  "idle",
  "listening",
  "thinking",
  "speaking",
  "celebrating",
  "consoling",
] as const
export type FernState = (typeof FERN_STATES)[number]

const f1 = (n: number) => n.toFixed(1)

/** A spiral that curls in from (x, y) heading at `angle`; dir 1 = clockwise. */
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
  let [px, py, a, len] = [x, y, angle, step]
  for (let i = 0; i < n; i++) {
    a += dir * turn
    len *= 0.88
    px += Math.cos(a) * len
    py += Math.sin(a) * len
    points.push([px, py])
  }
  return smooth(points)
}

type FrondOptions = {
  seed?: number
  leaf?: number
  curl?: boolean
  wid?: number
  outside?: boolean
}

/** A frond bent along a circle from angle a0 to a1: two make a wreath. */
export function arcFrond(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  n: number,
  o: FrondOptions = {},
) {
  const random = rng(o.seed ?? 5),
    steps = 24,
    points: Point[] = [],
    dir = Math.sign(a1 - a0),
    tangent = (a: number) => a + (dir * Math.PI) / 2
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps
    points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  let d = smooth(jitter(points, r * 0.012, random))
  const end = points[steps]
  if (o.curl !== false)
    d += ` ${curl(end[0], end[1], tangent(a1), r * 0.07, dir, 12, 0.5)}`
  for (let k = 0; k < n; k++) {
    const t = 0.06 + (k / n) * 0.86,
      a = a0 + (a1 - a0) * t,
      x = cx + Math.cos(a) * r,
      y = cy + Math.sin(a) * r,
      side = k % 2 ? 1 : -1
    if (o.outside && side < 0) continue
    const length = (o.leaf ?? 10) * (1 - t * 0.4) * (0.85 + random() * 0.3)
    d += ` ${leaf(x, y, length, tangent(a) - dir * side * 0.85, o.wid ?? 0.38)}`
  }
  return d
}

/** A straight-ish frond with alternating leaflets: the curl opened on a win. */
export function frond(
  x: number,
  y: number,
  length: number,
  angle: number,
  bend: number,
  n: number,
  o: FrondOptions = {},
) {
  const random = rng(o.seed ?? 7),
    points: Point[] = [],
    steps = 24,
    leafMax = o.leaf ?? length * 0.22
  const ex = x + Math.cos(angle) * length,
    ey = y + Math.sin(angle) * length,
    px = -Math.sin(angle),
    py = Math.cos(angle)
  const cx = (x + ex) / 2 + px * length * bend,
    cy = (y + ey) / 2 + py * length * bend
  const at = (t: number): Point => [
    (1 - t) ** 2 * x + 2 * (1 - t) * t * cx + t * t * ex,
    (1 - t) ** 2 * y + 2 * (1 - t) * t * cy + t * t * ey,
  ]
  const tan = (t: number) =>
    Math.atan2(
      2 * (1 - t) * (cy - y) + 2 * t * (ey - cy),
      2 * (1 - t) * (cx - x) + 2 * t * (ex - cx),
    )
  for (let i = 0; i <= steps; i++) points.push(at(i / steps))
  let d = smooth(jitter(points, length * 0.012, random))
  if (o.curl !== false)
    d += ` ${curl(ex, ey, tan(1), length * 0.07, bend >= 0 ? 1 : -1, 14, 0.5)}`
  for (let i = 0; i < n; i++) {
    const t = 0.12 + (i / n) * 0.78,
      [lx, ly] = at(t),
      a = tan(t),
      s = i % 2 ? 1 : -1
    const l = leafMax * (1 - t * 0.75) * (0.85 + random() * 0.3)
    d += ` ${leaf(lx, ly, l, a + s * 0.95, o.wid ?? 0.32)}`
  }
  return d
}

/** The fiddlehead on Fern's head: a short stem rolling into the logo's curl. */
const sprout = (x: number, y: number, h: number) =>
  `M${x} ${y} C${x - 0.4} ${y - h * 0.45} ${x} ${y - h * 0.75} ${x + 1.8} ${y - h} ${curl(x + 1.8, y - h, -0.5, h * 0.3, 1, 12, 0.55).replace(/^M[^C]*/, "")}`

/** The curl opened into a frond, for a win. */
const sproutOpen = (x: number, y: number, h: number) =>
  frond(x, y, h * 1.9, -1.5, -0.1, 6, {
    seed: 51,
    leaf: h * 0.55,
    curl: false,
    wid: 0.42,
  })

/** Where the curl grows from: x, y and height, in box units. */
export const CURL_AT = [32, 21, 8] as const
/** The arms' bases (left, right) and leaf length. */
export const ARM_AT = {
  left: [17.6, 38],
  right: [46.4, 38],
  length: 7.5,
} as const
/** Eye spacing, eye and mouth heights, eye radius. */
export const FACE = { ex: 4.6, ey: 35, my: 40, r: 1.9 } as const

/** Static arm angles per state (left, right), in degrees. */
export const ARM_POSE: Record<FernState, [number, number]> = {
  arriving: [0, 0],
  idle: [0, 0],
  listening: [-26, 26],
  thinking: [0, 0],
  speaking: [0, 0],
  celebrating: [70, -70],
  consoling: [-34, 34],
}

export type MoodMark =
  | {
      kind: "twinkle"
      d: string
      x: number
      y: number
      color: MoodColor
      delay: number
    }
  | { kind: "ripple"; delay: number }
  | { kind: "spore"; x: number; y: number; r: number; delay: number }
  | { kind: "ping"; d: string; delay: number }

export type MoodColor = "joy" | "love" | "sprout"

const star = (x: number, y: number, r: number) =>
  `M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z`
const gem = (x: number, y: number, r: number) =>
  `M${x} ${y - r} L${x + r * 0.7} ${y} L${x} ${y + r} L${x - r * 0.7} ${y}Z`
const twinkle = (
  x: number,
  y: number,
  r: number,
  color: MoodColor,
  delay: number,
  shape: "star" | "gem" = "star",
): MoodMark => ({
  kind: "twinkle",
  d: shape === "star" ? star(x, y, r) : gem(x, y, r),
  x,
  y,
  color,
  delay,
})

/**
 * Every shape of the sprite for one state. `small` (under 32 pt) pulls the
 * wreath in tight round the orb, crops the box, enlarges the eyes and drops
 * the cheeks, brows and mood marks so the face gets the pixels.
 */
export function fernShapes(state: FernState, small: boolean) {
  const happy = state === "celebrating",
    sad = state === "consoling",
    big = !small
  const wr = small ? 19.5 : 25,
    wy = small ? 35 : 33
  const n = small ? 5 : 9,
    frondOptions = { leaf: small ? 7 : 6.5, wid: 0.42, outside: small }
  const wreathLeft = arcFrond(
    32,
    wy,
    wr,
    Math.PI / 2 + 0.32,
    Math.PI + 1.25,
    n,
    {
      ...frondOptions,
      seed: 41,
    },
  )
  const wreathRight = arcFrond(32, wy, wr, Math.PI / 2 - 0.32, -1.25, n, {
    ...frondOptions,
    seed: 42,
  })
  // The two fronds' stems cross under the chin, as on the trophy badges.
  const ex0 = wr * Math.sin(0.32),
    ey0 = wy + wr * Math.cos(0.32)
  const wreathCross = `M${f1(32 - ex0)} ${f1(ey0)} Q${f1(32 - ex0 * 0.2)} ${f1(ey0 + 4.5)} ${f1(32 + ex0 * 0.7)} ${f1(ey0 + 2.9)} M${f1(32 + ex0)} ${f1(ey0)} Q${f1(32 + ex0 * 0.2)} ${f1(ey0 + 4.5)} ${f1(32 - ex0 * 0.7)} ${f1(ey0 + 2.9)}`

  const { ex, my, r } = FACE
  const eyeY = FACE.ey + (state === "listening" ? -1.2 : sad ? 0.8 : 0)
  const grow = small ? 1.25 : 1
  // Open eyes; on a miss they well with a dewdrop under tilted brows.
  const eye = sad
    ? { rx: r * (small ? 1.25 : 1.05), ry: r * (small ? 1.45 : 1.25) }
    : { rx: r * 0.9 * grow, ry: r * 1.1 * grow }
  const happyEyes = `M${32 - ex - 1.8} ${eyeY + 0.6} q1.8 -2.4 3.6 0 M${32 + ex - 1.8} ${eyeY + 0.6} q1.8 -2.4 3.6 0`
  const dew = [-1, 1].map((k) => {
    const x = 32 + k * ex
    return {
      x,
      d: `M${x - eye.rx} ${eyeY} a${eye.rx} ${eye.ry} 0 0 0 ${eye.rx * 2} 0 z`,
      brow: big
        ? `M${x - k * 1.6} ${eyeY - eye.ry - 3.1} L${x + k * 2.2} ${eyeY - eye.ry - 1.5}`
        : null,
    }
  })
  const mw = 3.2
  const mouth = happy
    ? `M${32 - mw} ${my - 0.6} q${mw} ${mw * 1.3} ${mw * 2} 0`
    : sad
      ? `M${32 - mw * 0.7} ${my + 0.8} q${mw * 0.7} -${mw * 0.45} ${mw * 1.4} 0`
      : state === "thinking"
        ? `M${32 - mw * 0.45} ${my} h${mw * 0.9}`
        : `M${32 - mw * 0.8} ${my - 0.2} q${mw * 0.8} ${mw * 0.7} ${mw * 1.6} 0`
  const talk = { cy: my + 0.4, rx: mw * 0.62, ry: mw * 0.42 }
  const cheeks = big
    ? {
        left: 32 - ex - 3.2,
        right: 32 + ex + 3.2,
        y: my - 1,
        opacity: happy ? 0.95 : sad ? 0.2 : 0.5,
      }
    : null

  const [cx, cy, ch] = CURL_AT
  const { left, right, length } = ARM_AT
  const arms = {
    left: leaf(left[0], left[1], length, Math.PI - 0.35, 0.42),
    right: leaf(right[0], right[1], length, 0.35, 0.42),
  }

  let mood: MoodMark[] = []
  if (big && happy)
    mood = [
      twinkle(6, 9, 3.4, "joy", 0),
      twinkle(58, 6, 2.8, "joy", 0.5),
      twinkle(63, 24, 2.3, "love", 0.25, "gem"),
      twinkle(1, 27, 2, "love", 0.75, "gem"),
      twinkle(46, 0, 1.8, "joy", 1),
    ]
  // Listening: ripples spread on the ground under Fern, a pond taking in a sound.
  else if (big && state === "listening")
    mood = [0, 0.7, 1.4].map((delay) => ({ kind: "ripple", delay }))
  // Thinking: spores drift up in mirrored pairs beside the wreath.
  else if (big && state === "thinking")
    mood = (
      [
        [4, 22, 1.5, 0],
        [60, 22, 1.5, 0],
        [2, 12, 1.1, 0.6],
        [62, 12, 1.1, 0.6],
        [8, 4, 1.3, 1.2],
        [56, 4, 1.3, 1.2],
      ] as const
    ).map(([x, y, rr, delay]) => ({ kind: "spore", x, y, r: rr, delay }))
  // Speaking: three short lines each side, pulsing together.
  else if (big && state === "speaking")
    mood = [1, -1].flatMap((k) =>
      (
        [
          [59.5, 26, 3, -2.4],
          [61, 32, 4, 0],
          [59.5, 38, 3, 2.4],
        ] as const
      ).map(
        ([x, y, dx, dy], i): MoodMark => ({
          kind: "ping",
          d: `M${32 + k * (x - 32)} ${y} l${k * dx} ${dy}`,
          delay: i * 0.12,
        }),
      ),
    )
  else if (big && state === "arriving")
    mood = [
      twinkle(6, 10, 2.6, "sprout", 0.6),
      twinkle(58, 8, 2.2, "sprout", 0.9),
    ]

  const tears =
    big && sad
      ? [-1, 1].map((k) => ({
          x: 32 + k * ex,
          y: eyeY + 3,
          d: `M${32 + k * ex - k * 0.4} ${eyeY + 2.6} q-1.5 2.4 0 3.4 q1.5 -1 0 -3.4Z`,
        }))
      : []

  // Leaves that lift on a win and fall on a miss.
  const lift = happy
    ? (
        [
          [-22, -20, -50, 14, 20],
          [22, -22, 60, 50, 20],
          [-24, 6, -90, 9, 40],
          [24, 4, 80, 55, 40],
          [-6, -28, 20, 22, 10],
        ] as const
      ).map(([dx, dy, rot, x, y], i) => ({
        d: leaf(x, y, 5, -1.57, 0.42),
        x,
        y,
        dx,
        dy,
        rot,
        delay: i * 0.14,
      }))
    : []
  const fall = sad
    ? [
        { d: leaf(13, 26, 5, 2.2, 0.42), x: 13, y: 26, fx: 5, delay: 0 },
        ...(big
          ? [
              {
                d: leaf(51, 26, 5, Math.PI - 2.2, 0.42),
                x: 51,
                y: 26,
                fx: -5,
                delay: 1.6,
              },
            ]
          : []),
      ]
    : []

  return {
    viewBox: small ? ([6, 10, 52, 52] as const) : ([0, 0, 64, 64] as const),
    wreath: {
      left: wreathLeft,
      right: wreathRight,
      cross: wreathCross,
      width: small ? 2 : 1.5,
    },
    eyeY,
    eye,
    happyEyes,
    dew,
    mouth,
    talk,
    cheeks,
    // The longest subpath of each drawn-on stroke, for its dash: the wreath's
    // stem arc plus its end curl, the crossed stems, the curl's stem and spiral.
    lengths: { wreath: wr * 2.5 + 4, cross: 14, curl: ch * 2.2 },
    curl: sprout(cx, cy, ch),
    curlOpen: sproutOpen(cx, cy, ch),
    arms,
    mood,
    tears,
    lift,
    fall,
  }
}

export type FernShapes = ReturnType<typeof fernShapes>
