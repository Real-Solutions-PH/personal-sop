import { MODULE_KEYS, weekStartKey } from "@domain/dash/data"
import * as D from "@domain/dash/hooks"
import {
  dashStore,
  setInstallDismissed,
  setSetupHidden,
} from "@domain/dash/store"
import * as FA from "@domain/finance/actions"
import * as N from "@domain/finance/calc"
import { finStore } from "@domain/finance/store"
import { startWorkout } from "@domain/fitness/actions"
import * as F from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import * as HA from "@domain/habits/actions"
import type { Habit } from "@domain/habits/data"
import * as H from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { openCapture } from "@domain/lib/capture"
import { dayKey, dayOffset, fmtDuration, isEvening } from "@domain/lib/day"
import { privacyStore, togglePrivacy } from "@domain/lib/privacy"
import { completeTask } from "@domain/tasks/actions"
import { useStats, useTodayData } from "@domain/tasks/hooks"
import { fmtInstant, isDueNow } from "@domain/tasks/logic"
import { tasksStore } from "@domain/tasks/store"
import { LinearGradient } from "expo-linear-gradient"
import { useLocalSearchParams } from "expo-router"
import {
  AlarmClock,
  ArrowRight,
  Bell,
  CalendarClock,
  Camera,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Dumbbell,
  Eye,
  EyeOff,
  Flame,
  History,
  type LucideIcon,
  Moon,
  MoreHorizontal,
  Pencil,
  PiggyBank,
  Play,
  Plus,
  Scale,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Target,
  TriangleAlert,
  Trophy,
  Utensils,
  Wallet,
  X,
} from "lucide-react-native"
import { useState } from "react"
import { Platform, Text, View } from "react-native"
import { toast } from "sonner-native"
import { AppLauncher } from "../app-launcher"
import {
  Bar,
  border,
  Copy,
  Frame,
  Group,
  IconTap,
  Line,
  Part,
  SmallButton,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { CommunityCard } from "../social/today-card"
import { fonts, useTheme } from "../theme"
import { Screen, SwipeRow, undo, useNow } from "../ui"
import { Ring } from "../visual"
import { refreshWeather } from "../weather"
import { WeatherCard } from "../weather-card"
import { RecordEditor, useMoney } from "./finance"
import { HabitLog } from "./habits"
import { TaskRow } from "./tasks"

// Native counterparts of dash/today, day-hero and the module Today cards.
// Keep composition and dimensions aligned with the deployed prototype.
function DayHero() {
  const t = useTheme(),
    s = dashStore.use((s) => s),
    ring = D.useTodayRing(),
    streak = D.useOnTarget(7),
    ls = D.useLifeScore(7)
  const pct = ring.due ? ring.done / ring.due : 1,
    need = Math.max(0, Math.ceil(ring.due * s.targetThreshold) - ring.done)
  const headline = !ring.due
    ? "Free day"
    : ring.done >= ring.due
      ? "Day complete"
      : !need
        ? "Target hit"
        : `${need} to target`
  const accents = {
    habits: "hab",
    tasks: "tsk",
    fitness: "fit",
    finance: "fin",
  } as const
  return (
    <Frame style={{ borderRadius: 24 }}>
      <LinearGradient
        colors={[`${t.primary}26`, `${t.primary}00`, `${t.hab}1a`]}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: 16 }}
      >
        <Line style={{ gap: 16 }}>
          <Ring
            size={112}
            strokeWidth={11}
            value={pct}
            target={s.targetThreshold}
            color={pct >= s.targetThreshold ? t.life : t.primary}
          >
            <Text
              style={{
                fontFamily: fonts.display,
                fontSize: 36,
                fontVariant: ["tabular-nums"],
                lineHeight: 36,
                color: t.text,
              }}
            >
              {Math.round(pct * 100)}
              <Text style={{ fontSize: 20, color: t.muted }}>%</Text>
            </Text>
            <Copy size={11} muted style={{ letterSpacing: 1, marginTop: 4 }}>
              DONE
            </Copy>
          </Ring>
          <View style={{ flex: 1 }}>
            <Copy size={12} muted style={{ letterSpacing: 1 }}>
              TODAY
            </Copy>
            <Line style={{ gap: 4 }}>
              {ring.due > 0 && !need && <Check size={20} color={t.life} />}
              <Copy weight="display" size={24} style={{ lineHeight: 30 }}>
                {headline}
              </Copy>
            </Line>
            <Copy size={14} muted style={{ marginTop: 2 }}>
              {!ring.due
                ? "Nothing due — your streak is safe."
                : `${ring.done} of ${ring.due} done · target ${Math.round(s.targetThreshold * 100)}%${s.wrapups[dayKey()] ? " · wrapped up" : ""}`}
            </Copy>
            <Line style={{ gap: 8, marginTop: 12 }}>
              <Tap
                label={`On-target streak ${streak.current} days, best ${streak.best}`}
                onPress={() => go("/stats")}
                style={{
                  height: 36,
                  borderRadius: 18,
                  paddingHorizontal: 10,
                  backgroundColor: `${t.life}26`,
                  justifyContent: "center",
                }}
              >
                <Line style={{ gap: 4 }}>
                  <Flame size={16} color={t.life} fill={t.life} />
                  <Copy size={14} weight="semibold" style={{ color: t.life }}>
                    {streak.current}
                    <Text style={{ fontFamily: fonts.body, fontSize: 12 }}>
                      {" "}
                      streak
                    </Text>
                  </Copy>
                </Line>
              </Tap>
              <Tap
                label={`Life Score ${ls.score ?? "not available yet"}`}
                onPress={() => go("/stats")}
                style={{
                  height: 36,
                  borderRadius: 18,
                  paddingHorizontal: 10,
                  backgroundColor: t.soft,
                  justifyContent: "center",
                }}
              >
                <Line style={{ gap: 4 }}>
                  <Sparkles size={16} color={t.life} />
                  <Copy size={14} weight="semibold">
                    {ls.score ?? "—"}
                    <Text
                      style={{
                        fontFamily: fonts.body,
                        fontSize: 12,
                        color: t.muted,
                      }}
                    >
                      {" "}
                      score
                    </Text>
                  </Copy>
                </Line>
              </Tap>
            </Line>
          </View>
        </Line>
      </LinearGradient>
      {MODULE_KEYS.filter((k) => s.enabled[k] && ring.per[k].due > 0).map(
        (k) => (
          <Tap
            key={k}
            onPress={() => go(`/${k}`)}
            style={{
              borderTopWidth: 1,
              borderColor: border(t.line, 0.6),
              paddingHorizontal: 16,
              paddingVertical: 8,
              minHeight: 49,
            }}
          >
            <Line>
              <Copy size={14} weight="medium" style={{ width: 64 }}>
                {k[0].toUpperCase() + k.slice(1)}
              </Copy>
              <Bar
                value={ring.per[k].done / ring.per[k].due}
                target={s.targetThreshold}
                color={t[accents[k]]}
              />
              <Copy size={14} muted style={{ width: 40, textAlign: "right" }}>
                {Math.min(ring.per[k].done, ring.per[k].due)}/{ring.per[k].due}
              </Copy>
              <ChevronRight size={16} color={t.muted} />
            </Line>
          </Tap>
        ),
      )}
    </Frame>
  )
}
function NextUp() {
  const t = useTheme(),
    today = dayKey(),
    items = D.useAllCalendar(today, today),
    now = useNow(),
    hm = new Date(now).toTimeString().slice(0, 5)
  const open = items.filter((i) => !i.done && i.module !== "finance"),
    timed = open.filter((i) => i.time),
    next =
      timed.filter((i) => (i.time ?? "") < hm).at(-1) ??
      timed.find((i) => (i.time ?? "") >= hm) ??
      open.find((i) => !i.time)
  if (!next) return null
  const accent =
    next.module === "habits" ? t.hab : next.module === "tasks" ? t.tsk : t.fit
  const habitId =
    next.module === "habits" && next.id.startsWith("habit-")
      ? next.id.slice(6, -(next.day.length + 1))
      : null
  const taskId =
    next.module === "tasks" && next.id.startsWith("task:")
      ? next.id.slice(5)
      : null
  return (
    <Frame style={{ padding: 16 }}>
      <Line>
        <Tap onPress={() => go(next.href)} style={{ flex: 1 }}>
          <Line>
            <View
              style={{
                height: 44,
                width: 44,
                borderRadius: 12,
                backgroundColor: `${accent}26`,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ArrowRight size={20} color={accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Copy muted size={11} style={{ letterSpacing: 0.6 }}>
                NEXT UP{next.time ? ` · ${next.time}` : ""}
              </Copy>
              <Copy weight="semibold" lines={1}>
                {next.title}
              </Copy>
            </View>
          </Line>
        </Tap>
        {habitId || taskId ? (
          <IconTap
            size={44}
            icon={Check}
            label={`Mark ${next.title.replace(/^\p{Extended_Pictographic}\s*/u, "")} done`}
            background={`${t.good}26`}
            color={t.good}
            onPress={() => {
              if (habitId) HA.checkHabit(habitId, today)
              if (taskId) completeTask(taskId)
              toast.success(`Done: ${next.title}`)
            }}
          />
        ) : (
          <ChevronRight size={20} color={t.muted} />
        )}
      </Line>
    </Frame>
  )
}
function TodayHabit({ habit }: { habit: Habit }) {
  const t = useTheme(),
    logs = habitsStore.use((s) => s.logs),
    [sheet, setSheet] = useState(false),
    today = dayKey(),
    idx = H.logIndex(logs),
    log = idx.get(H.lk(habit.id, today)),
    streak = H.streaks(habit, idx, today).current,
    done = log?.status === "done"
  const toggle = () => {
    if (done) HA.clearLog(habit.id, today)
    else HA.checkHabit(habit.id, today)
    undo(done ? "Log cleared" : "Habit checked", () => {
      HA.clearLog(habit.id, today)
      if (log) HA.restoreLog(log)
    })
  }
  return (
    <>
      <SwipeRow onComplete={toggle} onMore={() => setSheet(true)}>
        <Line style={{ gap: 8, paddingVertical: 4 }}>
          <Tap
            label={`${done ? "Reopen" : "Complete"} ${habit.name}`}
            onPress={toggle}
            style={{
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <View
              style={{
                width: 37,
                height: 37,
                borderRadius: 19,
                borderWidth: 3,
                borderColor: done ? t.hab : border(t.muted, 0.3),
                backgroundColor: done ? t.hab : "transparent",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {done && <Check size={15} color={t.onPrimary} />}
            </View>
          </Tap>
          <Tap
            onPress={() => go(`/habits/${habit.id}`)}
            style={{ flex: 1, paddingVertical: 6 }}
          >
            <Copy
              weight="medium"
              lines={1}
              style={
                done
                  ? { color: t.muted, textDecorationLine: "line-through" }
                  : {}
              }
            >
              {habit.icon} {habit.name}
            </Copy>
            <Line style={{ gap: 6 }}>
              <Copy size={12} muted>
                {H.fmtTime(H.slotFor(habit.schedule, today)?.time)}
                {log?.value !== undefined
                  ? ` · ${H.valueLabel(habit, log.value)}`
                  : ""}
                {log?.status === "skipped" ? " · skipped" : ""}
              </Copy>
              {streak > 0 && (
                <Line
                  style={{
                    gap: 2,
                    borderRadius: 12,
                    backgroundColor: `${t.warn}26`,
                    paddingHorizontal: 6,
                    paddingVertical: 1,
                  }}
                >
                  <Flame size={12} color={t.warn} />
                  <Copy
                    size={11}
                    weight="semibold"
                    style={{ color: t.warn, lineHeight: 14 }}
                  >
                    {streak}
                  </Copy>
                </Line>
              )}
            </Line>
          </Tap>
          {habit.type === "count" && !done && (
            <Tap
              label={`Add ${habit.step ?? 1} ${habit.unit ?? ""}`}
              onPress={() => {
                HA.incrementCount(habit.id)
                undo(`Updated ${habit.name}`, () => {
                  HA.clearLog(habit.id, today)
                  if (log) HA.restoreLog(log)
                })
              }}
              style={{
                minWidth: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: `${t.hab}26`,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Copy size={12} weight="semibold" style={{ color: t.hab }}>
                +{habit.step ?? 1}
              </Copy>
            </Tap>
          )}
          {habit.type === "duration" && !done && (
            <IconTap
              icon={Play}
              label={`Start ${habit.name} timer`}
              color={t.hab}
              background={`${t.hab}26`}
              onPress={() => go(HA.timerHref(habit.id))}
            />
          )}
          <IconTap
            icon={MoreHorizontal}
            label={`More options for ${habit.name}`}
            onPress={() => setSheet(true)}
          />
        </Line>
      </SwipeRow>
      <HabitLog
        habit={habit}
        day={today}
        open={sheet}
        onClose={() => setSheet(false)}
      />
    </>
  )
}
export function HabitsCard() {
  const t = useTheme(),
    s = habitsStore.use((s) => s),
    [showDone, setShowDone] = useState(false),
    today = dayKey(),
    idx = H.logIndex(s.logs)
  const due = H.sortedHabits(
      s.habits.filter((h) => h.status !== "archived" && H.isDue(h, today)),
    ),
    done = due.filter(
      (h) => idx.get(H.lk(h.id, today))?.status === "done",
    ).length,
    skipped = due.filter(
      (h) => idx.get(H.lk(h.id, today))?.status === "skipped",
    ).length,
    count = due.length - skipped
  const routines = s.routines.filter(
    (r) =>
      r.status === "active" &&
      r.steps.length &&
      H.slotFor(r.schedule, today) &&
      r.createdAt <= today,
  )
  return (
    <Group title="Habits" icon={Target} accent="hab" href="/habits">
      {routines.map((r) => {
        const run = [...s.runs]
            .reverse()
            .find((x) => x.routineId === r.id && x.day === today),
          completed = run?.state === "completed",
          active = run?.state === "in_progress"
        return (
          <LinearGradient
            key={r.id}
            colors={[`${t.hab}26`, `${t.hab}00`]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Part>
              <Line>
                <View
                  style={{
                    height: 56,
                    width: 56,
                    borderRadius: 16,
                    backgroundColor: `${t.hab}1f`,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Copy size={28}>{r.icon}</Copy>
                </View>
                <Tap
                  onPress={() => go(`/habits/routines/${r.id}`)}
                  style={{ flex: 1 }}
                >
                  <Copy weight="semibold">{r.name}</Copy>
                  <Copy size={12} muted>
                    {completed
                      ? `✓ Done in ${fmtDuration(H.runActualSec(run))} · planned ${H.plannedMin(r)}m`
                      : active
                        ? `Step ${Math.min(run.current + 1, run.steps.length)} of ${run.steps.length} · paused`
                        : `${r.steps.length} steps · ${H.plannedMin(r)}m${H.slotFor(r.schedule, today)?.time ? ` · ${H.slotFor(r.schedule, today)?.time}` : ""}`}
                  </Copy>
                </Tap>
                {completed ? (
                  <Check color={t.good} size={20} />
                ) : (
                  <Tap
                    onPress={() => go(`/habits/routines/${r.id}/play`)}
                    style={{
                      backgroundColor: t.hab,
                      borderRadius: 22,
                      height: 44,
                      paddingHorizontal: 16,
                      justifyContent: "center",
                    }}
                  >
                    <Line style={{ gap: 6 }}>
                      <Play size={16} color={t.onPrimary} fill={t.onPrimary} />
                      <Copy
                        size={14}
                        weight="medium"
                        style={{ color: t.onPrimary }}
                      >
                        {active
                          ? `Resume ${run.current}/${run.steps.length}`
                          : "Start"}
                      </Copy>
                    </Line>
                  </Tap>
                )}
              </Line>
            </Part>
          </LinearGradient>
        )
      })}
      <Part style={{ paddingBottom: 8 }}>
        <Line style={{ marginBottom: 4 }}>
          <Ring
            size={44}
            strokeWidth={5}
            value={count ? done / count : 0}
            color={t.hab}
          >
            <Copy size={11} weight="semibold">
              {done}/{count}
            </Copy>
          </Ring>
          <Copy weight="medium" style={{ flex: 1 }}>
            {count > 0 && done >= count
              ? "Perfect day ✓"
              : count === 0
                ? "Nothing scheduled — rest day"
                : `${count - done} left today${skipped ? ` · ${skipped} skipped` : ""}`}
          </Copy>
          <Tap onPress={() => go("/habits/manage")}>
            <Copy size={14} weight="medium" style={{ color: t.hab }}>
              Manage
            </Copy>
          </Tap>
        </Line>
        {(["now", "later", "anytime", "done"] as const).map((group) => {
          const items = due
            .filter(
              (h) =>
                H.todayGroup(h, idx.get(H.lk(h.id, today)), today) === group,
            )
            .sort(
              (a, b) =>
                H.toMin(H.slotFor(a.schedule, today)?.time ?? "99:99") -
                H.toMin(H.slotFor(b.schedule, today)?.time ?? "99:99"),
            )
          if (!items.length) return null
          return (
            <View key={group} style={{ marginTop: 8 }}>
              {group === "done" ? (
                <Tap
                  onPress={() => setShowDone(!showDone)}
                  label={`${showDone ? "Hide" : "Show"} completed habits`}
                  style={{ padding: 4 }}
                >
                  <Line style={{ gap: 4 }}>
                    <Copy
                      size={11}
                      weight="medium"
                      muted
                      style={{ letterSpacing: 0.6 }}
                    >
                      DONE · {items.length}
                    </Copy>
                    <ChevronDown size={14} color={t.muted} />
                  </Line>
                </Tap>
              ) : (
                <Copy
                  size={11}
                  weight="medium"
                  muted
                  style={{ letterSpacing: 0.6, paddingHorizontal: 4 }}
                >
                  {group === "now"
                    ? "NOW"
                    : group === "later"
                      ? "LATER TODAY"
                      : "ANYTIME"}
                </Copy>
              )}
              {(group !== "done" || showDone) &&
                items.map((h) => <TodayHabit key={h.id} habit={h} />)}
            </View>
          )
        })}
      </Part>
    </Group>
  )
}
function TasksCard() {
  const t = useTheme(),
    d = useTodayData(),
    stats = useStats(7),
    lists = tasksStore.use((s) => s.lists),
    grocery = lists.find((l) => l.kind === "shopping" && !l.archivedAt),
    dueNow = d.due.filter((task) => isDueNow(task)).length
  return (
    <Group title="Tasks" icon={CheckSquare} accent="tsk" href="/tasks">
      <Part style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
        <Line style={{ gap: 8, paddingHorizontal: 4 }}>
          <Copy size={14} weight="medium">
            {d.doneDueToday.length}/
            {d.due.length + d.doneDueToday.length + d.overdue.length}
          </Copy>
          {stats.streak > 1 && (
            <Line style={{ gap: 2 }}>
              <Flame size={14} color={t.warn} />
              <Copy size={12} muted>
                {stats.streak}-day streak
              </Copy>
            </Line>
          )}
          {dueNow > 0 && (
            <Copy size={11} style={{ color: t.tsk }}>
              {dueNow} due now
            </Copy>
          )}
          <View style={{ flex: 1 }} />
          <IconTap
            size={32}
            icon={Plus}
            label="Add task"
            color={t.tsk}
            background={`${t.tsk}26`}
            onPress={() => go("/tasks/capture")}
          />
        </Line>
        {d.overdue.length > 0 && (
          <Tap
            onPress={() => go("/tasks?filter=overdue")}
            style={{
              marginTop: 8,
              borderRadius: 12,
              paddingHorizontal: 12,
              paddingVertical: 8,
              backgroundColor: `${t.warn}1a`,
            }}
          >
            <Line style={{ gap: 8 }}>
              <TriangleAlert size={16} color={t.warn} />
              <Copy
                size={14}
                weight="medium"
                style={{ color: t.warn, flex: 1 }}
              >
                {d.overdue.length} overdue
              </Copy>
              <Copy size={12} style={{ color: t.warn }}>
                Triage
              </Copy>
              <ChevronRight size={16} color={t.warn} />
            </Line>
          </Tap>
        )}
        <View style={{ marginTop: 4 }}>
          {d.due.slice(0, 5).map((task) => (
            <TaskRow key={task.id} task={task} compact />
          ))}
          {!d.due.length && (
            <Copy muted style={{ textAlign: "center", paddingVertical: 20 }}>
              All clear for today
            </Copy>
          )}
        </View>
        {d.due.length > 5 && (
          <Tap onPress={() => go("/tasks")}>
            <Copy size={14} muted>
              +{d.due.length - 5} more
            </Copy>
          </Tap>
        )}
        <Line
          style={{
            flexWrap: "wrap",
            gap: 8,
            marginTop: 4,
            paddingHorizontal: 4,
            paddingTop: 8,
            borderTopWidth: 1,
            borderColor: border(t.line, 0.5),
          }}
        >
          {grocery && d.shoppingOpen > 0 && (
            <Tap
              onPress={() => go(`/tasks/list/${grocery.id}`)}
              style={{
                backgroundColor: `${t.fit}26`,
                borderRadius: 20,
                paddingHorizontal: 10,
                paddingVertical: 4,
              }}
            >
              <Line style={{ gap: 4 }}>
                <ShoppingCart size={14} color={t.fit} />
                <Copy size={12} weight="medium" style={{ color: t.fit }}>
                  {grocery.name} · {d.shoppingOpen}
                </Copy>
              </Line>
            </Tap>
          )}
          {d.nextReminder?.remindAt && (
            <Line style={{ gap: 4 }}>
              <AlarmClock size={14} color={t.muted} />
              <Copy size={12} muted>
                Next ping {fmtInstant(d.nextReminder.remindAt)}
              </Copy>
            </Line>
          )}
          <Tap onPress={() => go("/tasks")} style={{ marginLeft: "auto" }}>
            <Copy size={12} weight="medium" style={{ color: t.tsk }}>
              See all ›
            </Copy>
          </Tap>
        </Line>
      </Part>
    </Group>
  )
}
function FitnessCards({ evening }: { evening: boolean }) {
  const t = useTheme(),
    s = fitStore.use((s) => s),
    next = F.nextTemplate(s),
    last = next ? F.lastOfTemplate(s, next.id) : undefined,
    first = next?.items[0],
    sug = first ? F.suggestion(s, first.exerciseId) : undefined,
    ex = s.exercises.find((e) => e.id === first?.exerciseId),
    active = s.workouts.find(
      (w) => w.id === s.activeId && w.status === "in_progress",
    ),
    completed = F.finished(s)
      .filter((w) => dayKey(new Date(w.startedAt)) === dayKey())
      .at(-1),
    weight = F.dailyWeights(s).get(dayKey()),
    rate = F.weeklyRate(s),
    totals = F.dayTotals(s, dayKey()),
    target = F.targetFor(s, dayKey()),
    kLeft = target ? target.kcal - totals.totals.kcal : undefined,
    pLeft = target ? target.protein - totals.totals.protein : undefined
  const badge = (Icon: LucideIcon) => (
    <View
      style={{
        width: 44,
        height: 44,
        backgroundColor: `${t.fit}26`,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon size={20} color={t.fit} />
    </View>
  )
  return (
    <>
      <Group title="Fitness" icon={Dumbbell} accent="fit" href="/fitness">
        {active ? (
          <Part>
            <Tap onPress={() => go("/fitness/workout")}>
              <Copy weight="semibold">● {active.name} · Resume</Copy>
            </Tap>
          </Part>
        ) : completed ? (
          <Part>
            <Tap onPress={() => go(`/fitness/workouts/${completed.id}`)}>
              <Line>
                {badge(Check)}
                <Copy weight="semibold" style={{ flex: 1 }}>
                  {completed.name} done
                </Copy>
                <ChevronRight size={16} color={t.muted} />
              </Line>
            </Tap>
          </Part>
        ) : next &&
          (F.sessionsByWeek(s, 1)[0]?.count ?? 0) < s.settings.weeklyTarget ? (
          <Part>
            <Line>
              {badge(Dumbbell)}
              <Tap onPress={() => go("/fitness")} style={{ flex: 1 }}>
                <Copy weight="semibold">
                  {next.name}
                  <Text style={{ fontFamily: fonts.body, color: t.muted }}>
                    {last ? ` · last ${F.relDay(last.startedAt)}` : ""}
                  </Text>
                </Copy>
                <Copy size={14} muted lines={1}>
                  {sug?.kind === "weight"
                    ? `Suggested ${sug.badge} ${ex?.name.split(" ").slice(-2).join(" ").toLowerCase()}`
                    : `${F.sessionsByWeek(s, 1)[0]?.count ?? 0} of ${s.settings.weeklyTarget} sessions this week`}
                </Copy>
              </Tap>
              <SmallButton
                accent="fit"
                onPress={() => {
                  const result = startWorkout({
                    from: "template",
                    templateId: next.id,
                  })
                  if (result.ok) go("/fitness/workout")
                  else toast.error(result.reason)
                }}
              >
                Start
              </SmallButton>
            </Line>
          </Part>
        ) : null}
        <Part>
          <Line>
            {badge(Scale)}
            <Tap onPress={() => go("/fitness/body")} style={{ flex: 1 }}>
              <Copy weight="semibold">
                {weight === undefined ? "Weigh in" : `${weight.toFixed(1)} kg`}
              </Copy>
              <Copy size={14} muted>
                {weight === undefined
                  ? "Morning weight keeps the trend honest"
                  : `7-day avg ${rate?.avg.toFixed(1) ?? "—"} ${rate ? `${rate.kg <= 0 ? "↓" : "↑"}${Math.abs(rate.kg).toFixed(1)}` : ""}`}
              </Copy>
            </Tap>
            {weight === undefined && (
              <SmallButton
                accent="fit"
                onPress={() => go("/fitness/body?log=1")}
              >
                Log
              </SmallButton>
            )}
          </Line>
        </Part>
      </Group>
      <Group
        title="Nutrition"
        icon={Utensils}
        accent="nut"
        href="/fitness/nutrition"
      >
        <Part>
          <Line>
            <Tap onPress={() => go("/fitness/nutrition")} style={{ flex: 1 }}>
              <Line>
                <Ring
                  size={48}
                  strokeWidth={5}
                  value={target ? totals.totals.kcal / target.kcal : 0}
                  color={t.nut}
                >
                  <Copy size={11} weight="semibold">
                    {Math.round(
                      target ? (totals.totals.kcal / target.kcal) * 100 : 0,
                    )}
                    %
                  </Copy>
                </Ring>
                <Ring
                  size={48}
                  strokeWidth={5}
                  value={target ? totals.totals.protein / target.protein : 0}
                  color={t.tsk}
                >
                  <Copy size={11} weight="semibold">
                    P
                  </Copy>
                </Ring>
                <View style={{ flex: 1 }}>
                  <Copy weight="semibold">
                    {kLeft === undefined
                      ? `${Math.round(totals.totals.kcal)} kcal eaten`
                      : `${Math.round(Math.abs(kLeft))} kcal ${kLeft < 0 ? "over" : evening ? "under" : "left"}`}
                  </Copy>
                  <Copy size={14} muted lines={evening ? undefined : 1}>
                    {pLeft === undefined
                      ? "Set targets"
                      : `${Math.max(0, Math.round(pLeft))} g protein ${evening ? "short" : "left"}`}
                    {totals.pending ? ` · +${totals.pending} pending` : ""}
                    {totals.toReview ? ` · ${totals.toReview} to review` : ""}
                  </Copy>
                </View>
              </Line>
            </Tap>
            <IconTap
              icon={Camera}
              label="Log meal by photo"
              color={t.nut}
              background={`${t.nut}26`}
              size={40}
              onPress={() => openCapture({ mode: "photo", hint: "meal" })}
            />
            <IconTap
              icon={Pencil}
              label="Log meal manually"
              size={40}
              background={t.soft}
              onPress={() => go("/fitness/nutrition/new")}
            />
          </Line>
        </Part>
      </Group>
    </>
  )
}
function FinanceCard() {
  const t = useTheme(),
    s = finStore.use((s) => s),
    money = useMoney(),
    [projection, setProjection] = useState(true),
    [adding, setAdding] = useState(false),
    today = dayKey(),
    overall = s.budgets.find((b) => !b.archived && b.categoryIds === null),
    budget = overall ? N.budgetView(s, overall) : null,
    due = N.occurrencesIn(s, N.addDays(today, -14), N.addDays(today, 1)).filter(
      (o) => o.status === "overdue" || o.status === "due",
    ),
    stale = s.accounts.find(
      (a) =>
        !a.archived &&
        (a.type === "ewallet" || a.type === "bank") &&
        (N.lastReconciledDays(a) ?? 999) > s.settings.nudgeDays,
    ),
    pending = s.records.filter((r) => r.status === "pending").length,
    lastMonth = N.addMonths(N.monthOf(today, s.settings.monthStartDay), -1),
    reviewReady =
      Number(today.slice(8, 10)) <= 7 &&
      !s.lookbacks.some((l) => l.period === lastMonth),
    proj = N.project(s, {
      horizon: 12,
      includeUnplanned: s.settings.includeUnplanned,
      excludedPlanned: s.settings.projExcludedPlanned,
    }),
    last = proj.months.at(-1),
    alerts = s.budgets
      .filter((b) => !b.archived && b.categoryIds !== null)
      .map((b) => N.budgetView(s, b))
      .filter((v) => v.pct >= 0.8)
      .sort((a, b) => b.pct - a.pct)
  const info = (
    Icon: LucideIcon,
    title: string,
    href: string,
    color: string,
  ) => (
    <Tap key={title} onPress={() => go(href)}>
      <Line style={{ gap: 8 }}>
        <Icon size={16} color={color} />
        <Copy size={14} style={{ flex: 1 }}>
          {title}
        </Copy>
        <ChevronRight size={16} color={t.muted} />
      </Line>
    </Tap>
  )
  return (
    <>
      <Group title="Finance" icon={Wallet} accent="fin" href="/finance">
        <Part style={{ gap: 12 }}>
          <Line>
            <Tap
              onPress={() =>
                go(s.accounts.length ? "/finance" : "/finance/setup")
              }
              style={{ flex: 1 }}
            >
              <Line>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 16,
                    backgroundColor: `${t.fin}26`,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Wallet size={20} color={t.fin} />
                </View>
                <View>
                  <Copy size={12} muted>
                    Spent today
                  </Copy>
                  <Copy size={20} weight="semibold">
                    {money(N.flowIn(s, today, today).spend)}
                  </Copy>
                </View>
              </Line>
            </Tap>
            {budget && (
              <View style={{ alignItems: "flex-end" }}>
                <Copy size={12} muted>
                  Safe to spend / day
                </Copy>
                <Copy size={12} weight="semibold" style={{ color: t.fin }}>
                  {money(budget.safePerDay)}
                </Copy>
              </View>
            )}
            <IconTap
              size={40}
              icon={Plus}
              label="Quick add expense"
              background={t.fin}
              color={t.onPrimary}
              onPress={() => setAdding(true)}
            />
          </Line>
          {due.length > 0 && (
            <View
              style={{
                borderTopWidth: 1,
                borderColor: border(t.line, 0.5),
                paddingTop: 8,
              }}
            >
              {due.slice(0, 3).map((o) => (
                <Line
                  key={`${o.item.id}-${o.orig}`}
                  style={{ gap: 8, paddingVertical: 6 }}
                >
                  <Tap
                    onPress={() => go(`/finance/planned/${o.item.id}`)}
                    style={{ flex: 1 }}
                  >
                    <Line style={{ gap: 8 }}>
                      <Copy>
                        {s.categories.find((c) => c.id === o.item.categoryId)
                          ?.icon ?? "⇄"}
                      </Copy>
                      <View style={{ flex: 1 }}>
                        <Copy size={14} weight="medium" lines={1}>
                          {o.item.name}
                        </Copy>
                        <Copy size={11} muted>
                          {o.status === "overdue" ? "Overdue · " : ""}
                          {N.dayLabel(o.day)} · {money(o.item.amount)}
                        </Copy>
                      </View>
                    </Line>
                  </Tap>
                  <SmallButton
                    small
                    quiet
                    accent="fin"
                    onPress={() => {
                      FA.skipOccurrence(o.item.id, o.orig)
                      undo(`Skipped ${o.item.name}`, () =>
                        FA.unskipOccurrence(o.item.id, o.orig),
                      )
                    }}
                  >
                    Skip
                  </SmallButton>
                  <SmallButton
                    small
                    accent="fin"
                    onPress={() => {
                      if (o.item.estimated)
                        return go(`/finance/planned/${o.item.id}`)
                      const record = FA.settleOccurrence(o.item.id, o.orig, {
                        amount: o.item.amount,
                      })
                      if (record)
                        undo(`Paid ${o.item.name}`, () =>
                          FA.deleteRecords([record.id]),
                        )
                    }}
                  >
                    {o.item.type === "income" ? "Got it" : "Paid"}
                  </SmallButton>
                </Line>
              ))}
            </View>
          )}
          {(alerts.length > 0 || reviewReady || stale || pending > 0) && (
            <View
              style={{
                borderTopWidth: 1,
                borderColor: border(t.line, 0.5),
                paddingTop: 8,
                gap: 6,
              }}
            >
              {alerts
                .slice(0, 2)
                .map((v) =>
                  info(
                    TriangleAlert,
                    `${v.b.name} budget at ${Math.round(v.pct * 100)}%`,
                    `/finance/budgets/${v.b.id}`,
                    v.pct > 1 ? t.bad : t.warn,
                  ),
                )}
              {reviewReady &&
                info(
                  CalendarClock,
                  `${N.monthLabel(lastMonth, true)} review ready`,
                  `/finance/review?period=${lastMonth}`,
                  t.life,
                )}
              {stale &&
                info(
                  History,
                  `${stale.name} not matched with a statement for ${N.lastReconciledDays(stale) ?? "a while"} days`,
                  `/finance/import?account=${stale.id}`,
                  t.warn,
                )}
              {pending > 0 &&
                info(
                  Sparkles,
                  `${pending} AI-drafted transactions to confirm`,
                  "/finance/records?pending=1",
                  t.warn,
                )}
            </View>
          )}
          {proj.hasIncome && last && (
            <View
              style={{
                borderTopWidth: 1,
                borderColor: border(t.line, 0.5),
                paddingTop: 8,
              }}
            >
              <Tap onPress={() => setProjection(!projection)}>
                <Line style={{ gap: 8 }}>
                  <PiggyBank size={16} color={t.fin} />
                  <Copy size={14} style={{ flex: 1 }}>
                    Projection
                  </Copy>
                  <Copy size={12} muted>
                    {projection ? "hide" : "show"}
                  </Copy>
                </Line>
              </Tap>
              {projection && (
                <Tap
                  onPress={() => go("/finance/projection")}
                  style={{
                    marginTop: 4,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    backgroundColor: `${t.fin}0d`,
                    borderRadius: 12,
                  }}
                >
                  <Line style={{ justifyContent: "space-between" }}>
                    <Copy size={14}>
                      <Text style={{ fontFamily: fonts.semibold }}>
                        {money(last.end)}
                      </Text>{" "}
                      by {N.monthLabel(last.key)} {last.key.slice(2, 4)}
                    </Copy>
                    <Copy size={12} weight="medium" style={{ color: t.fin }}>
                      What if? ›
                    </Copy>
                  </Line>
                </Tap>
              )}
            </View>
          )}
        </Part>
      </Group>
      <RecordEditor open={adding} onClose={() => setAdding(false)} />
    </>
  )
}
function GoalsAndContext({ evening }: { evening: boolean }) {
  const t = useTheme(),
    goals = D.useGoals()
      .filter((g) => g.goal.status === "active" && g.goal.period === "week")
      .slice(0, 2),
    s = dashStore.use((s) => s),
    trophies = D.useTrophies(),
    misses = D.useAllMisses(dayOffset(-1), dayOffset(-1)),
    fresh = trophies.find((x) => !s.seenTrophies.includes(x.id)),
    tomorrow = D.useAllCalendar(dayOffset(1), dayOffset(1))
  const review = !s.reviews[`w-${weekStartKey(1)}`]?.done
  const context = review
    ? {
        title: "Weekly review is ready",
        detail: "3 minutes · wins, misses, one focus",
        href: "/stats/reviews",
        icon: Sparkles,
        color: t.primary,
      }
    : fresh
      ? {
          title: `New: ${fresh.title}`,
          detail: fresh.detail,
          href: "/stats/trophies",
          icon: Trophy,
          color: t.life,
        }
      : misses.length
        ? {
            title: `${misses.length} misses yesterday`,
            detail: "Look, note, move on.",
            href: "/stats/misses",
            icon: X,
            color: t.bad,
          }
        : null
  return (
    <>
      {goals.length > 0 && (
        <Frame style={{ padding: 16 }}>
          <Tap onPress={() => go("/stats/goals")}>
            <Line style={{ gap: 8, marginBottom: 8 }}>
              <Target size={16} color={t.primary} />
              <Copy weight="semibold" style={{ flex: 1 }}>
                Goals in play
              </Copy>
              <ChevronRight size={16} color={t.muted} />
            </Line>
          </Tap>
          <View style={{ gap: 12 }}>
            {goals.map(({ goal, entry, pct, hit }) => (
              <Tap
                key={goal.id}
                onPress={() =>
                  go(
                    goal.metric.includes(":")
                      ? `/stats/metric/${encodeURIComponent(goal.metric)}`
                      : "/stats/goals",
                  )
                }
              >
                <Line
                  style={{ marginBottom: 4, justifyContent: "space-between" }}
                >
                  <Copy size={14} style={{ flex: 1 }}>
                    {goal.label}
                    <Text style={{ color: t.muted, fontSize: 12 }}>
                      {" "}
                      {D.fmtGoal(goal)}
                    </Text>
                  </Copy>
                  <Copy
                    size={14}
                    weight="medium"
                    style={{ color: hit ? t.good : t.text }}
                  >
                    {entry?.value ?? "—"}
                    {hit ? " ✓" : ""}
                  </Copy>
                </Line>
                <Bar value={pct} color={hit ? t.life : t.primary} />
              </Tap>
            ))}
          </View>
        </Frame>
      )}
      {evening ? (
        <Frame style={{ padding: 16 }}>
          <Tap onPress={() => go("/plan?seg=calendar")}>
            <Copy weight="semibold">Tomorrow</Copy>
            {tomorrow.length ? (
              tomorrow.slice(0, 3).map((i) => (
                <Copy key={i.id} size={14} style={{ paddingVertical: 6 }}>
                  {i.time ?? "—"}　{i.title}
                </Copy>
              ))
            ) : (
              <Copy size={14} muted>
                Nothing scheduled yet — a clean slate.
              </Copy>
            )}
          </Tap>
        </Frame>
      ) : (
        context && (
          <Frame style={{ padding: 16 }}>
            <Tap onPress={() => go(context.href)}>
              <Line>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor: `${context.color}26`,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <context.icon size={20} color={context.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Copy weight="semibold">{context.title}</Copy>
                  <Copy size={12} muted>
                    {context.detail}
                  </Copy>
                </View>
                <ChevronRight size={16} color={t.muted} />
              </Line>
            </Tap>
          </Frame>
        )
      )}
    </>
  )
}
export function Today() {
  const t = useTheme(),
    s = dashStore.use((s) => s),
    hidden = privacyStore.use((s) => s.hidden),
    now = useNow(),
    date = new Date(now),
    { mode } = useLocalSearchParams<{ mode?: string }>(),
    evening =
      mode === "evening" ||
      (mode !== "morning" && isEvening(date, s.eveningStart)),
    unread = s.notifs.filter((n) => !n.read).length,
    ring = D.useTodayRing(),
    habits = habitsStore.use((s) => s.habits.length),
    tasks = tasksStore.use((s) => s.tasks.length),
    fin = finStore.use((s) => s.accounts.length),
    fit = fitStore.use(
      (s) => s.templates.length + s.workouts.length + s.weighIns.length,
    )
  const has = { habits, tasks, finance: fin, fitness: fit },
    pending = MODULE_KEYS.filter((k) => s.enabled[k] && !has[k]),
    greeting =
      date.getHours() >= 4 && date.getHours() < 12
        ? "Good morning"
        : date.getHours() >= 12 && date.getHours() < 18
          ? "Good afternoon"
          : "Good evening"
  return (
    <Screen
      root
      prototypeLayout
      onRefresh={() => refreshWeather(true)}
      title={`${greeting}, ${s.profile.name.split(" ")[0]}`}
      eyebrow={date
        .toLocaleDateString("en-PH", {
          weekday: "long",
          month: "short",
          day: "numeric",
        })
        .toUpperCase()}
      actions={
        <Line style={{ gap: 4 }}>
          <IconTap
            size={44}
            icon={hidden ? EyeOff : Eye}
            label={hidden ? "Show amounts" : "Hide amounts"}
            color={hidden ? t.primary : t.muted}
            onPress={togglePrivacy}
          />
          <View>
            <IconTap
              size={44}
              icon={Bell}
              label={`Notifications${unread ? `, ${unread} unread` : ""}`}
              color={t.text}
              onPress={() => go("/today/inbox")}
            />
            {unread > 0 && (
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  borderRadius: 8,
                  minWidth: 16,
                  backgroundColor: t.bad,
                  paddingHorizontal: 4,
                }}
              >
                <Copy
                  size={10}
                  weight="semibold"
                  style={{ color: t.bg, textAlign: "center" }}
                >
                  {unread}
                </Copy>
              </View>
            )}
          </View>
        </Line>
      }
    >
      <DayHero />
      <WeatherCard />
      {!s.setupHidden && pending.length > 0 && (
        <Frame style={{ padding: 16 }}>
          <Line>
            <Tap onPress={() => go("/setup")} style={{ flex: 1 }}>
              <Copy weight="semibold">Finish setting up</Copy>
              <Copy size={14} muted>
                {MODULE_KEYS.filter((k) => s.enabled[k]).length -
                  pending.length}{" "}
                steps done · next: {pending[0]}
              </Copy>
            </Tap>
            <IconTap
              icon={X}
              label="Hide setup reminder"
              onPress={() => setSetupHidden(true)}
            />
          </Line>
        </Frame>
      )}
      <AppLauncher />
      {evening ? (
        <Frame style={{ padding: 16, backgroundColor: `${t.hab}1a` }}>
          <Tap onPress={() => go("/today/wrap-up")}>
            <Line>
              <Moon color={t.hab} size={20} />
              <View style={{ flex: 1 }}>
                <Copy weight="semibold">
                  {s.wrapups[dayKey()]
                    ? "Day sealed · Tap to review"
                    : ring.due > ring.done
                      ? `${ring.due - ring.done} items open — wrap up`
                      : "All done — seal the day"}
                </Copy>
                <Copy size={12} muted>
                  30 seconds: tick, push, reflect
                </Copy>
              </View>
              <ChevronRight size={20} color={t.muted} />
            </Line>
          </Tap>
        </Frame>
      ) : (
        ring.done < ring.due && <NextUp />
      )}
      {Platform.OS === "web" && !s.installDismissed && (
        <Frame
          style={{
            padding: 16,
            backgroundColor: `${t.primary}0d`,
            borderColor: `${t.primary}4d`,
          }}
        >
          <Line>
            <Smartphone size={20} color={t.primary} />
            <Tap
              onPress={() => go("/onboarding?step=install")}
              style={{ flex: 1 }}
            >
              <Copy size={14} weight="medium">
                Install the app
              </Copy>
              <Copy size={12} muted>
                Needed for reminders on iPhone
              </Copy>
            </Tap>
            <IconTap
              size={44}
              icon={X}
              label="Dismiss install nudge"
              onPress={() => setInstallDismissed(true)}
            />
          </Line>
        </Frame>
      )}
      {s.enabled.habits && <HabitsCard />}
      {s.enabled.tasks && <TasksCard />}
      {s.enabled.fitness && <FitnessCards evening={evening} />}
      {s.enabled.finance && <FinanceCard />}
      <CommunityCard />
      <GoalsAndContext evening={evening} />
    </Screen>
  )
}
