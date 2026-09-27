"use client"

import {
  AlarmClock,
  ChevronRight,
  Flame,
  Plus,
  ShoppingCart,
  Sparkles,
  TriangleAlert,
} from "lucide-react"
import Link from "next/link"
import { openCapture } from "../lib/capture"
import { Btn, Card } from "../ui/kit"
import { useListMap, useStats, useTodayData } from "./hooks"
import { fmtInstant, isDueNow, today } from "./logic"
import { TaskSheets } from "./sheets"
import { tasksStore } from "./store"
import { EmptyAllClear, openQuickAdd, openTriage, TaskRow } from "./ui"

// TSK-16 Today card: overdue badge → ≤5 due today (inline tick) → +n more →
// groceries chip → next ping → "All clear".

export function TasksTodayCard() {
  const d = useTodayData()
  const stats = useStats(7)
  const listMap = useListMap()
  const lists = tasksStore.use((s) => s.lists)
  const grocery = lists.find((l) => l.kind === "shopping" && !l.archivedAt)
  const shown = d.due.slice(0, 5)
  const dueNow = d.due.filter((t) => isDueNow(t)).length

  if (!d.everHadTasks)
    return (
      <Card>
        <div className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-4 text-tsk" /> Tasks
        </div>
        <p className="mt-1 text-muted-foreground text-sm">
          Dump what's on your mind — dates and lists get sorted for you.
        </p>
        <Btn
          accent="tsk"
          className="mt-3 w-full"
          onClick={() =>
            openCapture({
              mode: "text",
              hint: "buy eggs, call Mark tomorrow 3pm",
            })
          }
        >
          Try: “buy eggs, call Mark tomorrow 3pm”
        </Btn>
      </Card>
    )

  return (
    <Card className="px-3 pb-2">
      <TaskSheets />
      <div className="flex items-center gap-2 px-1">
        <Link href="/tasks" className="flex min-w-0 flex-1 items-center gap-2">
          <span className="font-semibold">Tasks</span>
          <span className="num text-muted-foreground text-sm">
            {d.doneDueToday.length}/
            {d.due.length + d.doneDueToday.length + d.overdue.length}
          </span>
          {stats.streak > 1 && (
            <span className="inline-flex items-center gap-0.5 text-muted-foreground text-xs">
              <Flame aria-hidden="true" className="size-3.5 text-warn" />
              {stats.streak}-day streak
            </span>
          )}
          {dueNow > 0 && (
            <span className="rounded-full bg-tsk/15 px-2 py-0.5 font-medium text-[11px] text-tsk">
              {dueNow} due now
            </span>
          )}
        </Link>
        <button
          type="button"
          aria-label="Add task"
          onClick={() => openQuickAdd({ dueDate: today() })}
          className="grid size-8 place-items-center rounded-full bg-tsk/15 text-tsk active:scale-95"
        >
          <Plus className="size-4" />
        </button>
      </div>

      {d.overdue.length > 0 && (
        <button
          type="button"
          onClick={openTriage}
          className="mt-2 flex w-full items-center gap-2 rounded-xl bg-warn/10 px-3 py-2 text-left text-sm text-warn"
        >
          <TriangleAlert className="size-4" />
          <span className="flex-1 font-medium">{d.overdue.length} overdue</span>
          <span className="text-xs">Triage</span>
          <ChevronRight className="size-4" />
        </button>
      )}

      {shown.length === 0 ? (
        <div className="-my-6">
          <EmptyAllClear doneToday={d.doneToday.length} />
        </div>
      ) : (
        <div className="mt-1">
          {shown.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              list={t.listId ? (listMap.get(t.listId) ?? null) : null}
              showDay={false}
            />
          ))}
        </div>
      )}
      {d.due.length > 5 && (
        <Link
          href="/tasks"
          className="block px-1 py-1 text-muted-foreground text-sm"
        >
          +{d.due.length - 5} more
        </Link>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-2 border-border/50 border-t px-1 pt-2 text-muted-foreground text-xs">
        {grocery && d.shoppingOpen > 0 && (
          <Link
            href={`/tasks/list/${grocery.id}`}
            className="inline-flex items-center gap-1 rounded-full bg-fit/15 px-2.5 py-1 font-medium text-fit"
          >
            <ShoppingCart className="size-3.5" />
            {grocery.name} · {d.shoppingOpen}
          </Link>
        )}
        {d.nextReminder?.remindAt && (
          <span className="inline-flex items-center gap-1">
            <AlarmClock className="size-3.5" /> Next ping{" "}
            {fmtInstant(d.nextReminder.remindAt)}
          </span>
        )}
        <Link
          href="/tasks"
          className="ml-auto inline-flex items-center font-medium text-tsk"
        >
          See all <ChevronRight className="size-3.5" />
        </Link>
      </div>
    </Card>
  )
}
