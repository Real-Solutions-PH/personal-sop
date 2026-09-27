"use client"

import { ArrowDown, ArrowUp, Ellipsis, Star, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { moveTask, rescheduleBy, setDue, updateTask } from "./actions"
import type { Task, TaskList } from "./data"
import { addDays, fmtDay, today } from "./logic"
import { openPick, softDelete, TaskRow } from "./ui"

// Swipe-free row actions (IA F-TSK-09 as buttons): ⋯ reveals Today / Tomorrow /
// Next week / Pick / Star / Delete, plus ↑↓ when the list is in manual sort.

function push(t: Task, days: number) {
  const tk = today()
  const target = addDays(tk, days)
  const later = !!t.dueDate && target > t.dueDate
  if (days === 0) setDue(t.id, tk)
  else rescheduleBy(t.id, days)
  toast(`Moved to ${fmtDay(target)}`, {
    description: later ? `Rescheduled ${t.rescheduleCount + 1}×` : undefined,
  })
}

export function ActionTaskRow({
  task,
  list,
  showList,
  showDay,
  shopping,
  reorder,
}: {
  task: Task
  list?: TaskList | null
  showList?: boolean
  showDay?: boolean
  shopping?: boolean
  /** Visible id order — enables ↑↓ manual reorder. */
  reorder?: string[]
}) {
  const [open, setOpen] = useState(false)
  const tk = today()
  const btn =
    "flex h-9 flex-1 items-center justify-center gap-1 rounded-lg bg-muted px-2 font-medium text-xs active:opacity-70"
  return (
    <div className={cn("rounded-xl transition-colors", open && "bg-muted/40")}>
      <TaskRow
        task={task}
        list={list}
        showList={showList}
        showDay={showDay}
        shopping={shopping}
        actions={
          <div className="flex items-center">
            {reorder && (
              <div className="mr-1 flex flex-col">
                <button
                  type="button"
                  aria-label="Move up"
                  onClick={() => moveTask(task.id, -1, reorder)}
                  className="grid h-5 w-7 place-items-center text-muted-foreground"
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  onClick={() => moveTask(task.id, 1, reorder)}
                  className="grid h-5 w-7 place-items-center text-muted-foreground"
                >
                  <ArrowDown className="size-3.5" />
                </button>
              </div>
            )}
            <button
              type="button"
              aria-label={`Actions for ${task.title}`}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="grid size-9 place-items-center rounded-full text-muted-foreground active:bg-muted"
            >
              <Ellipsis className="size-4" />
            </button>
          </div>
        }
      />
      {open && (
        <div className="flex gap-1.5 px-1 pb-2">
          {!shopping && task.status === "open" && (
            <>
              {task.dueDate !== tk && (
                <button
                  type="button"
                  className={btn}
                  onClick={() => push(task, 0)}
                >
                  Today
                </button>
              )}
              <button
                type="button"
                className={btn}
                onClick={() => push(task, 1)}
              >
                Tmrw
              </button>
              <button
                type="button"
                className={btn}
                onClick={() => push(task, 7)}
              >
                +1 wk
              </button>
              <button
                type="button"
                className={btn}
                onClick={() => openPick(task.id)}
              >
                Pick
              </button>
            </>
          )}
          <button
            type="button"
            aria-label={task.starred ? "Unstar" : "Star"}
            className={cn(btn, "max-w-11")}
            onClick={() => updateTask(task.id, { starred: !task.starred })}
          >
            <Star
              className={cn("size-4", task.starred && "fill-warn text-warn")}
            />
          </button>
          <button
            type="button"
            aria-label="Delete"
            className={cn(btn, "max-w-11 bg-bad/10 text-bad")}
            onClick={() => softDelete(task)}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      )}
    </div>
  )
}
