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
import { tickOf } from "@domain/schedule/ticks"
import { Check, Undo2 } from "lucide-react-native"
import {
  type ComponentRef,
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
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
import { PlanCheck } from "./plan-day"
import {
  type Axis,
  BLOCK_MIN_H,
  columnsFor,
  layoutGrid,
  minuteAt,
  PX,
  type Slot,
  yAt,
} from "./plan-grid-layout"

/** The hour grid on the page, for a row dragged onto it from outside (the
 * Anytime list): where its first hour sits on screen. Null with no grid. */
export type GridRef = RefObject<ComponentRef<typeof View> | null>
export const GridAnchor = createContext<GridRef | null>(null)
/** The grid's current minute ↔ point mapping, for a row dragged onto it
 * from outside: hours stretch to fit their blocks, so a point is not a fixed
 * number of minutes. */
const axisOf = new WeakMap<GridRef, Axis>()

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
  const anchor = useContext(GridAnchor)
  const [width, setWidth] = useState(0)
  // Each block's height as it rendered: a long title wraps and the block
  // grows, and the hour it sits in grows with it (see plan-grid-layout).
  const [heights, setHeights] = useState<Record<string, number>>({})
  const onHeight = (id: string, h: number) =>
    setHeights((prev) =>
      Math.abs((prev[id] ?? 0) - h) < 0.5 ? prev : { ...prev, [id]: h },
    )
  const from = DAY_FROM,
    to = DAY_TO
  const lane = width ? width - GUTTER - 4 : 0
  const cols = columnsFor(lane)
  const grid = layoutGrid(items, {
    from,
    // The last hour line drawn is the one before the day wraps.
    to: to - 60,
    cols,
    minuteOf: (i) => (i.time ? dayMinutes(i.time) : null),
    heightOf: (i) => heights[i.id],
  })
  if (anchor) axisOf.set(anchor, grid.axis)
  return (
    <View
      ref={anchor ?? undefined}
      testID="plan-day-grid"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{
        height: Math.max(grid.height, yAt(grid.axis, to) + 8),
        marginTop: 4,
      }}
    >
      {grid.hours.map(({ min: h, y }) => (
        <View
          key={h}
          pointerEvents="none"
          style={{
            position: "absolute",
            top: y,
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
            top: yAt(grid.axis, nowMin) - 1,
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
        grid.placed.map((p) => (
          <Block
            key={p.item.id}
            placed={p}
            axis={grid.axis}
            top={p.top}
            left={GUTTER + (lane / p.cols) * p.col}
            width={lane / p.cols - 4}
            onHeight={onHeight}
          />
        ))}
    </View>
  )
}

function Block({
  placed,
  axis,
  top,
  left,
  width,
  onHeight,
}: {
  placed: Slot<CalendarItem>
  axis: Axis
  top: number
  left: number
  width: number
  onHeight: (id: string, height: number) => void
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
  const tickable = tickOf(item) !== null
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
  // Where its own time sits on the axis: a block in a group's second row
  // sits below that, but a drag still starts from its time.
  const base = yAt(axis, min)
  /** The quarter hour the block is over, ``offset`` points below its start. */
  const slotAt = (offset: number) => {
    "worklet"
    const raw = Math.round(minuteAt(axis, base + offset) / SNAP_MIN) * SNAP_MIN
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
    return Math.min(
      yAt(axis, hi) - base,
      Math.max(yAt(axis, lo) - base, offset),
    )
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
      const landed = top + yAt(axis, to) - base
      y.value = reduced ? landed : withTiming(landed, { duration: 140 })
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
      // Its height lays out the hour it sits in; not while it is held (the
      // landing time it shows then would stretch the grid under the finger).
      onLayout={(e) => {
        if (target === null) onHeight(item.id, e.nativeEvent.layout.height)
      }}
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
      <PlanCheck item={item} color={accent} size={22}>
        {(check, stepButton) => (
          <View
            style={{
              flexGrow: 1,
              flexDirection: "row",
              minHeight: BLOCK_MIN_H,
              borderRadius: 8,
              borderLeftWidth: 3,
              borderLeftColor: accent,
              backgroundColor: `${accent}26`,
            }}
          >
            <View style={{ flex: 1 }}>
              <GestureDetector gesture={pan}>
                {/* One pressable carries the open tap, the drag and the
                screen reader's actions: a button inside a button is invalid
                on web. */}
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
                          textDecorationLine: item.done
                            ? "line-through"
                            : "none",
                        }}
                      >
                        {item.title}
                      </Copy>
                      {target !== null && (
                        <Copy
                          size={12}
                          weight="semibold"
                          style={{ color: accent }}
                        >
                          {timeLabel(target)}
                        </Copy>
                      )}
                    </View>
                    {item.done && !tickable && (
                      <Check
                        size={14}
                        color={t.good}
                        style={{ marginTop: 1 }}
                      />
                    )}
                  </Line>
                </Pressable>
              </GestureDetector>
              {/* A count habit's +step sits under the title, not beside it:
              beside, it and the tick left a narrow column too little room
              for the title. Outside the pressable (no button in a button). */}
              {stepButton && target === null && (
                <View
                  style={{
                    flexDirection: "row",
                    paddingLeft: 4,
                    paddingBottom: 4,
                  }}
                >
                  {stepButton}
                </View>
              )}
              {/* Beside the pressable, never inside it. */}
              {movedFrom !== undefined && target === null && (
                <View style={{ paddingLeft: 4, paddingBottom: 4 }}>
                  <MovedMark item={item} from={movedFrom} />
                </View>
              )}
            </View>
            {/* Ticks off where it sits; outside the drag, so a press on the
            check never lifts the block. */}
            {check && target === null && (
              <View style={{ justifyContent: "center", paddingRight: 2 }}>
                {check}
              </View>
            )}
          </View>
        )}
      </PlanCheck>
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

/** The next quarter hour from now on the business day, else 9 AM: where a
 * screen reader's "give it a time" puts an Anytime item. */
function nextSlot(day: string, today: string) {
  if (day !== today) return 9 * 60
  const now = new Date()
  const min = dayMinutes(
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
  )
  return Math.min(DAY_LAST_MIN, Math.ceil(min / SNAP_MIN) * SNAP_MIN)
}

/**
 * A row of the Anytime list that can be long-pressed and dragged onto the
 * hour grid below it, landing at the quarter hour under the finger: a habit
 * or routine gets a time for that day only, a task its due time. Above the
 * grid it springs back. Without a grid on the page (the day parts view) it
 * is the row as it is. ``children`` gets whether the press that just ended
 * was a drag, so the row's own tap does not open the item then.
 */
export function DragToGrid({
  item,
  today,
  children,
}: {
  item: CalendarItem
  today: string
  children: (wasDrag: () => boolean) => ReactNode
}) {
  const t = useTheme()
  const grid = useContext(GridAnchor)
  const lock = useContext(ScrollLock)
  const nudge = useContext(PageNudge)
  const reduced = useReducedMotion()
  const screen = useWindowDimensions().height
  const insets = useSafeAreaInsets()
  const topZone = insets.top + HEADER + EDGE,
    bottomZone = screen - insets.bottom - TAB_BAR - EDGE
  const canMove = Boolean(grid) && movable(item)
  const ty = useSharedValue(0)
  const lifted = useSharedValue(0)
  const scale = useSharedValue(1)
  // Where the grid's first hour was on screen at the lift, and how far the
  // page has scrolled since; -1 while the finger is above the grid.
  const at = useRef({ gridTop: 0, scrolled: 0, travel: 0, absY: 0, slot: -1 })
  const [target, setTarget] = useState<number | null>(null)
  const dragged = useRef(false)
  const edge = useRef<{
    dir: number
    speed: number
    timer?: ReturnType<typeof setInterval>
  }>({ dir: 0, speed: 0 })
  useEffect(
    () => () => {
      if (edge.current.timer) clearInterval(edge.current.timer)
    },
    [],
  )
  /** The quarter hour under the finger, or -1 above the grid. */
  const aim = () => {
    const a = at.current
    const y = a.absY - (a.gridTop - a.scrolled)
    const axis = grid ? axisOf.get(grid) : undefined
    const over = axis ? minuteAt(axis, y) : DAY_FROM + y / PX
    const next =
      y < 0
        ? -1
        : Math.min(
            DAY_LAST_MIN,
            Math.max(DAY_FIRST_MIN, Math.round(over / SNAP_MIN) * SNAP_MIN),
          )
    if (next === a.slot) return
    a.slot = next
    feel.select()
    setTarget(next < 0 ? null : next)
  }
  const setEdge = (depth: number) => {
    const dir = Math.sign(depth)
    edge.current.speed = 2 + Math.abs(depth) * 6
    if (dir === edge.current.dir) return
    edge.current.dir = dir
    if (edge.current.timer) clearInterval(edge.current.timer)
    edge.current.timer = undefined
    if (!dir) return
    edge.current.timer = setInterval(() => {
      const moved = nudge(dir * edge.current.speed)
      if (!moved) return
      at.current.scrolled += moved
      ty.value = at.current.travel + at.current.scrolled
      aim()
    }, 16)
  }
  const lift = (absY: number) => {
    dragged.current = true
    lock(true)
    feel.impact()
    at.current = { gridTop: 1e9, scrolled: 0, travel: 0, absY, slot: -1 }
    grid?.current?.measureInWindow((_x, y) => {
      at.current.gridTop = y
      aim()
    })
  }
  const follow = (absY: number, travel: number) => {
    at.current.absY = absY
    at.current.travel = travel
    ty.value = travel + at.current.scrolled
    const depth =
      absY < topZone
        ? -Math.min(1, (topZone - absY) / EDGE)
        : absY > bottomZone
          ? Math.min(1, (absY - bottomZone) / EDGE)
          : 0
    setEdge(depth)
    aim()
  }
  const back = () => {
    ty.value = reduced ? 0 : withTiming(0, { duration: 160 })
  }
  // On web the release that ends a drag is also a click on the row; it
  // comes at once, so the flag clears just after.
  const settle = () => {
    setTimeout(() => {
      dragged.current = false
    }, 350)
  }
  const drop = () => {
    setEdge(0)
    lock(false)
    setTarget(null)
    settle()
    const to = at.current.slot
    if (to < 0) {
      back()
      return
    }
    const outcome = moveItem(item, clockOf(to))
    if (outcome === "fixed") {
      feel.warning()
      back()
      return
    }
    // Landed: it leaves this list for its block on the grid.
    feel.impact()
    ty.value = 0
    if (!reduced)
      scale.value = withSequence(
        withTiming(1.04, { duration: 90 }),
        withSpring(1, MOTION.spring),
      )
  }
  const pan = Gesture.Pan()
    .enabled(canMove)
    .activateAfterLongPress(300)
    .onStart((e) => {
      lifted.value = 1
      runOnJS(lift)(e.absoluteY)
    })
    .onUpdate((e) => {
      runOnJS(follow)(e.absoluteY, e.translationY)
    })
    .onEnd(() => {
      lifted.value = 0
      runOnJS(drop)()
    })
    .onFinalize((_e, ok) => {
      if (ok) return
      lifted.value = 0
      runOnJS(setEdge)(0)
      runOnJS(lock)(false)
      runOnJS(setTarget)(null)
      runOnJS(back)()
      runOnJS(settle)()
    })
  const style = useAnimatedStyle(() => ({
    zIndex: lifted.value ? 20 : 1,
    shadowOpacity: lifted.value ? 0.22 : 0,
    backgroundColor: lifted.value ? t.card : "transparent",
    transform: [
      { translateY: ty.value },
      { scale: lifted.value && !reduced ? 1.03 : scale.value },
    ],
  }))
  if (!canMove) return <>{children(() => false)}</>
  const accent = t[AREA[item.module].accent]
  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        accessibilityActions={[{ name: "increment", label: "Give it a time" }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === "increment")
            moveItem(item, clockOf(nextSlot(item.day, today)))
        }}
        style={[
          {
            flex: 1,
            borderRadius: 12,
            shadowColor: "#000",
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
          },
          style,
        ]}
      >
        {children(() => dragged.current)}
        {/* Over the row, out of its flow: growing the row would push the
            grid down mid-drag and the time would land late. */}
        {target !== null && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              right: 4,
              top: -22,
              paddingHorizontal: 6,
              borderRadius: 8,
              backgroundColor: t.card,
            }}
          >
            <Copy size={12} weight="semibold" style={{ color: accent }}>
              {timeLabel(target)}
            </Copy>
          </View>
        )}
      </Animated.View>
    </GestureDetector>
  )
}
