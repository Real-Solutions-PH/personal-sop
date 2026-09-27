"use client"

import {
  AlarmClock,
  ArrowUp,
  BellRing,
  CalendarDays,
  Check,
  Copy,
  Inbox,
  Repeat,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react"
import Link from "next/link"
import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { Btn, Chip, Empty } from "../ui/kit"
import {
  createList,
  createTask,
  deleteList,
  duplicateTask,
  getTask,
  type ListInput,
  moveAllOverdueToToday,
  removeTasks,
  restoreTask,
  setDue,
  setListArchived,
  snoozeTask,
  updateList,
  updateTask,
} from "./actions"
import type { ListColor, ListIcon, Task, TaskList } from "./data"
import {
  addDays,
  diffDays,
  fmtDate,
  fmtDayLong,
  fmtInstant,
  fmtRepeat,
  fmtTime,
  isOverdue,
  today,
} from "./logic"
import { parseTask } from "./parse"
import { RepeatSheet, type When, WhenSheet } from "./pickers"
import { tasksStore } from "./store"
import {
  BottomSheet,
  Circle,
  closePick,
  closeQuickAdd,
  closeTask,
  closeTriage,
  LIST_COLORS,
  LIST_DOT,
  LIST_ICONS,
  ListGlyph,
  softDelete,
  tick,
  useIsPrimaryHost,
  useUi,
} from "./ui"

const SOURCE: Record<Task["source"], string> = {
  manual: "Added manually",
  "capture-text": "Captured by chat",
  "capture-voice": "Captured by voice",
  "capture-photo": "Captured from a photo",
}

// ---------------------------------------------------------------- TSK-04 quick add

function whenLabel(date: string | null, time: string | null) {
  if (!date) return "Date"
  const d = fmtDayLong(date).split(" · ")[0]
  return time ? `${d} ${fmtTime(time)}` : d
}

export function QuickAddSheet() {
  const u = useUi()
  const lists = tasksStore.use((s) => s.lists)
  const notif = tasksStore.use((s) => s.notif)
  const defaultTime = tasksStore.use((s) => s.settings.defaultRemindTime)
  const open = !!u.quickAdd
  const [text, setText] = useState("")
  const [listId, setListId] = useState<string | null>(null)
  const [manual, setManual] = useState<When | null>(null)
  const [remind, setRemind] = useState(false)
  const [starred, setStarred] = useState(false)
  const [picker, setPicker] = useState(false)
  const [added, setAdded] = useState<Task[]>([])
  const [ask, setAsk] = useState<Task | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [openedFor, setOpenedFor] = useState<typeof u.quickAdd>(null)

  // reset on each open (render-time sync, no effect)
  if (u.quickAdd !== openedFor) {
    setOpenedFor(u.quickAdd)
    if (u.quickAdd) {
      setListId(u.quickAdd.listId)
      setManual(null)
      setText("")
      setRemind(false)
      setStarred(false)
      setAdded([])
      setAsk(null)
    }
  }

  const parsed = useMemo(() => parseTask(text), [text])
  const shopping = lists.find((l) => l.id === listId)?.kind === "shopping"
  const preset = u.quickAdd?.dueDate ?? null
  const date = manual
    ? manual.dueDate
    : (parsed.dueDate ?? (shopping ? null : preset))
  const time = manual ? manual.dueTime : parsed.dueTime
  const active = lists
    .filter((l) => !l.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const pickerValue = useMemo<When>(
    () => manual ?? { dueDate: date, dueTime: time, remindAt: null },
    [manual, date, time],
  )

  const add = () => {
    if (!text.trim()) return
    const t = createTask({
      title: shopping ? text.trim() : parsed.title,
      listId,
      dueDate: date,
      dueTime: time,
      remind: remind || (!!time && !manual),
      remindAt: manual?.remindAt ?? undefined,
      recurrence: shopping ? null : parsed.recurrence,
      starred,
    })
    setAdded((a) => [t, ...a].slice(0, 3))
    setText("")
    setManual(null)
    setStarred(false)
    setRemind(false)
    if (t.remindAt && notif.permission !== "granted" && !notif.remindLaterAt)
      setAsk(t)
    inputRef.current?.focus()
  }

  return (
    <BottomSheet open={open} onClose={closeQuickAdd} title="Add task">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              shopping ? "Add item — e.g. eggs" : "e.g. dentist fri 10am"
            }
            enterKeyHint="done"
            className="h-12 rounded-xl text-base"
            aria-label="Task title"
          />
          <button
            type="submit"
            aria-label="Add"
            disabled={!text.trim()}
            className="grid size-12 shrink-0 place-items-center rounded-xl bg-tsk text-background disabled:opacity-40"
          >
            <ArrowUp className="size-5" />
          </button>
        </div>
      </form>

      {/* inline NL highlight */}
      {!shopping && parsed.matched.length > 0 && !manual && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <Sparkles className="size-3.5 text-tsk" />
          {parsed.matched.map((m) => (
            <mark
              key={m}
              className="rounded-md bg-tsk/15 px-1.5 py-0.5 font-medium text-tsk"
            >
              {m}
            </mark>
          ))}
          <span className="text-muted-foreground">
            → {whenLabel(parsed.dueDate, parsed.dueTime)}
            {parsed.recurrence ? ` · ${fmtRepeat(parsed.recurrence)}` : ""}
          </span>
        </div>
      )}

      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip
          onClick={() => setListId(null)}
          active={listId === null}
          accent="tsk"
        >
          <Inbox className="size-3.5" /> Inbox
        </Chip>
        {active.map((l) => (
          <Chip
            key={l.id}
            accent="tsk"
            active={listId === l.id}
            onClick={() => setListId(l.id)}
          >
            <span className={cn("size-2 rounded-full", LIST_DOT[l.color])} />
            {l.name}
          </Chip>
        ))}
      </div>
      {!shopping && (
        <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
          <Chip active={!!date} accent="tsk" onClick={() => setPicker(true)}>
            <CalendarDays className="size-3.5" />
            {whenLabel(date, time)}
          </Chip>
          <Chip
            active={remind || !!manual?.remindAt}
            accent="tsk"
            onClick={() => setRemind((r) => !r)}
          >
            <AlarmClock className="size-3.5" />
            {remind
              ? `Remind ${time ? fmtTime(time) : fmtTime(defaultTime)}`
              : "Remind"}
          </Chip>
          <Chip
            active={starred}
            accent="tsk"
            onClick={() => setStarred((s) => !s)}
          >
            <Star className={cn("size-3.5", starred && "fill-white")} /> Star
          </Chip>
        </div>
      )}

      {ask && (
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-tsk/10 p-3">
          <BellRing className="size-5 shrink-0 text-tsk" />
          <div className="min-w-0 flex-1 text-sm">
            Want a ping at{" "}
            {ask.remindAt ? fmtInstant(ask.remindAt) : "that time"}?
          </div>
          <Link
            href="/tasks/reminders"
            onClick={closeQuickAdd}
            className="font-semibold text-sm text-tsk"
          >
            Turn on
          </Link>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setAsk(null)}
          >
            <X className="size-4 text-muted-foreground" />
          </button>
        </div>
      )}

      <div className="mt-3 mb-3 min-h-16 space-y-1">
        {added.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Return adds and keeps the sheet open for the next one. Swipe down to
            close.
          </p>
        ) : (
          added.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-sm">
              <Check className="size-4 text-good" />
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <span className="text-muted-foreground text-xs">
                {t.dueDate ? whenLabel(t.dueDate, t.dueTime) : ""}
              </span>
              <button
                type="button"
                className="font-medium text-tsk text-xs"
                onClick={() => {
                  removeTasks([t.id])
                  setAdded((a) => a.filter((x) => x.id !== t.id))
                }}
              >
                Undo
              </button>
            </div>
          ))
        )}
      </div>

      <WhenSheet
        open={picker}
        onClose={() => setPicker(false)}
        value={pickerValue}
        defaultTime={defaultTime}
        onSave={(w) => setManual(w)}
      />
    </BottomSheet>
  )
}

// ---------------------------------------------------------------- TSK-03 task detail

function Field({
  icon,
  label,
  value,
  onClick,
  onClear,
}: {
  icon: React.ReactNode
  label: string
  value?: string | null
  onClick: () => void
  onClear?: () => void
}) {
  return (
    <div className="flex min-h-12 items-center gap-3 border-border/50 border-b last:border-b-0">
      <span className="text-muted-foreground">{icon}</span>
      <button
        type="button"
        onClick={onClick}
        className="min-w-0 flex-1 py-3 text-left"
      >
        <span
          className={cn(
            "block truncate text-sm",
            !value && "text-muted-foreground",
          )}
        >
          {value || label}
        </span>
      </button>
      {value && onClear && (
        <button
          type="button"
          aria-label={`Clear ${label}`}
          onClick={onClear}
          className="grid size-8 place-items-center"
        >
          <X className="size-4 text-muted-foreground" />
        </button>
      )}
    </div>
  )
}

/** All fields of one task, autosaving. Used by the sheet and /tasks/task/[id]. */
export function TaskDetailBody({
  task,
  onDone,
}: {
  task: Task
  onDone?: () => void
}) {
  const lists = tasksStore.use((s) => s.lists)
  const defaultTime = tasksStore.use((s) => s.settings.defaultRemindTime)
  const [picker, setPicker] = useState(false)
  const [repeat, setRepeat] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const when = useMemo<When>(
    () => ({
      dueDate: task.dueDate,
      dueTime: task.dueTime,
      remindAt: task.remindAt,
    }),
    [task.dueDate, task.dueTime, task.remindAt],
  )
  const done = task.status === "done"
  const deleted = task.status === "deleted"
  const tk = today()
  const active = lists
    .filter((l) => !l.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const shopping = lists.find((l) => l.id === task.listId)?.kind === "shopping"

  const del = () => {
    if (task.recurrence && !confirmDel) return setConfirmDel(true)
    softDelete(task)
    onDone?.()
  }

  return (
    <div className="pb-3">
      <div className="flex items-start gap-3">
        <div className="pt-2.5">
          <Circle
            done={done}
            shopping={shopping}
            label={done ? "Mark not done" : "Complete"}
            onClick={() => tick(task)}
          />
        </div>
        <textarea
          value={task.title}
          onChange={(e) =>
            updateTask(task.id, { title: e.target.value.replace(/\n/g, " ") })
          }
          rows={1}
          aria-label="Title"
          className={cn(
            "field-sizing-content min-w-0 flex-1 resize-none bg-transparent py-2 font-semibold text-xl leading-snug outline-none",
            done && "text-muted-foreground line-through",
          )}
        />
        <button
          type="button"
          aria-label={task.starred ? "Unstar" : "Star"}
          aria-pressed={task.starred}
          onClick={() => updateTask(task.id, { starred: !task.starred })}
          className="grid size-10 place-items-center"
        >
          <Star
            className={cn(
              "size-5",
              task.starred ? "fill-warn text-warn" : "text-muted-foreground",
            )}
          />
        </button>
      </div>

      {deleted && (
        <div className="mt-2 flex items-center justify-between rounded-xl bg-bad/10 px-3 py-2 text-bad text-sm">
          Deleted {task.deletedAt ? fmtInstant(task.deletedAt) : ""}
          <button
            type="button"
            className="font-semibold"
            onClick={() => restoreTask(task.id)}
          >
            Restore
          </button>
        </div>
      )}

      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip
          accent="tsk"
          active={task.listId === null}
          onClick={() => updateTask(task.id, { listId: null })}
        >
          <Inbox className="size-3.5" /> Inbox
        </Chip>
        {active.map((l) => (
          <Chip
            key={l.id}
            accent="tsk"
            active={task.listId === l.id}
            onClick={() => updateTask(task.id, { listId: l.id })}
          >
            <span className={cn("size-2 rounded-full", LIST_DOT[l.color])} />
            {l.name}
          </Chip>
        ))}
      </div>

      <div className="mt-3 rounded-2xl border border-border/60 px-3">
        <Field
          icon={<CalendarDays className="size-4" />}
          label="Add date"
          value={
            task.dueDate
              ? `${fmtDayLong(task.dueDate, tk)}${task.dueTime ? ` · ${fmtTime(task.dueTime)}` : ""}${isOverdue(task, tk) ? ` · ${diffDays(task.dueDate, tk)}d late` : ""}`
              : null
          }
          onClick={() => setPicker(true)}
          onClear={() => setDue(task.id, null, null, null)}
        />
        <Field
          icon={<AlarmClock className="size-4" />}
          label="Add reminder"
          value={task.remindAt ? `Remind ${fmtInstant(task.remindAt)}` : null}
          onClick={() => setPicker(true)}
          onClear={() => updateTask(task.id, { remindAt: null })}
        />
        <Field
          icon={<Repeat className="size-4" />}
          label="Repeat"
          value={fmtRepeat(task.recurrence)}
          onClick={() => setRepeat(true)}
          onClear={() => updateTask(task.id, { recurrence: null })}
        />
      </div>

      {task.remindAt && task.status === "open" && (
        <div className="mt-2 flex gap-2">
          <span className="self-center text-muted-foreground text-xs">
            Snooze reminder
          </span>
          {[
            [60, "1 hr"],
            [180, "3 hr"],
          ].map(([m, l]) => (
            <Chip
              key={l}
              className="h-8"
              onClick={() => {
                snoozeTask(task.id, Number(m))
                toast(`Snoozed ${l}`, {
                  description: "Reminder only — the due date stays.",
                })
              }}
            >
              <AlarmClock className="size-3.5" /> {l}
            </Chip>
          ))}
        </div>
      )}

      <textarea
        value={task.notes ?? ""}
        onChange={(e) => updateTask(task.id, { notes: e.target.value || null })}
        placeholder="Notes"
        aria-label="Notes"
        className="field-sizing-content mt-3 min-h-20 w-full resize-none rounded-2xl border border-border/60 bg-transparent p-3 text-sm outline-none focus:border-tsk/60"
      />

      <div className="mt-3 space-y-1 px-1 text-muted-foreground text-xs">
        <div>
          {SOURCE[task.source]} · {fmtInstant(task.createdAt)}
        </div>
        {task.rescheduleCount > 0 && (
          <div className="text-warn">
            Rescheduled {task.rescheduleCount}×
            {task.originalDue
              ? ` · originally due ${fmtDate(task.originalDue)}`
              : ""}
          </div>
        )}
        {task.completedAt && (
          <div className="text-good">
            Completed {fmtInstant(task.completedAt)}
          </div>
        )}
      </div>

      {confirmDel ? (
        <div className="mt-4 rounded-2xl bg-muted/50 p-3">
          <div className="mb-2 font-medium text-sm">
            Delete a repeating task
          </div>
          <div className="flex gap-2">
            <Btn
              variant="secondary"
              className="flex-1"
              onClick={() => {
                // this one: skip to the next instance
                const t = getTask(task.id)
                if (t?.recurrence && t.dueDate) {
                  createTask({
                    title: t.title,
                    listId: t.listId,
                    dueDate: addDays(t.dueDate < tk ? tk : t.dueDate, 1),
                    dueTime: t.dueTime,
                    recurrence: t.recurrence,
                    notes: t.notes,
                    starred: t.starred,
                    remind: !!t.remindAt,
                  })
                }
                softDelete(task)
                onDone?.()
              }}
            >
              This one
            </Btn>
            <Btn
              variant="danger"
              className="flex-1"
              onClick={() => {
                softDelete(task)
                onDone?.()
              }}
            >
              All future
            </Btn>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Btn variant="secondary" onClick={() => tick(task)} className="px-2">
            <Check className="size-4" /> {done ? "Reopen" : "Done"}
          </Btn>
          <Btn
            variant="secondary"
            className="px-2"
            onClick={() => {
              const c = duplicateTask(task.id)
              if (c)
                toast.success("Duplicated", {
                  action: { label: "Undo", onClick: () => removeTasks([c.id]) },
                })
            }}
          >
            <Copy className="size-4" /> Copy
          </Btn>
          {deleted ? (
            <Btn
              variant="secondary"
              className="px-2"
              onClick={() => restoreTask(task.id)}
            >
              Restore
            </Btn>
          ) : (
            <Btn variant="danger" className="px-2" onClick={del}>
              <Trash2 className="size-4" /> Delete
            </Btn>
          )}
        </div>
      )}

      <WhenSheet
        open={picker}
        onClose={() => setPicker(false)}
        value={when}
        defaultTime={defaultTime}
        onSave={(w) => {
          const later =
            !!task.dueDate && !!w.dueDate && w.dueDate > task.dueDate
          setDue(task.id, w.dueDate, w.dueTime, w.remindAt)
          if (later)
            toast("Rescheduled", {
              description: `That's ${task.rescheduleCount + 1}× for this one.`,
            })
        }}
      />
      <RepeatSheet
        open={repeat}
        onClose={() => setRepeat(false)}
        value={task.recurrence}
        anchor={task.dueDate}
        onSave={(r) => {
          updateTask(task.id, { recurrence: r })
          if (r && !task.dueDate) setDue(task.id, tk)
        }}
      />
    </div>
  )
}

export function TaskDetailSheet() {
  const u = useUi()
  const task = tasksStore.use((s) =>
    u.detail ? s.tasks.find((t) => t.id === u.detail) : undefined,
  )
  return (
    <BottomSheet open={!!u.detail && !!task} onClose={closeTask} title="Task">
      {task && <TaskDetailBody task={task} onDone={closeTask} />}
    </BottomSheet>
  )
}

// ---------------------------------------------------------------- TSK-11 overdue triage

export function TriageSheet() {
  const u = useUi()
  const tasks = tasksStore.use((s) => s.tasks)
  const lists = tasksStore.use((s) => s.lists)
  const tk = today()
  const overdue = useMemo(
    () =>
      tasks
        .filter(
          (t) =>
            isOverdue(t, tk) &&
            lists.find((l) => l.id === t.listId)?.kind !== "shopping",
        )
        .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")),
    [tasks, lists, tk],
  )
  const [pick, setPick] = useState<Task | null>(null)
  const pickValue = useMemo<When>(
    () => ({
      dueDate: pick?.dueDate ?? null,
      dueTime: pick?.dueTime ?? null,
      remindAt: pick?.remindAt ?? null,
    }),
    [pick],
  )

  return (
    <BottomSheet
      open={u.triage}
      onClose={closeTriage}
      title={overdue.length ? `${overdue.length} overdue` : "Overdue"}
    >
      {overdue.length === 0 ? (
        <Empty
          icon={<Check className="size-8 text-good" />}
          title="Nothing overdue"
          body="Every past-due task is handled. Clean slate."
          action={
            <Btn variant="secondary" onClick={closeTriage}>
              Close
            </Btn>
          }
        />
      ) : (
        <>
          <p className="-mt-1 mb-3 text-muted-foreground text-sm">
            Each move to a later date counts as a reschedule in your stats.
          </p>
          <Btn
            accent="tsk"
            className="mb-3 w-full"
            onClick={() => {
              const n = moveAllOverdueToToday()
              toast(`Moved ${n} to today`, {
                description: `${n} reschedules logged.`,
              })
            }}
          >
            Move all to today
          </Btn>
          <div className="divide-y divide-border/50">
            {overdue.map((t) => {
              const late = diffDays(t.dueDate ?? tk, tk)
              const list = lists.find((l) => l.id === t.listId) ?? null
              return (
                <div key={t.id} className="py-3">
                  <div className="flex items-start gap-3">
                    <ListGlyph list={list} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{t.title}</div>
                      <div className="text-xs">
                        <span className="font-medium text-warn">
                          {late}d late
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          · was due {fmtDate(t.dueDate ?? tk)}
                          {t.rescheduleCount
                            ? ` · pushed ${t.rescheduleCount}×`
                            : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-1.5 pl-10">
                    {(
                      [
                        ["Today", () => setDue(t.id, tk)],
                        ["Tmrw", () => setDue(t.id, addDays(tk, 1))],
                        ["Pick", () => setPick(t)],
                      ] as const
                    ).map(([l, fn]) => (
                      <button
                        key={l}
                        type="button"
                        onClick={fn}
                        className="h-8 flex-1 rounded-lg bg-muted font-medium text-xs active:opacity-70"
                      >
                        {l}
                      </button>
                    ))}
                    <button
                      type="button"
                      aria-label={`Complete ${t.title}`}
                      onClick={() => tick(t)}
                      className="grid h-8 flex-1 place-items-center rounded-lg bg-good/15 text-good"
                    >
                      <Check className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${t.title}`}
                      onClick={() => softDelete(t)}
                      className="grid h-8 flex-1 place-items-center rounded-lg bg-bad/10 text-bad"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="h-3" />
        </>
      )}
      <WhenSheet
        open={!!pick}
        onClose={() => setPick(null)}
        value={pickValue}
        title={pick ? `New date · ${pick.title}` : "New date"}
        dateOnly
        onSave={(w) => pick && setDue(pick.id, w.dueDate)}
      />
    </BottomSheet>
  )
}

// ---------------------------------------------------------------- row "Pick date"

function PickSheet() {
  const u = useUi()
  const defaultTime = tasksStore.use((s) => s.settings.defaultRemindTime)
  const task = tasksStore.use((s) =>
    u.pick ? s.tasks.find((t) => t.id === u.pick) : undefined,
  )
  const value = useMemo<When>(
    () => ({
      dueDate: task?.dueDate ?? null,
      dueTime: task?.dueTime ?? null,
      remindAt: task?.remindAt ?? null,
    }),
    [task],
  )
  return (
    <WhenSheet
      open={!!task}
      onClose={closePick}
      value={value}
      defaultTime={defaultTime}
      title={task ? task.title : "When"}
      onSave={(w) => task && setDue(task.id, w.dueDate, w.dueTime, w.remindAt)}
    />
  )
}

/** Mount once per screen that shows tasks; renders the module's sheets. */
export function TaskSheets() {
  const primary = useIsPrimaryHost()
  if (!primary) return null
  return (
    <>
      <QuickAddSheet />
      <TaskDetailSheet />
      <TriageSheet />
      <PickSheet />
    </>
  )
}

// ---------------------------------------------------------------- TSK-07 list create / edit

const ICONS = Object.keys(LIST_ICONS) as ListIcon[]

export function ListEditSheet({
  open,
  onClose,
  list,
}: {
  open: boolean
  onClose: () => void
  /** null = create */
  list: TaskList | null
}) {
  const tasks = tasksStore.use((s) => s.tasks)
  const [form, setForm] = useState<ListInput>({
    name: "",
    kind: "standard",
    color: "tsk",
    icon: "list",
  })
  const [confirm, setConfirm] = useState(false)
  const [syncedFor, setSyncedFor] = useState<string | null | undefined>(
    undefined,
  )
  const key = open ? (list?.id ?? "new") : null
  if (key !== syncedFor) {
    setSyncedFor(key)
    setConfirm(false)
    setForm(
      list
        ? {
            name: list.name,
            kind: list.kind,
            color: list.color,
            icon: list.icon,
          }
        : { name: "", kind: "standard", color: "tsk", icon: "list" },
    )
  }
  const openCount = list
    ? tasks.filter((t) => t.listId === list.id && t.status === "open").length
    : 0
  const save = () => {
    if (!form.name.trim()) return
    if (list) updateList(list.id, { ...form, name: form.name.trim() })
    else createList({ ...form, name: form.name.trim() })
    toast.success(list ? "List saved" : `Created ${form.name.trim()}`)
    onClose()
  }
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={list ? "Edit list" : "New list"}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Input
          autoFocus={!list}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="List name — e.g. Side hustle"
          className="h-12 rounded-xl text-base"
          aria-label="List name"
        />
      </form>
      <div className="mt-4 flex flex-wrap gap-2">
        {LIST_COLORS.map((c: ListColor) => (
          <button
            key={c}
            type="button"
            aria-label={`Colour ${c}`}
            aria-pressed={form.color === c}
            onClick={() => setForm({ ...form, color: c })}
            className={cn(
              "size-9 rounded-full ring-offset-2 ring-offset-background",
              LIST_DOT[c],
              form.color === c && "ring-2 ring-foreground",
            )}
          />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-9 gap-1.5">
        {ICONS.map((i) => {
          const I = LIST_ICONS[i]
          return (
            <button
              key={i}
              type="button"
              aria-label={`Icon ${i}`}
              aria-pressed={form.icon === i}
              onClick={() => setForm({ ...form, icon: i })}
              className={cn(
                "grid aspect-square place-items-center rounded-lg",
                form.icon === i
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <I className="size-4" />
            </button>
          )
        })}
      </div>
      <label className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-3">
        <div>
          <div className="font-medium text-sm">Shopping mode</div>
          <div className="text-muted-foreground text-xs">
            Checkboxes, no dates, “In cart” + Clear checked.
          </div>
        </div>
        <input
          type="checkbox"
          checked={form.kind === "shopping"}
          onChange={(e) =>
            setForm({
              ...form,
              kind: e.target.checked ? "shopping" : "standard",
            })
          }
          className="size-5 accent-[var(--tsk)]"
        />
      </label>

      {confirm && list ? (
        <div className="mt-4 rounded-2xl bg-bad/10 p-3">
          <div className="font-medium text-sm">
            Delete “{list.name}”? It has {openCount} open task
            {openCount === 1 ? "" : "s"}.
          </div>
          <div className="mt-2 flex gap-2">
            <Btn
              variant="secondary"
              className="flex-1"
              onClick={() => {
                deleteList(list.id, "inbox")
                toast(`Deleted ${list.name}`, {
                  description: "Open tasks moved to Inbox.",
                })
                onClose()
              }}
            >
              Move to Inbox
            </Btn>
            <Btn
              variant="danger"
              className="flex-1"
              onClick={() => {
                deleteList(list.id, "delete")
                toast(`Deleted ${list.name} and its tasks`)
                onClose()
              }}
            >
              Delete tasks
            </Btn>
          </div>
        </div>
      ) : (
        <div className="mt-5 mb-3 flex gap-2">
          {list && (
            <>
              <Btn
                variant="secondary"
                onClick={() => {
                  setListArchived(list.id, !list.archivedAt)
                  toast(
                    list.archivedAt ? "Unarchived" : `Archived ${list.name}`,
                  )
                  onClose()
                }}
              >
                {list.archivedAt ? "Unarchive" : "Archive"}
              </Btn>
              <Btn
                variant="danger"
                onClick={() => {
                  if (openCount) setConfirm(true)
                  else {
                    deleteList(list.id, "inbox")
                    toast(`Deleted ${list.name}`)
                    onClose()
                  }
                }}
              >
                Delete
              </Btn>
            </>
          )}
          <Btn
            accent="tsk"
            className="flex-1"
            onClick={save}
            disabled={!form.name.trim()}
          >
            {list ? "Save" : "Create list"}
          </Btn>
        </div>
      )}
    </BottomSheet>
  )
}
