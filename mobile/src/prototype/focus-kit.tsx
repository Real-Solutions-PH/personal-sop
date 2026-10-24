// Pieces the Focus screens share (ADR-0025): the day timeline, the picker
// for what is being worked on, and the time-spent card a task or habit page
// shows.

import * as C from "@domain/focus/calc"
import type { FocusItem } from "@domain/focus/data"
import * as L from "@domain/focus/logic"
import { useFocusState } from "@domain/focus/store"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { tasksStore } from "@domain/tasks/store"
import {
  CheckSquare,
  CircleSlash,
  Play,
  Search,
  Target,
  Timer,
} from "lucide-react-native"
import { type ReactNode, useMemo, useState } from "react"
import { TextInput, View } from "react-native"
import Svg, {
  Circle,
  Defs,
  Pattern,
  Rect,
  Line as SvgLine,
} from "react-native-svg"
import { Copy, Frame, Line, Tap } from "./native-kit"
import { go } from "./navigation"
import { fonts, useTheme } from "./theme"
import { Sheet } from "./ui"

const pad = (n: number) => String(n).padStart(2, "0")
/** "Today", "Yesterday", "Tomorrow" or "Oct 22" for a business day. */
export function dayLabel(day: string, today = dayKey()) {
  if (day === today) return "Today"
  if (day === C.prevDay(today)) return "Yesterday"
  if (day === L.nextDay(today)) return "Tomorrow"
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}
const relative = (label: string) =>
  ["Today", "Yesterday", "Tomorrow"].includes(label)
    ? label.toLowerCase()
    : label
export const clockOf = (ms: number) => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---------------------------------------------------------------- ring

/** The timer's ring. Drawn straight from the value with no sweep: the
 * clock moves it every second, and a reveal animation restarted that
 * often would never settle. */
export function TimerRing({
  value,
  size,
  stroke = 10,
  color,
  children,
}: {
  value: number
  size: number
  stroke?: number
  color: string
  children?: ReactNode
}) {
  const t = useTheme()
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const p = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
  return (
    <View
      accessible
      accessibilityLabel={`${Math.round(p * 100)} percent`}
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={t.soft}
          strokeWidth={stroke}
          fill="none"
        />
        {p > 0 && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * p} ${c}`}
            fill="none"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </Svg>
      {children}
    </View>
  )
}

// ---------------------------------------------------------------- timeline

const HOUR_PX = 160

/** One business day as a vertical timeline: focus blocks in the Focus
 * colour labelled with the item, breaks in a light tint, pauses hatched.
 * Only hours that hold a block are drawn; a stretch with none folds into a
 * single "no focus" line. */
export function FocusTimeline({
  blocks,
  day,
  dimmed = false,
}: {
  blocks: C.Block[]
  day: string
  dimmed?: boolean
}) {
  const t = useTheme()
  const lo = L.dayStart(day)
  const hourOf = (ms: number) =>
    Math.min(23, Math.max(0, Math.floor((ms - lo) / 3600_000)))
  const touched = new Set<number>()
  for (const b of blocks)
    for (let h = hourOf(b.start); h <= hourOf(b.end - 1); h++) touched.add(h)
  const hours = [...touched].sort((a, b) => a - b)
  const runs: [number, number][] = []
  for (const h of hours) {
    const last = runs[runs.length - 1]
    if (last && h === last[1] + 1) last[1] = h
    else runs.push([h, h])
  }
  if (!runs.length) runs.push([5, 6])
  const at = (h: number) => lo + h * 3600_000
  return (
    <View
      accessible
      accessibilityLabel={`Focus timeline for ${day}: ${blocks
        .filter((b) => b.kind === "focus")
        .map(
          (b) =>
            `${clockOf(b.start)} to ${clockOf(b.end)} ${b.item?.title ?? "focus"}`,
        )
        .join(", ")}`}
      style={{ opacity: dimmed ? 0.35 : 1, gap: 8 }}
    >
      {runs.map(([from, to], i) => (
        <View key={from} style={{ gap: 8 }}>
          {i > 0 && (
            <Line style={{ gap: 8 }}>
              <View
                style={{
                  flex: 1,
                  borderTopWidth: 1,
                  borderStyle: "dashed",
                  borderColor: t.line,
                }}
              />
              <Copy size={11} muted>
                No focus {clockOf(at(runs[i - 1][1] + 1))}–{clockOf(at(from))}
              </Copy>
              <View
                style={{
                  flex: 1,
                  borderTopWidth: 1,
                  borderStyle: "dashed",
                  borderColor: t.line,
                }}
              />
            </Line>
          )}
          <HourRun
            blocks={blocks}
            top={at(from)}
            bottom={at(to + 1)}
            hours={to - from + 1}
          />
        </View>
      ))}
    </View>
  )
}

function HourRun({
  blocks,
  top,
  bottom,
  hours,
}: {
  blocks: C.Block[]
  top: number
  bottom: number
  hours: number
}) {
  const t = useTheme()
  const height = hours * HOUR_PX
  const y = (ms: number) => ((ms - top) / 3600_000) * HOUR_PX
  const here = blocks
    .filter((b) => b.end > top && b.start < bottom)
    .map((b) => ({
      ...b,
      start: Math.max(b.start, top),
      end: Math.min(b.end, bottom),
    }))
  return (
    <View style={{ flexDirection: "row" }}>
      <View style={{ width: 48, height }}>
        {Array.from({ length: hours }, (_, i) => (
          <Copy
            key={i}
            size={11}
            muted
            style={{
              position: "absolute",
              top: i * HOUR_PX - 2,
              fontFamily: fonts.monoRegular,
            }}
          >
            {clockOf(top + i * 3600_000)}
          </Copy>
        ))}
      </View>
      <View style={{ flex: 1, height }}>
        {Array.from({ length: hours }, (_, i) => (
          <View
            key={i}
            style={{
              position: "absolute",
              top: i * HOUR_PX,
              left: 0,
              right: 0,
              height: 1,
              backgroundColor: t.line,
            }}
          />
        ))}
        {here.map((b) => {
          const h = Math.max(3, y(b.end) - y(b.start) - 1)
          const label =
            b.kind === "focus"
              ? (b.item?.title ?? "Focus")
              : b.kind === "pause"
                ? `Paused ${L.fmtHm((b.end - b.start) / 1000)}`
                : "Break"
          const onAccent = b.kind === "focus" && !b.abandoned
          return (
            <View
              key={`${b.segmentId}-${b.start}`}
              style={{
                position: "absolute",
                top: y(b.start),
                left: b.kind === "focus" ? 0 : 12,
                right: 0,
                height: h,
                borderRadius: 6,
                overflow: "hidden",
                backgroundColor:
                  b.kind === "focus"
                    ? b.abandoned
                      ? t.soft
                      : t.foc
                    : b.kind === "break"
                      ? `${t.foc}26`
                      : "transparent",
                borderWidth: b.kind === "pause" ? 1 : 0,
                borderColor: t.line,
              }}
            >
              {b.kind === "pause" && <Hatch color={t.muted} />}
              {h >= 18 && (
                <Line style={{ gap: 6, paddingHorizontal: 8, paddingTop: 1 }}>
                  <Copy
                    size={12}
                    weight="medium"
                    lines={1}
                    style={{
                      flex: 1,
                      color: onAccent ? t["on-accent"] : t.text,
                    }}
                  >
                    {label}
                  </Copy>
                  {b.kind === "focus" && (
                    <Copy
                      size={11}
                      style={{
                        fontFamily: fonts.mono,
                        color: onAccent ? t["on-accent"] : t.muted,
                      }}
                    >
                      {clockOf(b.start)}–{b.running ? "now" : clockOf(b.end)}
                    </Copy>
                  )}
                </Line>
              )}
            </View>
          )
        })}
      </View>
    </View>
  )
}

function Hatch({ color }: { color: string }) {
  return (
    <Svg width="100%" height="100%" style={{ position: "absolute" }}>
      <Defs>
        <Pattern
          id="focus-hatch"
          width={8}
          height={8}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <SvgLine
            x1={0}
            y1={0}
            x2={0}
            y2={8}
            stroke={color}
            strokeWidth={2}
            strokeOpacity={0.45}
          />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#focus-hatch)" />
    </Svg>
  )
}

/** The current session as a strip: focus, break and pause in proportion. */
export function SessionStrip({ blocks }: { blocks: C.Block[] }) {
  const t = useTheme()
  if (!blocks.length) return null
  const lo = blocks[0].start
  const hi = Math.max(...blocks.map((b) => b.end))
  const span = Math.max(1, hi - lo)
  return (
    <View
      accessibilityElementsHidden
      style={{
        flexDirection: "row",
        height: 10,
        borderRadius: 5,
        overflow: "hidden",
        backgroundColor: t.soft,
        width: "100%",
      }}
    >
      {blocks.map((b) => (
        <View
          key={`${b.segmentId}-${b.start}`}
          style={{
            width: `${((b.end - b.start) / span) * 100}%`,
            backgroundColor:
              b.kind === "focus"
                ? t.foc
                : b.kind === "break"
                  ? `${t.foc}40`
                  : "transparent",
          }}
        >
          {b.kind === "pause" && <Hatch color={t.muted} />}
        </View>
      ))}
    </View>
  )
}

// ---------------------------------------------------------------- picker

interface Choice {
  item: FocusItem | null
  label: string
  detail: string
  icon: "task" | "habit" | "none"
}

/** Pick what the time goes to: an open task, an active habit, or nothing. */
export function ItemPicker({
  open,
  onClose,
  onPick,
  current,
}: {
  open: boolean
  onClose: () => void
  onPick: (item: FocusItem | null) => void
  current: FocusItem | null
}) {
  const t = useTheme()
  const tasks = tasksStore.use((s) => s.tasks)
  const habits = habitsStore.use((s) => s.habits)
  const [q, setQ] = useState("")
  const choices = useMemo(() => {
    const text = q.trim().toLowerCase()
    const out: Choice[] = []
    for (const x of tasks)
      if (x.status === "open")
        out.push({
          item: { kind: "task", id: x.id, title: x.title },
          label: x.title,
          detail: x.dueDate
            ? `Task · due ${relative(dayLabel(x.dueDate))}`
            : "Task",
          icon: "task",
        })
    for (const h of habits)
      if (h.status === "active")
        out.push({
          item: { kind: "habit", id: h.id, title: h.name },
          label: `${h.icon} ${h.name}`,
          detail: "Habit",
          icon: "habit",
        })
    return out
      .filter((c) => !text || c.label.toLowerCase().includes(text))
      .slice(0, 40)
  }, [tasks, habits, q])
  const row = (c: Choice) => {
    const picked =
      (c.item === null && current === null) ||
      (c.item && current && L.itemKey(c.item) === L.itemKey(current))
    const Icon =
      c.icon === "task"
        ? CheckSquare
        : c.icon === "habit"
          ? Target
          : CircleSlash
    return (
      <Tap
        key={c.item ? L.itemKey(c.item) : "none"}
        label={c.label}
        onPress={() => {
          onPick(c.item)
          onClose()
        }}
        style={{
          paddingVertical: 10,
          paddingHorizontal: 12,
          borderRadius: 12,
          backgroundColor: picked ? `${t.foc}1f` : "transparent",
        }}
      >
        <Line>
          <Icon
            size={18}
            color={
              c.icon === "task" ? t.tsk : c.icon === "habit" ? t.hab : t.muted
            }
          />
          <View style={{ flex: 1 }}>
            <Copy weight="medium" lines={1}>
              {c.label}
            </Copy>
            <Copy size={12} muted lines={1}>
              {c.detail}
            </Copy>
          </View>
        </Line>
      </Tap>
    )
  }
  return (
    <Sheet title="What are you working on?" open={open} onClose={onClose}>
      <Line
        style={{
          gap: 8,
          paddingHorizontal: 12,
          borderRadius: 12,
          backgroundColor: t.soft,
          height: 44,
        }}
      >
        <Search size={16} color={t.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search tasks and habits"
          placeholderTextColor={t.muted}
          accessibilityLabel="Search tasks and habits"
          style={{
            flex: 1,
            color: t.text,
            fontFamily: fonts.body,
            fontSize: 16,
          }}
        />
      </Line>
      {row({
        item: null,
        label: "Nothing in particular",
        detail: "Just focus",
        icon: "none",
      })}
      {choices.map(row)}
    </Sheet>
  )
}

// ---------------------------------------------------------------- time card

/** Time spent on a task or habit, against its estimate where it has one,
 * with its recent sessions and a way to start focusing on it. */
export function FocusTimeCard({
  item,
  estimateMin,
  estimateLabel = "estimate",
  against = "total",
  onStart,
}: {
  item: FocusItem
  estimateMin?: number
  estimateLabel?: string
  /** What the estimate is measured against: all time spent (a task), or
   * today's (a habit's daily target). */
  against?: "total" | "today"
  onStart: () => void
}) {
  const t = useTheme()
  const s = useFocusState()
  const time = useMemo(
    () => C.itemTime(s, item.kind, item.id),
    [s, item.kind, item.id],
  )
  const est = estimateMin ? estimateMin * 60 : 0
  const spent = against === "today" ? time.todaySec : time.sec
  const share = est ? spent / est : 0
  const over = est > 0 && spent > est
  return (
    <Frame style={{ padding: 16, gap: 12 }}>
      <Line>
        <Timer size={18} color={t.foc} />
        <Copy weight="semibold" style={{ flex: 1 }}>
          Time spent
        </Copy>
        <Tap
          label={`Start focusing on ${item.title ?? "this"}`}
          onPress={onStart}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 12,
            height: 36,
            borderRadius: 18,
            backgroundColor: `${t.foc}1f`,
          }}
        >
          <Play size={14} color={t.foc} fill={t.foc} />
          <Copy size={14} weight="medium" style={{ color: t.foc }}>
            Focus
          </Copy>
        </Tap>
      </Line>
      <Line style={{ gap: 20, alignItems: "flex-end" }}>
        <View>
          <Copy size={28} style={{ fontFamily: fonts.mono, lineHeight: 34 }}>
            {L.fmtHm(time.sec)}
          </Copy>
          <Copy size={12} muted>
            {est && against === "total"
              ? `of ${L.fmtHm(est)} ${estimateLabel}`
              : "all time"}
          </Copy>
        </View>
        <View>
          <Copy size={16} style={{ fontFamily: fonts.mono }}>
            {L.fmtHm(time.todaySec)}
          </Copy>
          <Copy size={12} muted>
            today
          </Copy>
        </View>
        <View>
          <Copy size={16} style={{ fontFamily: fonts.mono }}>
            {L.fmtHm(time.weekSec)}
          </Copy>
          <Copy size={12} muted>
            7 days
          </Copy>
        </View>
      </Line>
      {est > 0 && (
        <View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.soft }}>
            <View
              style={{
                height: 8,
                borderRadius: 4,
                width: `${Math.min(100, share * 100)}%`,
                backgroundColor: over ? t.warn : t.foc,
              }}
            />
          </View>
          <Copy
            size={12}
            muted={!over}
            style={{ marginTop: 6, ...(over ? { color: t.warn } : {}) }}
          >
            {over
              ? `${L.fmtHm(spent - est)} over the ${estimateLabel}`
              : against === "today"
                ? `${L.fmtHm(spent)} of ${L.fmtHm(est)} ${estimateLabel}`
                : `${L.fmtHm(est - spent)} left of the ${estimateLabel}`}
          </Copy>
        </View>
      )}
      {time.recent.length ? (
        <View style={{ gap: 6 }}>
          {time.recent.slice(0, 3).map((r) => (
            <Tap
              key={r.sessionId}
              label={`Session on ${r.day}`}
              onPress={() => go(`/focus/day?day=${r.day}`)}
            >
              <Line>
                <Copy size={14} muted style={{ flex: 1 }}>
                  {dayLabel(r.day)} · {clockOf(new Date(r.startedAt).getTime())}
                </Copy>
                <Copy size={14} style={{ fontFamily: fonts.mono }}>
                  {L.fmtHm(r.sec)}
                </Copy>
              </Line>
            </Tap>
          ))}
        </View>
      ) : (
        <Copy size={12} muted>
          Time you spend on this with the focus timer adds up here.
        </Copy>
      )}
    </Frame>
  )
}
