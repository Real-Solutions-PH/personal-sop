"use client"

import { AlarmClock, Check, Undo2, X } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { removeTasks, setDue, updateTask } from "./actions"
import type { Task } from "./data"
import { useListMap } from "./hooks"
import { fmtDay, fmtTime, isoAt } from "./logic"
import { tasksStore } from "./store"
import { LIST_DOT, openTask } from "./ui"

// TSK-14 Capture result card — rendered by M5 Capture after captureTasks().
// "Saved · Undo": rows are already stored; tap a row to fix, × removes one.

export function CaptureResultCard({
  taskIds,
  followUp,
}: {
  taskIds: string[]
  /** Task id to ask a single "remind at?" follow-up for (implied-but-vague time). */
  followUp?: string
}) {
  const all = tasksStore.use((s) => s.tasks)
  const listMap = useListMap()
  const [expanded, setExpanded] = useState(false)
  const [undone, setUndone] = useState(false)
  const [asked, setAsked] = useState(false)
  const rows = taskIds
    .map((id) => all.find((t) => t.id === id))
    .filter(Boolean) as Task[]
  const shown = expanded ? rows : rows.slice(0, 5)
  const ask = followUp ? rows.find((t) => t.id === followUp) : undefined

  if (undone)
    return (
      <div className="rounded-2xl border border-border/60 bg-card px-4 py-3 text-muted-foreground text-sm">
        Undone — nothing was saved.
      </div>
    )
  if (!rows.length)
    return (
      <div className="rounded-2xl border border-border/60 bg-card px-4 py-3 text-muted-foreground text-sm">
        All rows removed.
      </div>
    )

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
      <div className="flex items-center gap-2 border-border/50 border-b px-4 py-2.5 text-sm">
        <Check className="size-4 text-good" />
        <span className="flex-1 font-medium">
          Saved {rows.length} task{rows.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => {
            removeTasks(rows.map((r) => r.id))
            setUndone(true)
          }}
          className="inline-flex items-center gap-1 font-medium text-tsk"
        >
          <Undo2 className="size-3.5" /> Undo all
        </button>
      </div>
      {shown.map((t) => {
        const list = t.listId ? listMap.get(t.listId) : undefined
        return (
          <div
            key={t.id}
            className="flex items-center gap-2 border-border/30 border-b px-4 last:border-b-0"
          >
            <button
              type="button"
              onClick={() => openTask(t.id)}
              className="min-w-0 flex-1 py-2.5 text-left"
            >
              <div className="truncate font-medium text-sm">{t.title}</div>
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <span className="inline-flex items-center gap-1">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      list ? LIST_DOT[list.color] : "bg-muted-foreground",
                    )}
                  />
                  {list?.name ?? "Inbox"}
                </span>
                {t.dueDate && (
                  <span>
                    {fmtDay(t.dueDate)}
                    {t.dueTime ? ` ${fmtTime(t.dueTime)}` : ""}
                  </span>
                )}
                {t.remindAt && (
                  <AlarmClock className="size-3" aria-label="Reminder" />
                )}
              </div>
            </button>
            <button
              type="button"
              aria-label={`Remove ${t.title}`}
              onClick={() => removeTasks([t.id])}
              className="grid size-8 place-items-center text-muted-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        )
      })}
      {rows.length > 5 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full px-4 py-2 text-left text-muted-foreground text-sm"
        >
          +{rows.length - 5} more
        </button>
      )}
      {ask && !asked && (
        <div className="border-border/50 border-t px-4 py-3">
          <div className="text-sm">Remind you about “{ask.title}” at 1pm?</div>
          <div className="mt-2 flex gap-2">
            {["13:00", "14:00"].map((tm) => (
              <button
                key={tm}
                type="button"
                onClick={() => {
                  const day =
                    ask.dueDate ??
                    tasksStore.get().tasks.find((x) => x.id === ask.id)?.dueDate
                  if (day) {
                    setDue(ask.id, day, tm)
                    updateTask(ask.id, { remindAt: isoAt(day, tm) })
                  }
                  setAsked(true)
                }}
                className="h-8 rounded-full bg-tsk/15 px-3 font-medium text-sm text-tsk"
              >
                {fmtTime(tm)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAsked(true)}
              className="h-8 rounded-full bg-muted px-3 text-sm"
            >
              No reminder
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
