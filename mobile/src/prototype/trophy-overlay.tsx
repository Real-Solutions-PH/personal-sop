// A trophy earned in the last two days that the person has not seen yet is
// presented over whatever screen is open: a medal rising in, its ring
// sweeping round, then its title and detail. Trophies are derived on read,
// so a new one is noticed by diffing the achievements the device already
// refetches after every sync against the trophies marked seen.
import {
  type Trophy,
  type TrophyType,
  trophyFrom,
  useTrophies,
} from "@domain/dash/hooks"
import {
  type ServerAchievements,
  statKey,
  useServerStat,
} from "@domain/dash/server-stats"
import { dashStore, markTrophiesSeen } from "@domain/dash/store"
import { captureUi } from "@domain/lib/capture"
import { dayOffset } from "@domain/lib/day"
import { usePathname } from "expo-router"
import { Award } from "lucide-react-native"
import { type ComponentRef, useEffect, useMemo, useRef, useState } from "react"
import {
  AccessibilityInfo,
  AppState,
  findNodeHandle,
  Pressable,
  Text,
  View,
} from "react-native"
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated"
import Svg from "react-native-svg"
import { prototypeMode } from "./mode"
import { ArcCircle, alpha, feel, MOTION, Shimmer } from "./motion"
import { Copy } from "./native-kit"
import { go } from "./navigation"
import { fonts, useTheme } from "./theme"
import { Button } from "./ui"

/** At most this many present in a row; the last offers the Trophy case. */
const SHOWN = 3
const GAP = 400
const LAND = 650
const COLORS: Record<TrophyType, "fit" | "life" | "hab" | "fin" | "tsk"> = {
  pr: "fit",
  streak: "life",
  best: "hab",
  goal: "fin",
  first: "tsk",
}

/** Before the first change event the state can still be unknown; only a
 * backgrounded or inactive app holds a trophy back. */
const foreground = (s: string | null | undefined) =>
  s !== "background" && s !== "inactive"

/** Presented once per launch, whatever later responses say. */
const presented = new Set<string>()
/** For tests: forget what this launch presented. */
export const resetPresented = () => presented.clear()

/** Trophies to present now, oldest first: unseen, not yet presented this
 * launch, and dated today or yesterday (records are dated the day before). */
export function newTrophies(trophies: Trophy[], seen: string[]): Trophy[] {
  const from = dayOffset(-1)
  const known = new Set(seen)
  return trophies
    .filter((x) => !known.has(x.id) && !presented.has(x.id) && x.day >= from)
    .sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id))
}

/** Mounted once at the shell. The live variant reads the server's
 * achievements (a watched stat, so it refetches after each sync); the
 * prototype one computes them on the device. Chosen once, so the costly
 * local computation never runs at the shell in live mode. */
export function TrophyWatcher({ hidden = false }: { hidden?: boolean }) {
  return prototypeMode ? (
    <LocalWatcher hidden={hidden} />
  ) : (
    <ServerWatcher hidden={hidden} />
  )
}
function ServerWatcher({ hidden }: { hidden: boolean }) {
  const stat = useServerStat<ServerAchievements>(statKey.achievements())
  const trophies = useMemo(
    () => stat.data?.trophies.map(trophyFrom),
    [stat.data],
  )
  return <TrophyQueue trophies={trophies} hidden={hidden} />
}
function LocalWatcher({ hidden }: { hidden: boolean }) {
  return <TrophyQueue trophies={useTrophies()} hidden={hidden} />
}

/** Picks what to present and presents it one at a time. */
export function TrophyQueue({
  trophies,
  hidden = false,
}: {
  /** Undefined until a successful load: nothing presents meanwhile. */
  trophies: Trophy[] | undefined
  hidden?: boolean
}) {
  const seen = dashStore.use((s) => s.seenTrophies)
  const path = usePathname()
  const drawer = captureUi.use((s) => s.open)
  const [active, setActive] = useState(foreground(AppState.currentState))
  // One check's worth: up to three to show, every id that qualified.
  const [run, setRun] = useState<{ items: Trophy[]; ids: string[] } | null>(
    null,
  )
  const [index, setIndex] = useState(0)
  const [showing, setShowing] = useState(true)
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) =>
      setActive(foreground(s)),
    )
    return () => sub.remove()
  }, [])
  // The Trophy case shows and marks them itself; the rest wait their turn.
  const suppressed =
    hidden || drawer || !active || path.startsWith("/stats/trophies")
  useEffect(() => {
    if (run || suppressed || !trophies) return
    const due = newTrophies(trophies, seen)
    if (!due.length) return
    for (const x of due) presented.add(x.id)
    setRun({ items: due.slice(0, SHOWN), ids: due.map((x) => x.id) })
    setIndex(0)
    setShowing(true)
  }, [run, suppressed, trophies, seen])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  if (!run || suppressed) return null
  const current = run.items[index]
  const last = index === run.items.length - 1
  const more = run.ids.length > run.items.length
  const finish = () => {
    markTrophiesSeen(run.ids)
    setRun(null)
  }
  const next = () => {
    markTrophiesSeen([current.id])
    if (last) return finish()
    setShowing(false)
    timer.current = setTimeout(() => {
      // A trophy gone from a later response (its log undone) is skipped.
      const live = new Set(trophies?.map((x) => x.id))
      let i = index + 1
      while (i < run.items.length - 1 && !live.has(run.items[i].id)) i++
      setIndex(i)
      setShowing(true)
    }, GAP)
  }
  if (!showing) return null
  return (
    <TrophyReveal
      key={current.id}
      trophy={current}
      onNice={next}
      secondary={
        last && more
          ? {
              label: `See all ${run.ids.length} new`,
              onPress: () => {
                finish()
                go("/stats/trophies")
              },
            }
          : {
              label: "View",
              onPress: () => {
                markTrophiesSeen(last ? run.ids : [current.id])
                setRun(null)
                go(`/stats/trophies?open=${current.id}`)
              },
            }
      }
    />
  )
}

/** The medal reveal itself, over everything, until dismissed. */
export function TrophyReveal({
  trophy,
  onNice,
  secondary,
}: {
  trophy: Trophy
  onNice: () => void
  secondary: { label: string; onPress: () => void }
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const tint = t[COLORS[trophy.type]]
  const [landed, setLanded] = useState(reduced)
  const rise = useSharedValue(reduced ? 1 : 0)
  const title = useRef<ComponentRef<typeof Text>>(null)
  useEffect(() => {
    const say = `Trophy earned: ${trophy.title}. ${trophy.detail}`
    const land = () => {
      setLanded(true)
      feel.success()
      const node = findNodeHandle(title.current)
      if (node) AccessibilityInfo.setAccessibilityFocus(node)
      AccessibilityInfo.announceForAccessibility(say)
    }
    if (reduced) {
      land()
      return
    }
    rise.value = withSpring(1, { damping: 14, stiffness: 90, mass: 1 })
    const id = setTimeout(land, LAND)
    return () => clearTimeout(id)
  }, [reduced, rise, trophy.title, trophy.detail])
  const medal = useAnimatedStyle(() => ({
    opacity: Math.min(1, rise.value * 1.5),
    transform: [
      { translateY: 24 * (1 - rise.value) },
      { scale: 0.6 + 0.4 * rise.value },
    ],
  }))
  // Text follows the medal, 150 ms apart; nothing moves under Reduce Motion.
  const enter = (i: number) =>
    reduced ? undefined : FadeIn.delay(i * 150).duration(MOTION.base)
  return (
    <Animated.View
      testID="trophy-overlay"
      accessibilityViewIsModal
      entering={FadeIn.duration(reduced ? 200 : 320)}
      exiting={FadeOut.duration(reduced ? 200 : MOTION.base)}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100,
        elevation: 100,
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
      }}
    >
      <Pressable
        accessibilityLabel="Dismiss"
        onPress={onNice}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: alpha(t.bg, 0.85),
        }}
      />
      <Animated.View style={[{ width: 136, height: 136 }, medal]}>
        <View
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            width: 120,
            height: 120,
            borderRadius: 60,
            overflow: "hidden",
            backgroundColor: tint,
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
          }}
        >
          <Award size={44} color={t.onPrimary} strokeWidth={2.2} />
          <Copy size={18} weight="semibold" style={{ color: t.onPrimary }}>
            {trophy.value}
          </Copy>
          {landed && !reduced && <Shimmer />}
        </View>
        {landed && (
          <Svg
            width={136}
            height={136}
            style={{ position: "absolute", top: 0, left: 0 }}
            pointerEvents="none"
          >
            <ArcCircle
              cx={68}
              cy={68}
              r={65}
              value={1}
              stroke={tint}
              strokeWidth={3}
              strokeLinecap="round"
              transform="rotate(-90 68 68)"
              duration={MOTION.reveal}
            />
          </Svg>
        )}
      </Animated.View>
      {landed && (
        <View style={{ alignItems: "center", gap: 8, marginTop: 24 }}>
          <Animated.View entering={enter(0)}>
            <Copy
              size={12}
              weight="medium"
              muted
              style={{ letterSpacing: 0.8, textAlign: "center" }}
            >
              TROPHY EARNED
            </Copy>
          </Animated.View>
          <Animated.View entering={enter(1)}>
            <Text
              ref={title}
              accessibilityRole="header"
              style={{
                fontFamily: fonts.display,
                fontSize: 26,
                color: t.text,
                textAlign: "center",
              }}
            >
              {trophy.title}
            </Text>
          </Animated.View>
          <Animated.View entering={enter(2)}>
            <Copy size={15} muted style={{ textAlign: "center" }}>
              {trophy.detail}
            </Copy>
          </Animated.View>
          <Animated.View
            entering={enter(3)}
            style={{ flexDirection: "row", gap: 12, marginTop: 16 }}
          >
            <Button tone="quiet" onPress={secondary.onPress}>
              {secondary.label}
            </Button>
            <Button onPress={onNice}>Nice</Button>
          </Animated.View>
        </View>
      )}
    </Animated.View>
  )
}
