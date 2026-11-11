import { dayKey } from "@domain/lib/day"
import * as A from "@domain/tasks/actions"
import type { Task, TaskList } from "@domain/tasks/data"
import * as L from "@domain/tasks/logic"
import { tasksStore } from "@domain/tasks/store"
import { useLocalSearchParams } from "expo-router"
import {
  AlarmClock,
  ArrowRight,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  Check,
  CopyPlus,
  Ellipsis,
  FolderInput,
  type LucideIcon,
  Plus,
  Repeat,
  RotateCcw,
  Star,
  Trash2,
} from "lucide-react-native"
import { useRef, useState } from "react"
import { Pressable, Text, View } from "react-native"
import Animated from "react-native-reanimated"
import { toast } from "sonner-native"
import {
  AnimatedCheck,
  feel,
  markCompletion,
  rowEnter,
  rowExit,
  TickRow,
  useSwipeComplete,
} from "../motion"
import { Copy, Line, Tap } from "../native-kit"
import { back, go } from "../navigation"
import { PriorityMark } from "../task-editor"
import { fonts, useTheme } from "../theme"
import {
  Actions,
  Button,
  Choices,
  confirm,
  Field,
  ListScreen,
  Sheet,
  SwipeRow,
  Title,
  undo,
} from "../ui"
import { IconButton, Ring } from "../visual"
import { ListGlyph, ListEditor as NativeListEditor } from "./task-lists"

/** A task's tags as small neutral pills, under its title in the lists. */
/** When a task was ticked: "3:42 PM", or "Tue 3:42 PM" when the day is
 * not given by the surrounding list and is not today. */
function doneLabel(at: Date, withDay: boolean) {
  const time = at.toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  })
  return withDay && dayKey(at) !== dayKey()
    ? `${at.toLocaleDateString("en-PH", { weekday: "short" })} ${time}`
    : time
}
export function TagChips({ tags }: { tags?: string[] }) {
  const t = useTheme()
  if (!tags?.length) return null
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
      {tags.map((tag) => (
        <View
          key={tag}
          style={{
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 999,
            backgroundColor: t.soft,
          }}
        >
          <Text
            style={{ fontFamily: fonts.medium, fontSize: 12, color: t.muted }}
          >
            #{tag}
          </Text>
        </View>
      ))}
    </View>
  )
}

/** One-tap actions under a row: an icon over a short word each, sharing
 * the width (stacked, so "Tomorrow" fits a quarter of a phone sheet), every
 * target at least 44pt tall. */
function QuickActions({
  title,
  actions,
}: {
  title: string
  actions: {
    verb: string
    label?: string
    icon: LucideIcon
    color?: string
    onPress: () => void
  }[]
}) {
  const t = useTheme()
  return (
    <Line style={{ gap: 8, paddingLeft: 40, paddingBottom: 6 }}>
      {actions.map((a) => (
        <Tap
          key={a.verb}
          label={`${a.label ?? a.verb}: ${title}`}
          onPress={a.onPress}
          style={{
            flex: 1,
            minHeight: 44,
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            paddingVertical: 4,
          }}
        >
          <a.icon size={18} color={a.color ?? t.tsk} />
          <Copy
            size={12}
            weight="medium"
            lines={1}
            maxScale={1.2}
            style={{ color: a.color ?? t.text }}
          >
            {a.verb}
          </Copy>
        </Tap>
      ))}
    </Line>
  )
}
/** One action in the task sheet: an icon over a short word, coloured by
 * what it does, sharing its row's width. The word is a name, not a
 * sentence; the full name goes to screen readers. */
function ActionTile({
  icon: Icon,
  word,
  label,
  color,
  filled = false,
  onPress,
}: {
  icon: LucideIcon
  word: string
  label: string
  color: string
  filled?: boolean
  onPress: () => void
}) {
  const t = useTheme()
  return (
    <Tap
      label={label}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 64,
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        paddingVertical: 8,
        paddingHorizontal: 4,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.line,
        backgroundColor: t.card,
      }}
    >
      <Icon size={20} color={color} fill={filled ? color : "none"} />
      <Copy
        size={12}
        weight="medium"
        maxScale={1.2}
        style={{ color, textAlign: "center" }}
      >
        {word}
      </Copy>
    </Tap>
  )
}

/** The task sheet's actions, grouped by meaning: what happens to the task
 * (done, starred, copied, moved), then when it is due — every date action
 * in one colour — and Delete on its own below a rule. */
export function TaskActionGrid({
  task,
  onDone,
  onToggle,
  onToday,
  onTomorrow,
  onMove,
}: {
  task: Task
  /** Closes the sheet after an action that finishes there. */
  onDone: () => void
  onToggle: () => void
  onToday: () => void
  onTomorrow: () => void
  onMove: () => void
}) {
  const t = useTheme()
  const done = task.status === "done"
  const act = (fn: () => void) => () => {
    fn()
    onDone()
  }
  return (
    <View style={{ gap: 8, marginVertical: 8 }}>
      <Line style={{ gap: 8, alignItems: "stretch" }}>
        <ActionTile
          icon={done ? RotateCcw : Check}
          word={done ? "Reopen" : "Done"}
          label={done ? "Reopen" : "Complete"}
          color={done ? t.text : t.good}
          onPress={act(onToggle)}
        />
        <ActionTile
          icon={Star}
          word={task.starred ? "Unstar" : "Star"}
          label={task.starred ? "Unstar" : "Star"}
          color={t.warn}
          filled={task.starred}
          onPress={act(() => A.updateTask(task.id, { starred: !task.starred }))}
        />
        <ActionTile
          icon={CopyPlus}
          word="Copy"
          label="Duplicate"
          color={t.text}
          onPress={act(() => A.duplicateTask(task.id))}
        />
        <ActionTile
          icon={FolderInput}
          word="Move"
          label="Move to list"
          color={t.text}
          onPress={onMove}
        />
      </Line>
      <Line style={{ gap: 8, alignItems: "stretch" }}>
        <ActionTile
          icon={AlarmClock}
          word="+1 hour"
          label="Snooze 1 hour"
          color={t.tsk}
          onPress={act(() => A.snoozeTask(task.id))}
        />
        {/* Only a late task: moving a later or undated one to today would
            count a push (or set an original date) that never happened. */}
        {L.isOverdue(task) && (
          <ActionTile
            icon={CalendarCheck}
            word="Today"
            label="Today"
            color={t.tsk}
            onPress={act(onToday)}
          />
        )}
        <ActionTile
          icon={CalendarPlus}
          word="Tomorrow"
          label="Tomorrow"
          color={t.tsk}
          onPress={act(onTomorrow)}
        />
        {!!task.dueDate && (
          <ActionTile
            icon={CalendarX}
            word="No date"
            label="Remove date"
            color={t.tsk}
            // No date means no schedule: a repeat would bring one back
            // on the next completion.
            onPress={act(() => {
              A.setDue(task.id, null, null, null)
              if (task.recurrence) A.updateTask(task.id, { recurrence: null })
            })}
          />
        )}
      </Line>
      <View style={{ height: 1, backgroundColor: t.line, marginVertical: 4 }} />
      <Tap
        label="Delete"
        onPress={act(() => A.deleteTask(task.id))}
        style={{
          minHeight: 48,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          borderRadius: 12,
          backgroundColor: `${t.bad}26`,
        }}
      >
        <Trash2 size={18} color={t.bad} />
        <Copy size={14} weight="semibold" style={{ color: t.bad }}>
          Delete
        </Copy>
      </Tap>
    </View>
  )
}
export function TaskRow({
  task,
  compact = false,
  showActions = false,
  showDay = false,
  showList = true,
  surface,
  quick = false,
}: {
  task: Task
  compact?: boolean
  showActions?: boolean
  showDay?: boolean
  showList?: boolean
  /** Background of the surface the row sits on (e.g. a card). */
  surface?: string
  /** Triage: one-tap Done, Today, Tomorrow and More under the row, in
   * place of its actions button. */
  quick?: boolean
}) {
  const t = useTheme()
  const list = tasksStore.use((s) => s.lists.find((l) => l.id === task.listId))
  const allLists = tasksStore.use((s) => s.lists)
  const [open, setOpen] = useState(false)
  // The actions sheet swaps to a list chooser; "New list…" opens the editor.
  const [moving, setMoving] = useState(false)
  const [making, setMaking] = useState(false)
  const close = () => {
    setOpen(false)
    setMoving(false)
  }
  const move = (listId: string | null) => {
    const prev = task.listId
    const target = listId
      ? tasksStore.get().lists.find((l) => l.id === listId && !l.archivedAt)
      : null
    close()
    if (listId && !target) {
      toast.error("That list is gone")
      return
    }
    if (listId === prev) return
    A.updateTask(task.id, { listId })
  }
  // An empty meta line would sit under the title and pull it above the
  // checkbox's centre, so it only renders when it has something to say.
  const doneAt =
    task.status === "done" && task.completedAt
      ? new Date(task.completedAt)
      : null
  const prioritised = !!task.priority && task.priority !== "none"
  const hasMeta =
    prioritised ||
    !!doneAt ||
    (showDay && !!task.dueDate) ||
    !!task.dueTime ||
    !!task.recurrence ||
    (!!task.remindAt && task.status === "open") ||
    task.rescheduleCount > 1 ||
    (!!list && showList)
  const toggle = () => {
    if (task.status === "done") {
      A.uncompleteTask(task.id)
      return
    }
    A.completeTask(task.id)
    undo("Task complete", () => A.uncompleteTask(task.id))
  }
  const swipe = useSwipeComplete(task.status === "done", toggle)
  // A quick action fires once per version of the task: a second tap before
  // the row leaves (or re-renders with the change) does nothing.
  const acted = useRef<Task | null>(null)
  const once = (fn: () => void) => () => {
    if (acted.current === task) return
    acted.current = task
    fn()
  }
  // Triage's Done: felt at once, and counted toward an all-done moment
  // (as a tick of the check is), without waiting out the check's beat.
  const finish = () => {
    feel.success()
    markCompletion(true)
    toggle()
  }
  const toToday = () => A.moveToToday(task.id)
  const toTomorrow = () => A.rescheduleBy(task.id, 1)
  return (
    <>
      {/* No layout transition: rows move between sections whose
          containers do not animate, which left gaps on iOS. */}
      <Animated.View entering={rowEnter} exiting={rowExit}>
        <SwipeRow
          onComplete={swipe.onComplete}
          onMore={() => setOpen(true)}
          background={surface}
        >
          <TickRow
            style={{
              flexDirection: "row",
              gap: compact ? 12 : 10,
              alignItems: "center",
              // A wrapped title grows the row; this keeps it off the next.
              paddingVertical: compact ? 6 : 9,
              minHeight: 56,
              paddingHorizontal: compact ? 4 : 0,
            }}
          >
            <AnimatedCheck
              checked={task.status === "done"}
              onToggle={toggle}
              label={task.status === "done" ? "Reopen task" : "Done"}
              color={t.tsk}
              idle={`${t.muted}66`}
              square={list?.kind === "shopping"}
              checkColor={t.dark ? t.bg : "#fff"}
              celebrate={swipe.celebrate}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Long press for actions"
              onPress={() => go(`/tasks/task/${task.id}`)}
              onLongPress={() => {
                feel.tap()
                setOpen(true)
              }}
              delayLongPress={350}
              style={{ flex: 1, gap: compact ? 2 : 3 }}
            >
              {/* The title is what the row is: it wraps, never truncates. */}
              <Text
                style={{
                  fontFamily: compact ? fonts.medium : fonts.semibold,
                  fontSize: compact ? 16 : 17,
                  lineHeight: compact ? 22 : 24,
                  color: t.text,
                  textDecorationLine:
                    task.status === "done" ? "line-through" : "none",
                }}
              >
                {task.title}
                {task.starred ? (
                  <Text style={{ color: t.warn, fontSize: 14 }}> ★</Text>
                ) : null}
              </Text>
              {compact ? (
                hasMeta && (
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      alignItems: "center",
                      columnGap: 6,
                      rowGap: 2,
                      minHeight: 16,
                    }}
                  >
                    {/* First: how much it matters is read before when. */}
                    <PriorityMark priority={task.priority} />
                    {doneAt && (
                      <View
                        accessible
                        accessibilityLabel={`Done at ${doneLabel(doneAt, showDay)}`}
                        style={{
                          flexDirection: "row",
                          gap: 2,
                          alignItems: "center",
                        }}
                      >
                        <Check size={12} color={t.good} />
                        <Text
                          style={{
                            fontFamily: fonts.medium,
                            fontSize: 12,
                            color: t.good,
                          }}
                        >
                          {doneLabel(doneAt, showDay)}
                        </Text>
                      </View>
                    )}
                    {showDay && task.dueDate && !doneAt && (
                      <Text
                        style={{
                          fontFamily: L.isOverdue(task)
                            ? fonts.medium
                            : fonts.body,
                          fontSize: 12,
                          color: L.isOverdue(task) ? t.bad : t.muted,
                        }}
                      >
                        {L.isOverdue(task)
                          ? `late ${L.diffDays(task.dueDate, dayKey())}d`
                          : L.fmtDay(task.dueDate)}
                      </Text>
                    )}
                    {task.dueTime && (
                      <Text
                        style={{
                          fontFamily: L.isDueNow(task)
                            ? fonts.medium
                            : fonts.body,
                          fontSize: 12,
                          color: L.isDueNow(task) ? t.text : t.muted,
                        }}
                      >
                        {L.fmtTime(task.dueTime)}
                      </Text>
                    )}
                    {task.recurrence && <Repeat size={12} color={t.muted} />}
                    {task.remindAt && task.status === "open" && (
                      <AlarmClock size={12} color={t.muted} />
                    )}
                    {task.rescheduleCount > 1 && (
                      <View
                        style={{
                          flexDirection: "row",
                          gap: 2,
                          alignItems: "center",
                        }}
                      >
                        {/* Pushed three times or more is a pattern, not
                            a one-off: it says so in the bad colour. */}
                        <CalendarClock
                          size={12}
                          color={task.rescheduleCount >= 3 ? t.bad : t.warn}
                        />
                        <Text
                          style={{
                            fontFamily:
                              task.rescheduleCount >= 3
                                ? fonts.medium
                                : fonts.body,
                            fontSize: 12,
                            color: task.rescheduleCount >= 3 ? t.bad : t.warn,
                          }}
                        >
                          {task.rescheduleCount >= 3
                            ? `pushed ${task.rescheduleCount}×`
                            : `${task.rescheduleCount}×`}
                        </Text>
                      </View>
                    )}
                    {list && showList && (
                      <View
                        style={{
                          flexDirection: "row",
                          gap: 4,
                          alignItems: "center",
                        }}
                      >
                        <View
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            backgroundColor: t[list.color],
                          }}
                        />
                        <Text
                          style={{
                            fontFamily: fonts.body,
                            fontSize: 12,
                            color: t.muted,
                          }}
                        >
                          {list.name}
                        </Text>
                      </View>
                    )}
                  </View>
                )
              ) : (
                <Line style={{ gap: 6, flexWrap: "wrap" }}>
                  <PriorityMark priority={task.priority} />
                  <Text
                    style={{
                      flexShrink: 1,
                      fontFamily: fonts.body,
                      fontSize: 12,
                      color: L.isOverdue(task) ? t.bad : t.muted,
                    }}
                  >
                    {task.dueDate
                      ? L.isOverdue(task)
                        ? `late ${L.diffDays(task.dueDate, dayKey())}d · ${L.fmtDay(task.dueDate)}`
                        : L.fmtDay(task.dueDate)
                      : "No date"}
                    {task.rescheduleCount >= 3
                      ? ` · pushed ${task.rescheduleCount}×`
                      : ""}
                    {task.dueTime ? ` · ${task.dueTime}` : ""}
                    {task.recurrence
                      ? ` · ${L.fmtRepeat(task.recurrence)}`
                      : ""}
                  </Text>
                </Line>
              )}
              <TagChips tags={task.tags} />
            </Pressable>
            {quick ? null : compact && showActions ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Actions for ${task.title}`}
                onPress={() => setOpen(true)}
                style={{
                  width: 36,
                  height: 44,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ellipsis size={16} color={t.muted} />
              </Pressable>
            ) : (
              !compact && (
                <IconButton
                  icon="more"
                  label={`Actions for ${task.title}`}
                  onPress={() => setOpen(true)}
                />
              )
            )}
          </TickRow>
          {quick && (
            <QuickActions
              title={task.title}
              actions={[
                {
                  verb: "Done",
                  icon: Check,
                  color: t.good,
                  onPress: once(finish),
                },
                { verb: "Today", icon: CalendarCheck, onPress: once(toToday) },
                {
                  verb: "Tomorrow",
                  icon: ArrowRight,
                  onPress: once(toTomorrow),
                },
                {
                  verb: "More",
                  label: "More actions",
                  icon: Ellipsis,
                  onPress: () => setOpen(true),
                },
              ]}
            />
          )}
        </SwipeRow>
      </Animated.View>
      <Sheet
        title={moving ? "Move to list" : "Task actions"}
        open={open}
        onClose={close}
        onBack={moving ? () => setMoving(false) : undefined}
      >
        {moving ? (
          <View>
            {[
              null,
              ...allLists
                .filter((l) => !l.archivedAt)
                .sort((a, b) => a.sortOrder - b.sortOrder),
            ].map((l) => {
              const current = (l?.id ?? null) === (task.listId ?? null)
              return (
                <Tap
                  key={l?.id ?? "inbox"}
                  role="radio"
                  selected={current}
                  label={l?.name ?? "Inbox"}
                  onPress={() => move(l?.id ?? null)}
                  style={{ paddingVertical: 10, paddingHorizontal: 4 }}
                >
                  <Line>
                    <ListGlyph list={l ?? "inbox"} small />
                    <Copy weight="medium" style={{ flex: 1 }}>
                      {l?.name ?? "Inbox"}
                    </Copy>
                    {current && <Check size={18} color={t.tsk} />}
                  </Line>
                </Tap>
              )
            })}
            <Tap
              label="New list…"
              onPress={() => {
                close()
                setMaking(true)
              }}
              style={{ paddingVertical: 10, paddingHorizontal: 4 }}
            >
              <Line>
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    backgroundColor: t.soft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Plus size={16} color={t.primary} />
                </View>
                <Copy weight="medium" style={{ flex: 1, color: t.primary }}>
                  New list…
                </Copy>
              </Line>
            </Tap>
          </View>
        ) : (
          <TaskActionGrid
            task={task}
            onDone={() => setOpen(false)}
            onToggle={toggle}
            onToday={toToday}
            onTomorrow={toTomorrow}
            onMove={() => setMoving(true)}
          />
        )}
      </Sheet>
      {making && (
        <NativeListEditor
          onClose={() => setMaking(false)}
          onCreated={(l) => {
            A.updateTask(task.id, { listId: l.id })
          }}
        />
      )}
    </>
  )
}
export function Tasks({
  listId,
  completed = false,
  search = false,
  reminders = false,
}: {
  listId?: string
  completed?: boolean
  search?: boolean
  reminders?: boolean
}) {
  const s = tasksStore.use((s) => s)
  const t = useTheme()
  const [controls, setControls] = useState(search)
  const [query, setQuery] = useState("")
  const params = useLocalSearchParams<{ filter?: string }>()
  const [filter, setFilter] = useState(params.filter ?? "all")
  const [sort, setSort] = useState("due")
  const [editing, setEditing] = useState(false)
  const list = s.lists.find((l) => l.id === listId)
  let tasks = s.tasks.filter(
    (t) =>
      t.status !== "deleted" &&
      !t.clearedAt &&
      (completed
        ? t.status === "done"
        : list?.kind === "shopping" || t.status === "open") &&
      (listId === "inbox"
        ? !t.listId
        : listId === "starred"
          ? t.starred
          : !listId || t.listId === listId) &&
      (!reminders || t.remindAt) &&
      t.title.toLowerCase().includes(query.toLowerCase()),
  )
  if (filter === "today") tasks = tasks.filter((t) => t.dueDate === dayKey())
  if (filter === "overdue") tasks = tasks.filter((t) => L.isOverdue(t))
  if (filter === "starred") tasks = tasks.filter((t) => t.starred)
  if (filter === "inbox") tasks = tasks.filter((t) => !t.listId)
  tasks = tasks.sort(
    sort === "name"
      ? (a, b) => a.title.localeCompare(b.title)
      : sort === "manual"
        ? (a, b) => a.order - b.order
        : sort === "priority"
          ? L.byPriority
          : L.byDue,
  )
  return (
    <ListScreen
      title={
        list?.name ??
        (listId === "inbox"
          ? "Inbox"
          : listId === "starred"
            ? "Starred"
            : completed
              ? "Completed"
              : reminders
                ? "Reminders"
                : search
                  ? "Find tasks"
                  : "Tasks")
      }
      data={tasks}
      actions={
        <View style={{ flexDirection: "row" }}>
          <IconButton
            icon="search"
            label="Search and sort tasks"
            onPress={() => setControls(!controls)}
          />
          <IconButton
            icon="add"
            label="Add task"
            accent="tsk"
            filled
            onPress={() => go(`/tasks/new${list ? `?list=${list.id}` : ""}`)}
          />
        </View>
      }
      header={
        <>
          {!completed && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                marginVertical: 10,
              }}
            >
              <Ring
                value={
                  s.tasks.filter(
                    (t) => t.status === "done" && t.dueDate === dayKey(),
                  ).length /
                  Math.max(
                    1,
                    s.tasks.filter((t) => t.dueDate === dayKey()).length,
                  )
                }
                size={54}
                color={t.tsk}
              >
                <Text
                  style={{
                    fontFamily: fonts.semibold,
                    color: t.text,
                    fontSize: 12,
                  }}
                >
                  {
                    s.tasks.filter(
                      (t) => t.status === "done" && t.dueDate === dayKey(),
                    ).length
                  }
                  /{s.tasks.filter((t) => t.dueDate === dayKey()).length}
                </Text>
              </Ring>
              <View>
                <Title>
                  {tasks.filter((t) => t.dueDate === dayKey()).length} left
                  today
                </Title>
                <Text
                  style={{
                    fontFamily: fonts.medium,
                    color: t.warn,
                    fontSize: 13,
                  }}
                >
                  {tasks.filter((t) => L.isOverdue(t)).length} overdue
                </Text>
              </View>
            </View>
          )}
          <Choices
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "today", label: "Today" },
              { value: "overdue", label: "Overdue" },
              { value: "starred", label: "Starred" },
              { value: "inbox", label: "Inbox" },
            ]}
          />
          {controls && (
            <>
              <Field
                label="Search tasks"
                value={query}
                onChangeText={setQuery}
              />
              <Choices
                label="Sort"
                value={sort}
                onChange={setSort}
                options={["due", "priority", "manual", "name"].map((value) => ({
                  value,
                  label: value,
                }))}
              />
              <Actions>
                <Button tone="quiet" href="/tasks/completed">
                  Completed
                </Button>
                <Button tone="quiet" href="/tasks/settings">
                  Settings
                </Button>
              </Actions>
            </>
          )}
          <Actions>
            <Button tone="quiet" href="/tasks/lists">
              Lists
            </Button>
            <Button tone="quiet" href="/tasks/stats">
              Stats
            </Button>
          </Actions>
          {filter === "overdue" && (
            <Button tone="quiet" onPress={() => A.moveAllOverdueToToday()}>
              Move overdue to today
            </Button>
          )}
          {list && (
            <>
              <Actions>
                <Button tone="quiet" onPress={() => setEditing(true)}>
                  Edit list
                </Button>
                {list.kind === "shopping" && (
                  <Button
                    tone="quiet"
                    onPress={() => {
                      A.clearChecked(list.id)
                    }}
                  >
                    Clear checked
                  </Button>
                )}
                <Button
                  tone="quiet"
                  onPress={() => A.setListArchived(list.id, !list.archivedAt)}
                >
                  {list.archivedAt ? "Restore list" : "Archive list"}
                </Button>
                <Button
                  tone="danger"
                  onPress={() =>
                    confirm(
                      "Delete list?",
                      "Open tasks will move to Inbox.",
                      () => {
                        A.deleteList(list.id, "inbox")
                        back()
                      },
                    )
                  }
                >
                  Delete list
                </Button>
              </Actions>
              <ListEditor
                list={list}
                open={editing}
                onClose={() => setEditing(false)}
              />
            </>
          )}
        </>
      }
      renderItem={(task, index) => (
        <View>
          {!completed &&
            !listId &&
            (index === 0 ||
              L.isOverdue(tasks[index - 1]) !== L.isOverdue(task) ||
              (tasks[index - 1].dueDate === dayKey()) !==
                (task.dueDate === dayKey())) && (
              <Text
                style={{
                  fontFamily: fonts.medium,
                  fontSize: 13,
                  color: L.isOverdue(task) ? t.bad : t.muted,
                  marginTop: 16,
                  marginBottom: 4,
                }}
              >
                {L.isOverdue(task)
                  ? "Overdue"
                  : task.dueDate === dayKey()
                    ? "Due today"
                    : "Upcoming and anytime"}
              </Text>
            )}
          <TaskRow task={task} />
          {sort === "manual" && (
            <Actions>
              <Button
                small
                tone="quiet"
                onPress={() =>
                  A.moveTask(
                    task.id,
                    -1,
                    tasks.map((t) => t.id),
                  )
                }
              >
                Move up
              </Button>
              <Button
                small
                tone="quiet"
                onPress={() =>
                  A.moveTask(
                    task.id,
                    1,
                    tasks.map((t) => t.id),
                  )
                }
              >
                Move down
              </Button>
            </Actions>
          )}
        </View>
      )}
    />
  )
}

function ListEditor({
  list,
  open,
  onClose,
}: {
  list?: TaskList
  open: boolean
  onClose: () => void
}) {
  return open ? <NativeListEditor list={list} onClose={onClose} /> : null
}
