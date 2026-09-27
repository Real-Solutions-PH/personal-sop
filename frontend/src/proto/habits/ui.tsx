"use client"

import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Flame,
  Minus,
  MoreHorizontal,
  Play,
  Plus,
  RotateCw,
  SkipForward,
  Trash2,
  Undo2,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { dayKey, dayOffset, fmtDuration } from "../lib/day"
import { elapsedSec, type Live, liveStore } from "../lib/live"
import { Btn, Chip, Empty, NumberInput, Switch } from "../ui/kit"
import {
  checkHabit,
  clearLog,
  deleteLog,
  exitRoutine,
  finishTimer,
  incrementCount,
  logHabit,
  playerHref,
  restoreLog,
  startRoutine,
  startTimer,
  timerHref,
} from "./actions"
import {
  EVERY_DAY,
  type Habit,
  type HabitLog,
  type LogStatus,
  type ScheduleSlot,
  WEEKDAY_SHORT,
  WEEKDAYS,
} from "./data"
import {
  type Cell,
  cellFor,
  fmtTime,
  lk,
  logIndex,
  scheduleLabel,
  streaks,
  valueLabel,
} from "./logic"
import { habitsStore } from "./store"

// ---- plumbing --------------------------------------------------------------

export function useMounted() {
  const [m, setM] = useState(false)
  useEffect(() => setM(true), [])
  return m
}

/** Re-render every `ms` (for live timers / "now" grouping). */
export function useTick(ms = 1000, on = true) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => set((n) => n + 1), ms)
    return () => clearInterval(t)
  }, [ms, on])
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      className="space-y-3 pt-2"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="h-28 animate-pulse rounded-2xl bg-muted/60" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/40" />
      ))}
    </div>
  )
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="mt-4 rounded-2xl border border-bad/30 bg-bad/10 p-4">
      <div className="flex items-center gap-2 font-semibold text-bad">
        <AlertTriangle className="size-4" /> Couldn't load habits
      </div>
      <p className="mt-1 text-muted-foreground text-sm">
        Showing nothing rather than stale numbers. Your logs are safe on this
        device and will sync when the connection is back.
      </p>
      {onRetry && (
        <Btn variant="secondary" className="mt-3" onClick={onRetry}>
          <RotateCw className="size-4" /> Retry
        </Btn>
      )}
    </div>
  )
}

function GateInner({
  children,
  empty,
  rows,
}: {
  children: ReactNode
  empty?: ReactNode
  rows?: number
}) {
  const sp = useSearchParams()
  const path = usePathname()
  const router = useRouter()
  const mounted = useMounted()
  const state = sp.get("state")
  if (!mounted || state === "loading") return <Skeleton rows={rows} />
  if (state === "error")
    return <ErrorState onRetry={() => router.replace(path)} />
  if (state === "empty" && empty) return <>{empty}</>
  return <>{children}</>
}

/** Client-only content gate: skeleton until mounted (no hydration drift from
 * localStorage), plus `?state=loading|error|empty` for walkthroughs. */
export function Gate(props: {
  children: ReactNode
  empty?: ReactNode
  rows?: number
}) {
  return (
    <Suspense fallback={<Skeleton rows={props.rows} />}>
      <GateInner {...props} />
    </Suspense>
  )
}

export function useStateParam() {
  return useSearchParams().get("state")
}

export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[88dvh] max-w-md gap-0 overflow-y-auto rounded-t-3xl [&>*]:shrink-0 border-border/60 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted" />
        <SheetHeader className="pb-2">
          <SheetTitle className="text-lg">{title}</SheetTitle>
          {description ? (
            <SheetDescription>{description}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">{title}</SheetDescription>
          )}
        </SheetHeader>
        <div className="px-4">{children}</div>
      </SheetContent>
    </Sheet>
  )
}

/** HAB-09 confirm dialog: plain consequence text. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: ReactNode
  body: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2">
          <Btn
            variant="secondary"
            className="flex-1"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Btn>
          <Btn
            variant={danger ? "danger" : "primary"}
            accent="hab"
            className="flex-1"
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            {confirmLabel}
          </Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** HAB-E3: one live activity at a time. Wraps timer / routine starts. */
export function useStartGuard() {
  const router = useRouter()
  const [conflict, setConflict] = useState<{
    live: Live
    retry: () => void
  } | null>(null)

  const tryTimer = (habitId: string) => {
    if (startTimer(habitId)) router.push(timerHref(habitId))
    else {
      const live = liveStore.get().live
      if (live) setConflict({ live, retry: () => tryTimer(habitId) })
    }
  }
  const tryRoutine = (routineId: string) => {
    if (startRoutine(routineId)) router.push(playerHref(routineId))
    else {
      const live = liveStore.get().live
      if (live) setConflict({ live, retry: () => tryRoutine(routineId) })
    }
  }

  const dialog = conflict ? (
    <ConflictDialog
      live={conflict.live}
      onClose={() => setConflict(null)}
      onStopAndRetry={() => {
        const retry = conflict.retry
        setConflict(null)
        retry()
      }}
    />
  ) : null
  return { tryTimer, tryRoutine, dialog }
}

function ConflictDialog({
  live,
  onClose,
  onStopAndRetry,
}: {
  live: Live
  onClose: () => void
  onStopAndRetry: () => void
}) {
  useTick()
  const router = useRouter()
  const mine = live.kind === "timer" || live.kind === "routine"
  const stop = () => {
    if (live.kind === "timer") {
      const log = finishTimer(elapsedSec(live) / 60)
      if (log) toast.success(`Logged ${log.value} min`)
    } else exitRoutine()
    onStopAndRetry()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm rounded-3xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Something is already running</DialogTitle>
          <DialogDescription>
            {live.label} is running ({fmtDuration(elapsedSec(live))}). Only one
            timer, routine or workout runs at a time.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {mine ? (
            <Btn accent="hab" onClick={stop}>
              {live.kind === "timer"
                ? "Stop & log it, start new"
                : "Leave routine (progress kept), start new"}
            </Btn>
          ) : null}
          <Btn
            variant="secondary"
            onClick={() => {
              onClose()
              router.push(live.href)
            }}
          >
            Go to {live.kind}
          </Btn>
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---- atoms -----------------------------------------------------------------

export function HabitIcon({
  icon,
  size = "md",
  className,
}: {
  icon: string
  size?: "sm" | "md" | "lg" | "xl"
  className?: string
}) {
  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center rounded-2xl bg-hab/12",
        size === "sm" && "size-8 rounded-xl text-base",
        size === "md" && "size-10 text-xl",
        size === "lg" && "size-14 text-3xl",
        size === "xl" && "size-24 rounded-[2rem] text-6xl",
        className,
      )}
      aria-hidden
    >
      {icon}
    </div>
  )
}

export function StatusGlyph({ cell }: { cell: Cell }) {
  const base = "grid size-5 place-items-center rounded-full"
  if (cell === "done")
    return (
      <span className={cn(base, "bg-hab text-background")}>
        <Check className="size-3" strokeWidth={3} />
      </span>
    )
  if (cell === "partial")
    return <span className={cn(base, "border-2 border-hab bg-hab/40")} />
  if (cell === "skipped")
    return (
      <span className={cn(base, "bg-warn/20 text-warn")}>
        <SkipForward className="size-3" />
      </span>
    )
  if (cell === "missed")
    return (
      <span className={cn(base, "bg-bad/20 text-bad")}>
        <Minus className="size-3" strokeWidth={3} />
      </span>
    )
  if (cell === "bonus")
    return <span className={cn(base, "border-2 border-hab")} />
  return <span className={cn(base, "border-2 border-muted-foreground/30")} />
}

/** Big tappable check circle; count habits show a progress ring. */
export function CheckCircle({
  habit,
  log,
  onClick,
}: {
  habit: Habit
  log?: HabitLog
  onClick: () => void
}) {
  const st = log?.status
  const frac =
    habit.type !== "check" && habit.target && log?.value
      ? Math.min(1, log.value / habit.target)
      : st === "done"
        ? 1
        : 0
  const r = 17
  const c = 2 * Math.PI * r
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      aria-label={
        st === "done" ? `Uncheck ${habit.name}` : `Check ${habit.name}`
      }
      aria-pressed={st === "done"}
      className="relative grid size-11 shrink-0 place-items-center rounded-full active:scale-90"
    >
      <svg
        width={40}
        height={40}
        className="-rotate-90 absolute"
        aria-hidden="true"
      >
        <circle
          cx={20}
          cy={20}
          r={r}
          fill="none"
          strokeWidth={3}
          className={
            st === "skipped" ? "stroke-warn/50" : "stroke-muted-foreground/30"
          }
        />
        {frac > 0 && (
          <circle
            cx={20}
            cy={20}
            r={r}
            fill="none"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - frac)}
            className="stroke-hab transition-[stroke-dashoffset] duration-500"
          />
        )}
      </svg>
      <span
        className={cn(
          "grid size-8 place-items-center rounded-full transition-colors",
          st === "done" && "bg-hab text-background",
        )}
      >
        {st === "done" ? (
          <Check className="size-5" strokeWidth={3} />
        ) : st === "skipped" ? (
          <SkipForward className="size-4 text-warn" />
        ) : habit.type === "count" && log?.value ? (
          <span className="num font-semibold text-[11px]">{log.value}</span>
        ) : null}
      </span>
    </button>
  )
}

export function StreakChip({
  n,
  className,
}: {
  n: number
  className?: string
}) {
  if (!n) return null
  return (
    <span
      className={cn(
        "num inline-flex items-center gap-0.5 rounded-full bg-warn/15 px-1.5 py-px font-semibold text-[11px] text-warn",
        className,
      )}
    >
      <Flame aria-hidden="true" className="size-3" />
      {n}
      <span className="sr-only">-day streak</span>
    </span>
  )
}

export function toastUndo(
  message: string,
  undo: () => void,
  description?: string,
) {
  toast(message, {
    description,
    action: { label: "Undo", onClick: undo },
    duration: 4000,
  })
}

const MILESTONES = [7, 30, 100, 365]

/** F-HAB-01/02: one tap toggles done ⇄ cleared, with Undo + milestone toasts. */
export function quickToggle(h: Habit, day = dayKey()) {
  const prev = logIndex(habitsStore.get().logs).get(lk(h.id, day))
  if (prev?.status === "done") {
    clearLog(h.id, day)
    toastUndo(`Unchecked ${h.name}`, () => restoreLog(prev))
    return
  }
  const log = checkHabit(h.id, day)
  if (!log) return
  const undo = () => (prev ? restoreLog(prev) : deleteLog(log.id))
  const s = streaks(h, logIndex(habitsStore.get().logs))
  if (MILESTONES.includes(s.current) && day === dayKey())
    toast.success(`${s.current}-day streak on ${h.name}!`, {
      action: { label: "Undo", onClick: undo },
    })
  else if (s.current > 1 && s.current >= s.best && day === dayKey())
    toastUndo(`✓ ${h.name}`, undo, `New best streak — ${s.current} days`)
  else
    toastUndo(
      `✓ ${h.name}`,
      undo,
      s.current > 1 ? `${s.current}-day streak` : undefined,
    )
}

export function quickIncrement(h: Habit, day = dayKey()) {
  const prev = logIndex(habitsStore.get().logs).get(lk(h.id, day))
  const log = incrementCount(h.id, undefined, day)
  if (!log) return
  toastUndo(
    `${h.name}: ${valueLabel(h, log.value)}`,
    () => (prev ? restoreLog(prev) : deleteLog(log.id)),
    log.status === "done" && prev?.status !== "done"
      ? "Target hit ✓"
      : undefined,
  )
}

export function useLongPress(cb: () => void, ms = 450) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fired = useRef(false)
  const clear = () => {
    if (t.current) clearTimeout(t.current)
    t.current = null
  }
  return {
    onPointerDown: () => {
      fired.current = false
      t.current = setTimeout(() => {
        fired.current = true
        cb()
      }, ms)
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerMove: clear,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      clear()
      if (!fired.current) cb()
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (fired.current) {
        e.preventDefault()
        e.stopPropagation()
        fired.current = false
      }
    },
  }
}

// ---- habit row -------------------------------------------------------------

/** One habit, one line: check · name/meta · quick control. Long-press → HAB-05. */
export function HabitRow({
  habit,
  day = dayKey(),
  log,
  streak,
  meta,
  onMore,
  onTimer,
  running,
}: {
  habit: Habit
  day?: string
  log?: HabitLog
  streak?: number
  meta?: ReactNode
  onMore: () => void
  onTimer?: () => void
  running?: boolean
}) {
  const lp = useLongPress(onMore)
  const slot = habit.schedule.find((s) =>
    s.days.includes(new Date(`${day}T12:00:00`).getDay()),
  )
  return (
    <div className="flex items-center gap-2 py-1" {...lp}>
      <CheckCircle
        habit={habit}
        log={log}
        onClick={() => quickToggle(habit, day)}
      />
      <Link
        href={`/habits/${habit.id}`}
        className="min-w-0 flex-1 select-none py-1.5"
      >
        <div
          className={cn(
            "flex items-center gap-1.5 truncate font-medium",
            log?.status === "done" &&
              "text-muted-foreground line-through decoration-muted-foreground/40",
          )}
        >
          <span aria-hidden>{habit.icon}</span>
          <span className="truncate">{habit.name}</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
          {meta ?? (
            <>
              <span>{fmtTime(slot?.time)}</span>
              {log?.value !== undefined && log.status !== "skipped" && (
                <span className="num">· {valueLabel(habit, log.value)}</span>
              )}
              {log?.status === "skipped" && (
                <span className="text-warn">· skipped</span>
              )}
              {running && (
                <span className="inline-flex items-center gap-1 text-hab">
                  ·{" "}
                  <span className="size-1.5 animate-pulse rounded-full bg-hab" />{" "}
                  live
                </span>
              )}
            </>
          )}
          {streak ? <StreakChip n={streak} /> : null}
        </div>
      </Link>
      {habit.type === "count" && log?.status !== "done" && (
        <button
          type="button"
          onClick={() => quickIncrement(habit, day)}
          aria-label={`Add ${habit.step ?? 1} ${habit.unit ?? ""}`}
          className="grid h-9 min-w-9 place-items-center rounded-full bg-hab/15 px-2 font-semibold text-hab text-xs active:scale-95"
        >
          +{habit.step ?? 1}
        </button>
      )}
      {habit.type === "duration" && onTimer && log?.status !== "done" && (
        <button
          type="button"
          onClick={onTimer}
          aria-label={`Start ${habit.name} timer`}
          className="grid size-9 place-items-center rounded-full bg-hab/15 text-hab active:scale-95"
        >
          <Play className="size-4 fill-current" />
        </button>
      )}
      <button
        type="button"
        onClick={onMore}
        aria-label={`More options for ${habit.name}`}
        className="grid size-9 place-items-center rounded-full text-muted-foreground active:bg-muted"
      >
        <MoreHorizontal className="size-4" />
      </button>
    </div>
  )
}

// ---- HAB-05 log sheet ------------------------------------------------------

export function LogSheet({
  habit,
  day,
  open,
  onOpenChange,
}: {
  habit: Habit | null
  day?: string
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  return (
    <BottomSheet
      open={open && !!habit}
      onOpenChange={onOpenChange}
      title={
        habit ? (
          <span className="flex items-center gap-2">
            <span>{habit.icon}</span> {habit.name}
          </span>
        ) : (
          "Log"
        )
      }
    >
      {open && habit && (
        <LogBody
          habit={habit}
          initialDay={day ?? dayKey()}
          onClose={() => onOpenChange(false)}
        />
      )}
    </BottomSheet>
  )
}

function LogBody({
  habit,
  initialDay,
  onClose,
}: {
  habit: Habit
  initialDay: string
  onClose: () => void
}) {
  const [day, setDay] = useState(initialDay)
  return (
    <LogFields
      key={day}
      habit={habit}
      day={day}
      setDay={setDay}
      onClose={onClose}
    />
  )
}

function LogFields({
  habit,
  day,
  setDay,
  onClose,
}: {
  habit: Habit
  day: string
  setDay: (d: string) => void
  onClose: () => void
}) {
  const logs = habitsStore.use((s) => s.logs)
  const existing = logIndex(logs).get(lk(habit.id, day))
  const numeric = habit.type !== "check"
  const [status, setStatus] = useState<LogStatus>(
    existing?.status ?? (numeric ? "partial" : "done"),
  )
  const [value, setValue] = useState<string>(
    existing?.value !== undefined
      ? String(existing.value)
      : numeric
        ? String(habit.target ?? 1)
        : "",
  )
  const [note, setNote] = useState(existing?.note ?? "")
  const unit = habit.type === "duration" ? "min" : (habit.unit ?? "")
  const step = habit.type === "duration" ? 5 : (habit.step ?? 1)
  const days = [0, -1, -2].map((n) => dayOffset(n))
  if (!days.includes(day)) days.push(day)

  const save = () => {
    const v = numeric && value !== "" ? Number(value) : undefined
    const prev = existing
    const log = logHabit({
      habitId: habit.id,
      day,
      status:
        status !== "skipped" &&
        numeric &&
        v !== undefined &&
        habit.target &&
        v >= habit.target
          ? "done"
          : status,
      value: v,
      note: note || undefined,
    })
    onClose()
    if (log)
      toastUndo(
        `${habit.name}: ${log.status}${log.value !== undefined ? ` · ${valueLabel(habit, log.value)}` : ""}`,
        () => (prev ? restoreLog(prev) : deleteLog(log.id)),
        day !== dayKey() ? `Logged for ${fmtDay(day)}` : undefined,
      )
  }
  const clear = () => {
    const prev = clearLog(habit.id, day)
    onClose()
    if (prev) toastUndo(`Cleared ${habit.name}`, () => restoreLog(prev))
  }

  return (
    <div className="space-y-4 pb-2">
      <p className="-mt-1 text-muted-foreground text-sm">
        {existing
          ? `Currently ${existing.status}${existing.source !== "tap" ? ` (via ${existing.source})` : ""}`
          : "Not logged yet"}
        {" · "}
        {fmtDay(day)}
      </p>
      <div className="flex flex-wrap gap-2">
        {days.map((d, i) => (
          <Chip
            key={d}
            accent="hab"
            active={day === d}
            onClick={() => setDay(d)}
          >
            {i === 0 ? "Today" : i === 1 ? "Yesterday" : fmtDay(d)}
          </Chip>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["done", "Done", Check],
            ["partial", "Partial", Minus],
            ["skipped", "Skip", SkipForward],
          ] as const
        ).map(([k, label, Icon]) => (
          <button
            key={k}
            type="button"
            aria-pressed={status === k}
            onClick={() => setStatus(k)}
            className={cn(
              "flex h-16 flex-col items-center justify-center gap-1 rounded-2xl border font-medium text-sm",
              status === k
                ? k === "skipped"
                  ? "border-warn bg-warn/15 text-warn"
                  : "border-hab bg-hab/15 text-hab"
                : "border-border",
            )}
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </div>
      {numeric && status !== "skipped" && (
        <div>
          <div className="mb-1.5 text-muted-foreground text-xs">
            {habit.type === "duration" ? "Minutes" : `Amount (${unit})`}
            {habit.target ? ` · target ${habit.target}` : ""}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Decrease"
              onClick={() =>
                setValue(String(Math.max(0, Number(value || 0) - step)))
              }
              className="grid size-12 place-items-center rounded-xl bg-muted"
            >
              <Minus className="size-4" />
            </button>
            <NumberInput
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
              className="num h-12 min-w-0 flex-1 rounded-xl border border-border bg-transparent text-center font-semibold text-xl outline-none focus:border-hab"
              aria-label="Value"
            />
            <button
              type="button"
              aria-label="Increase"
              onClick={() => setValue(String(Number(value || 0) + step))}
              className="grid size-12 place-items-center rounded-xl bg-muted"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>
      )}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={
          status === "skipped"
            ? "Reason (optional) — e.g. knee is sore"
            : "Note (optional)"
        }
        className="h-11 w-full rounded-xl border border-border bg-transparent px-3 text-sm outline-none focus:border-hab"
      />
      <div className="flex gap-2">
        {existing && (
          <Btn variant="danger" onClick={clear}>
            <Trash2 className="size-4" /> Clear
          </Btn>
        )}
        <Btn accent="hab" className="flex-1" onClick={save}>
          Save{day !== dayKey() ? ` for ${fmtDay(day)}` : ""}
        </Btn>
      </div>
    </div>
  )
}

export const fmtDay = (day: string, opts?: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(
    "en-PH",
    opts ?? { weekday: "short", month: "short", day: "numeric" },
  )

// ---- HAB-04 schedule sheet -------------------------------------------------

export function ScheduleSheet({
  open,
  onOpenChange,
  value,
  onChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  value: ScheduleSlot[]
  onChange: (s: ScheduleSlot[]) => void
}) {
  const [slots, setSlots] = useState<ScheduleSlot[]>(value)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on open
  useEffect(() => {
    if (open) setSlots(value.length ? value : [{ days: EVERY_DAY }])
  }, [open])
  const union = new Set(slots.flatMap((s) => s.days))
  const toggle = (i: number, d: number) =>
    setSlots((ss) =>
      ss.map(
        (s, j) =>
          j === i
            ? {
                ...s,
                days: s.days.includes(d)
                  ? s.days.filter((x) => x !== d)
                  : [...s.days, d].sort(),
              }
            : { ...s, days: s.days.filter((x) => x !== d) }, // a day lives in one slot
      ),
    )
  const preset = (i: number, days: number[]) =>
    setSlots((ss) =>
      ss.map((s, j) =>
        j === i
          ? { ...s, days }
          : { ...s, days: s.days.filter((x) => !days.includes(x)) },
      ),
    )
  const setTime = (i: number, time?: string) =>
    setSlots((ss) => ss.map((s, j) => (j === i ? { ...s, time } : s)))

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Schedule"
      description="Which days, and what time"
    >
      <div className="space-y-4 pb-2">
        {slots.map((s, i) => (
          <div
            key={i}
            className="space-y-3 rounded-2xl border border-border/60 p-3"
          >
            <div className="flex items-center justify-between">
              <div className="font-medium text-sm">
                {i === 0 ? "Days" : "Different time on"}
              </div>
              {i > 0 && (
                <button
                  type="button"
                  className="text-bad text-xs"
                  onClick={() => setSlots((ss) => ss.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              )}
            </div>
            {i === 0 && (
              <div className="flex gap-2">
                <Chip
                  accent="hab"
                  active={s.days.length === 7}
                  onClick={() => preset(i, EVERY_DAY)}
                >
                  Every day
                </Chip>
                <Chip
                  accent="hab"
                  active={s.days.join() === "1,2,3,4,5"}
                  onClick={() => preset(i, WEEKDAYS)}
                >
                  Weekdays
                </Chip>
                <Chip
                  accent="hab"
                  active={s.days.join() === "0,6"}
                  onClick={() => preset(i, [0, 6])}
                >
                  Weekends
                </Chip>
              </div>
            )}
            <div className="grid grid-cols-7 gap-1.5">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={s.days.includes(d)}
                  onClick={() => toggle(i, d)}
                  className={cn(
                    "grid aspect-square place-items-center rounded-xl font-medium text-xs",
                    s.days.includes(d)
                      ? "bg-hab text-background"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {WEEKDAY_SHORT[d].slice(0, 2)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Chip
                accent="hab"
                active={!s.time}
                onClick={() => setTime(i, undefined)}
              >
                Anytime
              </Chip>
              <input
                type="time"
                value={s.time ?? ""}
                onChange={(e) => setTime(i, e.target.value || undefined)}
                className={cn(
                  "num h-9 flex-1 rounded-full border px-3 text-sm outline-none",
                  s.time ? "border-hab text-hab" : "border-border",
                )}
                aria-label="Time"
              />
            </div>
          </div>
        ))}
        {slots.length < 3 && (
          <button
            type="button"
            onClick={() =>
              setSlots((ss) => [...ss, { days: [], time: ss[0]?.time }])
            }
            className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed py-2.5 text-muted-foreground text-sm"
          >
            <Plus className="size-4" /> Different time on some days
          </button>
        )}
        {union.size === 0 && (
          <p className="text-bad text-sm">Pick at least one day.</p>
        )}
        <Btn
          accent="hab"
          className="w-full"
          disabled={union.size === 0}
          onClick={() => {
            onChange(slots.filter((s) => s.days.length))
            onOpenChange(false)
          }}
        >
          Done
        </Btn>
      </div>
    </BottomSheet>
  )
}

// ---- heatmaps & dots -------------------------------------------------------

const cellCls: Record<Cell, string> = {
  done: "bg-hab text-background",
  partial: "bg-hab/45",
  skipped: "bg-warn/35",
  missed: "bg-bad/40",
  paused:
    "bg-[repeating-linear-gradient(135deg,var(--muted)_0_3px,transparent_3px_6px)]",
  pending: "border-2 border-dashed border-hab/60",
  bonus: "border-2 border-hab",
  none: "bg-muted/25",
  future: "border border-border",
}

export function Legend({ items }: { items: Cell[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((c) => (
        <span key={c} className="inline-flex items-center gap-1">
          <span className={cn("size-2.5 rounded-[3px]", cellCls[c])} />
          {c === "none" ? "not scheduled" : c}
        </span>
      ))}
    </div>
  )
}

/** Month calendar for one habit (HAB-02). Tap a past day → HAB-17. */
export function MonthHeatmap({
  habit,
  logs,
  weekStart,
}: {
  habit: Habit
  logs: HabitLog[]
  weekStart: 0 | 1
}) {
  const today = dayKey()
  const [offset, setOffset] = useState(0)
  const base = new Date(`${today}T12:00:00`)
  base.setDate(1)
  base.setMonth(base.getMonth() + offset)
  const y = base.getFullYear()
  const m = base.getMonth()
  const daysIn = new Date(y, m + 1, 0).getDate()
  const lead = (new Date(y, m, 1).getDay() - weekStart + 7) % 7
  const idx = logIndex(logs)
  const cells = Array.from({ length: daysIn }, (_, i) => {
    const d = `${y}-${String(m + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`
    return { d, c: cellFor(habit, d, idx, today) }
  })
  const heads = Array.from(
    { length: 7 },
    (_, i) => WEEKDAY_SHORT[(i + weekStart) % 7][0],
  )
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setOffset((o) => o - 1)}
          disabled={offset <= -3}
          className="grid size-8 place-items-center rounded-full hover:bg-muted disabled:opacity-30"
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="font-medium text-sm">
          {base.toLocaleDateString("en-PH", { month: "long", year: "numeric" })}
        </div>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setOffset((o) => o + 1)}
          disabled={offset >= 0}
          className="grid size-8 place-items-center rounded-full hover:bg-muted disabled:opacity-30"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="mx-auto grid max-w-[280px] grid-cols-7 gap-1.5 text-center">
        {heads.map((h, i) => (
          <div key={i} className="text-[10px] text-muted-foreground">
            {h}
          </div>
        ))}
        {Array.from({ length: lead }).map((_, i) => (
          <div key={`l${i}`} />
        ))}
        {cells.map(({ d, c }) => {
          const inner = Number(d.slice(8))
          const cls = cn(
            "grid aspect-square place-items-center rounded-lg",
            cellCls[c],
            d === today && "ring-2 ring-foreground/70",
          )
          return d <= today && d >= habit.createdAt ? (
            <Link
              key={d}
              href={`/habits/day/${d}`}
              className={cls}
              aria-label={`${d}: ${c}`}
            >
              <span className="num text-[11px]">{inner}</span>
            </Link>
          ) : (
            <div key={d} className={cn(cls, "opacity-60")}>
              <span className="num text-[11px]">{inner}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Last-7-days dots for list rows. */
export function WeekDots({ habit, logs }: { habit: Habit; logs: HabitLog[] }) {
  const today = dayKey()
  const idx = logIndex(logs)
  return (
    <div className="flex gap-1" role="img" aria-label="Last 7 days">
      {Array.from({ length: 7 }, (_, i) => {
        const d = dayOffset(i - 6)
        const c = cellFor(habit, d, idx, today)
        return (
          <span key={d} className={cn("size-2 rounded-full", cellCls[c])} />
        )
      })}
    </div>
  )
}

export { cellCls }

// ---- misc ------------------------------------------------------------------

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <Switch checked={checked} onChange={onChange} label={label} accent="hab" />
  )
}

export function scheduleSummary(h: { schedule: ScheduleSlot[] }) {
  return scheduleLabel(h.schedule) || "No days"
}

/** HAB-24: capture result card — what the AI logged, with per-line Undo. */
export function HabitLogResultCard({ logs }: { logs: HabitLog[] }) {
  const state = habitsStore.use((s) => s)
  const [undone, setUndone] = useState<string[]>([])
  const rows = useMemo(
    () =>
      logs.map((l) => {
        const h = state.habits.find((x) => x.id === l.habitId)
        const s = h ? streaks(h, logIndex(state.logs)).current : 0
        return { l, h, s }
      }),
    [logs, state],
  )
  return (
    <div className="rounded-2xl border border-hab/30 bg-hab/5 p-3">
      {rows.map(({ l, h, s }) =>
        h ? (
          <div key={l.id} className="flex items-center gap-2 py-1 text-sm">
            <StatusGlyph cell={undone.includes(l.id) ? "none" : l.status} />
            <span
              className={cn(
                "flex-1 truncate",
                undone.includes(l.id) && "line-through opacity-50",
              )}
            >
              {h.name}
              {l.value !== undefined && ` · ${valueLabel(h, l.value)}`}
              {l.day !== dayKey() && <b> · {fmtDay(l.day)}</b>}
            </span>
            <StreakChip n={s} />
            {!undone.includes(l.id) && (
              <button
                type="button"
                aria-label={`Undo ${h.name}`}
                className="text-muted-foreground"
                onClick={() => {
                  deleteLog(l.id)
                  setUndone((u) => [...u, l.id])
                }}
              >
                <Undo2 className="size-4" />
              </button>
            )}
          </div>
        ) : null,
      )}
    </div>
  )
}

export function NotFound({ what }: { what: string }) {
  return (
    <Empty
      title={`${what} not found`}
      body="It may have been deleted on another device."
      action={
        <Btn href="/habits/manage" accent="hab">
          Back to habits
        </Btn>
      }
    />
  )
}
