// The boot animation. It starts on the native splash's exact frame (the
// whole mark, at rest): the frond curls back into its spiral and unfurls,
// leaflets last, then sways from its foot until the app is ready, and is
// ended by the boot screen at the end of a sway.
import { useEffect } from "react"
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated"
import Svg, { Path } from "react-native-svg"
import {
  COIL,
  FOOT,
  HIGH_LEAF,
  LEAF_LENGTH,
  LOW_LEAF,
  MARK_BOX,
  STEM,
  STEM_LENGTH,
  UNIT,
} from "./geometry"

/** "rest" holds the splash frame: Reduce Motion is on. */
export type Stage = "rest" | "intro" | "loop" | "exit"

/** Milliseconds the intro takes, one sway, and the fade to the app. */
export const TIMING = { intro: 980, loop: 1800, exit: 260 }

const AnimatedPath = Animated.createAnimatedComponent(Path)
const out = Easing.out(Easing.cubic)
const hold = (value: number, ms: number) => withTiming(value, { duration: ms })

/** A point in mark units as a transform origin in points. */
const origin = ([x, y]: [number, number]) => [x * UNIT, y * UNIT, 0]

/** Draw-on as a stroke offset: 0 hidden, 1 whole. */
function useDrawn(drawn: SharedValue<number>, length: number) {
  return useAnimatedProps(() => ({
    strokeDashoffset: (1 - drawn.value) * (length + 1),
  }))
}

type MarkProps = {
  color: string
  stem?: Partial<{ strokeDashoffset: number }>
  low?: Partial<{ strokeDashoffset: number }>
  high?: Partial<{ strokeDashoffset: number }>
}
/** The fiddlehead at splash size, each stroke animatable on its own. */
function Mark({ color, stem, low, high }: MarkProps) {
  const stroke = {
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    fill: "none",
  }
  return (
    <Svg width={MARK_BOX} height={MARK_BOX} viewBox="0 0 24 24">
      <AnimatedPath
        d={STEM}
        {...stroke}
        strokeLinejoin="round"
        strokeDasharray={[STEM_LENGTH, STEM_LENGTH + 2]}
        animatedProps={stem}
      />
      <AnimatedPath
        d={LOW_LEAF}
        {...stroke}
        strokeDasharray={[LEAF_LENGTH, LEAF_LENGTH + 2]}
        animatedProps={low}
      />
      <AnimatedPath
        d={HIGH_LEAF}
        {...stroke}
        strokeDasharray={[LEAF_LENGTH, LEAF_LENGTH + 2]}
        animatedProps={high}
      />
    </Svg>
  )
}

const box = { width: MARK_BOX, height: MARK_BOX }

export function UnfurlMark({ stage, color }: { stage: Stage; color: string }) {
  const trim = useSharedValue(0)
  const turn = useSharedValue(0)
  const leaves = useSharedValue(1)
  const sway = useSharedValue(0)
  useEffect(() => {
    if (stage === "intro") {
      trim.value = withSequence(
        withTiming(0.62, { duration: 260, easing: Easing.in(Easing.quad) }),
        withTiming(0, { duration: 720, easing: out }),
      )
      turn.value = withSequence(
        withTiming(-40, { duration: 260, easing: Easing.in(Easing.quad) }),
        withTiming(0, { duration: 720, easing: Easing.out(Easing.back(1.6)) }),
      )
      leaves.value = withSequence(
        withTiming(0, { duration: 160 }),
        hold(0, 560),
        withTiming(1, { duration: 280, easing: out }),
      )
    }
    if (stage === "loop")
      sway.value = withRepeat(
        withSequence(
          withTiming(5, { duration: 900, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 900, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
      )
  }, [stage, trim, turn, leaves, sway])
  const stem = useAnimatedProps(() => ({
    strokeDashoffset: -trim.value * STEM_LENGTH,
  }))
  const leaf = useDrawn(leaves, LEAF_LENGTH)
  const swayStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${sway.value}deg` }],
  }))
  const turnStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value}deg` }],
  }))
  return (
    <Animated.View style={[box, { transformOrigin: origin(FOOT) }, swayStyle]}>
      <Animated.View
        style={[box, { transformOrigin: origin(COIL) }, turnStyle]}
      >
        <Mark color={color} stem={stem} low={leaf} high={leaf} />
      </Animated.View>
    </Animated.View>
  )
}
