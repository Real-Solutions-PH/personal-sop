// The guided tour on screen, plus the watcher that tells it (and the
// funnel) what the person did. Mounted once by the app layout above every
// page. See ADR-0039 for why this is our own overlay and not a library.
//
// - TourLayer: dims everything but the control the step teaches, and shows
//   Fern's card with "Skip" (this step) and "Skip tour" (always visible).
//   The hole lets taps through, so the person does the real thing.
// - TourWatcher: turns store changes and route changes into tour signals,
//   and records this install's first log for the funnel.
// - FirstTip: a one-time line the first time a deep screen opens.
import { captureStore } from "@domain/capture/store"
import { dashStore } from "@domain/dash/store"
import { habitsStore } from "@domain/habits/store"
import { tasksStore } from "@domain/tasks/store"
import { ChevronsRight, X } from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import { Pressable, useWindowDimensions, View } from "react-native"
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Orb } from "../companion/orb"
import { companionStore } from "../companion/store"
import { type FunnelStep, noteFirstLog } from "../funnel"
import { Copy, Line } from "../native-kit"
import { sessionStore } from "../session"
import { fonts, radius, useTheme } from "../theme"
import {
  currentStep,
  TOUR_STEPS,
  type TourSignal,
  type TourStepId,
} from "./machine"
import {
  dispatchTour,
  markTip,
  startQueuedTour,
  type TipId,
  tipSeen,
  tourOf,
  useTour,
} from "./store"
import {
  hasTarget,
  measureTarget,
  type Rect,
  revealTarget,
  type TargetId,
  useTargetsVersion,
} from "./targets"

/** The control a step points at, given where the person is. */
export function targetFor(step: TourStepId, path: string): TargetId {
  switch (step) {
    case "fern":
      return "tab-fern"
    case "tick":
      return "today-plan"
    case "plan":
      return "tab-plan"
    case "stats":
      return "tab-stats"
    case "remind":
      return path === "/me" && hasTarget("me-notifications")
        ? "me-notifications"
        : "tab-me"
  }
}

/** Fern's words for each step: one action, plain and short. */
export function stepCopy(
  step: TourStepId,
  name: string,
  target: TargetId,
): { title: string; body: string } {
  switch (step) {
    case "fern":
      return {
        title: `Tell ${name} anything`,
        body: `Tap ${name}, then type or say what happened, like “ran 5k” or “lunch 250”. ${name} logs it in the right place.`,
      }
    case "tick":
      return {
        title: "Tick it off",
        body: "Done a habit or task? Tap its circle. Every tick counts toward today.",
      }
    case "plan":
      return {
        title: "Plan your day",
        body: "Plan lays out today and the week ahead. Tap it to see yours.",
      }
    case "stats":
      return {
        title: "See your progress",
        body: "Stats shows your streaks, scores and trends as they build. Tap it.",
      }
    case "remind":
      return target === "me-notifications"
        ? {
            title: "Set your reminders",
            body: `Tap Notifications to choose when ${name} reminds you.`,
          }
        : {
            title: "Come back on cue",
            body: `${name} reminds you at the times you pick. Open Me to set them.`,
          }
  }
}

const PAD = 6
/** Room the card needs (title, two lines, the Skip row) at 375 pt. */
const CARD_ROOM = 190
/** How long Today gets to show something to tick before the step passes. */
const TICK_GRACE_MS = 1500

/** Fades a card in when its step changes; still under Reduce Motion. */
function useFadeIn(key: string) {
  const reduced = useReducedMotion()
  const o = useSharedValue(reduced ? 1 : 0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: replays per step
  useEffect(() => {
    if (reduced) {
      o.value = 1
      return
    }
    o.value = 0
    o.value = withTiming(1, { duration: 200 })
  }, [key, reduced])
  return useAnimatedStyle(() => ({ opacity: o.value }))
}

function StepDots({ index }: { index: number }) {
  const t = useTheme()
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
      accessible
      accessibilityLabel={`Step ${index + 1} of ${TOUR_STEPS.length}`}
    >
      {TOUR_STEPS.map((s, i) => (
        <View
          key={s}
          style={{
            width: i === index ? 16 : 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: i <= index ? t.primary : t.soft,
          }}
        />
      ))}
    </View>
  )
}

function TourCard({
  step,
  index,
  target,
  compact,
}: {
  step: TourStepId
  index: number
  target: TargetId
  /** While Fern's drawer is open: the words only, out of the way. */
  compact?: boolean
}) {
  const t = useTheme()
  const name = companionStore.use((s) => s.name)
  const copy = stepCopy(step, name, target)
  const fade = useFadeIn(`${step}:${target}:${compact ? 1 : 0}`)
  return (
    <Animated.View
      accessibilityViewIsModal={!compact}
      accessibilityLiveRegion="polite"
      style={[
        {
          backgroundColor: t.card,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: t.line,
          padding: 16,
          gap: 12,
          boxShadow: "0px 8px 24px rgba(0,0,0,0.18)",
        },
        fade,
      ]}
    >
      <Line style={{ gap: 12, alignItems: "flex-start" }}>
        <Orb size={28} />
        <View style={{ flex: 1, gap: 4 }}>
          <Copy weight="semibold" size={17} style={{ lineHeight: 22 }}>
            {copy.title}
          </Copy>
          <Copy size={15} muted style={{ lineHeight: 21 }}>
            {compact
              ? `Type or say anything, like “lunch 250”. ${name} logs it.`
              : copy.body}
          </Copy>
        </View>
      </Line>
      <Line style={{ justifyContent: "space-between", gap: 8 }}>
        <StepDots index={index} />
        <Line style={{ gap: 4 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip this step"
            onPress={() => dispatchTour({ type: "skipStep" })}
            hitSlop={4}
            style={{
              minHeight: 44,
              paddingHorizontal: 10,
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
            }}
          >
            <ChevronsRight size={16} color={t.muted} />
            <Copy size={14} muted>
              Skip
            </Copy>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip tour"
            onPress={() => dispatchTour({ type: "skipTour" })}
            hitSlop={4}
            style={{
              minHeight: 44,
              paddingHorizontal: 10,
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
            }}
          >
            <X size={16} color={t.text} />
            <Copy size={14} weight="medium">
              Skip tour
            </Copy>
          </Pressable>
        </Line>
      </Line>
    </Animated.View>
  )
}

/** Four panes around the hole: taps on them are held, taps in the hole go
 * through to the real control. */
function Dim({ hole }: { hole: Rect }) {
  const { width, height } = useWindowDimensions()
  const t = useTheme()
  const shade = t.dark ? "rgba(0,0,0,0.66)" : "rgba(10,20,15,0.55)"
  const top = Math.max(0, hole.y - PAD),
    left = Math.max(0, hole.x - PAD),
    right = Math.min(width, hole.x + hole.width + PAD),
    bottom = Math.min(height, hole.y + hole.height + PAD)
  const pane = (style: object) => (
    <View
      accessible={false}
      style={[{ position: "absolute", backgroundColor: shade }, style]}
    />
  )
  return (
    <>
      {pane({ left: 0, right: 0, top: 0, height: top })}
      {pane({ left: 0, right: 0, top: bottom, bottom: 0 })}
      {pane({ left: 0, width: left, top, height: bottom - top })}
      {pane({ left: right, right: 0, top, height: bottom - top })}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left,
          top,
          width: right - left,
          height: bottom - top,
          borderRadius: radius.card,
          borderWidth: 2,
          borderColor: t.primary,
        }}
      />
    </>
  )
}

export function TourLayer({
  path,
  drawerOpen,
  barHeight,
}: {
  path: string
  drawerOpen: boolean
  barHeight: number
}) {
  const { tour, queued } = useTour()
  const safe = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const version = useTargetsVersion()
  const step = currentStep(tour)
  const target = step ? targetFor(step, path) : null
  const [rect, setRect] = useState<Rect | null>(null)

  // First run's end or a replay: the tour starts once Today shows.
  useEffect(() => {
    if (queued && path === "/today") startQueuedTour()
  }, [queued, path])

  // Follows the target as pages scroll and lay out; brings it into view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: version re-measures when targets change
  useEffect(() => {
    if (!target) {
      setRect(null)
      return
    }
    let live = true
    // A page still laying out can stop a scroll short: try a few times.
    let tries = 0
    const tick = async () => {
      const r = await measureTarget(target)
      if (!live) return
      const floor = height - barHeight - 24
      if (r && tries < 5 && (r.y < 0 || r.y + r.height > floor)) {
        tries++
        revealTarget(target, r.y < 0 ? r.y - 140 : r.y + r.height - floor + 140)
      }
      setRect((old) =>
        old &&
        r &&
        Math.abs(old.x - r.x) < 1 &&
        Math.abs(old.y - r.y) < 1 &&
        Math.abs(old.width - r.width) < 1 &&
        Math.abs(old.height - r.height) < 1
          ? old
          : r,
      )
    }
    void tick()
    const id = setInterval(tick, 300)
    return () => {
      live = false
      clearInterval(id)
    }
  }, [target, version, height, barHeight])

  // Nothing to tick today: the step passes instead of waiting forever.
  // biome-ignore lint/correctness/useExhaustiveDependencies: version re-checks when targets change
  useEffect(() => {
    if (step !== "tick" || path !== "/today" || hasTarget("today-plan")) return
    const id = setTimeout(() => {
      if (!hasTarget("today-plan"))
        dispatchTour({ type: "unavailable", step: "tick" })
    }, TICK_GRACE_MS)
    return () => clearTimeout(id)
  }, [step, path, version])

  if (!step || !target) return null
  const index = tour.index
  // Fern's drawer is open. Later steps wait until it closes, so Fern's
  // answer stays in view and the drawer can be closed.
  if (drawerOpen && step !== "fern") return null
  // The person is typing to Fern, so only the words stay.
  if (drawerOpen)
    return (
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          top: safe.top + 8,
        }}
      >
        <TourCard step={step} index={index} target={target} compact />
      </View>
    )
  // The control is off this page, or still off screen: say what to do,
  // without blocking.
  const visible = rect !== null && rect.y >= 0 && rect.y + rect.height <= height
  if (!rect || !visible)
    return (
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          bottom: barHeight + 16,
        }}
      >
        <TourCard step={step} index={index} target={target} />
      </View>
    )
  const below = rect.y + rect.height / 2 < height / 2
  // The card never leaves the screen: with too little room beside the
  // hole it sits as far as it can and may cover part of the target.
  const roomTop = safe.top + 8,
    roomBottom = barHeight + 8
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
    >
      <Dim hole={rect} />
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          ...(below
            ? {
                top: Math.min(
                  rect.y + rect.height + PAD + 12,
                  height - roomBottom - CARD_ROOM,
                ),
              }
            : {
                bottom: Math.min(
                  height - rect.y + PAD + 12,
                  height - roomTop - CARD_ROOM,
                ),
              }),
        }}
      >
        <TourCard step={step} index={index} target={target} />
      </View>
    </View>
  )
}

/** Where a first log happened, for the funnel. */
function firstLogStep(path: string): FunnelStep {
  if (path.startsWith("/onboarding") || path.startsWith("/setup"))
    return "capture"
  const step = currentStep(tourOf().tour)
  return step ? (`tour_${step}` as FunnelStep) : "app"
}

/** Store changes become tour signals; a new account's first one is also
 * its first log. Always mounted, onboarding included. */
export function TourWatcher({
  path,
  drawerOpen = false,
}: {
  path: string
  /** Fern's drawer: a tick Fern files from a message is not the person
   * ticking, so ticks while it is open or Fern is working don't count. */
  drawerOpen?: boolean
}) {
  const captures = captureStore.use((s) => s.captures.length)
  const habitTicks = habitsStore.use(
    (s) => s.logs.filter((l) => l.status === "done").length,
  )
  const taskTicks = tasksStore.use(
    (s) => s.tasks.filter((x) => x.status === "done").length,
  )
  const granted = dashStore.use((s) => s.push.permission === "granted")
  const returning = sessionStore.use((s) => s.returning)
  const fernBusy = captureStore.use((s) =>
    s.captures.some((c) => c.status === "processing"),
  )
  const index = useTour().tour.index
  const seen = useRef({ captures, habitTicks, taskTicks, granted })
  const pathRef = useRef(path)
  pathRef.current = path

  // Also when a step becomes current: someone already on Plan who reaches
  // the Plan step has done it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: index re-checks per step
  useEffect(() => {
    dispatchTour({ type: "signal", signal: { kind: "opened", path } })
  }, [path, index])

  useEffect(() => {
    const was = seen.current
    seen.current = { captures, habitTicks, taskTicks, granted }
    const signals: TourSignal[] = []
    if (captures > was.captures) signals.push({ kind: "logged" })
    const ticked = habitTicks > was.habitTicks || taskTicks > was.taskTicks
    if (ticked && !drawerOpen && !fernBusy) signals.push({ kind: "ticked" })
    // Still a log for the funnel, whoever filed it.
    else if (ticked && !returning) noteFirstLog(firstLogStep(pathRef.current))
    if (granted && !was.granted) signals.push({ kind: "reminders" })
    for (const signal of signals) {
      // A returning account's sync is not a first log.
      if (signal.kind !== "reminders" && !returning)
        noteFirstLog(firstLogStep(pathRef.current))
      dispatchTour({ type: "signal", signal })
    }
  }, [
    captures,
    habitTicks,
    taskTicks,
    granted,
    returning,
    drawerOpen,
    fernBusy,
  ])
  return null
}

/** Pages under /habits that are not one habit. */
const HABIT_PAGES = [
  "day",
  "manage",
  "new",
  "routines",
  "settings",
  "share",
  "today",
  "week",
]
/** The deep screen a path is, for its one-time tip. */
export function tipFor(path: string): TipId | null {
  if (path === "/finance") return "finance"
  if (path === "/nutrition") return "nutrition"
  if (/^\/habits\/[^/]+$/.test(path)) {
    const id = path.slice("/habits/".length)
    return HABIT_PAGES.includes(id) ? null : "habit"
  }
  return null
}

const TIP_TEXT: Record<TipId, (name: string) => string> = {
  finance: (name) =>
    `Tell ${name} what you spent, like “lunch 250”. It lands here, sorted.`,
  nutrition: (name) =>
    `Tell ${name} what you ate, like “chicken adobo and rice”. The meal fills in here.`,
  habit: () =>
    "This habit's streak and history build here. Tick it on Today and this fills in.",
}
/** Seen once it has shown this long, or when closed. */
const TIP_SEEN_MS = 1500

export function FirstTip({
  path,
  barHeight,
}: {
  path: string
  barHeight: number
}) {
  const t = useTheme()
  const { tour, queued } = useTour()
  const name = companionStore.use((s) => s.name)
  const id = tipFor(path)
  // The tip on show, held for its page even after it counts as seen.
  const [active, setActive] = useState<{ id: TipId; path: string } | null>(null)
  const quiet = tour.status !== "running" && !queued
  useEffect(() => {
    setActive(id && quiet && !tipSeen(id) ? { id, path } : null)
  }, [id, path, quiet])
  const fade = useFadeIn(active?.path ?? "")
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => markTip(active.id), TIP_SEEN_MS)
    return () => clearTimeout(timer)
  }, [active])
  if (!active || active.path !== path) return null
  const tip = active.id
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        bottom: barHeight + 16,
      }}
    >
      <Animated.View
        accessibilityLiveRegion="polite"
        style={[
          {
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 12,
            backgroundColor: t.card,
            borderRadius: radius.card,
            borderWidth: 1,
            borderColor: t.line,
            paddingLeft: 14,
            paddingVertical: 12,
            paddingRight: 4,
            boxShadow: "0px 8px 24px rgba(0,0,0,0.16)",
          },
          fade,
        ]}
      >
        <Orb size={24} />
        <Copy
          size={14}
          style={{ flex: 1, lineHeight: 20, fontFamily: fonts.body }}
        >
          {TIP_TEXT[tip](name)}
        </Copy>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close tip"
          onPress={() => {
            markTip(tip)
            setActive(null)
          }}
          style={{
            width: 44,
            height: 44,
            marginTop: -10,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <X size={18} color={t.muted} />
        </Pressable>
      </Animated.View>
    </View>
  )
}
