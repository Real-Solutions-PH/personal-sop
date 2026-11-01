import { dayKey } from "@domain/lib/day"
import * as A from "@domain/tasks/actions"
import type { Task, TaskList } from "@domain/tasks/data"
import * as L from "@domain/tasks/logic"
import { tasksStore } from "@domain/tasks/store"
import { useLocalSearchParams } from "expo-router"
import {
  AlarmClock,
  CalendarClock,
  Check,
  Ellipsis,
  Plus,
  Repeat,
} from "lucide-react-native"
import { useState } from "react"
import { Pressable, Text, View } from "react-native"
import Animated from "react-native-reanimated"
import { toast } from "sonner-native"
import {
  AnimatedCheck,
  feel,
  rowEnter,
  rowExit,
  TickRow,
  useSwipeComplete,
} from "../motion"
import { Copy, Line, Tap } from "../native-kit"
import { back, go } from "../navigation"
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
            style={{ fontFamily: fonts.medium, fontSize: 11, color: t.muted }}
          >
            #{tag}
          </Text>
        </View>
      ))}
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
}: {
  task: Task
  compact?: boolean
  showActions?: boolean
  showDay?: boolean
  showList?: boolean
  /** Background of the surface the row sits on (e.g. a card). */
  surface?: string
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
    undo(`Moved to ${target?.name ?? "Inbox"}`, () =>
      A.updateTask(task.id, { listId: prev }),
    )
  }
  // An empty meta line would sit under the title and pull it above the
  // checkbox's centre, so it only renders when it has something to say.
  const doneAt =
    task.status === "done" && task.completedAt
      ? new Date(task.completedAt)
      : null
  const hasMeta =
    !!doneAt ||
    (showDay && !!task.dueDate) ||
    !!task.dueTime ||
    !!task.recurrence ||
    (!!task.remindAt && task.status === "open") ||
    task.rescheduleCount > 1 ||
    (!!list && showList)
  const toggle = () => {
    const done = task.status === "done"
    if (done) A.uncompleteTask(task.id)
    else A.completeTask(task.id)
    undo(done ? "Task reopened" : "Task complete", () =>
      done ? A.completeTask(task.id) : A.uncompleteTask(task.id),
    )
  }
  const swipe = useSwipeComplete(task.status === "done", toggle)
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
                        <Check size={12} color={t.tsk} />
                        <Text
                          style={{
                            fontFamily: fonts.medium,
                            fontSize: 12,
                            color: t.tsk,
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
                          color: L.isOverdue(task) ? t.warn : t.muted,
                        }}
                      >
                        {L.isOverdue(task)
                          ? `${L.diffDays(task.dueDate, dayKey())}d late`
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
                          color: L.isDueNow(task) ? t.tsk : t.muted,
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
                        <CalendarClock size={12} color={t.warn} />
                        <Text
                          style={{
                            fontFamily: fonts.body,
                            fontSize: 12,
                            color: t.warn,
                          }}
                        >
                          {task.rescheduleCount}×
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
                <Text
                  style={{
                    fontFamily: fonts.body,
                    fontSize: 12,
                    color: L.isOverdue(task) ? t.warn : t.muted,
                  }}
                >
                  {task.dueDate ? L.fmtDay(task.dueDate) : "No date"}
                  {task.dueTime ? ` · ${task.dueTime}` : ""}
                  {task.recurrence ? ` · ${L.fmtRepeat(task.recurrence)}` : ""}
                </Text>
              )}
              <TagChips tags={task.tags} />
            </Pressable>
            {compact && showActions ? (
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
                  <Plus size={16} color={t.tsk} />
                </View>
                <Copy weight="medium" style={{ flex: 1, color: t.tsk }}>
                  New list…
                </Copy>
              </Line>
            </Tap>
          </View>
        ) : (
          <Actions>
            <Button
              onPress={() => {
                toggle()
                setOpen(false)
              }}
            >
              {task.status === "done" ? "Reopen" : "Complete"}
            </Button>
            <Button
              tone="quiet"
              onPress={() => {
                A.snoozeTask(task.id)
                setOpen(false)
              }}
            >
              Snooze 1 hour
            </Button>
            <Button
              tone="quiet"
              onPress={() => {
                A.rescheduleBy(task.id, 1)
                setOpen(false)
              }}
            >
              Tomorrow
            </Button>
            <Button tone="quiet" onPress={() => setMoving(true)}>
              Move to list…
            </Button>
            <Button
              tone="quiet"
              onPress={() => {
                A.updateTask(task.id, { starred: !task.starred })
                setOpen(false)
              }}
            >
              {task.starred ? "Unstar" : "Star"}
            </Button>
            <Button
              tone="quiet"
              onPress={() => {
                A.duplicateTask(task.id)
                setOpen(false)
              }}
            >
              Duplicate
            </Button>
            <Button
              tone="danger"
              onPress={() => {
                A.deleteTask(task.id)
                undo("Task deleted", () => A.restoreTask(task.id))
                setOpen(false)
              }}
            >
              Delete
            </Button>
          </Actions>
        )}
      </Sheet>
      {making && (
        <NativeListEditor
          onClose={() => setMaking(false)}
          onCreated={(l) => {
            const prev = task.listId
            A.updateTask(task.id, { listId: l.id })
            undo(`Moved to ${l.name}`, () =>
              A.updateTask(task.id, { listId: prev }),
            )
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
                options={["due", "manual", "name"].map((value) => ({
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
                      const ids = A.clearChecked(list.id)
                      undo("Checked items cleared", () => A.unclear(ids))
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
                  fontSize: 12,
                  letterSpacing: 0.8,
                  color: L.isOverdue(task) ? t.warn : t.muted,
                  marginTop: 16,
                  marginBottom: 4,
                }}
              >
                {L.isOverdue(task)
                  ? "OVERDUE"
                  : task.dueDate === dayKey()
                    ? "DUE TODAY"
                    : "UPCOMING & ANYTIME"}
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
