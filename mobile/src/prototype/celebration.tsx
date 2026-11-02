// The finish moment for a workout, a run or walk, or a routine: the
// fiddlehead draws itself and settles, one quiet burst of leaves in the area
// colours, the numbers count up and the phone gives one success tap. A
// record set on the way (a run's best pace) lands as a line under it. It
// plays once per finished session; opened again later it shows settled,
// with no burst.

import { createStore } from "@domain/lib/store"
import {
  Activity,
  Check,
  Dumbbell,
  Footprints,
  Trophy,
} from "lucide-react-native"
import { type ComponentRef, useEffect, useRef, useState } from "react"
import { Text, View } from "react-native"
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated"
import Svg, { Path } from "react-native-svg"
import { FERN_PATHS } from "./companion/brand"
import { feel, MOTION, useCountUp } from "./motion"
import { Copy, Line } from "./native-kit"
import { anchor, type Box, Overlay } from "./overlay"
import { fonts, useTheme } from "./theme"

/** The workouts and runs already celebrated on this phone, newest last.
 * Device-local: a celebration is a moment here, never synced. */
export const celebrateStore = createStore("celebrated", () => ({
  ids: [] as string[],
}))
const KEEP = 50
export function markCelebrated(id: string) {
  celebrateStore.set((s) =>
    s.ids.includes(id) ? s : { ids: [...s.ids, id].slice(-KEEP) },
  )
}

/** Whether to play the celebration for ``id``: true on its first showing.
 * Decided once at mount, and the store is not subscribed to, so recording
 * the id cannot stop an animation that is still running. With ``enabled``
 * off (a page that never celebrates) it is false and records nothing. */
export function useCelebrate(id: string, enabled = true) {
  const [play] = useState(
    () => enabled && !celebrateStore.get().ids.includes(id),
  )
  useEffect(() => {
    if (enabled) markCelebrated(id)
  }, [id, enabled])
  return play
}

const LEAVES = 18
const BURST_MS = 1100
/** A leaf in a 10 × 16 box. */
const LEAF = "M5 0 C9 4 9 12 5 16 C1 12 1 4 5 0 Z"
/** The fiddlehead's strokes are shorter than this in its 24-unit box. */
const STROKE = 40
const AnimatedPath = Animated.createAnimatedComponent(Path)

type Leaf = {
  angle: number
  distance: number
  spin: number
  color: string
}

function Burst({ colors }: { colors: string[] }) {
  // Drawn once: re-renders while the burst runs never reshuffle it.
  const leaves = useRef<Leaf[]>(
    Array.from({ length: LEAVES }, (_, i) => ({
      angle: (i / LEAVES) * Math.PI * 2 + (Math.random() - 0.5) * 0.5,
      distance: 80 + Math.random() * 60,
      spin: (Math.random() - 0.5) * 540,
      color: colors[i % colors.length],
    })),
  ).current
  const progress = useSharedValue(0)
  const at = useRef<ComponentRef<typeof View>>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [live, setLive] = useState(true)
  useEffect(() => {
    if (at.current) anchor.measure(at.current, setBox)
    progress.value = withTiming(1, {
      duration: BURST_MS,
      easing: Easing.out(Easing.cubic),
    })
    const id = setTimeout(() => setLive(false), BURST_MS + 80)
    return () => clearTimeout(id)
  }, [progress])
  // Measured here, drawn in the top layer: nothing on the page covers it.
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
          <View
            testID="celebration-burst"
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              position: "absolute",
              left: box.x + box.width / 2,
              top: box.y + box.height / 2,
              width: 0,
              height: 0,
            }}
          >
            {leaves.map((leaf, i) => (
              <LeafView key={i} leaf={leaf} progress={progress} />
            ))}
          </View>
        </Overlay>
      )}
    </>
  )
}

function LeafView({
  leaf,
  progress,
}: {
  leaf: Leaf
  progress: SharedValue<number>
}) {
  const style = useAnimatedStyle(() => {
    const k = progress.value
    return {
      opacity: k < 0.6 ? 1 : Math.max(0, 1 - (k - 0.6) / 0.4),
      transform: [
        { translateX: Math.cos(leaf.angle) * leaf.distance * k },
        { translateY: Math.sin(leaf.angle) * leaf.distance * k },
        { rotate: `${leaf.spin * k}deg` },
        { scale: 0.6 + 0.4 * Math.min(1, k * 3) },
      ],
    }
  })
  return (
    <Animated.View
      testID="celebration-leaf"
      style={[
        { position: "absolute", left: -5, top: -8, width: 10, height: 16 },
        style,
      ]}
    >
      <Svg width={10} height={16} viewBox="0 0 10 16">
        <Path d={LEAF} fill={leaf.color} />
      </Svg>
    </Animated.View>
  )
}

/** The fiddlehead, its strokes drawing in when ``play`` is on. */
function UnfurlMark({
  color,
  play,
  size,
}: {
  color: string
  play: boolean
  size: number
}) {
  const offset = useSharedValue(play ? STROKE : 0)
  useEffect(() => {
    if (play)
      offset.value = withTiming(0, {
        duration: MOTION.reveal,
        easing: Easing.out(Easing.cubic),
      })
  }, [play, offset])
  const props = useAnimatedProps(() => ({ strokeDashoffset: offset.value }))
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {FERN_PATHS.map((d) => (
        <AnimatedPath
          key={d}
          d={d}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={[STROKE, STROKE]}
          animatedProps={props}
        />
      ))}
    </Svg>
  )
}

function StatValue({
  label,
  value,
  format,
  play,
  color,
}: {
  label: string
  value: number
  format: (n: number) => string
  play: boolean
  color: string
}) {
  const n = useCountUp(value),
    shown = play ? n : value
  return (
    <View
      style={{ flex: 1, alignItems: "center" }}
      accessible
      accessibilityLabel={`${label} ${format(value)}`}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{
          fontFamily: fonts.displayMedium,
          fontSize: 28,
          lineHeight: 34,
          color,
          fontVariant: ["tabular-nums"],
        }}
      >
        {format(shown)}
      </Text>
      <Copy size={12} muted>
        {label}
      </Copy>
    </View>
  )
}

export function Celebration({
  kind,
  title,
  subtitle,
  icon,
  stats,
  record,
  play,
}: {
  /** Picks the accent (fitness or habits) and the icon. */
  kind: "workout" | "run" | "walk" | "routine"
  title: string
  subtitle: string
  /** The routine's emoji; the others show their own icon. */
  icon?: string
  stats: { label: string; value: number; format: (n: number) => string }[]
  /** A record this session set: "Best pace yet · 5:12 /km". */
  record?: string
  /** True only on the first showing after finishing. */
  play: boolean
}) {
  const t = useTheme(),
    reduced = useReducedMotion(),
    moving = play && !reduced,
    accent = kind === "routine" ? t.hab : t.fit,
    Icon = kind === "run" ? Activity : kind === "walk" ? Footprints : Dumbbell,
    pop = useSharedValue(moving ? 0.9 : 1),
    badge = useSharedValue(moving ? 0 : 1)
  useEffect(() => {
    if (play) feel.success()
  }, [play])
  useEffect(() => {
    if (!moving) return
    pop.value = withDelay(MOTION.reveal, withSpring(1, MOTION.spring))
    badge.value = withDelay(MOTION.commit, withSpring(1, MOTION.spring))
  }, [moving, pop, badge])
  const popStyle = useAnimatedStyle(() => ({
      transform: [{ scale: pop.value }],
    })),
    badgeStyle = useAnimatedStyle(() => ({
      opacity: badge.value,
      transform: [{ scale: badge.value }],
    }))
  return (
    <View
      testID="celebration"
      style={{ alignItems: "center", gap: 8, paddingVertical: 16 }}
    >
      <View
        style={{
          width: 160,
          height: 120,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {moving && <Burst colors={[t.fit, t.hab, t.nut, t.tsk, t.fin]} />}
        <Animated.View
          style={[
            {
              width: 96,
              height: 96,
              borderRadius: 28,
              backgroundColor: `${accent}1f`,
              alignItems: "center",
              justifyContent: "center",
            },
            popStyle,
          ]}
        >
          <UnfurlMark color={accent} play={moving} size={72} />
          <View
            style={{
              position: "absolute",
              left: -8,
              top: -8,
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: t.card,
              borderWidth: 3,
              borderColor: t.bg,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {kind !== "routine" || !icon ? (
              <Icon size={16} color={accent} strokeWidth={2} />
            ) : (
              <Copy size={16}>{icon}</Copy>
            )}
          </View>
          <Animated.View
            style={[
              {
                position: "absolute",
                right: -8,
                bottom: -8,
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: t.good,
                borderWidth: 4,
                borderColor: t.bg,
                alignItems: "center",
                justifyContent: "center",
              },
              badgeStyle,
            ]}
          >
            <Check size={20} color={t.bg} strokeWidth={2.5} />
          </Animated.View>
        </Animated.View>
      </View>
      <Text
        accessibilityRole="header"
        style={{
          fontFamily: fonts.semibold,
          fontSize: 24,
          lineHeight: 30,
          color: t.text,
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      <Copy size={14} muted style={{ textAlign: "center" }}>
        {subtitle}
      </Copy>
      {record && (
        <Animated.View
          testID="celebration-record"
          style={[
            {
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 99,
              backgroundColor: `${t.good}1f`,
            },
            badgeStyle,
          ]}
        >
          <Trophy size={14} color={t.good} />
          <Text
            style={{
              fontFamily: fonts.semibold,
              fontSize: 13,
              lineHeight: 18,
              color: t.good,
              fontVariant: ["tabular-nums"],
            }}
          >
            {record}
          </Text>
        </Animated.View>
      )}
      {stats.length > 0 && (
        <Line style={{ gap: 12, marginTop: 12, alignSelf: "stretch" }}>
          {stats.map((x, i) => (
            <StatValue
              key={x.label}
              label={x.label}
              value={x.value}
              format={x.format}
              play={moving}
              color={i === 0 ? accent : t.text}
            />
          ))}
        </Line>
      )}
    </View>
  )
}
