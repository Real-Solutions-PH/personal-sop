"use client"

import { GripVertical } from "lucide-react"
import { type ReactNode, useRef, useState } from "react"
import { cn } from "@/lib/utils"

// Drag-to-reorder list: pointer events (touch + mouse) on a grip handle, no
// dependency. Keyboard alternative: focus the handle, ArrowUp / ArrowDown.
// ponytail: fine for short lists (routine steps, exercises); no auto-scroll
// while dragging — add it if lists outgrow one screen.

interface Drag {
  from: number
  to: number
  startY: number
  dy: number
  mids: number[] // item vertical midpoints at drag start
  height: number // dragged item height
}

export function SortableList<T>({
  items,
  keyOf,
  labelOf,
  onReorder,
  renderItem,
  className,
}: {
  items: T[]
  keyOf: (item: T, i: number) => string
  /** Accessible name of the item, used in the handle's label. */
  labelOf: (item: T) => string
  onReorder: (from: number, to: number) => void
  renderItem: (item: T, i: number, handle: ReactNode) => ReactNode
  className?: string
}) {
  const refs = useRef<(HTMLDivElement | null)[]>([])
  const [drag, setDrag] = useState<Drag | null>(null)

  const targetFor = (d: Drag, dy: number) => {
    const center = d.mids[d.from] + dy
    let to = d.from
    for (let i = 0; i < d.mids.length; i++) {
      if (i < d.from && center < d.mids[i]) to = Math.min(to, i)
      if (i > d.from && center > d.mids[i]) to = i
    }
    return to
  }

  const shiftFor = (i: number) => {
    if (!drag || i === drag.from) return 0
    if (drag.from < drag.to && i > drag.from && i <= drag.to)
      return -drag.height
    if (drag.from > drag.to && i < drag.from && i >= drag.to) return drag.height
    return 0
  }

  return (
    <div className={className}>
      {items.map((item, i) => {
        const dragging = drag?.from === i
        const handle = (
          <button
            type="button"
            aria-label={`Reorder ${labelOf(item)} — drag, or use arrow keys`}
            className="grid size-11 shrink-0 cursor-grab touch-none place-items-center text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              const rects = refs.current.map((el) =>
                el ? el.getBoundingClientRect() : null,
              )
              const r = rects[i]
              if (!r) return
              setDrag({
                from: i,
                to: i,
                startY: e.clientY,
                dy: 0,
                mids: rects.map((x) => (x ? x.top + x.height / 2 : 0)),
                height: r.height,
              })
            }}
            onPointerMove={(e) => {
              if (!drag || drag.from !== i) return
              const dy = e.clientY - drag.startY
              setDrag({ ...drag, dy, to: targetFor(drag, dy) })
            }}
            onPointerUp={() => {
              if (drag && drag.from === i && drag.to !== drag.from)
                onReorder(drag.from, drag.to)
              setDrag(null)
            }}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" && i > 0) {
                e.preventDefault()
                onReorder(i, i - 1)
              }
              if (e.key === "ArrowDown" && i < items.length - 1) {
                e.preventDefault()
                onReorder(i, i + 1)
              }
            }}
          >
            <GripVertical className="size-5" aria-hidden="true" />
          </button>
        )
        return (
          <div
            key={keyOf(item, i)}
            ref={(el) => {
              refs.current[i] = el
            }}
            className={cn(
              "relative",
              dragging
                ? "z-10 rounded-xl bg-card shadow-lg ring-1 ring-border"
                : drag && "transition-transform duration-200",
            )}
            style={{
              transform: `translateY(${dragging ? drag.dy : shiftFor(i)}px)`,
            }}
          >
            {renderItem(item, i, handle)}
          </div>
        )
      })}
    </div>
  )
}

/** Move one element of an array (returns a new array). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list]
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}
