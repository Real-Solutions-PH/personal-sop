// The finish moment for a workout, a run or walk, or a routine: Fern
// celebrates, one quiet burst of leaves in the area colours, the numbers
// count up and the medal's check lands. A record set on the way (a run's
// best pace) lands as a line under it. It plays every time the finish page
// opens, a second finish in the same session included; the success tap
// comes only on the first showing. Under Reduce Motion it still plays, as a
// dissolve: the leaves fade in and out where they land instead of flying,
// nothing scales, and the numbers still count up.

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
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated"
import Svg, { Path } from "react-native-svg"
import { FernCelebrates } from "./companion/fern-celebrates"
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

const known = (id: string) => celebrateStore.get().ids.includes(id)

/** The finish page's celebration for ``id``. ``play`` is ``enabled``: the
 * page celebrates every time it opens. ``first`` is true on the first
 * showing only, for the one success haptic. Recording the id never stops
 * an animation that is running. ``enabled`` may turn on after mount (the
 * run's completion reaches the store a beat after the page opens); the
 * first showing is decided then. With ``enabled`` off (a page that never
 * celebrates) nothing plays and nothing is recorded. */
export function useCelebrate(id: string, enabled = true) {
  const [first, setFirst] = useState(() => enabled && !known(id))
  const decided = useRef<string | null>(enabled ? id : null)
  useEffect(() => {
    if (!enabled) return
    if (decided.current !== id) {
      decided.current = id
      setFirst(!known(id))
    }
    markCelebrated(id)
  }, [id, enabled])
  return { play: enabled, first: enabled && first }
}

const LEAVES = 18
const BURST_MS = 1100
/** A leaf in a 10 × 16 box. */
const LEAF = "M5 0 C9 4 9 12 5 16 C1 12 1 4 5 0 Z"

type Leaf = {
  angle: number
  distance: number
  spin: number
  color: string
}

const never = ReduceMotion.Never

function Burst({ colors, calm }: { colors: string[]; calm: boolean }) {
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
    // Never skipped by Reduce Motion: there it draws the calm dissolve.
    progress.value = withTiming(1, {
      duration: BURST_MS,
      easing: Easing.out(Easing.cubic),
      reduceMotion: never,
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
              <LeafView key={i} leaf={leaf} progress={progress} calm={calm} />
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
  calm,
}: {
  leaf: Leaf
  progress: SharedValue<number>
  /** Reduce Motion: the leaf fades in and out where it lands, unmoving. */
  calm: boolean
}) {
  const style = useAnimatedStyle(() => {
    const k = progress.value
    if (calm)
      return {
        opacity: Math.sin(Math.PI * k),
        transform: [
          { translateX: Math.cos(leaf.angle) * leaf.distance * 0.8 },
          { translateY: Math.sin(leaf.angle) * leaf.distance * 0.8 },
          { rotate: `${leaf.spin * 0.25}deg` },
        ],
      }
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
  first = play,
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
  /** Plays the celebration: every time the finish page opens. */
  play: boolean
  /** The first showing of this finish: the one success haptic. */
  first?: boolean
}) {
  const t = useTheme(),
    reduced = useReducedMotion(),
    accent = kind === "routine" ? t.hab : t.fit,
    Icon = kind === "run" ? Activity : kind === "walk" ? Footprints : Dumbbell,
    pop = useSharedValue(play && !reduced ? 0.9 : 1),
    badge = useSharedValue(play ? 0 : 1)
  useEffect(() => {
    if (first) feel.success()
  }, [first])
  // Runs when the page opens celebrating, or when the finish lands a beat
  // after it opened. Never skipped by Reduce Motion: there the check fades
  // in where it stands instead of springing.
  useEffect(() => {
    if (!play) return
    badge.value = 0
    badge.value = withDelay(
      MOTION.commit,
      reduced
        ? withTiming(1, { duration: MOTION.base, reduceMotion: never })
        : withSpring(1, { ...MOTION.spring, reduceMotion: never }),
      never,
    )
    if (reduced) return
    pop.value = 0.9
    pop.value = withDelay(
      MOTION.reveal,
      withSpring(1, { ...MOTION.spring, reduceMotion: never }),
      never,
    )
  }, [play, reduced, pop, badge])
  const popStyle = useAnimatedStyle(() => ({
      transform: [{ scale: pop.value }],
    })),
    badgeStyle = useAnimatedStyle(() =>
      reduced
        ? { opacity: badge.value }
        : { opacity: badge.value, transform: [{ scale: badge.value }] },
    )
  return (
    <View
      testID="celebration"
      style={{ alignItems: "center", gap: 8, paddingVertical: 16 }}
    >
      <View
        style={{
          width: 160,
          height: 136,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {play && (
          <Burst colors={[t.fit, t.hab, t.nut, t.tsk, t.fin]} calm={reduced} />
        )}
        {/* Fern celebrates the finish, with what was finished beside it. */}
        <Animated.View
          style={[
            {
              width: 112,
              height: 112,
              alignItems: "center",
              justifyContent: "center",
            },
            popStyle,
          ]}
        >
          <FernCelebrates size={112} />
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
              play={play}
              color={i === 0 ? accent : t.text}
            />
          ))}
        </Line>
      )}
    </View>
  )
}
