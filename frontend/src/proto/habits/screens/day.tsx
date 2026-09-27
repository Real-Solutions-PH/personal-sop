"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { dayKey } from "../../lib/day"
import { Card, Chip, Empty, NumberInput, Screen } from "../../ui/kit"
import { clearLog, deleteLog, logHabit, restoreLog } from "../actions"
import type { Habit, LogStatus } from "../data"
import {
  addDays,
  cellFor,
  lk,
  logIndex,
  slotFor,
  sortedHabits,
  valueLabel,
} from "../logic"
import { habitsStore } from "../store"
import { fmtDay, Gate, StatusGlyph, toastUndo } from "../ui"

/** HAB-17 Day editor: fix or backfill a past day's logs. */
export function DayEditorScreen({ day }: { day: string }) {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day)
  return (
    <Screen
      title={
        valid
          ? fmtDay(day, { weekday: "long", month: "short", day: "numeric" })
          : "Day"
      }
      back
    >
      <Gate>
        {valid ? (
          <DayBody day={day} />
        ) : (
          <Empty
            title="Not a valid day"
            body="Pick a day from a habit's calendar."
          />
        )}
      </Gate>
    </Screen>
  )
}

function DayBody({ day }: { day: string }) {
  const state = habitsStore.use((s) => s)
  const [showAll, setShowAll] = useState(false)
  const today = dayKey()
  const future = day > today
  const rows = useMemo(() => {
    const idx = logIndex(state.logs)
    return sortedHabits(
      state.habits.filter((h) => h.status !== "archived" && day >= h.createdAt),
    )
      .map((h) => ({
        h,
        c: cellFor(h, day, idx, today),
        log: idx.get(lk(h.id, day)),
      }))
      .filter((r) => showAll || r.c !== "none")
  }, [state, day, today, showAll])
  const scheduled = rows.filter(
    (r) => r.c !== "none" && r.c !== "bonus" && r.c !== "paused",
  )
  const done = scheduled.filter((r) => r.c === "done").length

  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-center justify-between">
        <Link
          href={`/habits/day/${addDays(day, -1)}`}
          aria-label="Previous day"
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <div className="text-center">
          <div className="num font-semibold text-2xl">
            {done}/{scheduled.length}
          </div>
          <div className="text-muted-foreground text-xs">
            {day === today ? "today" : "done that day"}
          </div>
        </div>
        <Link
          href={`/habits/day/${addDays(day, 1)}`}
          aria-label="Next day"
          aria-disabled={day >= today}
          className={cn(
            "grid size-10 place-items-center rounded-full hover:bg-muted",
            day >= today && "pointer-events-none opacity-30",
          )}
        >
          <ChevronRight className="size-5" />
        </Link>
      </div>

      {future ? (
        <Empty
          title="That day hasn't happened yet"
          body="You can only log today or past days."
        />
      ) : (
        <>
          <Card className="divide-y divide-border/50 p-0">
            {rows.length === 0 && (
              <div className="p-6 text-center text-muted-foreground text-sm">
                Nothing scheduled — rest day.
              </div>
            )}
            {rows.map(({ h, c, log }) => (
              <DayRow
                key={h.id}
                habit={h}
                day={day}
                cell={c}
                value={log?.value}
              />
            ))}
          </Card>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="w-full py-2 text-center text-muted-foreground text-xs"
          >
            {showAll
              ? "Only scheduled habits"
              : "Show unscheduled habits too (log a bonus)"}
          </button>
        </>
      )}
    </div>
  )
}

function DayRow({
  habit,
  day,
  cell,
  value,
}: {
  habit: Habit
  day: string
  cell: ReturnType<typeof cellFor>
  value?: number
}) {
  const [v, setV] = useState(value !== undefined ? String(value) : "")
  const set = (status: LogStatus | "clear") => {
    const prev = habitsStore
      .get()
      .logs.find((l) => l.habitId === habit.id && l.day === day)
    if (status === "clear") {
      const old = clearLog(habit.id, day)
      if (old) toastUndo(`Cleared ${habit.name}`, () => restoreLog(old))
      return
    }
    const log = logHabit({
      habitId: habit.id,
      day,
      status,
      value:
        habit.type !== "check" && status !== "skipped"
          ? Number(v || habit.target || 1)
          : undefined,
    })
    if (log)
      toastUndo(`${habit.name} → ${status}`, () =>
        prev ? restoreLog(prev) : deleteLog(log.id),
      )
  }
  const slot = slotFor(habit.schedule, day)
  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center gap-2">
        <StatusGlyph cell={cell} />
        <span>{habit.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-sm">{habit.name}</div>
          <div className="text-muted-foreground text-xs">
            {cell === "none"
              ? "not scheduled"
              : cell === "bonus"
                ? "bonus (unscheduled)"
                : cell}
            {value !== undefined && ` · ${valueLabel(habit, value)}`}
            {slot?.time && ` · ${slot.time}`}
          </div>
        </div>
        {habit.type !== "check" && (
          <NumberInput
            inputMode="numeric"
            value={v}
            placeholder={String(habit.target ?? "")}
            onChange={(e) => setV(e.target.value.replace(/\D/g, ""))}
            onBlur={() => {
              if (
                v &&
                (cell === "done" || cell === "partial" || cell === "bonus")
              )
                logHabit({ habitId: habit.id, day, value: Number(v) })
            }}
            aria-label={`${habit.name} value`}
            className="num h-9 w-16 rounded-lg border border-border bg-transparent text-center text-sm outline-none focus:border-hab"
          />
        )}
      </div>
      {cell !== "paused" && (
        <div className="flex gap-1.5">
          <Chip
            accent="hab"
            active={cell === "done" || cell === "bonus"}
            onClick={() => set("done")}
            className="h-8 px-3 text-xs"
          >
            Done
          </Chip>
          <Chip
            accent="hab"
            active={cell === "partial"}
            onClick={() => set("partial")}
            className="h-8 px-3 text-xs"
          >
            Partial
          </Chip>
          <Chip
            accent="hab"
            active={cell === "skipped"}
            onClick={() => set("skipped")}
            className="h-8 px-3 text-xs"
          >
            Skip
          </Chip>
          <Chip
            accent="hab"
            active={cell === "missed" || cell === "pending"}
            onClick={() => set("clear")}
            className="h-8 px-3 text-xs"
          >
            {cell === "pending" ? "Not yet" : "Missed"}
          </Chip>
        </div>
      )}
    </div>
  )
}
