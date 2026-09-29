"use client"

import {
  AlarmClock,
  BookOpen,
  Briefcase,
  CalendarClock,
  CalendarDays,
  Check,
  Gift,
  Heart,
  House,
  Inbox,
  Laptop,
  List,
  type LucideIcon,
  Plane,
  Repeat,
  ShoppingCart,
  Star,
  SunMedium,
  Trash2,
} from "lucide-react"
import {
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react"
import { toast } from "sonner"
import {
  SheetContent,
  Sheet as SheetRoot,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { type Accent, Btn, Card, Empty } from "../ui/kit"
import { SwipeAction, SwipeRow } from "../ui/swipe-row"
import {
  deleteTask,
  rescheduleBy,
  restoreTask,
  setDue,
  toggleTask,
  uncompleteTask,
} from "./actions"
import type { ListColor, ListIcon, Task, TaskList } from "./data"
import {
  addDays,
  diffDays,
  fmtDay,
  fmtRepeat,
  fmtTime,
  isDueNow,
  isOverdue,
  today,
} from "./logic"

// ---------------------------------------------------------------- ephemeral UI store
// Sheet open-state for the module (not persisted — a reload closes sheets).

interface Ui {
  quickAdd: { listId: string | null; dueDate: string | null } | null
  detail: string | null
  triage: boolean
  /** Task id whose date picker (TSK-05) is open from a row action. */
  pick: string | null
}
let ui: Ui = { quickAdd: null, detail: null, triage: false, pick: null }
const subs = new Set<() => void>()
const setUi = (p: Partial<Ui>) => {
  ui = { ...ui, ...p }
  for (const l of subs) l()
}
const sub = (l: () => void) => {
  subs.add(l)
  return () => {
    subs.delete(l)
  }
}
const SERVER_UI: Ui = {
  quickAdd: null,
  detail: null,
  triage: false,
  pick: null,
}
export const useUi = () =>
  useSyncExternalStore(
    sub,
    () => ui,
    () => SERVER_UI,
  )

/** Open the quick-add sheet (TSK-04), optionally pre-set to a list / day. */
export const openQuickAdd = (
  o: { listId?: string | null; dueDate?: string | null } = {},
) =>
  setUi({ quickAdd: { listId: o.listId ?? null, dueDate: o.dueDate ?? null } })
export const closeQuickAdd = () => setUi({ quickAdd: null })
/** Open the task detail sheet (TSK-03). */
export const openTask = (id: string) => setUi({ detail: id })
export const closeTask = () => setUi({ detail: null })
/** Open the overdue triage sheet (TSK-11). */
export const openTriage = () => setUi({ triage: true })
export const closeTriage = () => setUi({ triage: false })
/** Open the date picker for one task (row "Pick date" action). */
export const openPick = (id: string) => setUi({ pick: id })
export const closePick = () => setUi({ pick: null })

// Only one sheet host renders even if Today card + Plan view both mount one.
let hostSeq = 0
const hosts: number[] = []
const hostSubs = new Set<() => void>()
export function useIsPrimaryHost(): boolean {
  const [id] = useState(() => ++hostSeq)
  useEffect(() => {
    hosts.push(id)
    for (const l of hostSubs) l()
    return () => {
      hosts.splice(hosts.indexOf(id), 1)
      for (const l of hostSubs) l()
    }
  }, [id])
  return useSyncExternalStore(
    (l) => {
      hostSubs.add(l)
      return () => {
        hostSubs.delete(l)
      }
    },
    () => hosts[0] === id,
    () => false,
  )
}

// ---------------------------------------------------------------- view state (?state=)

export type ViewState = "loaded" | "empty" | "error" | "loading"

/** Reads `?state=empty|error|loading` so the owner can walk every state. */
export function useViewState(): ViewState {
  const [v, setV] = useState<ViewState>("loaded")
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("state")
    if (s === "empty" || s === "error" || s === "loading") setV(s)
  }, [])
  return v
}

export function LoadingRows({ n = 5 }: { n?: number }) {
  return (
    <div className="space-y-3 py-2" aria-busy>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-1">
          <Skeleton className="size-6 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function SyncError({ onRetry }: { onRetry?: () => void }) {
  return (
    <Card className="mt-3 border-bad/30 bg-bad/5">
      <div className="font-medium text-bad text-sm">
        Couldn't sync 2 changes
      </div>
      <ul className="mt-1 text-muted-foreground text-xs">
        <li>· Completed "Submit timesheet"</li>
        <li>· Moved "Finish Q4 deck" to Fri</li>
      </ul>
      <div className="mt-3 flex gap-2">
        <Btn
          variant="secondary"
          className="h-9"
          onClick={() => {
            toast.success("Synced")
            onRetry?.()
          }}
        >
          Retry
        </Btn>
        <span className="self-center text-muted-foreground text-xs">
          Your changes are saved on this device.
        </span>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- list look

export const LIST_ICONS: Record<ListIcon, LucideIcon> = {
  briefcase: Briefcase,
  laptop: Laptop,
  home: House,
  cart: ShoppingCart,
  heart: Heart,
  book: BookOpen,
  plane: Plane,
  gift: Gift,
  list: List,
}
export const LIST_BG: Record<ListColor, string> = {
  tsk: "bg-tsk/15 text-tsk",
  fin: "bg-fin/15 text-fin",
  hab: "bg-hab/15 text-hab",
  fit: "bg-fit/15 text-fit",
  life: "bg-life/15 text-life",
  warn: "bg-warn/15 text-warn",
}
export const LIST_DOT: Record<ListColor, string> = {
  tsk: "bg-tsk",
  fin: "bg-fin",
  hab: "bg-hab",
  fit: "bg-fit",
  life: "bg-life",
  warn: "bg-warn",
}
export const LIST_COLORS = Object.keys(LIST_DOT) as ListColor[]

export function ListGlyph({
  list,
  size = "md",
}: {
  list: TaskList | null | "inbox" | "starred"
  size?: "sm" | "md"
}) {
  const Icon =
    list === "inbox" || list === null
      ? Inbox
      : list === "starred"
        ? Star
        : LIST_ICONS[list.icon]
  const tone =
    list === "inbox" || list === null
      ? "bg-muted text-muted-foreground"
      : list === "starred"
        ? "bg-warn/15 text-warn"
        : LIST_BG[list.color]
  return (
    <div
      className={cn(
        "grid place-items-center rounded-xl",
        size === "md" ? "size-9" : "size-7 rounded-lg",
        tone,
      )}
    >
      <Icon className={size === "md" ? "size-[18px]" : "size-4"} />
    </div>
  )
}

// ---------------------------------------------------------------- bottom sheet

/** Phone-column bottom sheet (shadcn Sheet constrained to max-w-md). */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <SheetRoot open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className={cn(
          "pb-safe mx-auto max-h-[88dvh] w-full max-w-md gap-0 overflow-y-auto rounded-t-3xl [&>*]:shrink-0 border-border/60 px-4 pt-3",
          className,
        )}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted" />
        <SheetTitle className="mb-3 pr-8 text-lg">{title}</SheetTitle>
        {children}
      </SheetContent>
    </SheetRoot>
  )
}

// ---------------------------------------------------------------- task row

export function Circle({
  done,
  onClick,
  shopping,
  label,
}: {
  done: boolean
  onClick: () => void
  shopping?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={done}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
        if (!done && typeof navigator !== "undefined") navigator.vibrate?.(10)
      }}
      className="-m-2 grid size-10 shrink-0 place-items-center"
    >
      <span
        className={cn(
          "grid size-6 place-items-center border-2 transition-all",
          shopping ? "rounded-md" : "rounded-full",
          done
            ? "scale-95 border-tsk bg-tsk text-background"
            : "border-muted-foreground/40 active:scale-90",
        )}
      >
        {done && <Check className="size-3.5" strokeWidth={3} />}
      </span>
    </button>
  )
}

/** "Due" meta line: day, time, repeat, reminder, reschedules, list. */
export function DueMeta({
  task,
  list,
  showList = true,
  showDay = true,
}: {
  task: Task
  list?: TaskList | null
  showList?: boolean
  showDay?: boolean
}) {
  const tk = today()
  const overdue = isOverdue(task, tk)
  const late = overdue && task.dueDate ? diffDays(task.dueDate, tk) : 0
  const bits: ReactNode[] = []
  if (task.dueDate && showDay)
    bits.push(
      <span key="d" className={cn(overdue && "font-medium text-warn")}>
        {overdue ? `${late}d late` : fmtDay(task.dueDate, tk)}
      </span>,
    )
  if (task.dueTime)
    bits.push(
      <span key="t" className={cn(isDueNow(task) && "font-medium text-tsk")}>
        {fmtTime(task.dueTime)}
      </span>,
    )
  if (task.recurrence)
    bits.push(
      <span
        key="r"
        className="inline-flex items-center gap-0.5"
        title={fmtRepeat(task.recurrence) ?? ""}
      >
        <Repeat className="size-3" />
      </span>,
    )
  if (task.remindAt && task.status === "open")
    bits.push(
      <AlarmClock key="a" className="size-3" aria-label="Reminder set" />,
    )
  if (task.rescheduleCount > 1)
    bits.push(
      <span key="p" className="inline-flex items-center gap-0.5 text-warn/90">
        <CalendarClock className="size-3" />
        {task.rescheduleCount}×
      </span>,
    )
  if (showList && list !== undefined)
    bits.push(
      <span key="l" className="inline-flex items-center gap-1">
        {list && (
          <span className={cn("size-1.5 rounded-full", LIST_DOT[list.color])} />
        )}
        {list?.name ?? "Inbox"}
      </span>,
    )
  if (!bits.length) return null
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground text-xs">
      {bits}
    </div>
  )
}

/** Tick with undo toast (F-TSK-08; 5s undo per IA §8). */
export function tick(t: Task) {
  const wasDone = t.status === "done"
  const spawned = toggleTask(t.id)
  if (wasDone) return
  toast.success(`Done · ${t.title}`, {
    description: spawned?.dueDate
      ? `Next: ${fmtDay(spawned.dueDate)}`
      : undefined,
    duration: 5000,
    action: {
      label: "Undo",
      onClick: () => {
        uncompleteTask(t.id)
        if (spawned) deleteTask(spawned.id)
      },
    },
  })
}

/** Move a task's due date to today + days, with a toast. */
export function push(t: Task, days: number) {
  const tk = today()
  const target = addDays(tk, days)
  const later = !!t.dueDate && target > t.dueDate
  if (days === 0) setDue(t.id, tk)
  else rescheduleBy(t.id, days)
  toast(`Moved to ${fmtDay(target)}`, {
    description: later ? `Rescheduled ${t.rescheduleCount + 1}×` : undefined,
  })
}

export function softDelete(t: Task) {
  deleteTask(t.id)
  toast(`Deleted · ${t.title}`, {
    duration: 5000,
    action: { label: "Undo", onClick: () => restoreTask(t.id) },
  })
}

export function TaskRow({
  task,
  list,
  showList = true,
  showDay = true,
  actions,
  shopping,
  onOpen,
}: {
  task: Task
  list?: TaskList | null
  showList?: boolean
  showDay?: boolean
  /** Inline action buttons (the ⋯ menu) — the button twin of the swipes. */
  actions?: ReactNode
  shopping?: boolean
  onOpen?: () => void
}) {
  const done = task.status === "done"
  // IA F-TSK-09: right = done; left reveals Tomorrow / Pick / Delete.
  return (
    <SwipeRow
      onDone={() => tick(task)}
      doneLabel={done ? "Reopen" : shopping ? "In cart" : "Done"}
      doneClass="bg-tsk text-background"
      actions={
        <>
          {!done && !shopping && (
            <>
              <SwipeAction
                onClick={() => push(task, 1)}
                icon={<SunMedium className="size-4" />}
                label="Tomorrow"
                className="bg-muted"
              />
              <SwipeAction
                onClick={() => openPick(task.id)}
                icon={<CalendarDays className="size-4" />}
                label="Pick"
                className="bg-secondary"
              />
            </>
          )}
          <SwipeAction
            onClick={() => softDelete(task)}
            icon={<Trash2 className="size-4" />}
            label="Delete"
            className="bg-bad text-white"
          />
        </>
      }
    >
      <div className="group">
        <div className="flex min-h-14 items-center gap-3 px-1">
          <Circle
            done={done}
            shopping={shopping}
            label={
              done
                ? `Mark "${task.title}" not done`
                : `Complete "${task.title}"`
            }
            onClick={() => tick(task)}
          />
          <button
            type="button"
            onClick={onOpen ?? (() => openTask(task.id))}
            className="min-w-0 flex-1 py-2 text-left"
          >
            <div
              className={cn(
                "flex items-center gap-1.5 font-medium leading-snug",
                done &&
                  "text-muted-foreground line-through decoration-muted-foreground/50",
              )}
            >
              <span className="truncate">{task.title}</span>
              {task.starred && !done && (
                <Star
                  className="size-3.5 shrink-0 fill-warn text-warn"
                  aria-label="Starred"
                />
              )}
            </div>
            {!shopping && (
              <DueMeta
                task={task}
                list={list}
                showList={showList}
                showDay={showDay}
              />
            )}
          </button>
          {actions}
        </div>
      </div>
    </SwipeRow>
  )
}

export function EmptyAllClear({
  doneToday,
  accent = "tsk",
}: {
  doneToday: number
  accent?: Accent
}) {
  return (
    <Empty
      icon={
        <div
          className={cn(
            "grid size-14 place-items-center rounded-full",
            accent === "tsk" && "bg-tsk/15 text-tsk",
          )}
        >
          <Check className="size-7" strokeWidth={2.5} />
        </div>
      }
      title="All clear"
      body={
        doneToday ? `${doneToday} done today. Nice work.` : "Nothing due today."
      }
    />
  )
}
