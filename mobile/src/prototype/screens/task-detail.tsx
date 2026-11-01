import { startFocus } from "@domain/focus/actions"
import { fmtHm } from "@domain/focus/logic"
import * as A from "@domain/tasks/actions"
import type { Recurrence, Task } from "@domain/tasks/data"
import * as L from "@domain/tasks/logic"
import { tasksStore } from "@domain/tasks/store"
import {
  AlarmClock,
  CalendarDays,
  Check,
  Copy as CopyIcon,
  Hourglass,
  Inbox,
  Plus,
  Repeat,
  Star,
  Trash2,
  X,
} from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import { ScrollView, TextInput, View } from "react-native"
import { toast } from "sonner-native"
import { FocusTimeCard } from "../focus-kit"
import { AnimatedCheck, TickRow } from "../motion"
import { border, Copy, Frame, IconTap, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import {
  Button,
  Choices,
  DateField,
  Empty,
  Field,
  Screen,
  Sheet,
  Toggle,
  undo,
} from "../ui"
import { isDay } from "../validation"
import { KeepReminding } from "./keep-reminding"

const SOURCE: Record<Task["source"], string> = {
  manual: "Added manually",
  "capture-text": "Captured by chat",
  "capture-photo": "Captured from a photo",
  "capture-voice": "Captured by voice",
}
/** A text field edited as a local draft: typing never waits on the store,
 * so a save echoing back through sync can't put deleted text back. The
 * draft saves after a pause, on leaving the field and on leaving the page;
 * a change from elsewhere shows only while the field isn't being edited. */
function useDraft(value: string, save: (v: string) => void) {
  const [draft, setDraft] = useState(value),
    editing = useRef(false),
    latest = useRef({ draft: value, save, dirty: false }),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  latest.current.save = save
  const flush = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (latest.current.dirty) {
      latest.current.dirty = false
      latest.current.save(latest.current.draft)
    }
  }
  useEffect(() => {
    if (!editing.current && !latest.current.dirty) {
      setDraft(value)
      latest.current.draft = value
    }
  }, [value])
  // biome-ignore lint/correctness/useExhaustiveDependencies: flush on unmount only
  useEffect(() => flush, [])
  return {
    value: draft,
    onChangeText: (v: string) => {
      setDraft(v)
      latest.current = { ...latest.current, draft: v, dirty: true }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, 600)
    },
    onFocus: () => {
      editing.current = true
    },
    onBlur: () => {
      editing.current = false
      flush()
    },
  }
}

/** The task's tags: each removable, and a field to add one (Return adds it;
 * a comma or space-separated list adds several). */
function TagEditor({
  tags,
  onChange,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
}) {
  const t = useTheme()
  const [adding, setAdding] = useState(false),
    [text, setText] = useState("")
  const add = () => {
    const more = text.split(",").map((x) => x.trim())
    if (more.some(Boolean)) onChange([...tags, ...more])
    setText("")
  }
  const pill = {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    backgroundColor: t.soft,
  }
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {tags.map((tag) => (
        <Tap
          key={tag}
          label={`Remove tag ${tag}`}
          onPress={() => onChange(tags.filter((x) => x !== tag))}
          style={pill}
        >
          <Copy size={13} weight="medium" style={{ color: t.text }}>
            #{tag}
          </Copy>
          <X size={14} color={t.muted} />
        </Tap>
      ))}
      {adding ? (
        <TextInput
          accessibilityLabel="New tag"
          autoFocus
          value={text}
          onChangeText={setText}
          onSubmitEditing={add}
          onBlur={() => {
            add()
            setAdding(false)
          }}
          submitBehavior="submit"
          autoCapitalize="none"
          returnKeyType="done"
          placeholder="Tag"
          placeholderTextColor={t.muted}
          style={{
            ...pill,
            minWidth: 96,
            fontFamily: fonts.medium,
            fontSize: 13,
            color: t.text,
          }}
        />
      ) : (
        tags.length < 8 && (
          <Tap label="Add tag" onPress={() => setAdding(true)} style={pill}>
            <Plus size={14} color={t.muted} />
            <Copy size={13} muted>
              {tags.length ? "Tag" : "Add tag"}
            </Copy>
          </Tap>
        )
      )}
    </View>
  )
}

export function TaskDetail({ id }: { id: string }) {
  const s = tasksStore.use((s) => s),
    t = useTheme(),
    task = s.tasks.find((x) => x.id === id),
    [when, setWhen] = useState(false),
    [repeat, setRepeat] = useState(false),
    [confirmDel, setConfirmDel] = useState(false),
    [estimating, setEstimating] = useState(false),
    title = useDraft(task?.title ?? "", (v) => {
      const next = v.replace(/\n/g, " ").trim()
      if (next) A.updateTask(id, { title: next })
    }),
    notes = useDraft(task?.notes ?? "", (v) =>
      A.updateTask(id, { notes: v || null }),
    )
  if (!task)
    return (
      <Screen title="Task">
        <Empty
          title="Task not found"
          detail="It may have been removed on another device."
        />
      </Screen>
    )
  const done = task.status === "done",
    deleted = task.status === "deleted",
    today = L.today(),
    shopping = s.lists.find((l) => l.id === task.listId)?.kind === "shopping"
  const tick = () => {
      A.toggleTask(id)
      undo(done ? "Task reopened" : "Task complete", () =>
        done ? A.completeTask(id) : A.uncompleteTask(id),
      )
    },
    remove = () => {
      A.deleteTask(id)
      undo("Task deleted", () => A.restoreTask(id))
      go("/tasks")
    }
  return (
    <Screen title="Task">
      <TickRow>
        <Line style={{ alignItems: "flex-start", gap: 12 }}>
          <AnimatedCheck
            checked={done}
            onToggle={tick}
            label={done ? "Mark not done" : "Complete"}
            color={t.tsk}
            idle={t.muted}
            size={28}
            square={shopping}
            checkColor={t.bg}
          />
          <TextInput
            accessibilityLabel="Title"
            {...title}
            // Grows with the title instead of scrolling inside one line.
            multiline
            scrollEnabled={false}
            style={{
              flex: 1,
              minWidth: 0,
              paddingVertical: 8,
              paddingHorizontal: 0,
              fontFamily: fonts.semibold,
              fontSize: 20,
              lineHeight: 27.5,
              color: done ? t.muted : t.text,
              textDecorationLine: done ? "line-through" : "none",
            }}
          />
          <Tap
            label={task.starred ? "Unstar" : "Star"}
            onPress={() => A.updateTask(id, { starred: !task.starred })}
            style={{
              width: 40,
              height: 40,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Star
              size={20}
              color={task.starred ? t.warn : t.muted}
              fill={task.starred ? t.warn : "none"}
            />
          </Tap>
        </Line>
      </TickRow>
      {deleted && (
        <Line
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 12,
            backgroundColor: `${t.bad}1a`,
            justifyContent: "space-between",
          }}
        >
          <Copy size={14} style={{ color: t.bad }}>
            Deleted {task.deletedAt ? L.fmtInstant(task.deletedAt) : ""}
          </Copy>
          <Tap onPress={() => A.restoreTask(id)}>
            <Copy size={14} weight="semibold" style={{ color: t.bad }}>
              Restore
            </Copy>
          </Tap>
        </Line>
      )}
      <TagEditor
        tags={task.tags ?? []}
        onChange={(tags) => A.updateTask(id, { tags: A.cleanTags(tags) })}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -16 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 4,
          gap: 8,
        }}
      >
        {[
          { id: null, name: "Inbox", color: "tsk" as const },
          ...s.lists
            .filter((l) => !l.archivedAt)
            .sort((a, b) => a.sortOrder - b.sortOrder),
        ].map((l) => (
          <Tap
            key={l.id ?? "inbox"}
            onPress={() => A.updateTask(id, { listId: l.id })}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderRadius: 99,
              borderWidth: 1,
              borderColor: task.listId === l.id ? t.tsk : t.line,
              backgroundColor: task.listId === l.id ? t.tsk : t.card,
            }}
          >
            <Line style={{ gap: 6 }}>
              {l.id ? (
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: t[l.color],
                  }}
                />
              ) : (
                <Inbox size={14} color={task.listId === l.id ? t.bg : t.text} />
              )}
              <Copy
                size={14}
                weight="medium"
                style={{ color: task.listId === l.id ? t.bg : t.text }}
              >
                {l.name}
              </Copy>
            </Line>
          </Tap>
        ))}
      </ScrollView>
      <Frame style={{ paddingHorizontal: 12, backgroundColor: "transparent" }}>
        {[
          {
            icon: CalendarDays,
            label: "Add date",
            value: task.dueDate
              ? `${L.fmtDayLong(task.dueDate, today)}${task.dueTime ? ` · ${L.fmtTime(task.dueTime)}` : ""}${L.isOverdue(task, today) ? ` · ${L.diffDays(task.dueDate, today)}d late` : ""}`
              : null,
            press: () => setWhen(true),
            clear: () => A.setDue(id, null, null, null),
          },
          {
            icon: AlarmClock,
            label: "Add reminder",
            value: task.remindAt
              ? `Remind ${L.fmtInstant(task.remindAt)}`
              : null,
            press: () => setWhen(true),
            clear: () => A.updateTask(id, { remindAt: null }),
          },
          {
            icon: Repeat,
            label: "Repeat",
            value: L.fmtRepeat(task.recurrence),
            press: () => setRepeat(true),
            clear: () => A.updateTask(id, { recurrence: null }),
          },
          {
            icon: Hourglass,
            label: "Add an estimate",
            value: task.estimateMin
              ? `Estimate ${fmtHm(task.estimateMin * 60)}`
              : null,
            press: () => setEstimating(true),
            clear: () => A.updateTask(id, { estimateMin: undefined }),
          },
        ].map((f, i, all) => (
          <Line
            key={f.label}
            style={{
              minHeight: 48,
              borderBottomWidth: i < all.length - 1 ? 1 : 0,
              borderColor: border(t.line, 0.5),
            }}
          >
            <f.icon size={16} color={t.muted} />
            <Tap onPress={f.press} style={{ flex: 1, paddingVertical: 12 }}>
              <Copy size={14} muted={!f.value} lines={1}>
                {f.value ?? f.label}
              </Copy>
            </Tap>
            {f.value && (
              <IconTap
                size={32}
                icon={X}
                label={`Clear ${f.label}`}
                onPress={f.clear}
              />
            )}
          </Line>
        ))}
      </Frame>
      <Frame style={{ padding: 12, backgroundColor: "transparent" }}>
        <KeepReminding
          accent="tsk"
          value={task.nagEveryMin}
          unavailable={
            task.dueDate || task.remindAt
              ? undefined
              : "Add a date first: repeats start once the task is overdue."
          }
          // The switch and its line say what changed: no toast (only
          // toasts that carry Undo are shown).
          onChange={(min) => A.updateTask(id, { nagEveryMin: min })}
        />
      </Frame>
      {task.remindAt && task.status === "open" && (
        <Line style={{ gap: 8 }}>
          <Copy size={12} muted>
            Snooze reminder
          </Copy>
          {[
            { m: 60, label: "1 hr" },
            { m: 180, label: "3 hr" },
          ].map((x) => (
            <Button
              key={x.m}
              small
              tone="quiet"
              icon={AlarmClock}
              onPress={() => {
                A.snoozeTask(id, x.m)
                toast.success(`Snoozed ${x.label}`)
              }}
            >
              {x.label}
            </Button>
          ))}
        </Line>
      )}
      <TextInput
        accessibilityLabel="Notes"
        {...notes}
        placeholder="Notes"
        placeholderTextColor={t.muted}
        multiline
        style={{
          minHeight: 80,
          padding: 12,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: border(t.line, 0.6),
          fontFamily: fonts.body,
          fontSize: 14,
          color: t.text,
          textAlignVertical: "top",
        }}
      />
      {!deleted && (
        <FocusTimeCard
          item={{ kind: "task", id: task.id, title: task.title }}
          estimateMin={task.estimateMin}
          onStart={() => {
            startFocus({
              item: { kind: "task", id: task.id, title: task.title },
            })
            go("/focus")
          }}
        />
      )}
      <Sheet
        title="How long should it take?"
        open={estimating}
        onClose={() => setEstimating(false)}
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {[15, 30, 45, 60, 90, 120, 180, 240, 480].map((m) => (
            <Tap
              key={m}
              label={`Estimate ${fmtHm(m * 60)}`}
              onPress={() => {
                A.updateTask(id, { estimateMin: m })
                setEstimating(false)
                toast(`Estimate set to ${fmtHm(m * 60)}`)
              }}
              style={{
                paddingHorizontal: 16,
                height: 40,
                borderRadius: 20,
                justifyContent: "center",
                borderWidth: 1,
                borderColor: task.estimateMin === m ? t.foc : t.line,
                backgroundColor: task.estimateMin === m ? `${t.foc}1f` : t.card,
              }}
            >
              <Copy size={14} style={{ fontFamily: fonts.mono }}>
                {fmtHm(m * 60)}
              </Copy>
            </Tap>
          ))}
        </View>
      </Sheet>
      <View style={{ paddingHorizontal: 4, gap: 4 }}>
        <Copy size={12} muted>
          {SOURCE[task.source]} · {L.fmtInstant(task.createdAt)}
        </Copy>
        {task.rescheduleCount > 0 && (
          <Copy size={12} style={{ color: t.warn }}>
            Rescheduled {task.rescheduleCount}×
            {task.originalDue
              ? ` · originally due ${L.fmtDate(task.originalDue)}`
              : ""}
          </Copy>
        )}
        {task.completedAt && (
          <Copy size={12} style={{ color: t.good }}>
            Completed {L.fmtInstant(task.completedAt)}
          </Copy>
        )}
      </View>
      {confirmDel ? (
        <View
          style={{
            marginTop: 4,
            padding: 12,
            borderRadius: 16,
            backgroundColor: border(t.soft, 0.5),
            gap: 8,
          }}
        >
          <Copy size={14} weight="medium">
            Delete a repeating task
          </Copy>
          <Line style={{ gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button
                tone="quiet"
                onPress={() => {
                  if (task.recurrence && task.dueDate)
                    A.createTask({
                      title: task.title,
                      listId: task.listId,
                      dueDate: L.addDays(
                        task.dueDate < today ? today : task.dueDate,
                        1,
                      ),
                      dueTime: task.dueTime,
                      recurrence: task.recurrence,
                      notes: task.notes,
                      starred: task.starred,
                      remind: !!task.remindAt,
                    })
                  remove()
                }}
              >
                This one
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button tone="danger" onPress={remove}>
                All future
              </Button>
            </View>
          </Line>
        </View>
      ) : (
        <Line style={{ marginTop: 4, gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button icon={Check} tone="quiet" onPress={tick}>
              {done ? "Reopen" : "Done"}
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button
              icon={CopyIcon}
              tone="quiet"
              onPress={() => {
                const copy = A.duplicateTask(id)
                if (copy) undo("Duplicated", () => A.removeTasks([copy.id]))
              }}
            >
              Copy
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button
              icon={deleted ? undefined : Trash2}
              tone={deleted ? "quiet" : "danger"}
              onPress={() =>
                deleted
                  ? A.restoreTask(id)
                  : task.recurrence
                    ? setConfirmDel(true)
                    : remove()
              }
            >
              {deleted ? "Restore" : "Delete"}
            </Button>
          </View>
        </Line>
      )}
      {when && <TaskWhen task={task} onClose={() => setWhen(false)} />}
      {repeat && <TaskRepeat task={task} onClose={() => setRepeat(false)} />}
    </Screen>
  )
}
export function TaskWhen({
  task,
  onClose,
}: {
  task: Task
  onClose: () => void
}) {
  const defaultTime = tasksStore.use((s) => s.settings.defaultRemindTime),
    [date, setDate] = useState(task.dueDate ?? ""),
    [time, setTime] = useState(task.dueTime ?? ""),
    [remind, setRemind] = useState(
      task.remindAt && task.dueDate
        ? String(
            Math.max(
              0,
              Math.round(
                (new Date(
                  L.isoAt(task.dueDate, task.dueTime ?? defaultTime),
                ).getTime() -
                  new Date(task.remindAt).getTime()) /
                  60000,
              ),
            ),
          )
        : "off",
    )
  return (
    <Sheet title="Date & reminder" open onClose={onClose}>
      <Line style={{ gap: 8, flexWrap: "wrap" }}>
        {[
          { label: "Today", day: L.today() },
          { label: "Tomorrow", day: L.addDays(L.today(), 1) },
          { label: "Next week", day: L.addDays(L.today(), 7) },
        ].map((p) => (
          <Button
            key={p.label}
            small
            tone="quiet"
            onPress={() => setDate(p.day)}
          >
            {p.label}
          </Button>
        ))}
      </Line>
      <DateField label="Date" value={date} onChangeText={setDate} />
      <DateField
        label="Time (optional)"
        value={time}
        onChangeText={setTime}
        mode="time"
      />
      <Choices
        label="Remind me"
        value={remind}
        onChange={setRemind}
        options={[
          { value: "off", label: "Off" },
          { value: "0", label: "At time" },
          { value: "15", label: "15 min before" },
          { value: "60", label: "1 hour before" },
          { value: "1440", label: "1 day before" },
        ]}
      />
      <Button
        onPress={() => {
          if (
            (date && !isDay(date)) ||
            (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
          ) {
            toast.error("Enter a valid date and time")
            return
          }
          const remindAt =
            date && remind !== "off"
              ? new Date(
                  new Date(L.isoAt(date, time || defaultTime)).getTime() -
                    Number(remind) * 60000,
                ).toISOString()
              : null
          A.setDue(task.id, date || null, time || null, remindAt)
          onClose()
        }}
      >
        Save
      </Button>
      <Button
        tone="quiet"
        onPress={() => {
          A.setDue(task.id, null, null, null)
          onClose()
        }}
      >
        No date
      </Button>
    </Sheet>
  )
}
export function TaskRepeat({
  task,
  onClose,
}: {
  task: Task
  onClose: () => void
}) {
  const [kind, setKind] = useState<Recurrence["rule"]["kind"]>(
      task.recurrence?.rule.kind ?? "weekly",
    ),
    [days, setDays] = useState(
      task.recurrence?.rule.kind === "weekly"
        ? task.recurrence.rule.days
        : [new Date(`${task.dueDate ?? L.today()}T12:00:00`).getDay()],
    ),
    [number, setNumber] = useState(
      task.recurrence?.rule.kind === "everyN"
        ? String(task.recurrence.rule.n)
        : "3",
    ),
    [dom, setDom] = useState(
      task.recurrence?.rule.kind === "monthly"
        ? String(task.recurrence.rule.day)
        : String(Number((task.dueDate ?? L.today()).slice(-2))),
    ),
    [after, setAfter] = useState(task.recurrence?.mode === "after")
  return (
    <Sheet title="Repeat" open onClose={onClose}>
      <Choices
        value={kind}
        onChange={setKind}
        options={[
          { value: "daily", label: "Daily" },
          { value: "weekdays", label: "Weekdays" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
          { value: "everyN", label: "Every N days" },
        ]}
      />
      {kind === "weekly" && (
        <Line style={{ gap: 4 }}>
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d, i) => (
            <View key={d} style={{ flex: 1 }}>
              <Button
                small
                tone={days.includes(i) ? "primary" : "quiet"}
                onPress={() =>
                  setDays(
                    days.includes(i)
                      ? days.filter((x) => x !== i)
                      : [...days, i],
                  )
                }
              >
                {d}
              </Button>
            </View>
          ))}
        </Line>
      )}
      {kind === "everyN" && (
        <Field
          label="Every N days"
          value={number}
          onChangeText={setNumber}
          keyboardType="number-pad"
        />
      )}
      {kind === "monthly" && (
        <Field
          label="Day of month"
          value={dom}
          onChangeText={setDom}
          keyboardType="number-pad"
        />
      )}
      <Toggle
        label="Repeat after completion"
        value={after}
        onChange={setAfter}
      />
      <Copy size={12} muted>
        Next one counts from the day you finish, not the schedule.
      </Copy>
      <Button
        disabled={kind === "weekly" && !days.length}
        onPress={() => {
          if (
            (kind === "everyN" &&
              (!Number.isInteger(Number(number)) ||
                Number(number) < 2 ||
                Number(number) > 60)) ||
            (kind === "monthly" &&
              (!Number.isInteger(Number(dom)) ||
                Number(dom) < 1 ||
                Number(dom) > 31))
          ) {
            toast.error("Enter a valid repeat interval")
            return
          }
          const recurrence: Recurrence = {
            mode: after ? "after" : "fixed",
            rule:
              kind === "weekly"
                ? { kind, days }
                : kind === "monthly"
                  ? { kind, day: Number(dom) }
                  : kind === "everyN"
                    ? { kind, n: Number(number) }
                    : { kind },
          }
          A.updateTask(task.id, { recurrence })
          if (!task.dueDate) A.setDue(task.id, L.today())
          onClose()
        }}
      >
        Set repeat
      </Button>
      {task.recurrence && (
        <Button
          tone="quiet"
          onPress={() => {
            A.updateTask(task.id, { recurrence: null })
            onClose()
          }}
        >
          Don't repeat
        </Button>
      )}
    </Sheet>
  )
}
