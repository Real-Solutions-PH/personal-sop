import type { CalendarItem, ModuleKey } from "@domain/contract"
import { AREA, MODULE_KEYS } from "@domain/dash/data"
import { useAllCalendar, useEnabled } from "@domain/dash/hooks"
import * as N from "@domain/finance/calc"
import { finStore } from "@domain/finance/store"
import * as H from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import * as A from "@domain/tasks/actions"
import { useStats, useTodayData } from "@domain/tasks/hooks"
import * as T from "@domain/tasks/logic"
import { tasksStore } from "@domain/tasks/store"
import { useLocalSearchParams } from "expo-router"
import {
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudSun,
  Flame,
  History,
  ListChecks,
  ListTodo,
  Moon,
  Plus,
  Search,
  Settings2,
  Star,
  Sun,
  Sunrise,
  TriangleAlert,
} from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { ScrollView as GHScrollView } from "react-native-gesture-handler"
import { SwipeSegments, SwipeStep } from "../motion"
import {
  Copy,
  Frame,
  IconTap,
  Line,
  LinkRow,
  SectionHeading,
  Segmented,
  SmallButton,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Button, confirm, Screen, Sheet, undo } from "../ui"
import { Ring } from "../visual"
import { useMoney } from "./finance"
import { TaskRow } from "./tasks"

export function TaskPlanPanel() {
  const t = useTheme(),
    d = useTodayData(),
    stats = useStats(7),
    s = tasksStore.use((s) => s),
    params = useLocalSearchParams<{ filter?: string }>(),
    [view, setView] = useState(
      params.filter === "overdue" ? "overdue" : "today",
    ),
    [done, setDone] = useState(false),
    [triage, setTriage] = useState(false)
  const count = d.due.length + d.doneDueToday.length + d.overdue.length
  const row = (task: (typeof d.due)[number], showDay = true) => (
    <TaskRow key={task.id} task={task} compact showActions showDay={showDay} />
  )
  return (
    <View>
      <Line>
        <Ring
          size={52}
          strokeWidth={5}
          value={count ? d.doneDueToday.length / count : 1}
          color={t.tsk}
        >
          <Copy size={12} weight="semibold">
            {d.doneDueToday.length}/{count}
          </Copy>
        </Ring>
        <View style={{ flex: 1 }}>
          <Copy weight="semibold">
            {!d.everHadTasks
              ? "No tasks yet"
              : d.due.length
                ? `${d.due.length} left today`
                : "Today's clear"}
          </Copy>
          <Line style={{ gap: 8 }}>
            {d.overdue.length > 0 && (
              <Tap onPress={() => setTriage(true)}>
                <Copy size={12} weight="medium" style={{ color: t.warn }}>
                  {d.overdue.length} overdue
                </Copy>
              </Tap>
            )}
            <Line style={{ gap: 4 }}>
              <Flame size={14} color={t.warn} />
              <Copy size={12} muted>
                {stats.streak}-day streak
              </Copy>
            </Line>
          </Line>
        </View>
        <Line style={{ gap: 0 }}>
          <IconTap
            size={40}
            icon={Search}
            label="Search and sort tasks"
            onPress={() => go("/tasks/search")}
          />
          <IconTap
            size={40}
            icon={ChartColumn}
            label="Task stats"
            onPress={() => go("/tasks/stats")}
          />
          <IconTap
            size={40}
            icon={Plus}
            label="Add task"
            color={t.onPrimary}
            background={t.tsk}
            onPress={() => go("/tasks/new")}
          />
        </Line>
      </Line>
      <View style={{ marginTop: 16 }}>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "today", label: "Today" },
            { value: "upcoming", label: "Upcoming" },
            {
              value: "overdue",
              label: (
                <Copy size={14} weight="medium" muted={view !== "overdue"}>
                  Overdue{" "}
                  {d.overdue.length > 0 && (
                    <Copy size={10} style={{ color: t.warn }}>
                      {d.overdue.length}
                    </Copy>
                  )}
                </Copy>
              ),
            },
            { value: "lists", label: "Lists" },
          ]}
        />
      </View>
      {!d.everHadTasks ? (
        <View style={{ alignItems: "center", paddingVertical: 40, gap: 12 }}>
          <Copy size={22} weight="display">
            Dump everything on your mind
          </Copy>
          <Copy size={14} muted>
            One line per thought. Dates and lists get sorted for you.
          </Copy>
          <SmallButton accent="tsk" onPress={() => go("/tasks/new")}>
            Add your first tasks
          </SmallButton>
        </View>
      ) : view === "today" ? (
        <View>
          {d.overdue.length > 0 && (
            <>
              <SectionHeading
                action={
                  <Tap onPress={() => setTriage(true)}>
                    <Copy size={12} weight="medium" style={{ color: t.warn }}>
                      Triage
                    </Copy>
                  </Tap>
                }
              >
                <Copy size={12} weight="medium" style={{ color: t.warn }}>
                  OVERDUE · {d.overdue.length}
                </Copy>
              </SectionHeading>
              {d.overdue.slice(0, 3).map((task) => row(task))}
              {d.overdue.length > 3 && (
                <Tap
                  onPress={() => setView("overdue")}
                  style={{ paddingHorizontal: 4, paddingVertical: 8 }}
                >
                  <Copy size={14} muted>
                    +{d.overdue.length - 3} more overdue
                  </Copy>
                </Tap>
              )}
            </>
          )}
          <SectionHeading>Due today · {d.due.length}</SectionHeading>
          {d.due.length ? (
            d.due.map((task) => row(task, false))
          ) : (
            <Copy muted style={{ padding: 20, textAlign: "center" }}>
              All clear for today
            </Copy>
          )}
          {d.doneToday.length > 0 && (
            <>
              <Tap
                onPress={() => setDone(!done)}
                style={{ marginTop: 16, paddingHorizontal: 4 }}
              >
                <Line style={{ gap: 4 }}>
                  <ChevronDown size={16} color={t.muted} />
                  <Copy size={12} weight="medium" muted>
                    DONE TODAY · {d.doneToday.length}
                  </Copy>
                </Line>
              </Tap>
              {done && d.doneToday.map((task) => row(task, false))}
            </>
          )}
        </View>
      ) : view === "upcoming" ? (
        <View>
          {d.upcoming.map((g) => (
            <View key={g.day}>
              <SectionHeading
                action={
                  <IconTap
                    icon={Plus}
                    size={24}
                    label={`Add task on ${T.fmtDayLong(g.day)}`}
                    onPress={() => go(`/tasks/new?day=${g.day}`)}
                  />
                }
              >
                {T.fmtDayLong(g.day)}
              </SectionHeading>
              {g.tasks.length ? (
                g.tasks.map((task) => row(task, false))
              ) : (
                <Copy size={14} muted style={{ paddingHorizontal: 4 }}>
                  Nothing planned
                </Copy>
              )}
            </View>
          ))}
          {d.later.length > 0 && (
            <>
              <SectionHeading>Later · {d.later.length}</SectionHeading>
              {d.later.map((task) => row(task))}
            </>
          )}
        </View>
      ) : view === "overdue" ? (
        <View style={{ marginTop: 12 }}>
          {d.overdue.length ? (
            <>
              <Frame
                style={{
                  padding: 16,
                  backgroundColor: `${t.warn}0d`,
                  borderColor: `${t.warn}4d`,
                }}
              >
                <Line>
                  <TriangleAlert size={20} color={t.warn} />
                  <View style={{ flex: 1 }}>
                    <Copy size={14} weight="medium">
                      {d.overdue.length} slipped
                    </Copy>
                    <Copy size={12} muted>
                      {stats.reschedules} reschedules this week
                    </Copy>
                  </View>
                  <SmallButton accent="tsk" onPress={() => setTriage(true)}>
                    Triage
                  </SmallButton>
                </Line>
              </Frame>
              <View style={{ marginTop: 8 }}>
                {d.overdue.map((task) => row(task))}
              </View>
            </>
          ) : (
            <Copy muted style={{ padding: 24 }}>
              Nothing overdue
            </Copy>
          )}
        </View>
      ) : (
        <>
          <SectionHeading>Smart views</SectionHeading>
          <LinkRow
            title="Inbox"
            detail="No list yet"
            icon={ListTodo}
            accent="tsk"
            href="/tasks/list/inbox"
            right={
              <Copy size={14} muted>
                {d.inbox.length}
              </Copy>
            }
          />
          <LinkRow
            title="Starred"
            icon={Star}
            accent="life"
            href="/tasks/list/starred"
            right={
              <Copy size={14} muted>
                {d.starred.length}
              </Copy>
            }
          />
          <SectionHeading
            action={
              <Tap onPress={() => go("/tasks/lists")}>
                <Copy size={12} style={{ color: t.tsk }}>
                  Edit lists
                </Copy>
              </Tap>
            }
          >
            Lists
          </SectionHeading>
          {s.lists
            .filter((l) => !l.archivedAt)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((l) => (
              <LinkRow
                key={l.id}
                title={l.name}
                detail={l.kind === "shopping" ? "Shopping list" : undefined}
                icon={ListTodo}
                accent={l.color === "warn" ? "life" : l.color}
                href={`/tasks/list/${l.id}`}
                right={
                  <Copy size={14} muted>
                    {s.tasks.filter(
                      (task) => task.listId === l.id && task.status === "open",
                    ).length || ""}
                  </Copy>
                }
              />
            ))}
          <SectionHeading>More</SectionHeading>
          {[
            { title: "Search & filter", icon: Search, href: "/tasks/search" },
            {
              title: "Completed & deleted",
              icon: History,
              href: "/tasks/completed",
            },
            { title: "Task stats", icon: ListChecks, href: "/tasks/stats" },
            {
              title: "Tasks settings",
              icon: Settings2,
              href: "/tasks/settings",
            },
          ].map((l) => (
            <LinkRow key={l.href} {...l} />
          ))}
        </>
      )}
      <Sheet
        title="Triage overdue tasks"
        open={triage}
        onClose={() => setTriage(false)}
      >
        <Copy size={14} muted>
          Choose a new date, finish, or delete each task.
        </Copy>
        {d.overdue.map((task) => row(task))}
        <Button
          onPress={() =>
            confirm(
              "Move all overdue tasks to today?",
              "The current dates will be replaced. You can undo this change.",
              () => {
                const old = d.overdue.map((task) => ({ ...task }))
                A.moveAllOverdueToToday()
                undo("Moved overdue tasks to today", () =>
                  old.forEach((task) => {
                    A.setDue(task.id, task.dueDate, task.dueTime, task.remindAt)
                  }),
                )
                setTriage(false)
              },
            )
          }
        >
          Move all to today
        </Button>
      </Sheet>
    </View>
  )
}
export function TasksHome() {
  return (
    <Screen title="Tasks" prototypeLayout>
      <TaskPlanPanel />
    </Screen>
  )
}
export function Plan() {
  const enabled = useEnabled(),
    params = useLocalSearchParams<{ seg?: string }>(),
    [seg, setSeg] = useState(params.seg ?? "tasks")
  const options = [
      ...(enabled.tasks ? [{ value: "tasks", label: "Tasks" }] : []),
      ...(enabled.habits ? [{ value: "habits", label: "Habits" }] : []),
      { value: "calendar", label: "Calendar" },
    ],
    active = options.some((o) => o.value === seg) ? seg : "calendar"
  return (
    <Screen root prototypeLayout title="Plan">
      <Segmented value={active} onChange={setSeg} options={options} />
      <SwipeSegments
        value={active}
        options={options.map((o) => o.value)}
        onChange={setSeg}
      >
        {active === "tasks" ? (
          <TaskPlanPanel />
        ) : active === "habits" ? (
          <HabitPlanPanel />
        ) : (
          <CalendarPanel />
        )}
      </SwipeSegments>
    </Screen>
  )
}
export function HabitPlanPanel() {
  const t = useTheme(),
    s = habitsStore.use((s) => s),
    today = dayKey(),
    [week, setWeek] = useState(0),
    [sel, setSel] = useState(today),
    start = H.addDays(H.weekStartOf(today, s.settings.weekStart), week * 7),
    days = Array.from({ length: 7 }, (_, i) => H.addDays(start, i)),
    idx = H.logIndex(s.logs),
    habits = H.sortedHabits(s.habits.filter((h) => h.status !== "archived"))
  const items = [
    ...s.routines
      .filter(
        (r) =>
          r.status === "active" &&
          sel >= r.createdAt &&
          H.slotFor(r.schedule, sel),
      )
      .map((r) => ({
        id: r.id,
        time: H.slotFor(r.schedule, sel)?.time,
        habit: null,
        routine: r,
      })),
    ...habits
      .filter((h) => H.cellFor(h, sel, idx, today) !== "none")
      .map((h) => ({
        id: h.id,
        time: H.slotFor(h.schedule, sel)?.time,
        habit: h,
        routine: null,
      })),
  ].sort((a, b) => H.toMin(a.time ?? "99:99") - H.toMin(b.time ?? "99:99"))
  return (
    <View>
      <Line style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <IconTap
          icon={ChevronLeft}
          label="Previous week"
          onPress={() => setWeek(week - 1)}
        />
        <Tap
          onPress={() => {
            setWeek(0)
            setSel(today)
          }}
        >
          <Copy size={14} weight="medium">
            {week === 0
              ? "This week"
              : `${dateLabel(days[0])} – ${dateLabel(days[6])}`}
          </Copy>
        </Tap>
        <IconTap
          icon={ChevronRight}
          label="Next week"
          onPress={() => setWeek(week + 1)}
        />
      </Line>
      <SwipeStep stepKey={week} onStep={(d) => setWeek(week + d)}>
        <Line style={{ gap: 4 }}>
          {days.map((d) => {
            const due = habits.filter((h) => H.isDue(h, d)),
              done = due.filter(
                (h) => idx.get(H.lk(h.id, d))?.status === "done",
              ).length
            return (
              <Tap
                key={d}
                label={`Select ${d}`}
                onPress={() => setSel(d)}
                style={{
                  flex: 1,
                  gap: 4,
                  alignItems: "center",
                  paddingVertical: 8,
                  borderRadius: 16,
                  backgroundColor: sel === d ? `${t.hab}26` : "transparent",
                }}
              >
                <Copy size={10} muted>
                  {
                    new Date(`${d}T12:00:00`).toLocaleDateString("en", {
                      weekday: "short",
                    })[0]
                  }
                </Copy>
                <Ring
                  size={34}
                  strokeWidth={3}
                  color={t.hab}
                  value={d <= today && due.length ? done / due.length : 0}
                >
                  <Copy
                    size={12}
                    weight="semibold"
                    style={{ color: d === today ? t.hab : t.text }}
                  >
                    {Number(d.slice(8))}
                  </Copy>
                </Ring>
                <Copy size={10} muted>
                  {d <= today ? `${done}/${due.length}` : due.length}
                </Copy>
              </Tap>
            )
          })}
        </Line>
      </SwipeStep>
      <SectionHeading
        action={
          <Tap onPress={() => go(`/habits/day/${sel}`)}>
            <Copy size={12} style={{ color: t.hab }}>
              Edit day
            </Copy>
          </Tap>
        }
      >
        {sel === today ? "Today" : dateLabel(sel)}
      </SectionHeading>
      <Frame style={{ padding: 4 }}>
        {items.length ? (
          items.map((item, i) => (
            <View key={item.id}>
              {i === 0 || item.time !== items[i - 1].time ? (
                <Copy size={11} muted style={{ padding: 8 }}>
                  {H.fmtTime(item.time)}
                </Copy>
              ) : null}
              <Tap
                onPress={() =>
                  go(
                    item.routine
                      ? `/habits/routines/${item.id}`
                      : `/habits/${item.id}`,
                  )
                }
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: item.routine ? 10 : 8,
                  borderRadius: 12,
                  backgroundColor: item.routine ? `${t.hab}1a` : "transparent",
                }}
              >
                <Line>
                  {item.habit && (
                    <View
                      style={{
                        height: 20,
                        width: 20,
                        borderRadius: 10,
                        borderWidth: 2,
                        borderColor:
                          idx.get(H.lk(item.id, sel))?.status === "done"
                            ? t.hab
                            : `${t.muted}4d`,
                        backgroundColor:
                          idx.get(H.lk(item.id, sel))?.status === "done"
                            ? t.hab
                            : "transparent",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {idx.get(H.lk(item.id, sel))?.status === "done" && (
                        <Check size={12} color={t.onPrimary} />
                      )}
                    </View>
                  )}
                  <Copy>{item.habit?.icon ?? item.routine?.icon}</Copy>
                  <View style={{ flex: 1 }}>
                    <Copy
                      size={item.routine ? 16 : 14}
                      weight={item.routine ? "medium" : "body"}
                    >
                      {item.habit?.name ?? item.routine?.name}
                    </Copy>
                    {item.routine && (
                      <Copy size={12} muted>
                        Routine · {item.routine.steps.length} steps ·{" "}
                        {H.plannedMin(item.routine)}m
                      </Copy>
                    )}
                  </View>
                </Line>
              </Tap>
            </View>
          ))
        ) : (
          <Copy muted style={{ padding: 24, textAlign: "center" }}>
            Nothing scheduled — rest day.
          </Copy>
        )}
      </Frame>
      <SectionHeading>Manage</SectionHeading>
      <LinkRow
        title="Habits"
        icon={ListChecks}
        accent="hab"
        href="/habits/manage"
      />
      <LinkRow
        title="Routines"
        icon={History}
        accent="hab"
        href="/habits/routines"
      />
    </View>
  )
}
const dateLabel = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
  })
const monday = (d: string) =>
  N.addDays(d, -((new Date(`${d}T12:00:00`).getDay() + 6) % 7))
const PARTS = [
  { label: "Early morning", range: "4–8 AM", from: 4, to: 8, icon: Sunrise },
  { label: "Morning", range: "8 AM–12 PM", from: 8, to: 12, icon: Sun },
  { label: "Afternoon", range: "12–6 PM", from: 12, to: 18, icon: CloudSun },
  { label: "Night", range: "6 PM–4 AM", from: 18, to: 28, icon: Moon },
]
const hour = (time: string) =>
  Number(time.slice(0, 2)) < 4
    ? Number(time.slice(0, 2)) + 24
    : Number(time.slice(0, 2))
function CalendarPanel() {
  const t = useTheme(),
    enabled = useEnabled(),
    today = dayKey(),
    [mode, setMode] = useState("month"),
    [offset, setOffset] = useState(0),
    [sel, setSel] = useState(today),
    [hidden, setHidden] = useState<ModuleKey[]>([]),
    fin = finStore.use((s) => s),
    money = useMoney()
  const anchor = new Date(`${today}T12:00:00`)
  anchor.setDate(1)
  anchor.setMonth(anchor.getMonth() + offset)
  const first = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}-01`,
    start =
      mode === "week" ? N.addDays(monday(today), offset * 7) : monday(first),
    days = Array.from({ length: mode === "week" ? 7 : 42 }, (_, i) =>
      N.addDays(start, i),
    ),
    all = useAllCalendar(days[0], days.at(-1)!),
    items = all.filter((i) => !hidden.includes(i.module)),
    selected = items.filter((i) => i.day === sel),
    currentHour = hour(new Date().toTimeString().slice(0, 5)),
    due = N.occurrencesIn(
      fin,
      N.addDays(today, -7),
      N.addDays(today, 14),
    ).filter(
      (o) => o.status !== "skipped" && (o.status !== "paid" || o.day >= today),
    )
  const itemRow = (i: CalendarItem) => (
    <Tap key={i.id} onPress={() => go(i.href)} style={{ paddingVertical: 8 }}>
      <Line style={{ gap: 8 }}>
        <Copy size={12} muted style={{ width: 42 }}>
          {i.time ?? "—"}
        </Copy>
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: t[AREA[i.module].accent],
          }}
        />
        <Copy
          size={14}
          lines={1}
          style={{
            flex: 1,
            color: i.done ? t.muted : t.text,
            textDecorationLine: i.done ? "line-through" : "none",
          }}
        >
          {i.title}
        </Copy>
        {i.done && <Check size={14} color={t.good} />}
      </Line>
    </Tap>
  )
  return (
    <View>
      <Line style={{ gap: 8, marginBottom: 12 }}>
        <IconTap
          size={44}
          icon={ChevronLeft}
          label="Previous"
          onPress={() => setOffset(offset - 1)}
        />
        <Tap
          style={{ flex: 1 }}
          onPress={() => {
            setOffset(0)
            setSel(today)
          }}
        >
          <Copy weight="semibold" style={{ textAlign: "center" }}>
            {mode === "week"
              ? `${dateLabel(days[0])} – ${dateLabel(days[6])}`
              : anchor.toLocaleDateString("en-PH", {
                  month: "long",
                  year: "numeric",
                })}
          </Copy>
        </Tap>
        <IconTap
          size={44}
          icon={ChevronRight}
          label="Next"
          onPress={() => setOffset(offset + 1)}
        />
        <View style={{ width: 112 }}>
          <Segmented
            value={mode}
            options={[
              { value: "month", label: "M" },
              { value: "week", label: "W" },
            ]}
            onChange={(v) => {
              setMode(v)
              setOffset(0)
            }}
          />
        </View>
      </Line>
      <SwipeStep
        stepKey={`${mode}-${offset}`}
        onStep={(d) => setOffset(offset + d)}
      >
        <Frame style={{ padding: 8 }}>
          <Line style={{ gap: 2, paddingBottom: 4 }}>
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <Copy
                key={`${d}-${i}`}
                size={10}
                muted
                style={{ flex: 1, textAlign: "center" }}
              >
                {d}
              </Copy>
            ))}
          </Line>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {days.map((d) => {
              const list = items.filter((i) => i.day === d)
              return (
                <Tap
                  key={d}
                  label={`Select ${d}`}
                  onPress={() => setSel(d)}
                  style={{
                    width: "14.2857%",
                    height: mode === "week" ? 80 : 56,
                    paddingVertical: 6,
                    gap: 4,
                    alignItems: "center",
                    borderRadius: 12,
                    backgroundColor:
                      sel === d ? `${t.primary}26` : "transparent",
                    opacity:
                      mode === "month" && !d.startsWith(first.slice(0, 7))
                        ? 0.35
                        : 1,
                  }}
                >
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: d === today ? t.primary : "transparent",
                    }}
                  >
                    <Copy
                      size={14}
                      style={{ color: d === today ? t.onPrimary : t.text }}
                    >
                      {Number(d.slice(8))}
                    </Copy>
                  </View>
                  <Line style={{ gap: 2 }}>
                    {MODULE_KEYS.filter((k) =>
                      list.some((i) => i.module === k),
                    ).map((k) => (
                      <View
                        key={k}
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: t[AREA[k].accent],
                        }}
                      />
                    ))}
                  </Line>
                  {mode === "week" && (
                    <Copy size={10} muted>
                      {list.length || ""}
                    </Copy>
                  )}
                </Tap>
              )
            })}
          </View>
        </Frame>
      </SwipeStep>
      <GHScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginTop: 12 }}
        contentContainerStyle={{ gap: 8 }}
      >
        {MODULE_KEYS.filter((k) => enabled[k]).map((k) => (
          <Tap
            key={k}
            onPress={() =>
              setHidden(
                hidden.includes(k)
                  ? hidden.filter((x) => x !== k)
                  : [...hidden, k],
              )
            }
            style={{
              height: 44,
              paddingHorizontal: 14,
              justifyContent: "center",
              borderRadius: 22,
              backgroundColor: hidden.includes(k)
                ? t.soft
                : `${t[AREA[k].accent]}26`,
            }}
          >
            <Copy
              size={12}
              style={{
                color: hidden.includes(k) ? t.muted : t[AREA[k].accent],
              }}
            >
              {AREA[k].label}
            </Copy>
          </Tap>
        ))}
      </GHScrollView>
      <SectionHeading>{`${sel === today ? "Today" : dateLabel(sel)} · ${selected.length}`}</SectionHeading>
      <View style={{ gap: 12 }}>
        {selected.length ? (
          <>
            {PARTS.map((part) => {
              const list = selected
                  .filter(
                    (i) =>
                      i.time &&
                      hour(i.time) >= part.from &&
                      hour(i.time) < part.to,
                  )
                  .sort((a, b) => hour(a.time!) - hour(b.time!)),
                current =
                  sel === today &&
                  currentHour >= part.from &&
                  currentHour < part.to
              return (
                <Frame
                  key={part.label}
                  style={{
                    padding: 12,
                    borderColor: current ? `${t.primary}99` : undefined,
                  }}
                >
                  <Line style={{ gap: 8, marginBottom: 4 }}>
                    <part.icon
                      size={16}
                      color={current ? t.primary : t.muted}
                    />
                    <Copy size={14} weight="semibold">
                      {part.label}
                    </Copy>
                    <Copy size={12} muted>
                      {part.range}
                    </Copy>
                    {current && (
                      <Copy size={10} style={{ color: t.primary }}>
                        NOW
                      </Copy>
                    )}
                    <Copy size={12} muted style={{ marginLeft: "auto" }}>
                      {list.length
                        ? `${list.filter((i) => i.done).length}/${list.length}`
                        : ""}
                    </Copy>
                  </Line>
                  {list.length ? (
                    list.map(itemRow)
                  ) : (
                    <Copy size={12} muted>
                      Nothing planned
                    </Copy>
                  )}
                </Frame>
              )
            })}
            {selected.some((i) => !i.time) && (
              <Frame style={{ padding: 12 }}>
                <Copy size={14} weight="semibold">
                  Anytime
                </Copy>
                {selected.filter((i) => !i.time).map(itemRow)}
              </Frame>
            )}
          </>
        ) : (
          <Frame style={{ padding: 24 }}>
            <Copy weight="semibold">Nothing scheduled</Copy>
            <Copy size={14} muted>
              Free day — add a task or let it breathe.
            </Copy>
          </Frame>
        )}
      </View>
      {enabled.finance && (
        <>
          <SectionHeading
            action={
              <Tap onPress={() => go("/finance/planned")}>
                <Copy size={12} style={{ color: t.fin }}>
                  All scheduled
                </Copy>
              </Tap>
            }
          >
            Bills & paydays
          </SectionHeading>
          <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
            {due.map((o) => (
              <Tap
                key={`${o.item.id}-${o.orig}`}
                onPress={() => go(`/finance/planned/${o.item.id}`)}
                style={{ paddingVertical: 8 }}
              >
                <Line>
                  <Copy>
                    {fin.categories.find((c) => c.id === o.item.categoryId)
                      ?.icon ?? "⇄"}
                  </Copy>
                  <View style={{ flex: 1 }}>
                    <Copy size={14}>{o.item.name}</Copy>
                    <Copy size={11} muted>
                      {N.dayLabel(o.day)}
                    </Copy>
                  </View>
                  <Copy size={14}>{money(o.item.amount)}</Copy>
                </Line>
              </Tap>
            ))}
            {!due.length && (
              <Copy muted>No bills or paydays in the next 2 weeks.</Copy>
            )}
          </Frame>
        </>
      )}
    </View>
  )
}
