import * as Haptics from "expo-haptics"
import { Check } from "lucide-react-native"
import { type ReactNode, useEffect, useRef, useState } from "react"
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
  FadeOut,
  LinearTransition,
  runOnJS,
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
} from "react-native-reanimated"
import { Circle } from "react-native-svg"

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
  /** How long a check stays visible in place before the row moves. */
  commit: 360,
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
}

const easeOut = Easing.out(Easing.cubic)

/** List rows glide to their new place when a list re-sorts or shrinks. */
export const rowLayout = LinearTransition.springify().damping(20).stiffness(220)
export const rowEnter = FadeIn.duration(MOTION.base)
export const rowExit = FadeOut.duration(MOTION.fast)

/** Count a number up (or down) to `value`, e.g. a score revealing itself. */
export function useCountUp(value: number, duration = MOTION.reveal) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(reduced ? value : 0)
  const from = useRef(reduced ? value : 0)
  useEffect(() => {
    if (reduced) {
      setShown(value)
      from.current = value
      return
    }
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
  }, [value, duration, reduced])
  return shown
}

export function CountUp({
  value,
  style,
  suffix,
}: {
  value: number | null
  style?: TextStyle
  suffix?: ReactNode
}) {
  const n = useCountUp(value ?? 0)
  return (
    <Text style={style}>
      {value === null ? "—" : Math.round(n)}
      {suffix}
    </Text>
  )
}

const AnimatedCircleSvg = Animated.createAnimatedComponent(Circle)

/** An SVG arc whose fill sweeps to `value` (0–1) on mount and on change. */
export function ArcCircle({
  value,
  r,
  cx,
  cy,
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
}) {
  const reduced = useReducedMotion()
  const c = 2 * Math.PI * r
  const p = useSharedValue(reduced ? value : 0)
  useEffect(() => {
    p.value = reduced
      ? value
      : withTiming(value, { duration: MOTION.reveal, easing: easeOut })
  }, [value, reduced, p])
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

/**
 * A completion check that answers instantly — pop, fill and haptic — then
 * commits after a short beat so the user sees the result before the row
 * moves or re-sorts.
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
}) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(checked)
  const pending = useRef(false)
  useEffect(() => {
    if (!pending.current) setShown(checked)
  }, [checked])
  const scale = useSharedValue(1)
  const tick = useSharedValue(checked ? 1 : 0)
  useEffect(() => {
    tick.value = reduced
      ? shown
        ? 1
        : 0
      : withSpring(shown ? 1 : 0, { damping: 14, stiffness: 320 })
  }, [shown, reduced, tick])
  const box = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  const mark = useAnimatedStyle(() => ({
    opacity: tick.value,
    transform: [{ scale: 0.4 + tick.value * 0.6 }],
  }))
  const press = () => {
    if (pending.current) return
    const next = !shown
    pending.current = true
    setShown(next)
    if (next) feel.success()
    else feel.tap()
    if (!reduced)
      scale.value = withSequence(
        withTiming(0.82, { duration: 90 }),
        withSpring(1, { damping: 9, stiffness: 300 }),
      )
    const commit = () => {
      pending.current = false
      onToggle()
    }
    // Reduced motion commits at once. Otherwise the timer is deliberately not
    // cleared on unmount: the action must still happen.
    if (reduced) commit()
    else setTimeout(commit, MOTION.commit)
  }
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
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: square ? size / 4 : size / 2,
            borderWidth: ring,
            borderColor: shown ? color : idle,
            backgroundColor: shown ? color : "transparent",
            alignItems: "center",
            justifyContent: "center",
          },
          box,
        ]}
      >
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

/**
 * Content that pages between segmented options with a horizontal swipe; the
 * new page slides in from the side it was swiped toward.
 */
export function SwipeSegments<T extends string>({
  value,
  options,
  onChange,
  children,
}: {
  value: T
  options: readonly T[]
  onChange: (value: T) => void
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
  const step = (d: 1 | -1) => {
    const next = options[index + d]
    if (!next) return
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
  const entering = reduced
    ? undefined
    : (dir.current > 0 ? SlideInRight : SlideInLeft)
        .duration(MOTION.base)
        .easing(easeOut)
  return (
    <GestureDetector gesture={pan}>
      <View collapsable={false}>
        <Animated.View key={value} entering={entering}>
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
  const entering = reduced
    ? undefined
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
}: {
  /** Points, or a percentage of the parent such as "40%". */
  height: number | `${number}%`
  index?: number
  style?: ViewStyle
}) {
  const reduced = useReducedMotion()
  const pct = typeof height === "string"
  const target = pct ? Number.parseFloat(height) : height
  const h = useSharedValue(reduced ? target : 0)
  useEffect(() => {
    h.value = reduced
      ? target
      : withDelay(
          Math.min(index, 12) * 35,
          withTiming(target, {
            duration: MOTION.reveal * 0.7,
            easing: easeOut,
          }),
        )
  }, [target, index, reduced, h])
  const anim = useAnimatedStyle(() => ({
    height: pct ? (`${h.value}%` as `${number}%`) : h.value,
  }))
  return <Animated.View style={[style, anim]} />
}

/** Line/area charts sweep in left to right when they first appear. */
export function Reveal({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion()
  const [width, setWidth] = useState(0)
  const p = useSharedValue(reduced ? 1 : 0)
  useEffect(() => {
    if (!width || reduced) return
    p.value = withTiming(1, { duration: MOTION.reveal, easing: easeOut })
  }, [width, reduced, p])
  const clip = useAnimatedStyle(() => ({ width: width * p.value }))
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
