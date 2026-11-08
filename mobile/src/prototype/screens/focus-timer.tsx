// The focus timer (ADR-0025): a Pomodoro or a free stopwatch, on a task, a
// habit or nothing. What it shows is read from the session's timestamps
// every second, so it is right after the app was killed or the phone
// locked; nothing here counts.

import { dashStore } from "@domain/dash/store"
import * as A from "@domain/focus/actions"
import * as C from "@domain/focus/calc"
import {
  type FocusItem,
  type FocusMode,
  PRESETS,
  type PresetKey,
} from "@domain/focus/data"
import * as L from "@domain/focus/logic"
import { focusStore, useFocusState } from "@domain/focus/store"
import * as HA from "@domain/habits/actions"
import * as H from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { liveStore } from "@domain/lib/live"
import * as TA from "@domain/tasks/actions"
import { tasksStore } from "@domain/tasks/store"
import {
  ChartColumn,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Pause,
  Play,
  Plus,
  Settings,
  Share2,
  SkipForward,
  Target,
  Timer,
  X,
} from "lucide-react-native"
import { useEffect, useMemo, useRef, useState } from "react"
import { ScrollView, type ScrollViewInstance, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useMomentTimer } from "../big-moment"
import { TrophyBadge } from "../brand/badge"
import { CornerMotif } from "../brand/corner"
import { ItemPicker, SessionStrip, TimerRing } from "../focus-kit"
import { MomentCard } from "../moment"
import { claimOnce } from "../moments-seen"
import { AnimatedCheck, markCompletion } from "../motion"
import {
  Bar,
  border,
  Copy,
  chosen,
  Frame,
  IconTap,
  Line,
  Segmented,
  Tap,
} from "../native-kit"
import { back, go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Button, confirm, Sheet, undo, useNow } from "../ui"
import { FocusDayPanel } from "./focus-day"

type PresetChoice = PresetKey | "custom"

export function FocusTimer({ day }: { day?: string } = {}) {
  const t = useTheme(),
    safe = useSafeAreaInsets(),
    s = useFocusState(),
    now = useNow(),
    live = liveStore.use((x) => x.live),
    [mode, setMode] = useState<FocusMode>(s.settings.mode),
    [preset, setPreset] = useState<PresetChoice>(s.settings.preset),
    [pick, setPick] = useState(false),
    [next, setNext] = useState<FocusItem | null>(null),
    [ending, setEnding] = useState(false),
    // The session just ended, shown as a card in place of a silent stop.
    [ended, setEnded] = useState<Ended | null>(null),
    [goalMoment, setGoalMoment] = useState(false)
  const scroll = useRef<ScrollViewInstance>(null),
    scrolled = useRef(false)
  // Write down a set that ended on screen, so it syncs as it happens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: now is the clock tick
  useEffect(() => A.tickFocus(), [now])
  const session = A.current(s),
    tl = useMemo(
      () => (session ? L.advance(A.timelineOf(s, session), now) : null),
      [s, session, now],
    ),
    p = tl ? L.phase(tl, now) : null,
    today = dayKey(new Date(now)),
    todaySec = useMemo(
      () => C.rangeStats(s, today, today, now).byDay[today] ?? 0,
      [s, today, now],
    ),
    goal = C.goalSec(s),
    blocks = useMemo(
      () =>
        session
          ? C.dayBlocks(s, today, now).filter((b) => b.sessionId === session.id)
          : [],
      [s, session, today, now],
    )
  const goalKey = `focus-goal:${today}`,
    goalHit = goal > 0 && todaySec >= goal
  // The daily goal is cheered once a day, the moment it is crossed (or the
  // first time this screen sees it crossed).
  const [endedUp, closeEnded] = useMomentTimer(!!ended, 4500)
  useEffect(() => {
    if (goalHit && !endedUp && claimOnce(goalKey)) setGoalMoment(true)
  }, [goalHit, endedUp, goalKey])
  useEffect(() => {
    if (!goalMoment) return
    const id = setTimeout(() => setGoalMoment(false), 4000)
    return () => clearTimeout(id)
  }, [goalMoment])
  const goalUp = goalMoment && !endedUp,
    closeGoal = () => setGoalMoment(false)
  const streak = useMemo(
    () => (endedUp || goalUp ? C.streaks(s, 400, now).current : 0),
    [endedUp, goalUp, s, now],
  )
  const lengths: [number, number, number, number] =
    preset === "custom"
      ? [
          s.settings.focusMin,
          s.settings.shortBreakMin,
          s.settings.longBreakMin,
          s.settings.setsBeforeLong,
        ]
      : PRESETS[preset].lengths
  const start = () => {
    if (live && live.kind !== "focus") {
      confirm(
        "Another activity is running",
        `Finish or pause ${live.label} before starting a focus session.`,
        () => go(live.href),
      )
      return
    }
    A.startFocus({
      mode,
      preset: mode === "pomodoro" ? preset : undefined,
      lengths,
      item: next,
    })
  }
  const item = p?.item ?? session?.item ?? null
  const progress = p?.plannedSec
    ? p.elapsed / p.plannedSec
    : p
      ? (p.elapsed % 3600) / 3600
      : 0
  const clock = !p
    ? L.fmtClock(mode === "pomodoro" ? lengths[0] * 60 : 0)
    : p.remaining !== null
      ? L.fmtClock(p.remaining)
      : L.fmtClock(p.elapsed)
  const sets = tl?.sess.setsBeforeLong ?? lengths[3]
  const status = !p
    ? mode === "pomodoro"
      ? `${lengths[0]} min focus · ${lengths[1]} min break`
      : "Counts up until you stop"
    : p.status === "paused"
      ? `Paused · ${p.kind === "break" ? "break" : `set ${p.setIndex + 1}`}`
      : p.status === "waiting"
        ? p.kind === "break"
          ? `Set ${p.setIndex + 1} done · ${p.longBreak ? "long " : ""}break next`
          : `Break over · set ${p.setIndex + 1} next`
        : p.kind === "break"
          ? p.longBreak
            ? "Long break"
            : "Short break"
          : tl?.sess.mode === "stopwatch"
            ? "Stopwatch"
            : `Focus · set ${p.setIndex + 1} of ${sets}`
  const round = (size: number, color: string) => ({
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: color,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  })
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.bg,
        paddingTop: safe.top,
        paddingBottom: safe.bottom,
      }}
    >
      {/* The card library's page header: back, the title on the left, the
          settings gear on the right. */}
      <Line style={{ height: 56, paddingHorizontal: 8, gap: 4 }}>
        <IconTap
          size={44}
          icon={ChevronLeft}
          label={session ? "Back, the session keeps running" : "Back"}
          color={t.text}
          onPress={() => back("/today")}
        />
        <Text
          accessibilityRole="header"
          style={{
            flex: 1,
            fontFamily: fonts.displayMedium,
            fontSize: 20,
            lineHeight: 28,
            color: t.text,
          }}
        >
          Focus
        </Text>
        <IconTap
          size={40}
          icon={Share2}
          label="Share your focus"
          color={t.text}
          onPress={() => go(day ? `/focus/share?day=${day}` : "/focus/share")}
        />
        <IconTap
          size={40}
          icon={Settings}
          label="Focus settings"
          color={t.text}
          onPress={() => go("/focus/settings")}
        />
      </Line>
      <ScrollView
        ref={scroll}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: 32,
          gap: 20,
          alignItems: "center",
        }}
      >
        {session && tl && tl.sess.end === null && (
          // Switch the running session; the time focused so far carries
          // over (the rule is on L.switchMode).
          <View style={{ width: "100%" }}>
            <Segmented
              value={tl.sess.mode}
              onChange={(m) => {
                A.switchFocusMode(m)
                setMode(m)
              }}
              options={[
                { value: "pomodoro", label: "Pomodoro" },
                { value: "stopwatch", label: "Stopwatch" },
              ]}
            />
          </View>
        )}
        {!session && (
          <View style={{ width: "100%", gap: 12 }}>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: "pomodoro", label: "Pomodoro" },
                { value: "stopwatch", label: "Stopwatch" },
              ]}
            />
            {mode === "pomodoro" && (
              // Lengths as chips; the chosen one has the ink outline.
              <Line style={{ gap: 8, flexWrap: "wrap" }}>
                {[
                  ...(Object.keys(PRESETS) as PresetKey[]).map((k) => ({
                    value: k as PresetChoice,
                    label: `${PRESETS[k].lengths[0]}/${PRESETS[k].lengths[1]}`,
                  })),
                  { value: "custom" as PresetChoice, label: "Custom" },
                ].map((o) => (
                  <Tap
                    key={o.value}
                    label={`${o.label}${o.value === "custom" ? "" : " minutes"}`}
                    selected={preset === o.value}
                    onPress={() => setPreset(o.value)}
                    style={{
                      minHeight: 40,
                      paddingHorizontal: 14,
                      borderRadius: 99,
                      justifyContent: "center",
                      ...chosen(t, preset === o.value),
                    }}
                  >
                    <Copy
                      size={14}
                      weight="medium"
                      style={{ fontVariant: ["tabular-nums"] }}
                    >
                      {o.label}
                    </Copy>
                  </Tap>
                ))}
              </Line>
            )}
          </View>
        )}
        <ItemChip
          item={session ? item : next}
          onPress={() => setPick(true)}
          switching={!!session}
          now={now}
        />
        <TimerRing
          value={progress}
          size={264}
          stroke={10}
          color={p?.kind === "break" ? t.good : t.foc}
        >
          <Copy
            size={60}
            lines={1}
            weight="semibold"
            style={{
              lineHeight: 68,
              letterSpacing: -1.5,
              paddingHorizontal: 16,
              fontVariant: ["tabular-nums"],
              color: p?.status === "paused" ? t.muted : t.text,
            }}
          >
            {clock}
          </Copy>
          <Copy size={14} muted lines={1} style={{ maxWidth: 200 }}>
            {status}
          </Copy>
          {tl?.sess.mode === "pomodoro" && (
            <Line style={{ gap: 6, marginTop: 10 }}>
              {Array.from({ length: sets }, (_, i) => {
                const k = (p?.setIndex ?? 0) - ((p?.setIndex ?? 0) % sets) + i
                const done =
                  L.setsCompleted(
                    {
                      sess: tl.sess,
                      segs: tl.segs.filter((g) => g.setIndex === k),
                    },
                    now,
                  ) > 0
                return (
                  <View
                    key={i}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: done ? t.foc : t.soft,
                    }}
                  />
                )
              })}
            </Line>
          )}
        </TimerRing>
        {/* Controls after the card library: the one filled moss button in
            the middle, outlined pills beside it that say what they do. */}
        {!session ? (
          <Tap label="Start focus" onPress={start} style={round(88, t.primary)}>
            <Play size={36} color={t.onPrimary} fill={t.onPrimary} />
          </Tap>
        ) : (
          <Line style={{ gap: 16, alignItems: "center" }}>
            <View style={{ flex: 1, alignItems: "flex-end" }}>
              {p?.kind === "break" ? (
                <SidePill
                  icon={SkipForward}
                  label="Skip"
                  name="Skip the break"
                  onPress={A.skipBreak}
                />
              ) : p?.plannedSec && p.status !== "waiting" ? (
                <SidePill
                  icon={Plus}
                  label="5m"
                  name="Add 5 minutes"
                  onPress={() => A.extendFocus(300)}
                />
              ) : null}
            </View>
            {p?.status === "waiting" ? (
              <Tap
                label={
                  p.kind === "break"
                    ? "Start the break"
                    : `Start set ${p.setIndex + 1}`
                }
                onPress={A.nextFocus}
                style={round(80, t.primary)}
              >
                {p.kind === "break" ? (
                  <Coffee size={30} color={t.onPrimary} />
                ) : (
                  <Play size={32} color={t.onPrimary} fill={t.onPrimary} />
                )}
              </Tap>
            ) : (
              <Tap
                label={p?.status === "paused" ? "Resume" : "Pause"}
                onPress={() =>
                  p?.status === "paused" ? A.resumeFocus() : A.pauseFocus()
                }
                style={round(80, t.primary)}
              >
                {p?.status === "paused" ? (
                  <Play size={32} color={t.onPrimary} fill={t.onPrimary} />
                ) : (
                  <Pause size={32} color={t.onPrimary} fill={t.onPrimary} />
                )}
              </Tap>
            )}
            <View style={{ flex: 1, alignItems: "flex-start" }}>
              <SidePill
                icon={X}
                label="End"
                name="End session"
                onPress={() => setEnding(true)}
              />
            </View>
          </Line>
        )}
        {session && blocks.length > 0 && (
          <Frame style={{ width: "100%", padding: 16, gap: 8 }}>
            <CornerMotif kind="vine" seed={5} size={96} />
            <SessionStrip blocks={blocks} />
            <Line>
              <Copy size={13} muted style={{ flex: 1 }}>
                This session · {L.fmtHm(tl ? L.focusSec(tl, now) : 0)} focused
              </Copy>
              <Copy size={13} muted>
                {pauseLabel(blocks.filter((b) => b.kind === "pause").length)}
              </Copy>
            </Line>
          </Frame>
        )}
        <TodayGoal sec={todaySec} goal={goal} />
        <View style={{ width: "100%" }}>
          <NavRow
            icon={ChartColumn}
            label="Focus stats"
            detail="Hours, goal streak, time by item"
            onPress={() => go("/focus/stats")}
          />
        </View>
        {/* The day's blocks, here rather than a page of their own; a link
            to a day (/focus?day=…) scrolls down to it. */}
        <View
          style={{ width: "100%" }}
          onLayout={(e) => {
            if (!day || scrolled.current) return
            scrolled.current = true
            const y = e.nativeEvent.layout.y
            requestAnimationFrame(() =>
              scroll.current?.scrollTo({ y: Math.max(0, y - 8) }),
            )
          }}
        >
          <FocusDayPanel day={day} />
        </View>
        <Copy size={12} muted style={{ textAlign: "center" }}>
          Safe to lock your phone or close the app: the timer keeps time from
          when each block started.
        </Copy>
      </ScrollView>
      <ItemPicker
        open={pick}
        onClose={() => setPick(false)}
        current={session ? item : next}
        onPick={(i) => {
          if (session) {
            A.switchFocusItem(i)
          } else setNext(i)
        }}
      />
      <Sheet
        title="End this session?"
        open={ending}
        onClose={() => setEnding(false)}
      >
        <Copy size={14} muted>
          {tl
            ? `${L.fmtHm(L.focusSec(tl, now))} focused${
                tl.sess.mode === "pomodoro"
                  ? `, ${L.setsCompleted(tl, now)} of ${tl.sess.setsBeforeLong} sets`
                  : ""
              }.`
            : ""}
        </Copy>
        <Button
          onPress={() => {
            if (tl) {
              const sec = L.focusSec(tl, now)
              setEnded({
                key: tl.sess.id,
                title: item?.title ?? "Focus session",
                sec,
                sets:
                  tl.sess.mode === "pomodoro"
                    ? [L.setsCompleted(tl, now), tl.sess.setsBeforeLong]
                    : null,
                // This session carried the day over the goal: one card says
                // both, and the goal card does not follow.
                goal: goal > 0 && todaySec >= goal && claimOnce(goalKey),
                short: goal > 0 && todaySec < goal ? goal - todaySec : 0,
              })
            }
            A.stopFocus()
            setEnding(false)
          }}
        >
          End and keep it
        </Button>
        <Button tone="quiet" onPress={() => setEnding(false)}>
          Keep going
        </Button>
        <Button
          tone="danger"
          onPress={() => {
            A.stopFocus(true)
            setEnding(false)
          }}
        >
          Discard session
        </Button>
      </Sheet>
      {endedUp && ended && (
        <SessionDone
          key={ended.key}
          ended={ended}
          streak={streak}
          onClose={closeEnded}
        />
      )}
      {goalUp && !endedUp && (
        <MomentCard
          kind="focus"
          testID="focus-goal-moment"
          label="Daily focus goal reached"
          title={`${L.fmtHm(goal)} of deep work today`}
          detail={
            streak > 1 ? (
              <Copy size={13} muted>
                {streak}-day goal streak
              </Copy>
            ) : null
          }
          badge={<TrophyBadge type="goal" size={42} color={t.foc} />}
          tint={t.good}
          discColor={border(t.good, 0.14)}
          say={`Daily focus goal reached: ${L.fmtHm(goal)}.${streak > 1 ? ` ${streak}-day goal streak.` : ""}`}
          hint="Opens focus stats"
          onOpen={() => {
            closeGoal()
            go("/focus/stats")
          }}
          onClose={closeGoal}
        />
      )}
    </View>
  )
}

interface Ended {
  key: string
  title: string
  sec: number
  /** Sets finished of the planned run; null for a stopwatch. */
  sets: [number, number] | null
  /** This session reached today's goal. */
  goal: boolean
  /** Seconds still short of today's goal; 0 when met or none is set. */
  short: number
}

/** What a session came to: its time, its sets, the goal streak. A day
 * still short of its goal says by how much, in the warning colour. */
function SessionDone({
  ended: e,
  streak,
  onClose,
}: {
  ended: Ended
  streak: number
  onClose: () => void
}) {
  const t = useTheme()
  const nb = (x: string) => x.replace(/ /g, "\u00a0")
  const parts = [
    L.fmtHm(e.sec),
    ...(e.sets ? [`${e.sets[0]} of ${e.sets[1]} sets`] : []),
    ...(streak > 1 ? [`${streak}-day goal streak`] : []),
  ]
  const sep = "\u00a0· "
  const short = e.short > 0 ? `${L.fmtHm(e.short)} to today's goal` : ""
  return (
    <MomentCard
      kind="focus"
      testID="focus-session-done"
      label={e.goal ? "Session done · daily goal reached" : "Session done"}
      title={e.title}
      detail={
        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: 13,
            lineHeight: 18,
            color: t.muted,
            fontVariant: ["tabular-nums"],
          }}
        >
          {parts.map(nb).join(sep)}
          {short ? (
            <Text style={{ color: t.warn, fontFamily: fonts.medium }}>
              {`${sep}${nb(short)}`}
            </Text>
          ) : null}
        </Text>
      }
      badge={<Timer size={22} color={t.foc} />}
      tint={t.good}
      discColor={border(t.foc, 0.14)}
      say={`Focus session done: ${parts.join(", ")}${short ? `, ${short}` : ""}.`}
      hint="Opens focus stats"
      onOpen={() => {
        onClose()
        go("/focus/stats")
      }}
      onClose={onClose}
    />
  )
}

const pauseLabel = (n: number) =>
  n === 0
    ? "No pauses"
    : n === 1
      ? "1 pause"
      : `${n.toLocaleString("en-US")} pauses`

function ItemChip({
  item,
  onPress,
  switching,
  now,
}: {
  item: FocusItem | null
  onPress: () => void
  switching: boolean
  now: number
}) {
  const t = useTheme()
  const [done, setDone] = useState(false)
  const Icon = item?.kind === "habit" ? Target : CheckSquare
  return (
    // A card row, as in the card library: the check (or the item's icon),
    // what the session is on, and Switch / Pick in moss on the right.
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingLeft: item ? 6 : 8,
        paddingRight: 6,
        minHeight: 52,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: t.line,
        backgroundColor: t.card,
        width: "100%",
      }}
    >
      {item?.kind === "task" ? (
        <TaskCheck key={item.id} id={item.id} onDone={setDone} />
      ) : item?.kind === "habit" ? (
        <HabitCheck key={item.id} id={item.id} now={now} onDone={setDone} />
      ) : null}
      <Tap
        label={
          item
            ? `Working on ${item.title}. ${done ? "Pick the next item" : "Change"}`
            : "Pick what you're working on"
        }
        onPress={onPress}
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingVertical: 12,
          paddingHorizontal: 8,
        }}
      >
        {item && !checkable(item) ? (
          <Icon size={16} color={item.kind === "habit" ? t.hab : t.tsk} />
        ) : null}
        {/* What the session is on: it wraps, never truncates. */}
        <Copy
          size={15}
          weight="medium"
          style={{
            flex: 1,
            ...(done
              ? { color: t.muted, textDecorationLine: "line-through" }
              : {}),
          }}
        >
          {item?.title ??
            (switching ? "Nothing in particular" : "What are you working on?")}
        </Copy>
        <Copy size={14} weight="medium" style={{ color: t.primary }}>
          {done ? "Next" : switching ? "Switch" : "Pick"}
        </Copy>
      </Tap>
    </View>
  )
}

// The kinds the pill shows a check for (anything else keeps its icon).
const checkable = (item: FocusItem) =>
  item.kind === "task"
    ? !!TA.getTask(item.id)
    : (() => {
        const h = habitsStore.get().habits.find((x) => x.id === item.id)
        return !!h && !(h.rule && dashStore.get().enabled.screen)
      })()

/** Checks off the focused task where it is shown. The session keeps timing:
 * the time already focused stays on the task, and the pill then suggests
 * picking the next item. */
function TaskCheck({
  id,
  onDone,
}: {
  id: string
  onDone: (done: boolean) => void
}) {
  const t = useTheme(),
    task = tasksStore.use((s) => s.tasks.find((x) => x.id === id)),
    done = task?.status === "done"
  useEffect(() => onDone(done), [done, onDone])
  // Another item (or none) takes the pill: it is not done.
  useEffect(() => () => onDone(false), [onDone])
  if (!task) return null
  const toggle = () => {
    if (done) {
      TA.uncompleteTask(id)
      return
    }
    TA.completeTask(id)
    markCompletion()
    undo("Task complete", () => TA.uncompleteTask(id))
  }
  return (
    <AnimatedCheck
      checked={done}
      onToggle={toggle}
      label={`${done ? "Reopen" : "Complete"} ${task.title}`}
      color={t.tsk}
      idle={`${t.muted}66`}
      size={30}
      checkColor={t.dark ? t.bg : "#fff"}
    />
  )
}

/** Checks off the focused habit as its type is logged everywhere else: a
 * check is ticked, a count steps up (and its check marks it done), and a
 * timed habit records the minutes focused on it today, so checking it twice
 * never counts the same time twice. */
function HabitCheck({
  id,
  now,
  onDone,
}: {
  id: string
  now: number
  onDone: (done: boolean) => void
}) {
  const t = useTheme(),
    today = dayKey(new Date(now)),
    habit = habitsStore.use((s) => s.habits.find((x) => x.id === id)),
    log = habitsStore.use((s) => H.logIndex(s.logs).get(H.lk(id, today))),
    auto = dashStore.use((s) => s.enabled.screen) && !!habit?.rule,
    done = log?.status === "done",
    [stepped, setStepped] = useState(0)
  useEffect(() => onDone(done), [done, onDone])
  // Another item (or none) takes the pill: it is not done.
  useEffect(() => () => onDone(false), [onDone])
  if (!habit || auto) return null
  const restore = () => {
    HA.clearLog(id, today)
    if (log) HA.restoreLog(log)
  }
  const toggle = () => {
    if (done) {
      HA.clearLog(id, today)
      return
    }
    let minutes = 0
    if (habit.type === "duration") {
      minutes = Math.max(
        1,
        Math.round(
          C.itemTime(focusStore.get(), "habit", id, now).todaySec / 60,
        ),
      )
      HA.logHabit({
        habitId: id,
        day: today,
        status: "done",
        value: minutes,
        source: "timer",
      })
    } else HA.checkHabit(id, today)
    markCompletion()
    undo(
      `${habit.name} done${minutes ? ` · ${H.valueLabel(habit, minutes)}` : ""}`,
      restore,
    )
  }
  const step = () => {
    HA.incrementCount(id, undefined, today)
    const next = H.logIndex(habitsStore.get().logs).get(H.lk(id, today))
    // Only the step that reaches the target ticks the habit off.
    if (H.progressOf(habit, next) < 1) return
    markCompletion()
    setStepped((n) => n + 1)
    undo(`${habit.name} · ${H.valueLabel(habit, next?.value)}`, restore)
  }
  return (
    <>
      <AnimatedCheck
        checked={done}
        onToggle={toggle}
        label={`${done ? "Reopen" : "Complete"} ${habit.name}`}
        color={t.hab}
        idle={`${t.muted}66`}
        size={30}
        checkColor={t.onPrimary}
        progress={H.progressOf(habit, log)}
        celebrate={stepped}
      />
      {habit.type === "count" && !done && (
        <Tap
          label={`Add ${habit.step ?? 1} ${habit.unit ?? ""}`.trim()}
          onPress={step}
          style={{
            minWidth: 36,
            height: 32,
            paddingHorizontal: 8,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: t.input,
            backgroundColor: t.card,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Copy size={12} weight="semibold">
            +{habit.step ?? 1}
          </Copy>
        </Tap>
      )}
    </>
  )
}

/** A control beside the main button: an outlined pill with its symbol and
 * a word ("+ 5m", "× End"); the full name is its accessibility label. */
function SidePill({
  icon: Icon,
  label,
  name,
  onPress,
}: {
  icon: typeof Plus
  label: string
  name: string
  onPress: () => void
}) {
  const t = useTheme()
  return (
    <Tap
      label={name}
      onPress={onPress}
      style={{
        minHeight: 44,
        paddingHorizontal: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.input,
        backgroundColor: t.card,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      <Icon size={16} color={t.text} />
      <Copy size={14} weight="medium" style={{ fontVariant: ["tabular-nums"] }}>
        {label}
      </Copy>
    </Tap>
  )
}

function TodayGoal({ sec, goal }: { sec: number; goal: number }) {
  const t = useTheme()
  return (
    <Frame style={{ width: "100%", padding: 16, gap: 8 }}>
      <CornerMotif kind="sprig" seed={8} size={96} />
      <Line>
        <Copy weight="semibold" style={{ flex: 1 }}>
          Today
        </Copy>
        <Copy weight="semibold" style={{ fontVariant: ["tabular-nums"] }}>
          {L.fmtHm(sec)}
          {goal ? (
            <Copy muted style={{ fontVariant: ["tabular-nums"] }}>
              {` / ${L.fmtHm(goal)}`}
            </Copy>
          ) : null}
        </Copy>
      </Line>
      {goal > 0 && (
        // The hand-drawn line (ADR-0032); green once the goal is reached.
        <Bar
          value={Math.min(1, sec / goal)}
          color={sec >= goal ? t.good : t.foc}
        />
      )}
      <Copy size={13} muted>
        {!goal
          ? "No daily goal set"
          : sec >= goal
            ? "Daily goal reached"
            : `${L.fmtHm(goal - sec)} to your daily goal`}
      </Copy>
    </Frame>
  )
}

function NavRow({
  icon: Icon,
  label,
  detail,
  onPress,
}: {
  icon: typeof ChartColumn
  label: string
  detail: string
  onPress: () => void
}) {
  const t = useTheme()
  return (
    <Tap label={label} onPress={onPress}>
      <Frame style={{ padding: 14 }}>
        <Line>
          <Icon size={18} color={t.foc} />
          <View style={{ flex: 1 }}>
            <Copy weight="medium">{label}</Copy>
            <Copy size={12} muted>
              {detail}
            </Copy>
          </View>
          <ChevronRight size={16} color={t.muted} />
        </Line>
      </Frame>
    </Tap>
  )
}
