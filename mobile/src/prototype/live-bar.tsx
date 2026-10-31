// The bar above the tab bar while something runs: a workout, a routine, a
// habit timer or a focus session. Each row is what the lock screen's Live
// Activity shows, read from the same builder (surfaces/live-state): what
// it is, the step or set now, a live clock, how far through it is, and the
// one action that moves it on. A tap anywhere else on the row opens it.
//
// A focus session can run beside a workout, routine or timer (those hold
// the one Live slot; focus keeps its own store), so the bar lists both.

import { fitStore } from "@domain/fitness/store"
import * as FO from "@domain/focus/actions"
import { focusStore } from "@domain/focus/store"
import { habitsStore } from "@domain/habits/store"
import { fmtDuration } from "@domain/lib/day"
import { elapsedSec, type Live, liveStore } from "@domain/lib/live"
import * as Haptics from "expo-haptics"
import type { LucideIcon } from "lucide-react-native"
import {
  Check,
  Dumbbell,
  ListChecks,
  Pause,
  Play,
  SkipForward,
  Target,
  Timer,
} from "lucide-react-native"
import { Pressable, Text, View } from "react-native"
import { applySurfaceAction } from "@/surfaces/actions"
import { buildLiveState } from "@/surfaces/live-state"
import type { LiveControl, LiveState } from "@/surfaces/types"
import { focusLive } from "./focus-live"
import { border, IconTap } from "./native-kit"
import { go } from "./navigation"
import { type Accent, fonts, useTheme } from "./theme"
import { useNow } from "./ui"

/** One row of the bar, ready to draw. */
export interface LiveRow {
  key: string
  href: string
  accent: Accent
  icon: LucideIcon
  title: string
  /** The step, set or phase now, with its detail. */
  step: string
  paused: boolean
  /** Seconds on the clock, and whether it counts down. */
  clock: number
  down: boolean
  /** What the clock is counting, when it isn't the whole activity. */
  clockLabel?: string
  /** Steps or sets done, 0–1; null when there is nothing to count. */
  progress: number | null
  action?: { label: string; icon: LucideIcon; run: () => void }
}

const KIND: Record<
  "workout" | "routine" | "timer" | "focus",
  { accent: Accent; icon: LucideIcon }
> = {
  workout: { accent: "fit", icon: Dumbbell },
  routine: { accent: "hab", icon: ListChecks },
  timer: { accent: "hab", icon: Target },
  focus: { accent: "foc", icon: Timer },
}

const ACTION: Partial<
  Record<LiveControl, { label: string; icon: LucideIcon }>
> = {
  finishSet: { label: "Set done", icon: Check },
  skipRest: { label: "Skip rest", icon: SkipForward },
  done: { label: "Step done", icon: Check },
  skip: { label: "Skip break", icon: SkipForward },
  pause: { label: "Pause", icon: Pause },
  resume: { label: "Resume", icon: Play },
}

/** The control a row offers: the first one that moves the activity on,
 * never Finish (that has its own screen, with a summary to confirm). */
function primaryControl(s: LiveState): LiveControl | undefined {
  return s.controls.find(
    (c) => c !== "finish" && c !== "addRest" && c !== "subRest",
  )
}

function run(s: LiveState, focus: boolean, type: LiveControl) {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
  if (focus) {
    // A focus session beside a workout isn't the Live slot's, so it is
    // driven directly rather than through the slot's action routing.
    if (type === "pause") FO.pauseFocus()
    else if (type === "resume") FO.resumeFocus()
    else if (type === "skip") FO.skipBreak()
    return
  }
  applySurfaceAction({
    type,
    kind: s.kind,
    target: s.id,
    key: s.key,
    at: Date.now(),
  })
}

/** A row from the Live Activity's state of one running thing. */
export function rowOf(s: LiveState, focus: boolean, now: number): LiveRow {
  const resting = s.restEndsAt !== undefined && s.restEndsAt > now
  const counting =
    !resting && (s.stepEndsAt !== undefined || s.remainingSec !== undefined)
  const clock = resting
    ? (s.restEndsAt! - now) / 1000
    : s.stepEndsAt !== undefined && !s.paused
      ? (s.stepEndsAt - now) / 1000
      : s.remainingSec !== undefined
        ? s.remainingSec
        : s.paused
          ? s.elapsedSec
          : (now - s.startedAt) / 1000
  const control = primaryControl(s)
  const act = control && ACTION[control]
  const kind = focus ? KIND.focus : KIND[s.kind]
  return {
    key: `${focus ? "focus" : s.kind}-${s.id}`,
    href: s.href,
    accent: kind.accent,
    icon: kind.icon,
    title: s.title,
    step: [s.step, s.detail].filter(Boolean).join(" · "),
    paused: s.paused,
    clock: Math.max(0, clock),
    down: resting || counting,
    ...(resting ? { clockLabel: "Rest" } : {}),
    progress: s.count > 0 ? Math.min(1, s.index / s.count) : null,
    ...(act && control
      ? { action: { ...act, run: () => run(s, focus, control) } }
      : {}),
  }
}

/** When the stores behind the Live slot aren't loaded yet: its label and
 * clock, so the bar never goes blank while something runs. */
function bareRow(l: Live, now: number): LiveRow {
  const kind = KIND[l.kind]
  return {
    key: `${l.kind}-bare`,
    href: l.href,
    accent: kind.accent,
    icon: kind.icon,
    title: l.label,
    step: "",
    paused: !!l.pausedAt,
    clock: elapsedSec(l, now),
    down: false,
    progress: null,
  }
}

/** Every running thing, the Live slot's first. */
export function useLiveRows(now: number): LiveRow[] {
  const live = liveStore.use((s) => s.live),
    habits = habitsStore.use((s) => s),
    fit = fitStore.use((s) => s),
    focus = focusStore.use((s) => s)
  const rows: LiveRow[] = []
  if (live) {
    const s = buildLiveState({ live, habits, fit, focus, now })
    rows.push(s ? rowOf(s, live.kind === "focus", now) : bareRow(live, now))
  }
  if (live?.kind !== "focus") {
    const f = focusLive(focus, now)
    const s = f && buildLiveState({ live: f, habits, fit, focus, now })
    if (s) rows.push(rowOf(s, true, now))
  }
  return rows
}

/** The clock as mm:ss; a countdown shows the time left, labelled ("Rest")
 * when it counts something smaller than the whole activity. */
const clockText = (r: LiveRow) => fmtDuration(Math.round(r.clock))

export function LiveBar({ path }: { path: string }) {
  const t = useTheme(),
    now = useNow(),
    // The screen of the thing itself already shows all of this.
    rows = useLiveRows(now).filter((r) => r.href !== path)
  if (!rows.length) return null
  return (
    <View
      testID="live-bar"
      style={{
        backgroundColor: t.card,
        borderTopWidth: 1,
        borderColor: border(t.line, 0.6),
      }}
    >
      {rows.map((r, i) => (
        <LiveBarRow key={r.key} row={r} divided={i > 0} />
      ))}
    </View>
  )
}

function LiveBarRow({ row: r, divided }: { row: LiveRow; divided: boolean }) {
  const t = useTheme(),
    color = t[r.accent],
    Icon = r.icon
  const state = r.paused ? "Paused" : "In progress"
  return (
    <View
      style={
        divided
          ? { borderTopWidth: 1, borderColor: border(t.line, 0.6) }
          : undefined
      }
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 16,
          paddingRight: 10,
          paddingVertical: 8,
          gap: 12,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${state}: ${r.title}${r.step ? `, ${r.step}` : ""}, ${r.clockLabel ? `${r.clockLabel} ` : ""}${clockText(r)}${r.down ? " left" : ""}. Open`}
          onPress={() => go(r.href)}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            minHeight: 44,
            opacity: pressed ? 0.72 : 1,
          })}
        >
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: border(color, 0.16),
            }}
          >
            <Icon size={18} color={color} strokeWidth={1.75} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              {/* A steady dot while it runs, a hollow one while paused. */}
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  borderWidth: 1.5,
                  borderColor: r.paused ? t.muted : t.good,
                  backgroundColor: r.paused ? "transparent" : t.good,
                }}
              />
              <Text
                numberOfLines={1}
                style={{
                  flexShrink: 1,
                  fontFamily: fonts.medium,
                  fontSize: 14,
                  color: t.text,
                }}
              >
                {r.title}
                {r.paused ? (
                  <Text style={{ color: t.muted }}> · Paused</Text>
                ) : null}
              </Text>
            </View>
            {!!r.step && (
              <Text
                numberOfLines={1}
                style={{ fontFamily: fonts.body, fontSize: 12, color: t.muted }}
              >
                {r.step}
              </Text>
            )}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            {!!r.clockLabel && (
              <Text
                style={{ fontFamily: fonts.body, fontSize: 12, color: t.muted }}
              >
                {r.clockLabel}
              </Text>
            )}
            <Text
              testID="live-bar-clock"
              style={{
                fontFamily: fonts.mono,
                fontVariant: ["tabular-nums"],
                fontSize: 16,
                color: r.paused ? t.muted : t.text,
              }}
            >
              {clockText(r)}
            </Text>
          </View>
        </Pressable>
        {r.action ? (
          <IconTap
            size={44}
            icon={r.action.icon}
            label={r.action.label}
            background={t.soft}
            color={t.text}
            onPress={r.action.run}
          />
        ) : null}
      </View>
      {r.progress !== null && (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`${r.title} progress`}
          accessibilityValue={{
            min: 0,
            max: 100,
            now: Math.round(r.progress * 100),
          }}
          style={{ height: 2, backgroundColor: t.soft }}
        >
          <View
            testID="live-bar-progress"
            style={{
              width: `${r.progress * 100}%`,
              height: "100%",
              backgroundColor: color,
            }}
          />
        </View>
      )}
    </View>
  )
}
