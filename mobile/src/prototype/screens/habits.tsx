import * as A from "@domain/habits/actions"
import {
  EVERY_DAY,
  type Habit,
  type ScheduleSlot,
  WEEKDAY_SHORT,
} from "@domain/habits/data"
import * as L from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import { useState } from "react"
import {
  Text as NativeText,
  View as NativeView,
  Pressable,
  View,
} from "react-native"
import { toast } from "sonner-native"
import { Trend } from "../chart"
import { AnimatedCheck, feel, TickRow, useSwipeComplete } from "../motion"
import { Line } from "../native-kit"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import {
  Actions,
  Button,
  Card,
  Choices,
  confirm,
  DateField,
  Field,
  Label,
  ListScreen,
  Row,
  Screen,
  Sheet,
  SwipeRow,
  shareText,
  Title,
  undo,
} from "../ui"
import { IconButton, Metric, Ring, Section } from "../visual"
import { HabitActions } from "./habit-actions"
import {
  AutoMark,
  RuleRing,
  RuleText,
  SCREEN_OFF_LABEL,
  useAutoRule,
  useRuleState,
} from "./screen-card"

export function Schedule({
  value,
  onChange,
}: {
  value: ScheduleSlot[]
  onChange: (slots: ScheduleSlot[]) => void
}) {
  return (
    <Card>
      <Title>Schedule</Title>
      {value.map((slot, index) => (
        <View key={index}>
          <Actions>
            {WEEKDAY_SHORT.map((name, day) => (
              <Button
                key={name}
                tone={slot.days.includes(day) ? "primary" : "quiet"}
                small
                onPress={() =>
                  onChange(
                    value.map((s, i) =>
                      i === index
                        ? {
                            ...s,
                            days: s.days.includes(day)
                              ? s.days.filter((d) => d !== day)
                              : [...s.days, day],
                          }
                        : { ...s, days: s.days.filter((d) => d !== day) },
                    ),
                  )
                }
              >
                {name}
              </Button>
            ))}
          </Actions>
          <DateField
            mode="time"
            label="Time (HH:mm, blank for anytime)"
            value={slot.time ?? ""}
            onChangeText={(time) =>
              onChange(
                value.map((s, i) =>
                  i === index ? { ...s, time: time || undefined } : s,
                ),
              )
            }
          />
          {value.length > 1 && (
            <Button
              tone="quiet"
              onPress={() => onChange(value.filter((_, i) => i !== index))}
            >
              Remove time slot
            </Button>
          )}
        </View>
      ))}
      <Actions>
        <Button tone="quiet" onPress={() => onChange([{ days: EVERY_DAY }])}>
          Every day
        </Button>
        <Button
          tone="quiet"
          onPress={() => onChange([{ days: [1, 2, 3, 4, 5] }])}
        >
          Weekdays
        </Button>
        <Button tone="quiet" onPress={() => onChange([...value, { days: [] }])}>
          Different time on some days
        </Button>
      </Actions>
    </Card>
  )
}
export function validSchedule(slots: ScheduleSlot[]) {
  return (
    slots.some((s) => s.days.length > 0) &&
    slots.every((s) => !s.time || /^([01]\d|2[0-3]):[0-5]\d$/.test(s.time))
  )
}
export function HabitRow({
  habit,
  day = dayKey(),
}: {
  habit: Habit
  day?: string
}) {
  return useAutoRule(habit) ? (
    <RuleHabitRow habit={habit} day={day} />
  ) : (
    <ManualHabitRow habit={habit} day={day} />
  )
}
/** A habit screen time completes: its ring and what's used, read-only. */
function RuleHabitRow({ habit, day }: { habit: Habit; day: string }) {
  const log = habitsStore.use((s) =>
      s.logs.find((l) => l.habitId === habit.id && l.day === day),
    ),
    state = useRuleState(habit, day),
    [actions, setActions] = useState(false)
  return (
    <>
      <Row
        title={`${habit.icon} ${habit.name}`}
        detail={L.scheduleLabel(habit.schedule)}
        href={`/habits/${habit.id}`}
        onLongPress={() => {
          feel.tap()
          setActions(true)
        }}
        longPressLabel="Habit actions"
        right={
          <Line style={{ gap: 8 }}>
            <View style={{ alignItems: "flex-end", gap: 2 }}>
              <RuleText
                state={state}
                maxMin={habit.rule?.maxMin ?? 0}
                done={log?.status === "done"}
              />
              <AutoMark />
            </View>
            <RuleRing habit={habit} log={log} state={state} size={28} />
          </Line>
        }
      />
      <HabitActions
        habit={habit}
        day={day}
        open={actions}
        onClose={() => setActions(false)}
      />
    </>
  )
}
function ManualHabitRow({ habit, day }: { habit: Habit; day: string }) {
  const t = useTheme()
  const logs = habitsStore.use((s) => s.logs)
  const log = logs.find((l) => l.habitId === habit.id && l.day === day)
  const [open, setOpen] = useState(false)
  const [actions, setActions] = useState(false)
  const done = () => {
    const old = log
    if (log?.status === "done") {
      A.clearLog(habit.id, day)
      undo("Log cleared", () => {
        if (old) A.restoreLog(old)
      })
    } else {
      A.checkHabit(habit.id, day)
      undo("Habit checked", () => {
        A.clearLog(habit.id, day)
        if (old) A.restoreLog(old)
      })
    }
  }
  const swipe = useSwipeComplete(log?.status === "done", done)
  return (
    <>
      <SwipeRow onComplete={swipe.onComplete} onMore={() => setOpen(true)}>
        <TickRow>
          <Row
            title={`${habit.icon} ${habit.name}`}
            detail={`${log?.status ?? L.scheduleLabel(habit.schedule)}${habit.target ? ` · ${L.targetLabel(habit)}` : ""}${habit.rule ? ` · ${SCREEN_OFF_LABEL}` : ""}`}
            href={`/habits/${habit.id}`}
            onLongPress={() => {
              feel.tap()
              setActions(true)
            }}
            longPressLabel="Habit actions"
            right={
              habit.type === "check" ? (
                <AnimatedCheck
                  checked={log?.status === "done"}
                  onToggle={done}
                  label={`${log?.status === "done" ? "Clear" : "Check"} ${habit.name}`}
                  color={t.hab}
                  idle={`${t.muted}66`}
                  size={28}
                  checkColor={t.onPrimary}
                  celebrate={swipe.celebrate}
                />
              ) : (
                <Button
                  small
                  tone={log?.status === "done" ? "primary" : "quiet"}
                  onPress={() => setOpen(true)}
                >
                  {log?.status === "done" ? "✓" : "Log"}
                </Button>
              )
            }
          />
        </TickRow>
      </SwipeRow>
      <HabitLog
        habit={habit}
        day={day}
        open={open}
        onClose={() => setOpen(false)}
      />
      <HabitActions
        habit={habit}
        day={day}
        open={actions}
        onClose={() => setActions(false)}
      />
    </>
  )
}
export function HabitLog({
  habit,
  day,
  open,
  onClose,
}: {
  habit: Habit
  day: string
  open: boolean
  onClose: () => void
}) {
  const old = habitsStore
    .get()
    .logs.find((l) => l.habitId === habit.id && l.day === day)
  const [status, setStatus] = useState<"done" | "partial" | "skipped">(
    old?.status ?? "done",
  )
  const [value, setValue] = useState(String(old?.value ?? habit.target ?? ""))
  const [note, setNote] = useState(old?.note ?? "")
  const [date, setDate] = useState(day)
  // Edit opens once the sheet has left; iOS drops a push made while it leaves.
  const [editNext, setEditNext] = useState(false)
  return (
    <Sheet
      title={`Log ${habit.name}`}
      open={open}
      onClose={onClose}
      onClosed={() => {
        if (!editNext) return
        setEditNext(false)
        go(`/habits/${habit.id}/edit`)
      }}
    >
      <Choices
        value={status}
        onChange={setStatus}
        options={["done", "partial", "skipped"].map((value) => ({
          value: value as typeof status,
          label: value,
        }))}
      />
      {habit.type !== "check" && (
        <Field
          label={habit.unit ?? "Minutes"}
          keyboardType="decimal-pad"
          value={value}
          onChangeText={setValue}
        />
      )}
      <DateField label="Day (YYYY-MM-DD)" value={date} onChangeText={setDate} />
      <Actions>
        <Button tone="quiet" onPress={() => setDate(dayKey())}>
          Today
        </Button>
        <Button tone="quiet" onPress={() => setDate(dayOffset(-1))}>
          Yesterday
        </Button>
      </Actions>
      <Field label="Note" value={note} onChangeText={setNote} multiline />
      <Button
        onPress={() => {
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
            !Number.isFinite(Number(value)) ||
            Number(value) < 0
          ) {
            toast.error("Enter a valid day and non-negative value")
            return
          }
          A.logHabit({
            habitId: habit.id,
            day: date,
            status,
            value: habit.type === "check" ? undefined : Number(value),
            note,
          })
          onClose()
        }}
      >
        Save log
      </Button>
      <Actions>
        <Button
          tone="quiet"
          onPress={() => {
            const removed = A.clearLog(habit.id, date)
            if (removed) undo("Log cleared", () => A.restoreLog(removed))
            onClose()
          }}
        >
          Clear log
        </Button>
        {habit.type === "duration" && (
          <Button
            onPress={() => {
              onClose()
              go(`/habits/${habit.id}/timer`)
            }}
          >
            Open timer
          </Button>
        )}
        <Button
          tone="quiet"
          onPress={() => {
            setEditNext(true)
            onClose()
          }}
        >
          Edit habit
        </Button>
      </Actions>
    </Sheet>
  )
}
export function HabitsList({
  archived = false,
  today = false,
}: {
  archived?: boolean
  today?: boolean
}) {
  const t = useTheme()
  const [controls, setControls] = useState(false)
  const [reorder, setReorder] = useState(false)
  const s = habitsStore.use((s) => s)
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<"manual" | "name">("manual")
  const [type, setType] = useState("all")
  const list = s.habits
    .filter(
      (h) =>
        (archived ? h.status === "archived" : h.status !== "archived") &&
        (!today || L.isDue(h, dayKey())) &&
        h.name.toLowerCase().includes(query.toLowerCase()) &&
        (type === "all" || h.type === type),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : a.sortOrder - b.sortOrder,
    )
  return (
    <ListScreen
      title={archived ? "Archived habits" : today ? "Today’s habits" : "Habits"}
      data={list}
      actions={
        <NativeView style={{ flexDirection: "row" }}>
          <IconButton
            icon="history"
            label="Archived habits"
            href="/habits/manage/archived"
          />
          <IconButton
            icon="add"
            label="New habit"
            accent="hab"
            filled
            href="/habits/new"
          />
        </NativeView>
      }
      header={
        <>
          <Choices
            value={today ? "today" : "all"}
            onChange={(value) =>
              go(value === "today" ? "/habits/today" : "/habits/manage")
            }
            options={[
              { value: "today", label: "Today" },
              { value: "all", label: `All · ${list.length}` },
            ]}
          />
          <Actions>
            <Button tone="quiet" small onPress={() => setControls(!controls)}>
              Filter & sort
            </Button>
            <Button tone="quiet" small onPress={() => setReorder(!reorder)}>
              {reorder ? "Done reordering" : "Reorder"}
            </Button>
          </Actions>
          {controls && (
            <>
              <Field
                label="Search habits"
                value={query}
                onChangeText={setQuery}
              />
              <Actions>
                <Button tone="quiet" href="/habits/routines">
                  Routines
                </Button>
                <Button tone="quiet" href="/habits/week">
                  Schedule
                </Button>
                <Button tone="quiet" href="/habits/settings">
                  Settings
                </Button>
                <Button tone="quiet" href="/habits">
                  Analytics
                </Button>
              </Actions>
              <Choices
                value={type}
                onChange={setType}
                options={["all", "check", "count", "duration"].map((value) => ({
                  value,
                  label: value,
                }))}
              />
              <Choices
                value={sort}
                onChange={setSort}
                options={[
                  { value: "manual", label: "Manual order" },
                  { value: "name", label: "Name" },
                ]}
              />
            </>
          )}
        </>
      }
      renderItem={(h) => (
        <NativeView
          style={{
            backgroundColor: t.card,
            paddingHorizontal: 12,
            borderRadius: 12,
          }}
        >
          {archived ? (
            <>
              <Row title={h.name} />
              <Actions>
                <Button onPress={() => A.restoreHabit(h.id)}>Restore</Button>
                <Button
                  tone="danger"
                  onPress={() =>
                    confirm(
                      "Delete habit?",
                      `This removes ${s.logs.filter((l) => l.habitId === h.id).length} logs and its history.`,
                      () => A.deleteHabit(h.id),
                    )
                  }
                >
                  Delete
                </Button>
              </Actions>
            </>
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={() => go(`/habits/${h.id}`)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingVertical: 14,
                }}
              >
                <NativeView
                  style={{
                    backgroundColor: `${t.hab}15`,
                    borderRadius: 14,
                    width: 44,
                    height: 44,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <NativeText style={{ fontSize: 24 }}>{h.icon}</NativeText>
                </NativeView>
                <NativeView style={{ flex: 1, gap: 4 }}>
                  <NativeText
                    style={{
                      fontFamily: fonts.semibold,
                      color: t.text,
                      fontSize: 17,
                    }}
                  >
                    {h.name}
                  </NativeText>
                  <NativeText
                    style={{
                      fontFamily: fonts.body,
                      color: t.muted,
                      fontSize: 12,
                    }}
                  >
                    {L.scheduleLabel(h.schedule)}
                  </NativeText>
                  <NativeView
                    style={{
                      flexDirection: "row",
                      gap: 4,
                      alignItems: "center",
                    }}
                  >
                    {Array.from({ length: 7 }, (_, i) => {
                      const done = s.logs.some(
                        (l) =>
                          l.habitId === h.id &&
                          l.day === dayOffset(i - 6) &&
                          l.status === "done",
                      )
                      return (
                        <NativeView
                          key={i}
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 3,
                            backgroundColor: done ? t.hab : t.soft,
                          }}
                        />
                      )
                    })}
                    <NativeText
                      style={{
                        fontFamily: fonts.medium,
                        fontSize: 11,
                        color: t.life,
                        marginLeft: 8,
                      }}
                    >
                      {L.streaks(h, L.logIndex(s.logs)).current} day streak
                    </NativeText>
                  </NativeView>
                </NativeView>
                <NativeText style={{ color: t.muted }}>›</NativeText>
              </Pressable>
              {reorder && (
                <Actions>
                  <Button
                    small
                    tone="quiet"
                    onPress={() => A.reorderHabit(h.id, -1)}
                  >
                    Move up
                  </Button>
                  <Button
                    small
                    tone="quiet"
                    onPress={() => A.reorderHabit(h.id, 1)}
                  >
                    Move down
                  </Button>
                </Actions>
              )}
            </>
          )}
        </NativeView>
      )}
    />
  )
}
export { HabitDetail } from "./habit-detail"
export { HabitForm, RoutineForm } from "./habit-form"
export { HabitTimer } from "./habit-timer"
export { RoutinePlayer } from "./routine-player"
export { RoutineDetail, Routines } from "./routines"
export function HabitDay({
  day: initial = dayKey(),
  week = false,
}: {
  day?: string
  week?: boolean
}) {
  const s = habitsStore.use((s) => s)
  const [day, setDay] = useState(initial)
  return (
    <Screen title={week ? "Habit schedule" : day}>
      <Actions>
        <Button tone="quiet" onPress={() => setDay(L.addDays(day, -1))}>
          Previous day
        </Button>
        <Button tone="quiet" onPress={() => setDay(dayKey())}>
          Today
        </Button>
        <Button tone="quiet" onPress={() => setDay(L.addDays(day, 1))}>
          Next day
        </Button>
      </Actions>
      <Label large>{day}</Label>
      {s.habits
        .filter((h) => L.isDue(h, day))
        .map((h) => (
          <HabitRow key={`${h.id}-${day}`} habit={h} day={day} />
        ))}
      {s.routines
        .filter((r) => L.slotFor(r.schedule, day))
        .map((r) => (
          <Row
            key={r.id}
            title={r.name}
            detail="Routine"
            href={`/habits/routines/${r.id}`}
          />
        ))}
    </Screen>
  )
}
export { HabitSettings } from "./habit-secondary"
export function HabitStats({ share = false }: { share?: boolean }) {
  const t = useTheme()
  const s = habitsStore.use((s) => s)
  const [days, setDays] = useState("30")
  const stats = L.overallStats(s, Number(days))
  return (
    <Screen
      title={share ? "Share habits" : "Habits"}
      actions={
        <IconButton
          icon="settings"
          label="Habit settings"
          href="/habits/settings"
        />
      }
    >
      <Choices
        value={days}
        onChange={setDays}
        options={["7", "30", "90", "365"].map((value) => ({
          value,
          label: `${value} days`,
        }))}
      />
      <Card>
        <NativeView
          style={{ flexDirection: "row", gap: 18, alignItems: "center" }}
        >
          <Ring value={stats.rate} color={t.hab}>
            <NativeText
              style={{ fontFamily: fonts.display, fontSize: 32, color: t.text }}
            >
              {Math.round(stats.rate * 100)}%
            </NativeText>
            <Label muted>completion</Label>
          </Ring>
          <NativeView style={{ flex: 1, gap: 16 }}>
            <NativeView style={{ flexDirection: "row", gap: 12 }}>
              <Metric value={stats.perfect} label="Perfect days" />
              <Metric
                value={`${Math.round(stats.skipRate * 100)}%`}
                label="Skip rate"
              />
            </NativeView>
            <Metric
              value={`${Math.round(stats.minutes / 60)}h`}
              label="Time invested"
              color={t.hab}
            />
          </NativeView>
        </NativeView>
      </Card>
      <Card>
        <Label muted>Daily completion</Label>
        <Trend
          values={L.overallDays(
            s.habits,
            L.logIndex(s.logs),
            dayOffset(1 - Number(days)),
            dayKey(),
          ).map((d) => d.rate ?? 0)}
          label="Daily habit completion"
          color={t.hab}
          filled
        />
      </Card>
      <Actions>
        <Button tone="quiet" href="/habits/manage">
          Habits
        </Button>
        <Button tone="quiet" href="/habits/routines">
          Routines
        </Button>
        <Button tone="quiet" href="/habits/share">
          Share
        </Button>
      </Actions>
      <Section title="Reflection" />
      <Card>
        <Label>What slipped</Label>
        <NativeView style={{ flexDirection: "row", gap: 16 }}>
          <Metric value={stats.missed} label="Missed" color={t.bad} />
          <Metric value={stats.done} label="Completed" />
        </NativeView>
      </Card>
      <Section title="Your habits" />
      {s.habits
        .filter((h) => h.status !== "archived")
        .map((h) => (
          <Row
            key={h.id}
            title={h.name}
            detail={`${L.streaks(h, L.logIndex(s.logs)).current}-day streak`}
            href={`/habits/${h.id}`}
          />
        ))}
      <Button
        onPress={() =>
          void shareText(
            `My habits · ${Math.round(stats.rate * 100)}% completion over ${days} days`,
          )
        }
      >
        Share recap
      </Button>
    </Screen>
  )
}
