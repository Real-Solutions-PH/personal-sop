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
import { useContext, useEffect, useState } from "react"
import { View } from "react-native"
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
import { feel, MOTION } from "../motion"
import { Copy, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { ScrollLock } from "../ui"

/** Points per minute: an hour row is 64 pt, a quarter hour 16. */
const PX = 64 / 60
/** How long a block reads as, for laying out neighbours side by side. */
const SPAN_MIN = 30
const BLOCK_MIN_H = SPAN_MIN * PX - 2
const GUTTER = 48

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

/** The hours shown: 6 AM to midnight, stretched to every timed item. */
function hourRange(placed: Placed[]) {
  const mins = placed.map((p) => p.min)
  const first = Math.min(6 * 60, ...mins)
  const last = Math.max(24 * 60, ...mins.map((m) => m + 60))
  return {
    from: Math.max(DAY_FIRST_MIN, Math.floor(first / 60) * 60),
    to: Math.min(DAY_FIRST_MIN + 24 * 60, Math.ceil(last / 60) * 60),
  }
}

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
  const { from, to } = hourRange(placed)
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
            bounds={{ from, to: to - SNAP_MIN }}
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
  bounds,
}: {
  placed: Placed
  top: number
  left: number
  width: number
  bounds: { from: number; to: number }
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const lock = useContext(ScrollLock)
  const { item, min } = placed
  const accent = t[AREA[item.module].accent]
  const canMove = movable(item)
  const y = useSharedValue(top)
  const lifted = useSharedValue(0)
  const scale = useSharedValue(1)
  const slot = useSharedValue(min)
  const [target, setTarget] = useState<number | null>(null)
  // A new time from anywhere (a drop here, a reset, a pull): slide there.
  useEffect(() => {
    if (lifted.value) return
    y.value = reduced ? top : withTiming(top, { duration: 180 })
  }, [top, reduced, y, lifted])

  const lo = Math.max(bounds.from, DAY_FIRST_MIN),
    hi = Math.min(bounds.to, DAY_LAST_MIN)
  const drop = (to: number) => {
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
      runOnJS(lock)(true)
      runOnJS(feel.impact)()
      runOnJS(setTarget)(min)
    })
    .onUpdate((e) => {
      // The block follows the finger; the time it would land on snaps.
      y.value = top + e.translationY
      const raw = Math.round((min + e.translationY / PX) / SNAP_MIN) * SNAP_MIN
      const next = Math.min(hi, Math.max(lo, raw))
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
          shadowColor: "#000",
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
        },
        style,
      ]}
    >
      <GestureDetector gesture={pan}>
        <View
          accessible
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
        >
          <Tap onPress={() => go(item.href)} style={{ flex: 1 }}>
            <Line
              style={{
                gap: 6,
                alignItems: "flex-start",
                minHeight: BLOCK_MIN_H,
                paddingVertical: 4,
                paddingLeft: 8,
                // Room for the moved mark in the corner.
                paddingRight: movedFrom !== undefined ? 60 : 4,
                borderRadius: 8,
                borderLeftWidth: 3,
                borderLeftColor: accent,
                backgroundColor: `${accent}26`,
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
          </Tap>
        </View>
      </GestureDetector>
      {movedFrom !== undefined && target === null && (
        <MovedMark item={item} from={movedFrom} />
      )}
    </Animated.View>
  )
}

/** "Moved for this day": the time it had, struck through, and a tap back. */
export function MovedMark({
  item,
  from,
  inline = false,
}: {
  item: CalendarItem
  from: string | null
  inline?: boolean
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
        position: inline ? "relative" : "absolute",
        right: inline ? undefined : 2,
        bottom: inline ? undefined : 2,
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
