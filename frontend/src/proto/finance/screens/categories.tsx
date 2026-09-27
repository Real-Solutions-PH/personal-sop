"use client"

import { Plus } from "lucide-react"
import Link from "next/link"
import { type KeyboardEvent, useMemo, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Card, Screen, Segmented } from "../../ui/kit"
import { moveItem, SortableList } from "../../ui/sortable"
import { moveSubCategory, updateCategory } from "../actions"
import type { Category } from "../data"
import { openSheet } from "../sheets"
import { useFin } from "../store"
import { undoToast } from "../ui"

/** One visual row of the list: a main category, a sub-category, or "+ Add". */
type Row =
  | { t: "main"; c: Category }
  | { t: "sub"; c: Category }
  | { t: "add"; c: Category }

export function CategoriesScreen() {
  const s = useFin()
  const [kind, setKind] = useState<"expense" | "income">("expense")
  const usage = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of s.records)
      if (r.categoryId) m.set(r.categoryId, (m.get(r.categoryId) ?? 0) + 1)
    return m
  }, [s])
  const live = s.categories.filter(
    (c) => c.kind === kind && !c.archived && !c.system,
  )
  const tops = live.filter((c) => !c.parentId)
  const subsOf = (id: string | undefined) =>
    live.filter((c) => c.parentId === id)
  const archived = s.categories.filter((c) => c.archived).length

  // Flattened in visual order; only sub rows get a drag grip.
  const rows: Row[] = tops.flatMap((t) => [
    { t: "main" as const, c: t },
    ...subsOf(t.id).map((c) => ({ t: "sub" as const, c })),
    { t: "add" as const, c: t },
  ])

  const move = (c: Category, parentId: string, beforeId?: string) => {
    const sibs = subsOf(c.parentId)
    const next = sibs[sibs.findIndex((x) => x.id === c.id) + 1]?.id
    if (parentId === c.parentId && beforeId === next) return
    const undo = moveSubCategory(c.id, parentId, beforeId)
    if (parentId !== c.parentId) {
      const to = tops.find((t) => t.id === parentId)
      undoToast(`Moved ${c.name} to ${to?.name}`, undo)
    }
  }

  const onReorder = (from: number, to: number) => {
    const r = rows[from]
    if (r.t !== "sub") return
    const next = moveItem(rows, from, to)
    let parent: Category | undefined
    for (let j = to - 1; j >= 0 && !parent; j--)
      if (next[j].t === "main") parent = next[j].c
    if (!parent) return // dropped above the first main category: cancel
    const after = next[to + 1]
    move(r.c, parent.id, after?.t === "sub" ? after.c.id : undefined)
  }

  // Arrow keys move one row; past the edge of a category it crosses into the
  // neighbouring one (re-parent).
  const onGripKey = (e: KeyboardEvent, c: Category) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
    e.preventDefault()
    e.stopPropagation()
    const pi = tops.findIndex((t) => t.id === c.parentId)
    const sibs = subsOf(c.parentId)
    const i = sibs.findIndex((x) => x.id === c.id)
    if (e.key === "ArrowUp") {
      if (i > 0) move(c, tops[pi].id, sibs[i - 1].id)
      else if (pi > 0) move(c, tops[pi - 1].id)
    } else if (i < sibs.length - 1) move(c, tops[pi].id, sibs[i + 2]?.id)
    else if (pi < tops.length - 1)
      move(c, tops[pi + 1].id, subsOf(tops[pi + 1].id)[0]?.id)
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(`[data-grip="${c.id}"] button`)
        ?.focus(),
    )
  }

  const main = (c: Category, first: boolean) => {
    const kids = subsOf(c.id)
    const count =
      (usage.get(c.id) ?? 0) +
      kids.reduce((x, k) => x + (usage.get(k.id) ?? 0), 0)
    return (
      <div
        className={cn(
          "flex items-center gap-3 px-3 py-2",
          !first && "border-border/50 border-t",
        )}
      >
        {body(c, count, kids.length)}
      </div>
    )
  }

  const body = (c: Category, count: number, kids = 0) => (
    <>
      <button
        type="button"
        onClick={() => openSheet({ kind: "category", id: c.id })}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-lg">
          {c.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{c.name}</span>
          <span className="text-muted-foreground text-xs">
            {count} transaction{count === 1 ? "" : "s"}
            {kids > 0 && ` · ${kids} sub-categor${kids === 1 ? "y" : "ies"}`}
          </span>
        </span>
      </button>
      {c.kind === "expense" && (
        <button
          type="button"
          onClick={() => {
            updateCategory(c.id, { discretionary: !c.discretionary })
            toast(
              `${c.name}: now a ${c.discretionary ? "need — won't break no-spend days" : "want"}`,
            )
          }}
          className={cn(
            "rounded-full px-2.5 py-1 font-medium text-[11px]",
            c.discretionary
              ? "bg-fin/15 text-fin"
              : "bg-muted text-muted-foreground",
          )}
        >
          {c.discretionary ? "want" : "need"}
        </button>
      )}
    </>
  )

  return (
    <Screen
      title="Categories"
      back
      actions={
        <button
          type="button"
          aria-label="Add category"
          onClick={() => openSheet({ kind: "category", catKind: kind })}
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <Plus className="size-5" />
        </button>
      }
    >
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: "expense", label: "Expense" },
          { value: "income", label: "Income" },
        ]}
      />
      <p className="mt-3 px-1 text-muted-foreground text-xs">
        {kind === "expense" &&
          "Wants break a no-spend day. Tap the tag to switch want/need. "}
        Drag a sub-category by its grip to move it under another category.
      </p>
      <Card className="mt-3 py-1">
        <SortableList
          items={rows}
          keyOf={(r) => `${r.t}-${r.c.id}`}
          labelOf={(r) => r.c.name}
          onReorder={onReorder}
          renderItem={(r, i, handle) => {
            if (r.t === "main") return main(r.c, i === 0)
            if (r.t === "add")
              return (
                <button
                  type="button"
                  onClick={() =>
                    openSheet({
                      kind: "category",
                      catKind: kind,
                      parentId: r.c.id,
                    })
                  }
                  aria-label={`Add sub-category to ${r.c.name}`}
                  className="flex h-11 w-full items-center gap-2 rounded-lg pr-3 pl-14 text-left text-muted-foreground text-sm hover:text-fin focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Plus className="size-4" aria-hidden />
                  Add sub-category
                </button>
              )
            return (
              <div className="flex items-center gap-1 py-1 pr-3 pl-2">
                <span
                  data-grip={r.c.id}
                  className="contents"
                  onKeyDownCapture={(e) => onGripKey(e, r.c)}
                >
                  {handle}
                </span>
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {body(r.c, usage.get(r.c.id) ?? 0)}
                </div>
              </div>
            )
          }}
        />
      </Card>
      {archived > 0 && (
        <Link
          href="/finance/archived"
          className="mt-4 block text-center text-muted-foreground text-sm"
        >
          Show {archived} archived
        </Link>
      )}
    </Screen>
  )
}
