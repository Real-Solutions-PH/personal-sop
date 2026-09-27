"use client"

import { ChevronDown, Minus, Pause, Play, Plus, Square } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { fmtDuration } from "../../lib/day"
import { elapsedSec, liveStore } from "../../lib/live"
import { Btn, NumberInput } from "../../ui/kit"
import {
  discardTimer,
  extendTimer,
  finishTimer,
  pauseLive,
  resumeLive,
  timerHref,
} from "../actions"
import type { Habit } from "../data"
import { targetLabel } from "../logic"
import { habitsStore } from "../store"
import {
  BottomSheet,
  HabitIcon,
  NotFound,
  useMounted,
  useStartGuard,
  useTick,
} from "../ui"

/** Full-screen surface that hides the tab bar (IA frame feedback). */
export function FullScreen({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "pt-safe pb-safe absolute inset-0 z-40 flex flex-col overflow-y-auto bg-background",
        className,
      )}
    >
      {children}
    </div>
  )
}

/** HAB-06 Timer (TickTick-style focus screen) + HAB-07 finish sheet. */
export function TimerScreen({ id }: { id: string }) {
  const mounted = useMounted()
  const habit = habitsStore.use((s) => s.habits.find((h) => h.id === id))
  if (!mounted)
    return (
      <FullScreen>
        <div className="m-auto size-64 animate-pulse rounded-full bg-muted/50" />
      </FullScreen>
    )
  if (!habit)
    return (
      <FullScreen>
        <NotFound what="Habit" />
      </FullScreen>
    )
  return <Timer habit={habit} />
}

const STALE_SEC = 4 * 3600

function Timer({ habit }: { habit: Habit }) {
  useTick(1000)
  const router = useRouter()
  const live = liveStore.use((s) => s.live)
  const timer = habitsStore.use((s) => s.timer)
  const guard = useStartGuard()
  const [finishOpen, setFinishOpen] = useState(false)
  const buzzed = useRef(false)

  const running =
    live?.href === timerHref(habit.id) && timer?.habitId === habit.id
  const elapsed = running && live ? elapsedSec(live) : 0
  const target = running ? timer?.targetSec : undefined
  const paused = !!live?.pausedAt
  const over = target ? elapsed - target : 0
  const staleAt = Math.min(STALE_SEC, target ? target * 2 : STALE_SEC)
  const stale = running && elapsed > staleAt

  useEffect(() => {
    if (target && over >= 0 && !buzzed.current) {
      buzzed.current = true
      try {
        navigator.vibrate?.([200, 100, 200])
      } catch {}
      toast.success(`${habit.name}: target reached`, {
        description: "Keep going or stop to log it.",
      })
    }
    if (over < 0) buzzed.current = false
  }, [over, target, habit.name])

  useEffect(() => {
    if (stale) setFinishOpen(true)
  }, [stale])

  const size = 272
  const stroke = 10
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const frac = target ? Math.min(1, elapsed / target) : (elapsed % 3600) / 3600

  if (!running)
    return (
      <FullScreen>
        <TopBar onMinimise={() => router.back()} title="Focus timer" />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <HabitIcon icon={habit.icon} size="xl" />
          <div>
            <div className="font-semibold text-2xl">{habit.name}</div>
            <div className="text-muted-foreground">
              {habit.type === "duration"
                ? `Target ${targetLabel(habit)}`
                : "Counts up"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => guard.tryTimer(habit.id)}
            className="mt-6 grid size-24 place-items-center rounded-full bg-hab text-background shadow-hab/30 shadow-xl active:scale-95"
            aria-label="Start timer"
          >
            <Play className="size-10 fill-current" />
          </button>
          <Link
            href={`/habits/${habit.id}`}
            className="text-muted-foreground text-sm"
          >
            Log time manually instead
          </Link>
        </div>
        {guard.dialog}
      </FullScreen>
    )

  return (
    <FullScreen>
      <TopBar
        onMinimise={() => router.back()}
        title={paused ? "Paused" : "Focusing"}
      />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="text-xl">{habit.icon}</span>
          <span className="font-medium">{habit.name}</span>
        </div>
        <div className="relative" style={{ width: size, height: size }}>
          <svg
            width={size}
            height={size}
            className="-rotate-90"
            aria-hidden="true"
          >
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={stroke}
              className="stroke-muted"
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - frac)}
              className={cn(
                "transition-[stroke-dashoffset] duration-1000 ease-linear",
                over > 0 ? "stroke-good" : "stroke-hab",
                paused && "opacity-50",
              )}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div
              className={cn(
                "num font-semibold text-6xl tracking-tight",
                paused && "animate-pulse text-muted-foreground",
                over > 0 && "text-good",
              )}
              aria-live="polite"
            >
              {target
                ? over > 0
                  ? `+${fmtDuration(over)}`
                  : fmtDuration(target - elapsed)
                : fmtDuration(elapsed)}
            </div>
            <div className="mt-1 text-muted-foreground text-sm">
              {target
                ? over > 0
                  ? `Target ${Math.round(target / 60)}m reached`
                  : `of ${Math.round(target / 60)} min · ${fmtDuration(elapsed)} in`
                : "counting up"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={() => extendTimer(300)}
            className="grid size-14 place-items-center rounded-full bg-muted font-semibold text-sm"
            aria-label="Add 5 minutes"
          >
            +5m
          </button>
          <button
            type="button"
            onClick={() => (paused ? resumeLive() : pauseLive())}
            className="grid size-20 place-items-center rounded-full bg-hab text-background shadow-hab/30 shadow-xl active:scale-95"
            aria-label={paused ? "Resume" : "Pause"}
          >
            {paused ? (
              <Play className="size-8 fill-current" />
            ) : (
              <Pause className="size-8 fill-current" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setFinishOpen(true)}
            className="grid size-14 place-items-center rounded-full bg-muted"
            aria-label="Stop"
          >
            <Square className="size-5 fill-current" />
          </button>
        </div>
        <p className="text-center text-muted-foreground text-xs">
          Safe to lock your phone or close the app — time is kept from
          timestamps.
        </p>
      </div>
      <FinishSheet
        habit={habit}
        open={finishOpen}
        onOpenChange={setFinishOpen}
        elapsed={elapsed}
        stale={stale}
        onSaved={() => router.replace(`/habits/${habit.id}`)}
      />
    </FullScreen>
  )
}

function TopBar({
  onMinimise,
  title,
}: {
  onMinimise: () => void
  title: string
}) {
  return (
    <div className="flex h-14 items-center px-2">
      <button
        type="button"
        onClick={onMinimise}
        aria-label="Minimise — keeps running"
        className="grid size-10 place-items-center rounded-full hover:bg-muted"
      >
        <ChevronDown className="size-6" />
      </button>
      <div className="flex-1 text-center font-medium text-muted-foreground text-sm">
        {title}
      </div>
      <div className="size-10" />
    </div>
  )
}

/** HAB-07: confirm the time to log. */
function FinishSheet({
  habit,
  open,
  onOpenChange,
  elapsed,
  stale,
  onSaved,
}: {
  habit: Habit
  open: boolean
  onOpenChange: (o: boolean) => void
  elapsed: number
  stale: boolean
  onSaved: () => void
}) {
  const [min, setMin] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: prefill once per open
  useEffect(() => {
    if (open) setMin(Math.max(1, Math.round(elapsed / 60)))
  }, [open])
  const status = habit.target && min < habit.target ? "partial" : "done"
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Log this session"
      description={
        stale
          ? `Timer ran ${fmtDuration(elapsed)} — did you forget it? Adjust before saving.`
          : `Measured ${fmtDuration(elapsed)}`
      }
    >
      <div className="space-y-4 pb-2">
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            aria-label="Less"
            onClick={() => setMin((m) => Math.max(1, m - 5))}
            className="grid size-12 place-items-center rounded-full bg-muted"
          >
            <Minus className="size-5" />
          </button>
          <div className="text-center">
            <NumberInput
              inputMode="numeric"
              value={min}
              onChange={(e) =>
                setMin(Number(e.target.value.replace(/\D/g, "")) || 0)
              }
              className={cn(
                "num w-28 bg-transparent text-center font-semibold text-5xl outline-none",
                stale && "text-warn",
              )}
              aria-label="Minutes"
            />
            <div className="text-muted-foreground text-xs">minutes</div>
          </div>
          <button
            type="button"
            aria-label="More"
            onClick={() => setMin((m) => m + 5)}
            className="grid size-12 place-items-center rounded-full bg-muted"
          >
            <Plus className="size-5" />
          </button>
        </div>
        <div
          className={cn(
            "rounded-xl px-3 py-2 text-center text-sm",
            status === "done"
              ? "bg-hab/15 text-hab"
              : "bg-muted text-muted-foreground",
          )}
        >
          Will log as <b>{status}</b>
          {habit.target ? ` (target ${habit.target} min)` : ""}
        </div>
        <Btn
          accent="hab"
          className="w-full"
          onClick={() => {
            const log = finishTimer(min)
            onOpenChange(false)
            if (log) toast.success(`Logged ${log.value} min of ${habit.name}`)
            onSaved()
          }}
        >
          Save log
        </Btn>
        <div className="grid grid-cols-2 gap-2">
          <Btn variant="secondary" onClick={() => onOpenChange(false)}>
            Resume
          </Btn>
          <Btn
            variant="danger"
            onClick={() => {
              discardTimer()
              onOpenChange(false)
              toast("Timer discarded")
            }}
          >
            Discard
          </Btn>
        </div>
      </div>
    </BottomSheet>
  )
}
