// Pieces the Focus screens share (ADR-0025): the day timeline, the picker
// for what is being worked on, and the time-spent card a task or habit page
// shows.

import { saveFocusSettings, startFocus } from "@domain/focus/actions"
import * as C from "@domain/focus/calc"
import { type FocusItem, type FocusMode, PRESETS } from "@domain/focus/data"
import * as L from "@domain/focus/logic"
import { useFocusState } from "@domain/focus/store"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import type { TaskList } from "@domain/tasks/data"
import * as TL from "@domain/tasks/logic"
import { tasksStore } from "@domain/tasks/store"
import {
  CheckSquare,
  CircleSlash,
  Hourglass,
  Play,
  Search,
  Target,
  Timer,
  X,
} from "lucide-react-native"
import { type ReactNode, useMemo, useRef, useState } from "react"
import { TextInput, View } from "react-native"
import Svg, {
  Circle,
  Defs,
  G,
  Path,
  Pattern,
  Rect,
  Line as SvgLine,
} from "react-native-svg"
import { strokeAcross } from "./brand/scribble"
import { type PickerRow, pickerSections } from "./focus-picker"
import { border, Copy, chosen, Frame, Line, Tap } from "./native-kit"
import { go } from "./navigation"
import { PriorityMark } from "./task-editor"
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
        {/* The brand's hand-drawn line (ADR-0032): a dotted track, the arc,
            and a thinner echo just inside it. */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={t.muted}
          strokeWidth={Math.max(1.4, stroke * 0.3)}
          strokeDasharray={`0.5 ${Math.max(4, stroke * 0.9)}`}
          strokeLinecap="round"
          opacity={0.5}
          fill="none"
        />
        {p > 0 && (
          <>
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
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={r - stroke * 0.22}
              stroke={color}
              strokeWidth={Math.max(1, stroke * 0.38)}
              strokeLinecap="round"
              strokeDasharray={`${c * p * 0.98} ${c}`}
              opacity={0.5}
              fill="none"
              transform={`rotate(-89 ${size / 2} ${size / 2})`}
            />
          </>
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
              <Copy size={12} muted>
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
            size={12}
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
                      size={12}
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

/** The current session as one hand-drawn line (ADR-0032): focus blocks
 * drawn in the Focus colour, breaks lighter, pauses left as the dotted
 * track, each in proportion to its time. */
export function SessionStrip({ blocks }: { blocks: C.Block[] }) {
  const t = useTheme()
  if (!blocks.length) return null
  const lo = blocks[0].start
  const hi = Math.max(...blocks.map((b) => b.end))
  const span = Math.max(1, hi - lo)
  const W = 200,
    H = 12,
    y = H / 2,
    x = (ms: number) => 3 + ((ms - lo) / span) * (W - 6)
  return (
    <Svg
      accessibilityElementsHidden
      width="100%"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
    >
      <Path
        d={`M3 ${y} H${W - 3}`}
        stroke={t.muted}
        strokeWidth={1.4}
        strokeDasharray="1 4"
        strokeLinecap="round"
        opacity={0.5}
        vectorEffect="non-scaling-stroke"
      />
      {blocks
        .filter((b) => b.kind !== "pause" && b.end > b.start)
        .map((b, i) => {
          const d = strokeAcross(
            x(b.start),
            Math.max(x(b.start) + 1, x(b.end)),
            y,
            i + 3,
          )
          const focus = b.kind === "focus"
          return (
            <G key={`${b.segmentId}-${b.start}`} opacity={focus ? 1 : 0.4}>
              <Path
                d={d}
                stroke={t.foc}
                strokeWidth={6}
                strokeLinecap="round"
                fill="none"
                vectorEffect="non-scaling-stroke"
              />
              <Path
                d={d}
                stroke={t.foc}
                strokeWidth={2.4}
                strokeLinecap="round"
                fill="none"
                opacity={0.5}
                transform="translate(0.6 -1)"
                vectorEffect="non-scaling-stroke"
              />
            </G>
          )
        })}
    </Svg>
  )
}

// ---------------------------------------------------------------- picker

/** Pick what the time goes to: an open task, an active habit, or nothing.
 * Tasks come by when they are due, then by priority (the order is in
 * focus-picker); "Nothing in particular" is the way out, drawn apart above
 * the list rather than as one more choice. */
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
  const lists = tasksStore.use((s) => s.lists)
  const habits = habitsStore.use((s) => s.habits)
  const [q, setQ] = useState("")
  const today = dayKey()
  const sections = useMemo(
    () => pickerSections(tasks, habits, q, today),
    [tasks, habits, q, today],
  )
  const pick = (item: FocusItem | null) => {
    onPick(item)
    onClose()
  }
  const none = current === null
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
        {q ? (
          <Tap
            label="Clear search"
            onPress={() => setQ("")}
            style={{ padding: 6 }}
          >
            <X size={16} color={t.muted} />
          </Tap>
        ) : null}
      </Line>
      {/* The way out: an outlined action, dashed, not a card like the
          tasks below it. */}
      <Tap
        label="Nothing in particular"
        selected={none}
        onPress={() => pick(null)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 44,
          paddingHorizontal: 12,
          borderRadius: 22,
          borderWidth: none ? 2 : 1,
          borderStyle: none ? "solid" : "dashed",
          borderColor: none ? t.text : t.input,
          alignSelf: "flex-start",
        }}
      >
        <CircleSlash size={16} color={t.muted} />
        <Copy size={14} weight="medium">
          Nothing in particular
        </Copy>
        <Copy size={13} muted>
          · just focus
        </Copy>
      </Tap>
      {sections.length ? (
        sections.map((sec) => (
          <View key={sec.key} style={{ gap: 8, marginTop: 4 }}>
            <Copy
              size={12}
              weight="semibold"
              muted
              style={{ letterSpacing: 0.4, textTransform: "uppercase" }}
            >
              {sec.title}
            </Copy>
            {sec.rows.map((r) => (
              <PickerRowView
                key={L.itemKey(r.item)}
                row={r}
                lists={lists}
                today={today}
                picked={!!current && L.itemKey(r.item) === L.itemKey(current)}
                onPress={() => pick(r.item)}
              />
            ))}
            {sec.more > 0 ? (
              <Copy size={12} muted>
                {`${sec.more.toLocaleString("en-US")} more · search to find them`}
              </Copy>
            ) : null}
          </View>
        ))
      ) : (
        <Copy size={14} muted style={{ paddingVertical: 8 }}>
          {q.trim()
            ? `Nothing matches \u201c${q.trim()}\u201d`
            : "No open tasks or active habits"}
        </Copy>
      )}
    </Sheet>
  )
}

/** One choice: its icon, the title (wraps, never truncated), and for a task
 * what decides whether to work on it now: priority first, then when it is
 * due (late in red), its time, list and estimate. */
function PickerRowView({
  row: r,
  lists,
  today,
  picked,
  onPress,
}: {
  row: PickerRow
  lists: TaskList[]
  today: string
  picked: boolean
  onPress: () => void
}) {
  const t = useTheme()
  const x = r.task
  const habit = r.item.kind === "habit"
  const Icon = habit ? Target : CheckSquare
  const list = x?.listId ? lists.find((l) => l.id === x.listId) : undefined
  const late = !!x?.dueDate && x.dueDate < today
  const meta = !!x && (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        columnGap: 8,
        rowGap: 2,
      }}
    >
      <PriorityMark priority={x.priority} />
      {x.dueDate && (late || x.dueDate > today) ? (
        <Copy
          size={12}
          weight={late ? "medium" : undefined}
          muted={!late}
          style={late ? { color: t.bad } : undefined}
        >
          {late
            ? `late ${TL.diffDays(x.dueDate, today)}d`
            : TL.fmtDay(x.dueDate, today)}
        </Copy>
      ) : null}
      {x.dueTime ? (
        <Copy size={12} muted>
          {TL.fmtTime(x.dueTime)}
        </Copy>
      ) : null}
      {list ? (
        <Line style={{ gap: 4 }}>
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: t[list.color],
            }}
          />
          <Copy size={12} muted>
            {list.name}
          </Copy>
        </Line>
      ) : null}
      {x.estimateMin ? (
        <View
          accessible
          accessibilityLabel={`Estimate ${L.fmtHm(x.estimateMin * 60)}`}
          style={{ flexDirection: "row", alignItems: "center", gap: 2 }}
        >
          <Hourglass size={12} color={t.muted} />
          <Copy size={12} muted>
            {L.fmtHm(x.estimateMin * 60)}
          </Copy>
        </View>
      ) : null}
    </View>
  )
  const hasMeta =
    !!x &&
    ((!!x.priority && x.priority !== "none") ||
      (!!x.dueDate && x.dueDate !== today) ||
      !!x.dueTime ||
      !!list ||
      !!x.estimateMin)
  return (
    <Tap
      label={r.label}
      selected={picked}
      onPress={onPress}
      style={{
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 12,
        ...chosen(t, picked),
      }}
    >
      {/* A long title wraps and the row grows; the icon stays on its
          first line. */}
      <Line style={{ alignItems: "flex-start" }}>
        <Icon
          size={18}
          style={{ marginTop: 3 }}
          color={habit ? t.hab : t.tsk}
        />
        <View style={{ flex: 1, gap: 3 }}>
          <Copy weight="medium">
            {r.label}
            {x?.starred ? (
              <Copy size={14} style={{ color: t.warn }}>
                {" \u2605"}
              </Copy>
            ) : null}
          </Copy>
          {hasMeta ? meta : null}
        </View>
      </Line>
    </Tap>
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
}: {
  item: FocusItem
  estimateMin?: number
  estimateLabel?: string
  /** What the estimate is measured against: all time spent (a task), or
   * today's (a habit's daily target). */
  against?: "total" | "today"
}) {
  const t = useTheme()
  const s = useFocusState()
  const [choosing, setChoosing] = useState(false)
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
          onPress={() => setChoosing(true)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 12,
            height: 36,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: t.input,
            backgroundColor: t.card,
          }}
        >
          <Play size={14} color={t.text} fill={t.text} />
          <Copy size={14} weight="medium">
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
              onPress={() => go(`/focus?day=${r.day}`)}
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
      {choosing && (
        <StartFocusSheet item={item} onClose={() => setChoosing(false)} />
      )}
    </Frame>
  )
}

/** Pick how to focus on a task or habit: one tap on Pomodoro or Stopwatch
 * starts it. The highlighted one is the default: the last choice made here
 * (saved as the settings' default mode, so the Focus screen opens on it
 * too). */
export function StartFocusSheet({
  item,
  onClose,
}: {
  item: FocusItem
  onClose: () => void
}) {
  const t = useTheme()
  const st = useFocusState().settings
  const [open, setOpen] = useState(true)
  // Navigate once the sheet's modal is gone: iOS ignores a navigation
  // presented while it is still leaving.
  const then = useRef<(() => void) | null>(null)
  const [f, b] =
    st.preset === "custom"
      ? [st.focusMin, st.shortBreakMin]
      : PRESETS[st.preset].lengths
  const begin = (mode: FocusMode) => {
    saveFocusSettings({ mode })
    startFocus({ mode, item })
    then.current = () => go("/focus")
    setOpen(false)
  }
  const options: {
    mode: FocusMode
    icon: typeof Timer
    title: string
    detail: string
  }[] = [
    {
      mode: "pomodoro",
      icon: Hourglass,
      title: "Pomodoro",
      detail: `${f} min focus, then a ${b} min break`,
    },
    {
      mode: "stopwatch",
      icon: Timer,
      title: "Stopwatch",
      detail: "Counts up until you stop",
    },
  ]
  return (
    <Sheet
      title="How do you want to focus?"
      open={open}
      onClose={() => setOpen(false)}
      onClosed={() => {
        onClose()
        then.current?.()
      }}
    >
      {item.title ? (
        <Copy size={14} muted>
          On {item.title}. You can switch while it runs.
        </Copy>
      ) : null}
      {options.map((o) => {
        const sel = st.mode === o.mode
        return (
          <Tap
            key={o.mode}
            label={`Start ${o.title}`}
            selected={sel}
            onPress={() => begin(o.mode)}
            style={{ ...chosen(t, sel), padding: 12, borderRadius: 16 }}
          >
            <Line>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: border(t.foc, 0.15),
                }}
              >
                <o.icon size={20} color={t.foc} />
              </View>
              <View style={{ flex: 1 }}>
                <Line style={{ gap: 8, flexWrap: "wrap" }}>
                  <Copy weight="medium">{o.title}</Copy>
                  {sel && (
                    <Copy size={12} style={{ color: t.foc }}>
                      Default
                    </Copy>
                  )}
                </Line>
                <Copy size={12} muted>
                  {o.detail}
                </Copy>
              </View>
              <Play size={16} color={t.text} fill={t.text} />
            </Line>
          </Tap>
        )
      })}
    </Sheet>
  )
}
