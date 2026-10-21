import * as A from "@domain/tasks/actions"
import type { Task } from "@domain/tasks/data"
import * as L from "@domain/tasks/logic"
import { tasksStore } from "@domain/tasks/store"
import { RotateCcw, Search, X } from "lucide-react-native"
import { useState } from "react"
import { ScrollView, TextInput, View } from "react-native"
import { toast } from "sonner-native"
import {
  border,
  Copy,
  IconTap,
  Line,
  SectionHeading,
  Segmented,
  SmallButton,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Button, Empty, Screen } from "../ui"
import { ListGlyph } from "./task-lists"
import { TaskRow } from "./tasks"

export function TaskChip({
  label,
  active,
  onPress,
  color,
}: {
  label: string
  active: boolean
  onPress: () => void
  color?: string
}) {
  const t = useTheme()
  return (
    <Tap
      onPress={onPress}
      style={{
        backgroundColor: active ? t.tsk : t.card,
        borderRadius: 20,
        paddingHorizontal: 14,
        height: 36,
        justifyContent: "center",
        borderWidth: 1,
        borderColor: active ? "transparent" : t.line,
      }}
    >
      <Line style={{ gap: 6 }}>
        {color && (
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: color,
            }}
          />
        )}
        <Copy
          size={14}
          weight="medium"
          style={{ color: active ? t.bg : t.text }}
        >
          {label}
        </Copy>
      </Line>
    </Tap>
  )
}
export function TaskSearch() {
  const s = tasksStore.use((s) => s),
    t = useTheme(),
    [q, setQ] = useState(""),
    [listId, setList] = useState("any"),
    [status, setStatus] = useState("open"),
    [starred, setStarred] = useState(false),
    [overdue, setOverdue] = useState(false),
    [hasDate, setHasDate] = useState(false),
    [sort, setSort] = useState("due")
  const lists = s.lists.filter((l) => !l.archivedAt),
    results = s.tasks
      .filter(
        (task) =>
          task.status !== "deleted" &&
          (status === "all" || task.status === status) &&
          (listId === "any" ||
            (listId === "inbox"
              ? task.listId === null
              : task.listId === listId)) &&
          (!starred || task.starred) &&
          (!overdue || L.isOverdue(task)) &&
          (!hasDate || !!task.dueDate) &&
          (!q.trim() ||
            `${task.title} ${task.notes ?? ""}`
              .toLowerCase()
              .includes(q.trim().toLowerCase())),
      )
      .sort(
        sort === "created"
          ? (a, b) => b.createdAt.localeCompare(a.createdAt)
          : sort === "manual"
            ? (a, b) => a.order - b.order
            : L.byDue,
      )
  return (
    <Screen title="Search">
      <Line
        style={{
          borderWidth: 1,
          borderColor: border(t.line, 0.6),
          borderRadius: 16,
          backgroundColor: t.card,
          paddingHorizontal: 12,
          gap: 8,
        }}
      >
        <Search size={16} color={t.muted} />
        <TextInput
          accessibilityLabel="Search tasks"
          placeholder="Search titles and notes"
          placeholderTextColor={t.muted}
          value={q}
          onChangeText={setQ}
          style={{
            height: 48,
            flex: 1,
            fontFamily: fonts.body,
            fontSize: 16,
            color: t.text,
          }}
        />
        {!!q && (
          <IconTap icon={X} label="Clear search" onPress={() => setQ("")} />
        )}
      </Line>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Line style={{ gap: 8 }}>
          {["open", "done", "all"].map((v) => (
            <TaskChip
              key={v}
              label={v[0].toUpperCase() + v.slice(1)}
              active={status === v}
              onPress={() => setStatus(v)}
            />
          ))}
          <TaskChip
            label="Starred"
            active={starred}
            onPress={() => setStarred(!starred)}
          />
          <TaskChip
            label="Overdue"
            active={overdue}
            onPress={() => setOverdue(!overdue)}
          />
          <TaskChip
            label="Has date"
            active={hasDate}
            onPress={() => setHasDate(!hasDate)}
          />
        </Line>
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Line style={{ gap: 8 }}>
          <TaskChip
            label="Any list"
            active={listId === "any"}
            onPress={() => setList("any")}
          />
          <TaskChip
            label="Inbox"
            active={listId === "inbox"}
            onPress={() => setList("inbox")}
          />
          {lists.map((l) => (
            <TaskChip
              key={l.id}
              label={l.name}
              color={t[l.color]}
              active={listId === l.id}
              onPress={() => setList(l.id)}
            />
          ))}
        </Line>
      </ScrollView>
      <Segmented
        value={sort}
        onChange={setSort}
        options={[
          { value: "due", label: "Due" },
          { value: "created", label: "Created" },
          { value: "manual", label: "Manual" },
        ]}
      />
      {!results.length ? (
        <Empty
          title="No matches"
          detail={
            q
              ? `Nothing for “${q}”${status === "open" ? " in open tasks" : ""}.`
              : "Try fewer filters."
          }
          action={
            <Button
              tone="quiet"
              onPress={() => {
                if (status === "open") setStatus("all")
                else {
                  setList("any")
                  setStarred(false)
                  setOverdue(false)
                  setHasDate(false)
                }
              }}
            >
              {status === "open" ? "Include completed?" : "Clear filters"}
            </Button>
          }
        />
      ) : (
        <View>
          <SectionHeading>
            {results.length} result{results.length === 1 ? "" : "s"}
          </SectionHeading>
          {results.slice(0, 60).map((task) => (
            <TaskRow key={task.id} task={task} compact showActions showDay />
          ))}
          {results.length > 60 && (
            <Copy
              size={12}
              muted
              style={{ textAlign: "center", paddingVertical: 12 }}
            >
              Showing 60 — narrow the search to see more.
            </Copy>
          )}
        </View>
      )}
    </Screen>
  )
}
export function TaskCompleted() {
  const s = tasksStore.use((s) => s),
    _t = useTheme(),
    [tab, setTab] = useState("done"),
    [days, setDays] = useState(14),
    from = L.addDays(L.today(), -(days - 1)),
    groups = new Map<string, Task[]>()
  for (const task of s.tasks.filter(
    (task) => task.status === "done" && (L.doneDay(task) ?? "") >= from,
  )) {
    const key = L.doneDay(task) ?? ""
    groups.set(key, [...(groups.get(key) ?? []), task])
  }
  const deleted = s.tasks
    .filter(
      (task) =>
        task.status === "deleted" &&
        (task.deletedAt ?? "") >=
          new Date(Date.now() - 30 * 86400000).toISOString(),
    )
    .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""))
  const row = (task: Task, isDeleted = false) => (
    <Line
      key={task.id}
      style={{ gap: 8, paddingVertical: 12, paddingHorizontal: 4 }}
    >
      <Tap onPress={() => go(`/tasks/task/${task.id}`)} style={{ flex: 1 }}>
        <Line>
          <ListGlyph
            list={s.lists.find((l) => l.id === task.listId) ?? null}
            small
          />
          <View style={{ flex: 1 }}>
            <Copy
              size={16}
              weight="medium"
              muted={!isDeleted}
              style={{
                textDecorationLine: isDeleted ? "none" : "line-through",
              }}
            >
              {task.title}
            </Copy>
            <Copy size={12} muted>
              {isDeleted
                ? `Deleted ${task.deletedAt ? L.fmtDayLong(task.deletedAt.slice(0, 10)) : ""}`
                : task.completedAt
                  ? L.fmtTime(
                      new Date(task.completedAt).toTimeString().slice(0, 5),
                    )
                  : ""}
            </Copy>
          </View>
        </Line>
      </Tap>
      <SmallButton
        accent="tsk"
        quiet
        small
        icon={isDeleted ? RotateCcw : undefined}
        onPress={() => {
          isDeleted ? A.restoreTask(task.id) : A.uncompleteTask(task.id)
          toast(isDeleted ? "Restored" : "Reopened")
        }}
      >
        {isDeleted ? "Restore" : "Reopen"}
      </SmallButton>
    </Line>
  )
  return (
    <Screen title="Completed">
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "done", label: "Completed" },
          {
            value: "deleted",
            label: `Recently deleted${deleted.length ? ` · ${deleted.length}` : ""}`,
          },
        ]}
      />
      {tab === "done" ? (
        groups.size ? (
          <View>
            {[...groups.entries()]
              .sort((a, b) => b[0].localeCompare(a[0]))
              .map(([day, tasks]) => (
                <View key={day}>
                  <SectionHeading>
                    {L.fmtDayLong(day)} · {tasks.length}
                  </SectionHeading>
                  {tasks.map((task) => row(task))}
                </View>
              ))}
            {days < 90 && (
              <Button
                tone="quiet"
                onPress={() => setDays(Math.min(90, days + 30))}
              >
                Show older
              </Button>
            )}
          </View>
        ) : (
          <Empty
            title="Nothing completed yet"
            detail="Ticked tasks land here, grouped by day."
          />
        )
      ) : deleted.length ? (
        <View>
          <Copy
            size={12}
            muted
            style={{ paddingHorizontal: 4, paddingVertical: 12 }}
          >
            Kept for 30 days, then gone for good.
          </Copy>
          {deleted.map((task) => row(task, true))}
        </View>
      ) : (
        <Empty
          title="Nothing deleted"
          detail="Deleted tasks stay here for 30 days."
        />
      )}
    </Screen>
  )
}
