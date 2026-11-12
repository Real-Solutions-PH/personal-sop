import { dayKey } from "@domain/lib/day"
import * as Haptics from "expo-haptics"
import { LinearGradient } from "expo-linear-gradient"
import { usePathname } from "expo-router"
import { Check, Flame, Trophy } from "lucide-react-native"
import {
  type ComponentRef,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import {
  Pressable,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  runOnJS,
  type SharedValue,
  SlideInLeft,
  SlideInRight,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
} from "react-native-reanimated"
import Svg, { Circle } from "react-native-svg"
import { anchor, type Box, Overlay } from "./overlay"
import { isMilestone } from "./rewards"
import { prototypeStorage } from "./storage"
import { stepTab } from "./tab-swipe"
import { fonts, useTheme } from "./theme"

/**
 * One place for the app's motion vocabulary so every action feels related:
 * quick feedback on touch, a short beat before state commits, and slower
 * reveals for numbers worth savouring.
 */
export const MOTION = {
  /** Press feedback, toggles. */
  fast: 160,
  /** Most transitions. */
  base: 240,
  /** Score rings and count-ups. */
  reveal: 900,
  /** How long a check stays in place, celebrating, before the row moves. */
  commit: 520,
  /** A habit's progress ring stepping to its next value (1 of 2 → 2 of 2). */
  progress: 420,
  /** A completion's particles flying out from the check. */
  burst: 620,
  spring: { damping: 18, stiffness: 240, mass: 0.9 },
}

export const feel = {
  tap: () =>
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  select: () => void Haptics.selectionAsync().catch(() => {}),
  success: () =>
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success,
    ).catch(() => {}),
  impact: () =>
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
      () => {},
    ),
  /** Something went less well than hoped: a miss, a limit crossed. */
  warning: () =>
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Warning,
    ).catch(() => {}),
  /** Something failed or was refused. */
  error: () =>
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Error,
    ).catch(() => {}),
}

/** When this device last completed something by hand, and whether that was
 * a swipe (which already buzzed). An all-done moment only follows one of
 * these: a pull completing things elsewhere does not celebrate. */
const local = { at: 0, swipe: 0 }
export function markCompletion(swipe = false) {
  local.at = Date.now()
  if (swipe) local.swipe = local.at
}
export const completedAgo = () => Date.now() - local.at
export const completedRecently = (ms = 2000) => completedAgo() < ms
const swipedRecently = () => Date.now() - local.swipe < 300

/** `#rgb`/`#rrggbb` at `alpha` as rgba; anything else is returned as is. */
export function alpha(color: string, a: number) {
  const hex = color.replace("#", "")
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex
  if (!/^[0-9a-f]{6}$/i.test(full)) return color
  const n = Number.parseInt(full, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

const easeOut = Easing.out(Easing.cubic)

// Reanimated 4 jumps every animation to its end on frame 1 while iOS Reduce
// Motion is on, unless told otherwise. Reduce Motion asks for less movement,
// not for no feedback: fades, numbers counting and strokes drawing on still
// play under it (with this flag); slides, scaling and travel do not.
const never = ReduceMotion.Never

/** List rows glide to their new place when a list re-sorts or shrinks. */
export const rowLayout = LinearTransition.springify().damping(20).stiffness(220)
export const rowEnter = FadeIn.duration(MOTION.base).reduceMotion(never)
export const rowExit = FadeOut.duration(MOTION.fast).reduceMotion(never)

/** An entrance for something that just landed (a record, a new row): it
 * rises in, or only fades in under Reduce Motion, and it always plays. */
export function useEnter() {
  const reduced = useReducedMotion()
  return (delay = 0, duration = MOTION.base) =>
    (reduced ? FadeIn : FadeInDown)
      .duration(duration)
      .delay(delay)
      .reduceMotion(never)
}

/** An entrance for a win's line or badge: it pops in, or only fades in
 * under Reduce Motion, and it always plays. */
export function usePopIn() {
  const reduced = useReducedMotion()
  return (delay = 0) =>
    reduced
      ? FadeIn.duration(MOTION.base).delay(delay).reduceMotion(never)
      : ZoomIn.springify().damping(12).delay(delay).reduceMotion(never)
}

/** Count a number up (or down) to `value`, e.g. a score revealing itself.
 * It counts under Reduce Motion too: digits changing in place are not
 * movement, and a finish's numbers landing is part of its celebration. */
export function useCountUp(
  value: number,
  duration = MOTION.reveal,
  /** Where the first count starts; the value itself skips it. */
  start = 0,
) {
  const [shown, setShown] = useState(start)
  const from = useRef(start)
  useEffect(() => {
    const start = from.current
    const began = Date.now()
    let frame = 0
    const step = () => {
      const k = Math.min(1, (Date.now() - began) / duration)
      const eased = 1 - (1 - k) ** 3
      const next = start + (value - start) * eased
      setShown(next)
      from.current = next
      if (k < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])
  return shown
}

export function CountUp({
  value,
  style,
  suffix,
  maxScale,
}: {
  value: number | null
  style?: TextStyle
  suffix?: ReactNode
  /** Caps Dynamic Type, for numbers drawn inside fixed geometry. */
  maxScale?: number
}) {
  const n = useCountUp(value ?? 0)
  return (
    <Text style={style} maxFontSizeMultiplier={maxScale}>
      {value === null ? "—" : Math.round(n)}
      {suffix}
    </Text>
  )
}

const AnimatedCircleSvg = Animated.createAnimatedComponent(Circle)

/** An SVG arc whose fill sweeps to `value` (0–1) on mount and on change.
 * A stroke drawing on, so it sweeps under Reduce Motion as well. */
export function ArcCircle({
  value,
  r,
  cx,
  cy,
  duration,
  ...rest
}: {
  value: number
  r: number
  cx: number
  cy: number
  stroke: string
  strokeWidth: number
  strokeLinecap?: "round" | "butt"
  transform?: string
  /** The echo stroke of the hand-drawn ring is drawn at half strength. */
  opacity?: number
  /** Sweep time; the score rings' slow reveal unless a control wants a
   * quicker answer. */
  duration?: number
}) {
  const c = 2 * Math.PI * r
  const p = useSharedValue(0)
  const ms = duration ?? MOTION.reveal
  useEffect(() => {
    p.value = withTiming(value, {
      duration: ms,
      easing: easeOut,
      reduceMotion: never,
    })
  }, [value, p, ms])
  const props = useAnimatedProps(() => ({
    strokeDasharray: [c * p.value, c],
  }))
  return (
    <AnimatedCircleSvg
      cx={cx}
      cy={cy}
      r={r}
      fill="none"
      animatedProps={props}
      {...rest}
    />
  )
}

// A completion's feedback must still be seen, so these always run; under
// Reduce Motion they only fade, never move.
const fade = (to: number, duration: number) =>
  withTiming(to, { duration, easing: easeOut, reduceMotion: never })
const spring = (to: number, config: { damping: number; stiffness: number }) =>
  withSpring(to, { ...config, reduceMotion: never })

const PARTICLES = 12
/**
 * A completion's reward, centred on its parent each time `fire` goes up: a
 * soft flash, a ripple ring and twelve particles spraying out in a wide oval.
 * It is drawn in the top overlay layer at the parent's window position, so
 * no card, header, tab bar or sheet can clip or cover it. Never touchable,
 * gone after the burst. Under Reduce Motion it is a halo that fades in and
 * out where it stands.
 */
export function Burst({
  fire,
  color,
  size,
}: {
  fire: number
  color: string
  size: number
}) {
  const reduced = useReducedMotion()
  const t = useSharedValue(0)
  const [live, setLive] = useState(false)
  const [angles, setAngles] = useState<number[]>([])
  const [box, setBox] = useState<Box | null>(null)
  const at = useRef<ComponentRef<typeof View>>(null)
  const seen = useRef(fire)
  useEffect(() => {
    if (fire === seen.current) return
    seen.current = fire
    if (fire <= 0) return
    if (at.current) anchor.measure(at.current, setBox)
    // ±10° of jitter so no two bursts look stamped.
    setAngles(
      Array.from(
        { length: PARTICLES },
        (_, i) =>
          ((i * (360 / PARTICLES) + (Math.random() * 20 - 10)) * Math.PI) / 180,
      ),
    )
    setLive(true)
    t.value = 0
    t.value = fade(1, MOTION.burst)
    const id = setTimeout(() => setLive(false), MOTION.burst + 80)
    return () => clearTimeout(id)
  }, [fire, t])
  const ring = useAnimatedStyle(() => {
    const k = Math.min(1, t.value * 1.25)
    return reduced
      ? { opacity: 0.8 * Math.sin(Math.PI * t.value) }
      : { opacity: 0.8 * (1 - k), transform: [{ scale: 1 + 1.2 * k }] }
  })
  const flash = useAnimatedStyle(() =>
    reduced
      ? { opacity: 0.45 * Math.sin(Math.PI * t.value) }
      : {
          opacity: 0.45 * (1 - t.value),
          transform: [{ scale: 0.7 + 1.1 * t.value }],
        },
  )
  return (
    <>
      <View
        ref={at}
        collapsable={false}
        pointerEvents="none"
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {live && box && (
        <Overlay>
          <BurstAt
            box={box}
            t={t}
            reduced={reduced}
            ring={ring}
            flash={flash}
            angles={angles}
            color={color}
            size={size}
          />
        </Overlay>
      )}
    </>
  )
}
/** The burst itself, in the overlay layer over ``box``. */
function BurstAt({
  box,
  t,
  reduced,
  ring,
  flash,
  angles,
  color,
  size,
}: {
  box: Box
  t: SharedValue<number>
  reduced: boolean
  ring: ReturnType<typeof useAnimatedStyle>
  flash: ReturnType<typeof useAnimatedStyle>
  angles: number[]
  color: string
  size: number
}) {
  return (
    <View
      testID="burst"
      pointerEvents="none"
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View
        style={[
          {
            position: "absolute",
            width: size * 1.3,
            height: size * 1.3,
            borderRadius: size,
            backgroundColor: color,
          },
          flash,
        ]}
      />
      <Animated.View
        style={[
          {
            position: "absolute",
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 3,
            borderColor: color,
          },
          ring,
        ]}
      />
      {!reduced &&
        angles.map((a, i) => (
          <Particle
            key={i}
            t={t}
            angle={a}
            dx={size * 1.45}
            dy={size * 0.8}
            dot={i % 3 ? 5 : 7}
            color={i % 2 ? alpha(color, 0.6) : color}
          />
        ))}
    </View>
  )
}
function Particle({
  t,
  angle,
  dx,
  dy,
  dot,
  color,
}: {
  t: SharedValue<number>
  angle: number
  dx: number
  dy: number
  dot: number
  color: string
}) {
  const style = useAnimatedStyle(() => ({
    // Full strength for the first half of the flight, then out.
    opacity: Math.min(1, 2 - 2 * t.value),
    transform: [
      { translateX: Math.cos(angle) * dx * t.value },
      { translateY: Math.sin(angle) * dy * t.value },
      { scale: 1 - 0.5 * t.value },
    ],
  }))
  return (
    <Animated.View
      testID="burst-particle"
      style={[
        {
          position: "absolute",
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  )
}

const readDay = (key: string) => {
  try {
    return prototypeStorage().getItem(key)
  } catch {
    return null
  }
}
const writeDay = (key: string, day: string) => {
  try {
    prototypeStorage().setItem(key, day)
  } catch {
    // Without storage the moment may replay on the next launch.
  }
}
/** Claims a ``useDayMoment`` key for today from outside the screen that
 * shows it (an app-wide card): true if it had not played today. */
export function claimDayMoment(key: string, day = dayKey()) {
  if (readDay(key) === day) return false
  writeDay(key, day)
  return true
}
/**
 * A once-a-day moment, e.g. every habit done: "new" the first time today
 * `reached` turns true right after a completion on this device, "seen"
 * while it stays reached afterwards (or after a relaunch), else null.
 */
export function useDayMoment(
  key: string,
  reached: boolean,
): "new" | "seen" | null {
  const day = dayKey()
  const was = useRef(reached)
  const [state, setState] = useState<"new" | "seen" | null>(() =>
    reached && readDay(key) === day ? "seen" : null,
  )
  useEffect(() => {
    const before = was.current
    was.current = reached
    if (!reached) return setState(null)
    if (readDay(key) === day) return setState((s) => s ?? "seen")
    if (!before && completedRecently()) {
      writeDay(key, day)
      setState("new")
    }
  }, [reached, key, day])
  return state
}

/** One soft band of light sweeping across its parent, once, on mount.
 * Under Reduce Motion the light glows up and fades where it stands. */
export function Shimmer({ color = "rgba(255, 255, 255, 0.35)" }) {
  const reduced = useReducedMotion()
  const [width, setWidth] = useState(0)
  const x = useSharedValue(0)
  useEffect(() => {
    if (!width) return
    x.value = withTiming(1, {
      duration: reduced ? 900 : 700,
      easing: easeOut,
      reduceMotion: never,
    })
  }, [width, reduced, x])
  const band = useAnimatedStyle(() =>
    reduced
      ? {
          transform: [{ translateX: 0 }],
          width,
          opacity: Math.sin(Math.PI * x.value),
        }
      : {
          transform: [{ translateX: -120 + (width + 240) * x.value }],
          opacity: 1 - x.value * 0.4,
        },
  )
  return (
    <View
      pointerEvents="none"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: "hidden",
      }}
    >
      {width > 0 && (
        <Animated.View
          style={[
            { position: "absolute", top: 0, bottom: 0, width: 120 },
            band,
          ]}
        >
          <LinearGradient
            colors={["transparent", color, "transparent"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      )}
    </View>
  )
}

/** A habit's flame and streak. When the streak grows while it is on screen
 * the chip bumps and the number counts up to the new value. */
export function StreakChip({
  streak,
  from,
  miss = null,
  note = null,
}: {
  streak: number
  /** Where the count starts on mount: one less bumps it as it appears. */
  from?: number
  /** The run that ended on yesterday's miss and the days missed (shown
   * while ``streak`` is 0, for that day only): its cost, never a loss. */
  miss?: { missed: number; run: number } | null
  /** What a live streak rests on: "rest day ready", "rest day used",
   * "paused 3 days". */
  note?: string | null
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const scale = useSharedValue(1)
  const dim = useSharedValue(1)
  const prev = useRef(from ?? streak)
  const n = useCountUp(streak, MOTION.base * 2, from ?? streak)
  // A milestone day (7, 30, 100, 365) wears gold with a trophy.
  const milestone = isMilestone(streak)
  useEffect(() => {
    if (streak > prev.current && !reduced)
      scale.value = withSequence(
        never,
        withTiming(milestone ? 1.6 : 1.3, {
          duration: 140,
          reduceMotion: never,
        }),
        spring(1, { damping: milestone ? 6 : 8, stiffness: 260 }),
      )
    // Under Reduce Motion the chip glows instead: a dip and back, in place.
    else if (streak > prev.current)
      dim.value = withSequence(never, fade(0.35, 140), fade(1, 420))
    if (streak > prev.current && milestone) feel.success()
    prev.current = streak
  }, [streak, reduced, scale, dim, milestone])
  const bump = useAnimatedStyle(() => ({
    opacity: dim.value,
    transform: [{ scale: scale.value }],
  }))
  if (streak <= 0) {
    if (!miss) return null
    const days = `${miss.missed} day${miss.missed === 1 ? "" : "s"}`
    return (
      <View
        testID="streak-miss"
        accessibilityLabel={`${days} missed, ${miss.run}-day run ended`}
        style={{
          borderRadius: 12,
          backgroundColor: alpha(t.muted, 0.1),
          paddingHorizontal: 6,
          paddingVertical: 1,
        }}
      >
        <Text
          style={{
            fontFamily: fonts.medium,
            fontSize: 11,
            lineHeight: 14,
            color: t.muted,
          }}
        >
          {days} missed · run of {miss.run} ended
        </Text>
      </View>
    )
  }
  const tone = milestone ? t.life : t.warn
  const Icon = milestone ? Trophy : Flame
  return (
    <Animated.View
      testID={milestone ? "streak-milestone" : "streak-chip"}
      accessibilityLabel={`${streak}-day streak${milestone ? ", a milestone" : ""}${note ? `, ${note}` : ""}`}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 2,
          borderRadius: 12,
          backgroundColor: alpha(tone, milestone ? 0.22 : 0.15),
          paddingHorizontal: 6,
          paddingVertical: 1,
        },
        bump,
      ]}
    >
      <Icon size={12} color={tone} />
      <Text
        style={{
          fontFamily: fonts.semibold,
          fontSize: 11,
          lineHeight: 14,
          color: tone,
        }}
      >
        {Math.round(n)}
      </Text>
      {!!note && (
        <Text
          style={{
            fontFamily: fonts.medium,
            fontSize: 11,
            lineHeight: 14,
            color: t.muted,
            marginLeft: 2,
          }}
        >
          · {note}
        </Text>
      )}
    </Animated.View>
  )
}

/** A swipe that completes a row: the row's check plays its pop and burst
 * (`celebrate`), and the change commits after the same beat as a tap. A
 * swipe that reopens commits at once. */
export function useSwipeComplete(done: boolean, toggle: () => void) {
  const [celebrate, setCelebrate] = useState(0)
  const onComplete = () => {
    if (done) return toggle()
    markCompletion(true)
    setCelebrate((n) => n + 1)
    // Not cleared on unmount: the action must still happen.
    setTimeout(toggle, MOTION.commit)
  }
  return { celebrate, onComplete }
}

const RowFlash = createContext<((color: string) => void) | null>(null)
/**
 * A checkable row. When an `AnimatedCheck` inside it completes, the whole row
 * flashes its colour and a band of light sweeps across it (only the flash
 * under Reduce Motion).
 */
export function TickRow({
  children,
  style,
}: {
  children: ReactNode
  style?: ViewStyle
}) {
  const reduced = useReducedMotion()
  const [color, setColor] = useState<string | null>(null)
  const [width, setWidth] = useState(0)
  const glow = useSharedValue(0)
  const sweep = useSharedValue(0)
  const flash = useCallback(
    (c: string) => {
      setColor(c)
      glow.value = withSequence(never, fade(1, 120), fade(0, 560))
      sweep.value = 0
      if (!reduced) sweep.value = fade(1, 620)
    },
    [reduced, glow, sweep],
  )
  const tint = useAnimatedStyle(() => ({ opacity: glow.value }))
  const band = useAnimatedStyle(() => ({
    transform: [{ translateX: -160 + (width + 320) * sweep.value }],
  }))
  return (
    <RowFlash.Provider value={flash}>
      <View
        style={style}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {color && (
          <Animated.View
            testID="row-flash"
            pointerEvents="none"
            style={[
              {
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                borderRadius: 12,
                overflow: "hidden",
                backgroundColor: alpha(color, 0.16),
              },
              tint,
            ]}
          >
            {!reduced && width > 0 && (
              <Animated.View
                style={[
                  { position: "absolute", top: 0, bottom: 0, width: 160 },
                  band,
                ]}
              >
                <LinearGradient
                  colors={["transparent", alpha(color, 0.35), "transparent"]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={{ flex: 1 }}
                />
              </Animated.View>
            )}
          </Animated.View>
        )}
        {children}
      </View>
    </RowFlash.Provider>
  )
}

/**
 * The one completion check for every tickable thing (habits, tasks, sets).
 * Checking answers instantly: a success haptic, the check pops past full
 * size, its colour sweeps out from the centre, the tick springs in, a burst
 * flies out and its `TickRow` flashes. The change commits after a short beat
 * (`beat`) so all of that is seen before the row moves or re-sorts.
 * Unchecking is quieter: a light tap, a small dip, the fill draining away.
 * Under Reduce Motion nothing scales or travels, but the fill, tick, halo
 * and row flash still fade in, so a tick is never silent.
 */
export function AnimatedCheck({
  checked,
  onToggle,
  color,
  label,
  size = 24,
  square = false,
  ring = 2,
  idle,
  checkColor = "#fff",
  progress = 0,
  burst = true,
  celebrate = 0,
  beat = MOTION.commit,
}: {
  checked: boolean
  onToggle: () => void
  color: string
  label: string
  size?: number
  square?: boolean
  ring?: number
  idle: string
  checkColor?: string
  /** Partial progress (0–1) while not checked, e.g. 1 of 2 glasses: drawn
   * as an arc inside the circle that sweeps to each new value. */
  progress?: number
  /** Particles and a ripple when a press checks it. */
  burst?: boolean
  /** Goes up when something else completed it (a swipe, a count reaching
   * its target): plays the pop, fill and burst without toggling. */
  celebrate?: number
  /** How long after the press the toggle commits; 0 for rows that stay put
   * (a workout set), so the change is immediate and the animation plays on. */
  beat?: number
}) {
  const reduced = useReducedMotion()
  const flashRow = useContext(RowFlash)
  const [shown, setShown] = useState(checked)
  const [fire, setFire] = useState(0)
  const pending = useRef(false)
  useEffect(() => {
    if (!pending.current) setShown(checked)
  }, [checked])
  const scale = useSharedValue(1)
  const fill = useSharedValue(checked ? 1 : 0)
  const tick = useSharedValue(checked ? 1 : 0)
  const was = useRef(shown)
  useEffect(() => {
    if (shown === was.current) return
    was.current = shown
    if (shown) {
      fill.value = fade(1, 200)
      tick.value = reduced
        ? fade(1, 200)
        : withDelay(90, spring(1, { damping: 10, stiffness: 340 }), never)
    } else {
      fill.value = fade(0, 220)
      tick.value = fade(0, 140)
    }
  }, [shown, reduced, fill, tick])
  const cheer = () => {
    if (!reduced)
      scale.value = withSequence(
        never,
        fade(0.78, 80),
        spring(1, { damping: 6, stiffness: 300 }),
      )
    if (burst) setFire((n) => n + 1)
    flashRow?.(color)
  }
  const celebrated = useRef(celebrate)
  // Runs when the trigger goes up only.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (celebrate <= celebrated.current) {
      celebrated.current = celebrate
      return
    }
    celebrated.current = celebrate
    setShown(true)
    // A swipe already buzzed; one haptic per completion.
    if (!swipedRecently()) feel.success()
    cheer()
  }, [celebrate])
  const box = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  const sweep = useAnimatedStyle(() =>
    reduced
      ? { opacity: fill.value }
      : { opacity: fill.value, transform: [{ scale: fill.value }] },
  )
  const mark = useAnimatedStyle(() =>
    reduced
      ? { opacity: tick.value }
      : {
          opacity: Math.min(1, tick.value),
          transform: [
            { scale: 0.3 + tick.value * 0.7 },
            { rotate: `${(1 - tick.value) * -25}deg` },
          ],
        },
  )
  const press = () => {
    if (pending.current) return
    const next = !shown
    pending.current = true
    setShown(next)
    if (next) {
      feel.success()
      markCompletion()
      cheer()
    } else {
      feel.tap()
      if (!reduced)
        scale.value = withSequence(
          never,
          fade(0.9, 90),
          spring(1, { damping: 14, stiffness: 260 }),
        )
    }
    const commit = () => {
      pending.current = false
      onToggle()
    }
    // The timer is deliberately not cleared on unmount: the action must
    // still happen.
    if (beat <= 0) commit()
    else setTimeout(commit, beat)
  }
  const radius = square ? size / 4 : size / 2
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: shown }}
      onPress={press}
      hitSlop={6}
      style={{
        minWidth: 44,
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Burst fire={fire} color={color} size={size} />
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: radius,
            borderWidth: ring,
            borderColor: shown ? color : idle,
            alignItems: "center",
            justifyContent: "center",
          },
          box,
        ]}
      >
        <Animated.View
          testID="check-fill"
          style={[
            {
              position: "absolute",
              top: -ring,
              left: -ring,
              width: size,
              height: size,
              borderRadius: radius,
              backgroundColor: color,
            },
            sweep,
          ]}
        />
        {!square && !shown && progress > 0 && (
          <Svg
            width={size}
            height={size}
            style={{ position: "absolute", top: -ring, left: -ring }}
            pointerEvents="none"
          >
            <ArcCircle
              cx={size / 2}
              cy={size / 2}
              r={(size - ring) / 2}
              value={Math.min(1, progress)}
              stroke={color}
              strokeWidth={ring}
              strokeLinecap="round"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              duration={MOTION.progress}
            />
          </Svg>
        )}
        <Animated.View style={mark}>
          <Check
            size={Math.round(size * 0.55)}
            color={checkColor}
            strokeWidth={3}
          />
        </Animated.View>
      </Animated.View>
    </Pressable>
  )
}

/** A button or card that cheers when `fire` goes up: it pops (just the
 * burst's halo under Reduce Motion) with a burst drawn over it. */
export function Cheer({
  fire,
  color,
  size = 56,
  children,
  style,
}: {
  fire: number
  color: string
  size?: number
  children: ReactNode
  style?: ViewStyle
}) {
  const reduced = useReducedMotion()
  const scale = useSharedValue(1)
  const seen = useRef(fire)
  useEffect(() => {
    if (fire === seen.current) return
    seen.current = fire
    if (fire > 0 && !reduced)
      scale.value = withSequence(
        never,
        fade(0.94, 80),
        spring(1, { damping: 7, stiffness: 280 }),
      )
  }, [fire, reduced, scale])
  const pop = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  return (
    <Animated.View style={[style, pop]}>
      {children}
      <Burst fire={fire} color={color} size={size} />
    </Animated.View>
  )
}

/**
 * Content that pages between segmented options with a horizontal swipe; the
 * new page slides in from the side it was swiped toward.
 */
export function SwipeSegments<T extends string>({
  value,
  options,
  onChange,
  gap,
  children,
}: {
  value: T
  options: readonly T[]
  onChange: (value: T) => void
  /** Space between the page's children (they are stacked flush otherwise). */
  gap?: number
  children: ReactNode
}) {
  const reduced = useReducedMotion()
  const index = options.indexOf(value)
  // Direction of the last change, so the page slides in from that side.
  const prev = useRef(value)
  const dir = useRef<1 | -1>(1)
  if (prev.current !== value) {
    dir.current = index > options.indexOf(prev.current) ? 1 : -1
    prev.current = value
  }
  const path = usePathname()
  const step = (d: 1 | -1) => {
    const next = options[index + d]
    // Past the first/last segment, the swipe carries on to the next tab.
    if (!next) {
      if (stepTab(path, d)) feel.select()
      return
    }
    feel.select()
    onChange(next)
  }
  const pan = Gesture.Pan()
    .activeOffsetX([-28, 28])
    .failOffsetY([-14, 14])
    .onEnd((e) => {
      if (e.translationX < -60 || e.velocityX < -600) runOnJS(step)(1)
      else if (e.translationX > 60 || e.velocityX > 600) runOnJS(step)(-1)
    })
  // The new page slides in, or cross-fades under Reduce Motion.
  const entering = reduced
    ? FadeIn.duration(MOTION.fast).reduceMotion(never)
    : (dir.current > 0 ? SlideInRight : SlideInLeft)
        .duration(MOTION.base)
        .easing(easeOut)
  return (
    <GestureDetector gesture={pan}>
      <View collapsable={false}>
        <Animated.View key={value} entering={entering} style={{ gap }}>
          {children}
        </Animated.View>
      </View>
    </GestureDetector>
  )
}

/**
 * Swipe sideways to step a period (day/week/month). Activates sooner than
 * SwipeSegments so a calendar inside a paged screen keeps its own swipe.
 */
export function SwipeStep({
  stepKey,
  onStep,
  children,
}: {
  stepKey: string | number
  onStep: (direction: 1 | -1) => void
  children: ReactNode
}) {
  const reduced = useReducedMotion()
  const dir = useRef<1 | -1>(1)
  const step = (d: 1 | -1) => {
    dir.current = d
    feel.select()
    onStep(d)
  }
  const pan = Gesture.Pan()
    .activeOffsetX([-18, 18])
    .failOffsetY([-12, 12])
    .onEnd((e) => {
      if (e.translationX < -50 || e.velocityX < -500) runOnJS(step)(1)
      else if (e.translationX > 50 || e.velocityX > 500) runOnJS(step)(-1)
    })
  // The new page slides in, or cross-fades under Reduce Motion.
  const entering = reduced
    ? FadeIn.duration(MOTION.fast).reduceMotion(never)
    : (dir.current > 0 ? SlideInRight : SlideInLeft)
        .duration(MOTION.base)
        .easing(easeOut)
  return (
    <GestureDetector gesture={pan}>
      <View collapsable={false} style={{ overflow: "hidden" }}>
        <Animated.View key={stepKey} entering={entering}>
          {children}
        </Animated.View>
      </View>
    </GestureDetector>
  )
}

/** A chart bar that grows from the baseline when it first appears. */
export function GrowBar({
  height,
  index = 0,
  style,
  children,
}: {
  /** Points, or a percentage of the parent such as "40%". */
  height: number | `${number}%`
  index?: number
  style?: ViewStyle
  /** Drawn inside the growing box (the hand-drawn stem, ADR-0032). */
  children?: ReactNode
}) {
  const reduced = useReducedMotion()
  const pct = typeof height === "string"
  const target = pct ? Number.parseFloat(height) : height
  const h = useSharedValue(reduced ? target : 0)
  // Under Reduce Motion the bar is drawn at its height and fades in.
  const o = useSharedValue(reduced ? 0 : 1)
  useEffect(() => {
    const delay = Math.min(index, 12) * 35
    if (reduced) {
      h.value = target
      o.value = withDelay(delay, fade(1, MOTION.base), never)
      return
    }
    h.value = withDelay(
      delay,
      withTiming(target, {
        duration: MOTION.reveal * 0.7,
        easing: easeOut,
      }),
    )
  }, [target, index, reduced, h, o])
  const anim = useAnimatedStyle(() => ({
    opacity: o.value,
    height: pct ? (`${h.value}%` as `${number}%`) : h.value,
  }))
  return <Animated.View style={[style, anim]}>{children}</Animated.View>
}

/** Line/area charts sweep in left to right when they first appear (fade
 * in, whole, under Reduce Motion). */
export function Reveal({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion()
  const [width, setWidth] = useState(0)
  const p = useSharedValue(0)
  useEffect(() => {
    if (!width) return
    p.value = reduced
      ? fade(1, MOTION.base)
      : withTiming(1, { duration: MOTION.reveal, easing: easeOut })
  }, [width, reduced, p])
  const clip = useAnimatedStyle(() =>
    reduced ? { width, opacity: p.value } : { width: width * p.value },
  )
  return (
    <View
      style={{ width: "100%", height: "100%" }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {width > 0 ? (
        <Animated.View style={[{ overflow: "hidden", height: "100%" }, clip]}>
          <View style={{ width, height: "100%" }}>{children}</View>
        </Animated.View>
      ) : (
        <View style={{ opacity: 0, height: "100%" }}>{children}</View>
      )}
    </View>
  )
}
