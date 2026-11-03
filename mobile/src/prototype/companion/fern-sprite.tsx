// Fern as the C1 wreath sprite, drawn with react-native-svg and moved with
// Reanimated. fern-geometry.ts holds the shapes; this file stacks them in
// layers (one Svg per moving part, all sharing the same box) and plays the
// brand kit's keyframes on them from one clock. Every motion is a transform,
// an opacity or a stroke drawing on. Reduced Motion and `still` show the
// pose with nothing moving, as the kit's `.still` does.

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useMemo,
} from "react"
import { View } from "react-native"
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated"
import Svg, {
  Circle,
  Defs,
  Ellipse,
  LinearGradient,
  Path,
  Stop,
} from "react-native-svg"
import { useTheme } from "../theme"
import { fernMoods, fernPalette } from "./brand"
import {
  ARM_AT,
  ARM_POSE,
  CURL_AT,
  FACE,
  type FernState,
  fernShapes,
} from "./fern-geometry"
import { companionStore } from "./store"

export type { FernState } from "./fern-geometry"

type Track = readonly (readonly [number, number])[]
type Ease = "inOut" | "out" | "in"
/** One CSS keyframe animation: seconds, and value tracks by offset 0–1. */
type Motion = {
  dur: number
  delay?: number
  ease?: Ease
  /** Plays once and holds its last frame (arriving), instead of looping. */
  once?: boolean
  rotate?: Track
  scale?: Track
  scaleY?: Track
  tx?: Track
  ty?: Track
  opacity?: Track
  dash?: Track
}

function eased(u: number, ease: Ease) {
  "worklet"
  if (ease === "out") return 1 - (1 - u) * (1 - u)
  if (ease === "in") return u * u
  return (1 - Math.cos(Math.PI * u)) / 2
}

/** The track's value at progress p, eased between keyframes. */
function at(p: number, track: Track, ease: Ease) {
  "worklet"
  if (p <= track[0][0]) return track[0][1]
  for (let i = 1; i < track.length; i++) {
    const [o1, v1] = track[i]
    if (p <= o1) {
      const [o0, v0] = track[i - 1]
      const u = o1 === o0 ? 1 : (p - o0) / (o1 - o0)
      return v0 + (v1 - v0) * eased(u, ease)
    }
  }
  return track[track.length - 1][1]
}

/** Progress through the motion at clock ms; -1 before its delay starts. */
function progress(ms: number, m: Motion) {
  "worklet"
  const t = ms / 1000 - (m.delay ?? 0)
  if (t < 0) return -1
  if (m.once) return Math.min(t / m.dur, 1)
  return (t % m.dur) / m.dur
}

// The kit's keyframes (brand kit p1-head.html), as tracks.
const pulse = (to: number): Track => [
  [0, 1],
  [0.5, to],
  [1, 1],
]
const swing = (from: number, to: number): Track => [
  [0, from],
  [0.5, to],
  [1, from],
]
const DRAIN: Track = [
  [0, 0],
  [0.15, 0],
  [0.45, 1],
  [0.85, 1],
  [1, 0],
]
const M = {
  breathe: { dur: 3.6, scale: pulse(1.04) },
  breatheFast: { dur: 1, scale: pulse(1.06) },
  hop: {
    dur: 1.2,
    ty: [
      [0, 0],
      [0.2, -4],
      [0.32, 0],
      [1, 0],
    ],
    scaleY: [
      [0, 1],
      [0.2, 1],
      [0.32, 0.96],
      [0.55, 1],
      [1, 1],
    ],
  },
  sink: {
    dur: 4,
    ty: [
      [0, 0],
      [0.15, 0],
      [0.45, 1.5],
      [0.85, 1.5],
      [1, 0],
    ],
  },
  eBody: {
    dur: 5,
    once: true,
    scale: [
      [0, 0],
      [0.08, 0],
      [0.2, 1.08],
      [0.25, 1],
      [1, 1],
    ],
  },
  eEyes: {
    dur: 5,
    once: true,
    scaleY: [
      [0, 0.05],
      [0.3, 0.05],
      [0.34, 1],
      [1, 1],
    ],
  },
  eWreath: {
    dur: 5,
    once: true,
    ease: "out",
    dash: [
      [0, 60],
      [0.24, 0],
      [1, 0],
    ],
  },
  eCurl: {
    dur: 5,
    once: true,
    ease: "out",
    dash: [
      [0, 60],
      [0.22, 60],
      [0.34, 0],
      [1, 0],
    ],
  },
  draw: {
    dur: 2.4,
    dash: [
      [0, 60],
      [0.45, 0],
      [0.7, 0],
      [1, -60],
    ],
  },
  blink: {
    dur: 4.2,
    scaleY: [
      [0, 1],
      [0.46, 1],
      [0.5, 0.1],
      [0.54, 1],
      [1, 1],
    ],
  },
  glance: {
    dur: 3,
    tx: [
      [0, 0],
      [0.3, 0],
      [0.4, -1.4],
      [0.6, -1.4],
      [0.7, 1.2],
      [0.85, 1.2],
      [1, 0],
    ],
  },
  talk: { dur: 0.42, scaleY: swing(0.4, 1) },
  well: { dur: 4, scaleY: DRAIN },
  drain: { dur: 4, opacity: DRAIN },
  unfurl: {
    dur: 3,
    opacity: [
      [0, 1],
      [0.15, 1],
      [0.3, 0],
      [0.8, 0],
      [0.95, 1],
      [1, 1],
    ],
  },
  unfurlIn: {
    dur: 3,
    opacity: [
      [0, 0],
      [0.15, 0],
      [0.35, 1],
      [0.78, 1],
      [0.95, 0],
      [1, 0],
    ],
    scaleY: [
      [0, 0.4],
      [0.15, 0.4],
      [0.35, 1],
      [0.78, 1],
      [0.95, 0.4],
      [1, 0.4],
    ],
  },
  perk: { dur: 2.1, scale: pulse(1.12) },
  ripple: {
    dur: 2.1,
    ease: "out",
    opacity: [
      [0, 0.9],
      [1, 0],
    ],
    scale: [
      [0, 0.35],
      [1, 2.3],
    ],
  },
  spore: {
    dur: 1.8,
    opacity: [
      [0, 0],
      [0.35, 1],
      [0.65, 1],
      [1, 0],
    ],
    ty: [
      [0, 3],
      [0.35, 0],
      [0.65, 0],
      [1, -4],
    ],
    scale: [
      [0, 0.6],
      [0.35, 1],
      [0.65, 1],
      [1, 0.8],
    ],
  },
  ping: { dur: 1.2, opacity: swing(0.15, 1) },
  twinkle: {
    dur: 1.8,
    opacity: [
      [0, 0],
      [0.3, 1],
      [0.6, 1],
      [1, 0],
    ],
    scale: [
      [0, 0],
      [0.3, 1.15],
      [0.6, 1],
      [1, 0],
    ],
    rotate: [
      [0, 0],
      [0.3, 20],
      [0.6, 35],
      [1, 60],
    ],
  },
  tear: {
    dur: 4,
    opacity: [
      [0, 0],
      [0.45, 0],
      [0.52, 1],
      [0.8, 1],
      [0.88, 0],
      [1, 0],
    ],
    ty: [
      [0, 0],
      [0.52, 0],
      [0.8, 7],
      [0.88, 9],
      [1, 9],
    ],
  },
} satisfies Record<string, Motion>

const sway = (dur: number, flip = false): Motion => ({
  dur,
  rotate: flip ? swing(3, -3) : swing(-3, 3),
})
const lean = (k: 1 | -1): Motion => ({ dur: 2.4, rotate: swing(4 * k, 6 * k) })
const droop = (k: 1 | -1): Motion => ({
  dur: 2.4,
  rotate: [
    [0, 0],
    [0.2, 0],
    [0.6, 7 * k],
    [1, 7 * k],
  ],
})
const wave = (deg: number): Motion => ({ dur: 1.2, rotate: swing(0, deg) })

type Ctx = {
  size: number
  vb: readonly [number, number, number, number]
  /** Points per box unit. */
  k: number
  clock: SharedValue<number>
  live: boolean
}
const SpriteCtx = createContext<Ctx | null>(null)
const useCtx = () => useContext(SpriteCtx) as Ctx

/**
 * A part of Fern that moves on its own: a box the size of the sprite,
 * transformed about `origin` (box units). `rotate` is a fixed turn under
 * the motion (an arm's pose, a bowed curl).
 */
function Part({
  motion,
  origin = [32, 32],
  rotate = 0,
  children,
}: {
  motion?: Motion
  origin?: readonly [number, number]
  rotate?: number
  children: ReactNode
}) {
  const { size, vb, k, clock, live } = useCtx()
  const style = useAnimatedStyle(() => {
    const p = live && motion ? progress(clock.value, motion) : -1
    if (!motion || p < 0)
      return { opacity: 1, transform: [{ rotate: `${rotate}deg` }] }
    const e = motion.ease ?? "inOut"
    return {
      opacity: motion.opacity ? at(p, motion.opacity, e) : 1,
      transform: [
        { translateX: (motion.tx ? at(p, motion.tx, e) : 0) * k },
        { translateY: (motion.ty ? at(p, motion.ty, e) : 0) * k },
        {
          rotate: `${rotate + (motion.rotate ? at(p, motion.rotate, e) : 0)}deg`,
        },
        { scale: motion.scale ? at(p, motion.scale, e) : 1 },
        { scaleY: motion.scaleY ? at(p, motion.scaleY, e) : 1 },
      ],
    }
  })
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: 0,
          top: 0,
          width: size,
          height: size,
          transformOrigin: [
            (origin[0] - vb[0]) * k,
            (origin[1] - vb[1]) * k,
            0,
          ],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  )
}

/** The shapes of one part, in the sprite's box. */
function Art({ children }: { children: ReactNode }) {
  const { size, vb } = useCtx()
  return (
    <Svg
      width={size}
      height={size}
      viewBox={vb.join(" ")}
      style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
    >
      {children}
    </Svg>
  )
}

const AnimatedPath = Animated.createAnimatedComponent(Path)

/**
 * A stroke that draws itself on (thinking, arriving), else a plain stroke.
 * The kit dashes in a 60-unit path length; react-native-svg has no
 * `pathLength`, so the dash runs in box units over `length`, the longest
 * subpath (each subpath, stem or leaf, draws from its own start).
 */
function Stroke({
  d,
  color,
  width,
  draw,
  length = 60,
}: {
  d: string
  color: string
  width: number
  draw?: Motion
  length?: number
}) {
  const { clock, live } = useCtx()
  const props = useAnimatedProps(() => {
    const p = live && draw ? progress(clock.value, draw) : -1
    return {
      strokeDashoffset:
        draw?.dash && p >= 0
          ? (at(p, draw.dash, draw.ease ?? "inOut") / 60) * length
          : 0,
    }
  })
  const common = {
    d,
    fill: "none",
    stroke: color,
    strokeWidth: width,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  }
  if (!draw) return <Path {...common} />
  return (
    <AnimatedPath
      {...common}
      strokeDasharray={[length, length + 1]}
      animatedProps={props}
    />
  )
}

/** Fern's body gradient, moss to sprout (or dry olive to straw on a miss). */
function Gradient({
  id,
  stops,
}: {
  id: string
  stops: [string, string, string]
}) {
  return (
    <Defs>
      <LinearGradient id={id} x1="0" y1="1" x2="1" y2="0">
        <Stop offset="0" stopColor={stops[0]} />
        <Stop offset="0.55" stopColor={stops[1]} />
        <Stop offset="1" stopColor={stops[2]} />
      </LinearGradient>
    </Defs>
  )
}

/** On a miss the dry colours fade in over the green and back again; a
 * still pose holds them. */
function Dry({ on, children }: { on: boolean; children: ReactNode }) {
  return on ? <Part motion={M.drain}>{children}</Part> : null
}

const HOUR = 3_600_000

export type FernSpriteProps = {
  size: number
  state?: FernState
  /** A frozen pose, for share captures and print. */
  still?: boolean
  /** Forces the light or dark colour set; defaults to the theme. */
  dark?: boolean
  /** Hide from screen readers when the row around it already says it all. */
  decorative?: boolean
}

/**
 * Fern, the companion, as the C1 wreath sprite in one of seven states:
 * arriving (plays once, then rests), idle, listening, thinking, speaking,
 * celebrating (a win) and consoling (a miss, wilting to dry olive and straw
 * and back). Under 32 pt the drawing tightens for small sizes.
 */
export function FernSprite({
  size,
  state = "idle",
  still = false,
  dark,
  decorative = false,
}: FernSpriteProps) {
  const t = useTheme()
  const name = companionStore.use((s) => s.name)
  const isDark = dark ?? t.dark
  const reduced = useReducedMotion()
  const live = !still && !reduced
  const small = size < 32
  const s = useMemo(() => fernShapes(state, small), [state, small])
  const p = fernPalette(isDark),
    m = fernMoods(isDark)
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "")
  const clock = useSharedValue(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new state restarts the clock
  useEffect(() => {
    cancelAnimation(clock)
    clock.value = 0
    if (!live) return
    clock.value = withRepeat(
      withTiming(HOUR, { duration: HOUR, easing: Easing.linear }),
      -1,
      false,
    )
    return () => cancelAnimation(clock)
  }, [live, state, clock])

  const vb = s.viewBox
  const ctx = useMemo<Ctx>(
    () => ({ size, vb, k: size / vb[2], clock, live }),
    [size, vb, clock, live],
  )
  const sw = small ? 2.6 : size > 80 ? 1.5 : 1.9
  const happy = state === "celebrating",
    sad = state === "consoling",
    arrive = state === "arriving"
  const green = `${uid}g`,
    dry = `${uid}d`
  const greenStops: [string, string, string] = [p.moss, p.frond, p.sprout]
  const dryStops: [string, string, string] = [m.sad1, m.sad2, m.sad3]

  const wreathDraw =
    state === "thinking" ? M.draw : arrive ? M.eWreath : undefined
  const wreathSide = (side: "left" | "right") => {
    const k = side === "left" ? 1 : -1
    const motion =
      state === "listening"
        ? lean(k)
        : state === "speaking"
          ? sway(1.2, side === "right")
          : sad
            ? droop(k === 1 ? -1 : 1)
            : undefined
    const d = s.wreath[side]
    return (
      <Part motion={motion} origin={[32, 58]}>
        <Art>
          <Gradient id={green} stops={greenStops} />
          <Stroke
            d={d}
            color={`url(#${green})`}
            width={s.wreath.width}
            draw={wreathDraw}
            length={s.lengths.wreath}
          />
        </Art>
        <Dry on={sad}>
          <Art>
            <Gradient id={dry} stops={dryStops} />
            <Stroke d={d} color={`url(#${dry})`} width={s.wreath.width} />
          </Art>
        </Dry>
      </Part>
    )
  }

  const arm = (side: "left" | "right") => {
    const [x, y] = ARM_AT[side]
    const pose = ARM_POSE[state][side === "left" ? 0 : 1]
    const motion =
      state === "speaking"
        ? wave(side === "left" ? -22 : 22)
        : happy
          ? wave(side === "left" ? 14 : -14)
          : undefined
    const leafArt = (fill: string, stroke: string) => (
      <Art>
        <Path
          d={s.arms[side]}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw * 0.75}
          strokeLinejoin="round"
        />
      </Art>
    )
    return (
      <Part motion={motion} origin={[x, y]} rotate={pose}>
        {leafArt(p.sprout, m.ink)}
        <Dry on={sad}>{leafArt(m.sad3, m.wiltInk)}</Dry>
      </Part>
    )
  }

  const { ex } = FACE
  const eyes = happy ? (
    <Art>
      <Path
        d={s.happyEyes}
        fill="none"
        stroke="#fff"
        strokeWidth={sw}
        strokeLinecap="round"
      />
    </Art>
  ) : sad ? (
    <>
      <Art>
        {s.dew.map((e) => (
          <Ellipse
            key={e.x}
            cx={e.x}
            cy={s.eyeY}
            rx={s.eye.rx}
            ry={s.eye.ry}
            fill="#fff"
          />
        ))}
        {s.dew.map((e) =>
          e.brow ? (
            <Path
              key={e.brow}
              d={e.brow}
              stroke="#fff"
              strokeWidth={sw * 0.7}
              strokeLinecap="round"
              fill="none"
            />
          ) : null,
        )}
      </Art>
      {s.dew.map((e) => (
        <Part key={e.d} motion={M.well} origin={[e.x, s.eyeY + s.eye.ry]}>
          <Art>
            <Path d={e.d} fill={m.dew} opacity={0.85} />
          </Art>
        </Part>
      ))}
    </>
  ) : (
    <Part
      motion={state === "thinking" ? M.glance : arrive ? M.eEyes : M.blink}
      origin={[32, s.eyeY]}
    >
      <Art>
        {[-1, 1].map((k) => (
          <Ellipse
            key={k}
            cx={32 + k * ex}
            cy={s.eyeY}
            rx={s.eye.rx}
            ry={s.eye.ry}
            fill="#fff"
          />
        ))}
      </Art>
    </Part>
  )
  const mouth =
    state === "speaking" ? (
      <Part motion={M.talk} origin={[32, s.talk.cy]}>
        <Art>
          <Ellipse
            cx={32}
            cy={s.talk.cy}
            rx={s.talk.rx}
            ry={s.talk.ry}
            fill="#fff"
          />
        </Art>
      </Part>
    ) : (
      <Art>
        <Path
          d={s.mouth}
          fill="none"
          stroke="#fff"
          strokeWidth={sw * 0.85}
          strokeLinecap="round"
        />
      </Art>
    )

  const [cx, cy] = CURL_AT
  const curlStroke = (draw?: Motion) => (
    <Art>
      <Stroke
        d={s.curl}
        color={m.ink}
        width={sw}
        draw={draw}
        length={s.lengths.curl}
      />
    </Art>
  )
  const openCurl = (
    <Art>
      <Path
        d={s.curlOpen}
        fill="none"
        stroke={m.ink}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Art>
  )
  const curl = happy ? (
    live ? (
      <>
        <Part motion={M.unfurl}>{curlStroke()}</Part>
        <Part motion={M.unfurlIn} origin={[cx, cy]}>
          {openCurl}
        </Part>
      </>
    ) : (
      openCurl
    )
  ) : sad ? (
    <Part origin={[cx, cy]} rotate={38}>
      {curlStroke()}
    </Part>
  ) : state === "listening" ? (
    <Part motion={M.perk} origin={[cx, cy]}>
      {curlStroke()}
    </Part>
  ) : state === "speaking" || state === "idle" ? (
    <Part motion={sway(state === "idle" ? 3.6 : 1.2)} origin={[cx, cy]}>
      {curlStroke()}
    </Part>
  ) : (
    curlStroke(state === "thinking" ? M.draw : M.eCurl)
  )

  const whole: Motion | undefined = happy
    ? M.hop
    : sad
      ? M.sink
      : arrive
        ? undefined
        : state === "thinking"
          ? M.breatheFast
          : M.breathe
  const wholeOrigin: [number, number] = happy || sad ? [32, 58] : [32, 40]

  const moodColor = { joy: m.joy, love: m.love, sprout: p.sprout }
  const mood = s.mood.map((mk, i) => {
    const key = `${mk.kind}${i}`
    if (mk.kind === "twinkle")
      return (
        <Part
          key={key}
          motion={{ ...M.twinkle, delay: mk.delay }}
          origin={[mk.x, mk.y]}
        >
          <Art>
            <Path d={mk.d} fill={moodColor[mk.color]} />
          </Art>
        </Part>
      )
    if (mk.kind === "ripple")
      return (
        <Part
          key={key}
          motion={{ ...M.ripple, delay: mk.delay }}
          origin={[32, 63]}
        >
          <Art>
            <Ellipse
              cx={32}
              cy={63}
              rx={9}
              ry={1.8}
              fill="none"
              stroke={m.water}
              strokeWidth={1.2}
            />
          </Art>
        </Part>
      )
    if (mk.kind === "spore")
      return (
        <Part
          key={key}
          motion={{ ...M.spore, delay: mk.delay }}
          origin={[mk.x, mk.y]}
        >
          <Art>
            <Circle cx={mk.x} cy={mk.y} r={mk.r} fill={m.think} />
          </Art>
        </Part>
      )
    return (
      <Part key={key} motion={{ ...M.ping, delay: mk.delay }}>
        <Art>
          <Path
            d={mk.d}
            stroke={p.frond}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        </Art>
      </Part>
    )
  })

  return (
    <SpriteCtx.Provider value={ctx}>
      <View
        accessible={!decorative}
        accessibilityElementsHidden={decorative}
        importantForAccessibility={decorative ? "no-hide-descendants" : "yes"}
        accessibilityRole={decorative ? undefined : "image"}
        accessibilityLabel={decorative ? undefined : name}
        accessibilityState={
          decorative ? undefined : { busy: state === "thinking" }
        }
        testID={`fern-${state}`}
        style={{ width: size, height: size, overflow: "visible" }}
      >
        <Part motion={whole} origin={wholeOrigin}>
          {wreathSide("left")}
          {wreathSide("right")}
          <Part>
            <Art>
              <Gradient id={green} stops={greenStops} />
              <Stroke
                d={s.wreath.cross}
                color={`url(#${green})`}
                width={s.wreath.width}
                draw={wreathDraw}
                length={s.lengths.cross}
              />
            </Art>
            <Dry on={sad}>
              <Art>
                <Gradient id={dry} stops={dryStops} />
                <Stroke
                  d={s.wreath.cross}
                  color={`url(#${dry})`}
                  width={s.wreath.width}
                />
              </Art>
            </Dry>
          </Part>
          <Part motion={arrive ? M.eBody : undefined} origin={[32, 35]}>
            <Art>
              <Gradient id={green} stops={greenStops} />
              <Circle cx={32} cy={35} r={14} fill={`url(#${green})`} />
            </Art>
            <Dry on={sad}>
              <Art>
                <Gradient id={dry} stops={dryStops} />
                <Circle cx={32} cy={35} r={14} fill={`url(#${dry})`} />
              </Art>
            </Dry>
            {arm("left")}
            {arm("right")}
            {eyes}
            {mouth}
            {s.cheeks && (
              <Art>
                {[s.cheeks.left, s.cheeks.right].map((x) => (
                  <Circle
                    key={x}
                    cx={x}
                    cy={s.cheeks?.y}
                    r={1.7}
                    fill={m.blush}
                    opacity={s.cheeks?.opacity}
                  />
                ))}
              </Art>
            )}
          </Part>
          {curl}
          {s.tears.map((tear) => (
            <Part key={tear.d} motion={M.tear} origin={[tear.x, tear.y]}>
              <Art>
                <Path
                  d={tear.d}
                  fill={m.dew}
                  stroke={m.dewInk}
                  strokeWidth={0.5}
                />
              </Art>
            </Part>
          ))}
        </Part>
        {mood}
        {live &&
          s.lift.map((l) => (
            <Part
              key={l.d}
              origin={[l.x, l.y]}
              motion={{
                dur: 1.8,
                ease: "out",
                delay: l.delay,
                opacity: [
                  [0, 0],
                  [0.2, 1],
                  [1, 0],
                ],
                tx: [
                  [0, 0],
                  [1, l.dx],
                ],
                ty: [
                  [0, 0],
                  [1, l.dy],
                ],
                rotate: [
                  [0, 0],
                  [1, l.rot],
                ],
              }}
            >
              <Art>
                <Path
                  d={l.d}
                  fill={p.sprout}
                  stroke={m.ink}
                  strokeWidth={0.8}
                />
              </Art>
            </Part>
          ))}
        {s.fall.map((l) => (
          <Part
            key={l.d}
            origin={[l.x, l.y]}
            motion={{
              dur: 4,
              ease: "in",
              delay: l.delay,
              opacity: [
                [0, 0],
                [0.15, 1],
                [1, 0],
              ],
              tx: [
                [0, 0],
                [1, l.fx],
              ],
              ty: [
                [0, 0],
                [1, 26],
              ],
              rotate: [
                [0, 0],
                [1, 80],
              ],
            }}
          >
            <Art>
              <Path
                d={l.d}
                fill={m.wilt}
                stroke={m.wiltInk}
                strokeWidth={0.8}
              />
            </Art>
          </Part>
        ))}
      </View>
    </SpriteCtx.Provider>
  )
}
