// The day as hour rows for time blocking: every planned item sits at its
// time, and a habit, routine or task is moved by long-pressing it and
// dragging it to another quarter hour. A habit or routine moves for that day
// only (its own schedule stays), a recurring task's occurrence likewise, and
// a one-off task's due time moves. Workouts, focus sessions and bills are
// records, shown where they happened, and stay put.

import type { CalendarItem } from "@domain/contract"
import { AREA } from "@domain/dash/data"
import { moveItem, resetItem } from "@domain/schedule/actions"
import {
  clockOf,
  DAY_FIRST_MIN,
  DAY_LAST_MIN,
  dayMinutes,
  itemRef,
  SNAP_MIN,
  snapMinutes,
} from "@domain/schedule/logic"
import { Check, Undo2 } from "lucide-react-native"
import { useContext, useEffect, useRef, useState } from "react"
import { Pressable, useWindowDimensions, View } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { feel, MOTION } from "../motion"
import { Copy, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { PageNudge, ScrollLock } from "../ui"

/** Points per minute: an hour row is 64 pt, a quarter hour 16. */
const PX = 64 / 60
/** How long a block reads as, for laying out neighbours side by side. */
const SPAN_MIN = 30
const BLOCK_MIN_H = SPAN_MIN * PX - 2
const GUTTER = 48
/** How deep the zones are, inside the page's visible part, where a held
 * block scrolls it. */
const EDGE = 80
/** The page header above the content and the tab bar under it. */
const HEADER = 56
const TAB_BAR = 64

const label12 = (min: number) => {
  const [h, m] = clockOf(min).split(":").map(Number)
  const hr = h % 12 || 12
  return m ? `${hr}:${String(m).padStart(2, "0")}` : `${hr}`
}
const ampm = (min: number) => (Math.floor(min / 60) % 24 < 12 ? "AM" : "PM")
/** "9 AM", "2:30 PM". */
export const timeLabel = (min: number) => `${label12(min)} ${ampm(min)}`

/** Draggable: a habit, routine or task not yet done. */
const movable = (i: CalendarItem) => !i.done && itemRef(i) !== null

interface Placed {
  item: CalendarItem
  min: number
  lane: number
  lanes: number
}

/** Side by side when their half hours overlap, as many lanes as needed. */
export function layout(items: readonly CalendarItem[]): Placed[] {
  const timed = items
    .filter((i) => i.time)
    .map((item) => ({ item, min: dayMinutes(item.time as string) }))
    .sort((a, b) => a.min - b.min)
  const out: Placed[] = []
  let cluster: Placed[] = [],
    end = -1
  const close = () => {
    const lanes = Math.max(1, ...cluster.map((p) => p.lane + 1))
    for (const p of cluster) out.push({ ...p, lanes })
    cluster = []
  }
  for (const t of timed) {
    if (t.min >= end && cluster.length) close()
    const busy = new Set(
      cluster.filter((p) => p.min + SPAN_MIN > t.min).map((p) => p.lane),
    )
    let lane = 0
    while (busy.has(lane)) lane++
    cluster.push({ ...t, lane, lanes: 1 })
    end = Math.max(end, t.min + SPAN_MIN)
  }
  if (cluster.length) close()
  return out
}

/** The whole business day, 4 AM to 4 AM: anywhere a block can land. */
const DAY_FROM = DAY_FIRST_MIN,
  DAY_TO = DAY_FIRST_MIN + 24 * 60

export function DayGrid({
  items,
  nowMin,
}: {
  items: readonly CalendarItem[]
  /** Minutes on the business day now, when the day shown is today. */
  nowMin?: number
}) {
  const t = useTheme()
  const [width, setWidth] = useState(0)
  const placed = layout(items)
  const from = DAY_FROM,
    to = DAY_TO
  const hours = Array.from(
    { length: (to - from) / 60 },
    (_, k) => from + k * 60,
  )
  const lane = width ? width - GUTTER - 4 : 0
  return (
    <View
      testID="plan-day-grid"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height: (to - from) * PX + 8, marginTop: 4 }}
    >
      {hours.map((h) => (
        <View
          key={h}
          pointerEvents="none"
          style={{
            position: "absolute",
            top: (h - from) * PX,
            left: 0,
            right: 0,
            flexDirection: "row",
            alignItems: "flex-start",
          }}
        >
          <Copy
            size={12}
            muted
            style={{ width: GUTTER, marginTop: -8, lineHeight: 16 }}
          >
            {timeLabel(h)}
          </Copy>
          <View
            style={{
              flex: 1,
              height: 1,
              backgroundColor: t.line,
              opacity: 0.6,
            }}
          />
        </View>
      ))}
      {nowMin !== undefined && nowMin >= from && nowMin <= to && (
        <View
          pointerEvents="none"
          accessibilityLabel={`Now, ${timeLabel(nowMin)}`}
          style={{
            position: "absolute",
            top: (nowMin - from) * PX - 1,
            left: GUTTER - 4,
            right: 0,
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: t.primary,
            }}
          />
          <View style={{ flex: 1, height: 2, backgroundColor: t.primary }} />
        </View>
      )}
      {lane > 0 &&
        placed.map((p) => (
          <Block
            key={p.item.id}
            placed={p}
            top={(p.min - from) * PX}
            left={GUTTER + (lane / p.lanes) * p.lane}
            width={lane / p.lanes - 4}
          />
        ))}
    </View>
  )
}

function Block({
  placed,
  top,
  left,
  width,
}: {
  placed: Placed
  top: number
  left: number
  width: number
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const lock = useContext(ScrollLock)
  const nudge = useContext(PageNudge)
  const screen = useWindowDimensions().height
  const insets = useSafeAreaInsets()
  // The page's visible part, in window points: zones sit just inside it.
  const topZone = insets.top + HEADER + EDGE,
    bottomZone = screen - insets.bottom - TAB_BAR - EDGE
  const { item, min } = placed
  const accent = t[AREA[item.module].accent]
  const canMove = movable(item)
  const y = useSharedValue(top)
  const lifted = useSharedValue(0)
  const scale = useSharedValue(1)
  const slot = useSharedValue(min)
  // The finger's travel and how far the page has scrolled under it since
  // the lift: the block sits at their sum below where it started.
  const travel = useSharedValue(0)
  const scrolled = useSharedValue(0)
  const [target, setTarget] = useState<number | null>(null)
  // On web the release that ends a drag is also a click: it must not open
  // the item. Cleared on the next press-in.
  const dragged = useRef(false)
  const markDragged = () => {
    dragged.current = true
  }
  // A new time from anywhere (a drop here, a reset, a pull): slide there.
  useEffect(() => {
    if (lifted.value) return
    y.value = reduced ? top : withTiming(top, { duration: 180 })
  }, [top, reduced, y, lifted])

  // Anywhere on the business day the grid shows.
  const lo = DAY_FIRST_MIN,
    hi = DAY_LAST_MIN
  /** The quarter hour the block is over, ``offset`` points below its start. */
  const slotAt = (offset: number) => {
    "worklet"
    const raw = Math.round((min + offset / PX) / SNAP_MIN) * SNAP_MIN
    return Math.min(hi, Math.max(lo, raw))
  }
  // Held near the top or bottom of the screen, the page scrolls under the
  // block (the page itself is locked while it is lifted).
  const edge = useRef<{
    dir: number
    speed: number
    timer?: ReturnType<typeof setInterval>
  }>({ dir: 0, speed: 0 })
  /** Never above the day's first quarter hour or below its last. */
  const clampOffset = (offset: number) => {
    "worklet"
    return Math.min((hi - min) * PX, Math.max((lo - min) * PX, offset))
  }
  // ``depth``: -1..1, how far into the top (negative) or bottom edge zone
  // the finger is; deeper scrolls faster. Stops at the day's ends.
  const setEdge = (depth: number) => {
    const dir = Math.sign(depth)
    edge.current.speed = 2 + Math.abs(depth) * 6
    if (dir === edge.current.dir) return
    edge.current.dir = dir
    if (edge.current.timer) clearInterval(edge.current.timer)
    edge.current.timer = undefined
    if (!dir) return
    edge.current.timer = setInterval(() => {
      if ((dir > 0 && slot.value >= hi) || (dir < 0 && slot.value <= lo)) return
      const moved = nudge(dir * edge.current.speed)
      if (!moved) return
      scrolled.value += moved
      const offset = clampOffset(travel.value + scrolled.value)
      y.value = top + offset
      const next = slotAt(offset)
      if (next !== slot.value) {
        slot.value = next
        feel.select()
        setTarget(next)
      }
    }, 16)
  }
  useEffect(
    () => () => {
      if (edge.current.timer) clearInterval(edge.current.timer)
    },
    [],
  )
  const drop = (to: number) => {
    setEdge(0)
    lock(false)
    setTarget(null)
    if (to === min) {
      y.value = reduced ? top : withTiming(top, { duration: 160 })
      return
    }
    const outcome = moveItem(item, clockOf(to))
    if (outcome === "fixed") {
      feel.warning()
      y.value = reduced ? top : withTiming(top, { duration: 160 })
      return
    }
    // Landed: a firm tap and a small settle where it now sits.
    feel.impact()
    if (!reduced)
      scale.value = withSequence(
        withTiming(1.04, { duration: 90 }),
        withSpring(1, MOTION.spring),
      )
  }
  const pan = Gesture.Pan()
    .enabled(canMove)
    .activateAfterLongPress(300)
    .onStart(() => {
      lifted.value = 1
      slot.value = min
      travel.value = 0
      scrolled.value = 0
      runOnJS(lock)(true)
      runOnJS(markDragged)()
      runOnJS(feel.impact)()
      runOnJS(setTarget)(min)
    })
    .onUpdate((e) => {
      // The block follows the finger; the time it would land on snaps.
      travel.value = e.translationY
      const offset = clampOffset(e.translationY + scrolled.value)
      y.value = top + offset
      const depth =
        e.absoluteY < topZone
          ? -Math.min(1, (topZone - e.absoluteY) / EDGE)
          : e.absoluteY > bottomZone
            ? Math.min(1, (e.absoluteY - bottomZone) / EDGE)
            : 0
      runOnJS(setEdge)(depth)
      const next = slotAt(offset)
      if (next !== slot.value) {
        slot.value = next
        runOnJS(feel.select)()
        runOnJS(setTarget)(next)
      }
    })
    .onEnd(() => {
      const to = slot.value
      y.value = reduced
        ? top + (to - min) * PX
        : withTiming(top + (to - min) * PX, { duration: 140 })
      lifted.value = 0
      runOnJS(drop)(to)
    })
    .onFinalize((_e, ok) => {
      if (ok) return
      lifted.value = 0
      runOnJS(setEdge)(0)
      runOnJS(lock)(false)
      runOnJS(setTarget)(null)
    })
  const style = useAnimatedStyle(() => ({
    top: y.value,
    zIndex: lifted.value ? 20 : 1,
    shadowOpacity: lifted.value ? 0.22 : 0,
    transform: [{ scale: lifted.value && !reduced ? 1.03 : scale.value }],
  }))
  const step = (d: number) => {
    const to = snapMinutes(min + d * SNAP_MIN)
    if (to < lo || to > hi || to === min) return
    feel.select()
    moveItem(item, clockOf(to))
  }
  const movedFrom = item.movedFrom
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left,
          width,
          minHeight: BLOCK_MIN_H,
          // Opaque, so the hour lines never show through a block.
          borderRadius: 8,
          backgroundColor: t.card,
          shadowColor: "#000",
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
        },
        style,
      ]}
    >
      <View
        style={{
          flexGrow: 1,
          minHeight: BLOCK_MIN_H,
          borderRadius: 8,
          borderLeftWidth: 3,
          borderLeftColor: accent,
          backgroundColor: `${accent}26`,
        }}
      >
        <GestureDetector gesture={pan}>
          {/* One pressable carries the open tap, the drag and the screen
            reader's actions: a button inside a button is invalid on web. */}
          <Pressable
            cssInterop={false}
            accessibilityRole={canMove ? "adjustable" : "button"}
            accessibilityLabel={`${item.title}, ${timeLabel(min)}${
              movedFrom !== undefined ? ", moved for this day" : ""
            }`}
            accessibilityHint={
              canMove
                ? "Hold and drag to move it. Swipe up or down to move it 15 minutes."
                : undefined
            }
            accessibilityActions={
              canMove
                ? [
                    { name: "increment", label: "15 minutes later" },
                    { name: "decrement", label: "15 minutes earlier" },
                    { name: "activate", label: "Open" },
                  ]
                : [{ name: "activate", label: "Open" }]
            }
            onAccessibilityAction={(e) => {
              const a = e.nativeEvent.actionName
              if (a === "increment") step(1)
              else if (a === "decrement") step(-1)
              else go(item.href)
            }}
            onPressIn={() => {
              dragged.current = false
            }}
            onPress={() => {
              if (!dragged.current) go(item.href)
            }}
          >
            <Line
              style={{
                gap: 6,
                alignItems: "flex-start",
                paddingVertical: 4,
                paddingLeft: 6,
                paddingRight: 4,
              }}
            >
              <View style={{ flex: 1, gap: 1 }}>
                <Copy
                  size={12}
                  weight="medium"
                  style={{
                    color: item.done ? t.muted : t.text,
                    textDecorationLine: item.done ? "line-through" : "none",
                  }}
                >
                  {item.title}
                </Copy>
                {target !== null && (
                  <Copy size={12} weight="semibold" style={{ color: accent }}>
                    {timeLabel(target)}
                  </Copy>
                )}
              </View>
              {item.done && (
                <Check size={14} color={t.good} style={{ marginTop: 1 }} />
              )}
            </Line>
          </Pressable>
        </GestureDetector>
        {/* Beside the pressable, never inside it (no button in a button). */}
        {movedFrom !== undefined && target === null && (
          <View style={{ paddingLeft: 4, paddingBottom: 4 }}>
            <MovedMark item={item} from={movedFrom} />
          </View>
        )}
      </View>
    </Animated.View>
  )
}

/** "Moved for this day": the time it had, struck through, and a tap back. */
export function MovedMark({
  item,
  from,
}: {
  item: CalendarItem
  from: string | null
}) {
  const t = useTheme()
  const was = from ? timeLabel(dayMinutes(from)) : "no time"
  return (
    <Tap
      label={`Moved for this day from ${was}. Reset`}
      onPress={() => {
        if (resetItem(item)) feel.select()
      }}
      style={{
        alignSelf: "flex-start",
        minHeight: 24,
        paddingHorizontal: 6,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        backgroundColor: t.soft,
      }}
    >
      <Undo2 size={12} color={t.muted} />
      {from && (
        <Copy size={12} muted style={{ textDecorationLine: "line-through" }}>
          {label12(dayMinutes(from))}
        </Copy>
      )}
    </Tap>
  )
}
