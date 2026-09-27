"use client"

import { ChevronRight, Pencil, Plus, Search, ShoppingCart } from "lucide-react"
import Link from "next/link"
import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Btn, Empty, Screen, SectionTitle, Segmented } from "../../ui/kit"
import { clearChecked, createTask, unclear } from "../actions"
import type { Task } from "../data"
import { useListMap } from "../hooks"
import { byDue, doneDay } from "../logic"
import { parseTask } from "../parse"
import { ActionTaskRow } from "../rows"
import { ListEditSheet, TaskSheets } from "../sheets"
import { tasksStore } from "../store"
import { ListGlyph, LoadingRows, SyncError, useViewState } from "../ui"

// TSK-02 List detail (incl. smart views Inbox / Starred and shopping mode).

type Sort = "due" | "created" | "manual"

export function ListScreen({ id }: { id: string }) {
  const state = useViewState()
  const tasks = tasksStore.use((s) => s.tasks)
  const listMap = useListMap()
  const list = listMap.get(id) ?? null
  const smart = id === "inbox" || id === "starred"
  const shopping = list?.kind === "shopping"
  const [sort, setSort] = useState<Sort>("due")
  const [showDone, setShowDone] = useState(false)
  const [edit, setEdit] = useState(false)
  const [text, setText] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const { open, done, cart } = useMemo(() => {
    const mine = tasks.filter((t) =>
      id === "inbox"
        ? t.listId === null
        : id === "starred"
          ? t.starred
          : t.listId === id,
    )
    const sorter =
      sort === "manual"
        ? (a: Task, b: Task) => a.order - b.order
        : sort === "created"
          ? (a: Task, b: Task) => b.createdAt.localeCompare(a.createdAt)
          : byDue
    const doneAll = mine
      .filter((t) => t.status === "done")
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    return {
      open: mine
        .filter((t) => t.status === "open")
        .sort(shopping ? (a, b) => a.order - b.order : sorter),
      done: doneAll.filter((t) => !shopping || t.clearedAt),
      cart: shopping ? doneAll.filter((t) => !t.clearedAt) : [],
    }
  }, [tasks, id, sort, shopping])

  if (!smart && !list)
    return (
      <Screen title="List" back="/tasks">
        <Empty
          title="List not found"
          body="It may have been deleted."
          action={<Btn href="/tasks">Back to tasks</Btn>}
        />
      </Screen>
    )

  const title =
    id === "inbox" ? "Inbox" : id === "starred" ? "Starred" : (list?.name ?? "")
  const add = () => {
    if (!text.trim()) return
    const p = parseTask(text)
    createTask(
      shopping
        ? { title: text.trim(), listId: id }
        : {
            title: p.title,
            listId: smart ? null : id,
            dueDate: p.dueDate,
            dueTime: p.dueTime,
            recurrence: p.recurrence,
            remind: !!p.dueTime,
            starred: id === "starred",
          },
    )
    setText("")
    inputRef.current?.focus()
  }
  const isEmpty = state === "empty" || (open.length === 0 && cart.length === 0)
  const ids = open.map((t) => t.id)

  return (
    <Screen
      back
      title={
        <span className="flex items-center gap-2">
          <ListGlyph
            list={
              id === "inbox" ? "inbox" : id === "starred" ? "starred" : list
            }
            size="sm"
          />
          {title}
          <span className="num font-normal text-muted-foreground text-sm">
            {state === "empty" ? 0 : open.length}
          </span>
        </span>
      }
      actions={
        <>
          <Link
            href="/tasks/search"
            aria-label="Search"
            className="grid size-10 place-items-center rounded-full hover:bg-muted"
          >
            <Search className="size-[18px]" />
          </Link>
          {list && (
            <button
              type="button"
              aria-label="Edit list"
              onClick={() => setEdit(true)}
              className="grid size-10 place-items-center rounded-full hover:bg-muted"
            >
              <Pencil className="size-[18px]" />
            </button>
          )}
        </>
      }
    >
      <TaskSheets />
      {state === "error" && <SyncError />}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
        className="mt-1 flex items-center gap-2 rounded-2xl border border-border/60 bg-card px-3"
      >
        <Plus className="size-4 text-tsk" />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={shopping ? "Add item" : `Add to ${title}`}
          aria-label={shopping ? "Add item" : "Add task"}
          enterKeyHint="done"
          className="h-12 flex-1 bg-transparent text-base outline-none"
        />
        {text && (
          <button type="submit" className="font-semibold text-sm text-tsk">
            Add
          </button>
        )}
      </form>

      {!shopping && !isEmpty && (
        <div className="mt-3">
          <Segmented<Sort>
            value={sort}
            onChange={setSort}
            options={[
              { value: "due", label: "By due" },
              { value: "created", label: "Newest" },
              { value: "manual", label: "Manual" },
            ]}
          />
        </div>
      )}

      {state === "loading" ? (
        <LoadingRows />
      ) : isEmpty ? (
        <Empty
          icon={shopping ? <ShoppingCart className="size-8" /> : undefined}
          title="Nothing here"
          body={
            shopping
              ? "Add what you need — tick items off in the store."
              : "Tap the field above to add the first one."
          }
          action={
            <Btn variant="secondary" onClick={() => inputRef.current?.focus()}>
              Add {shopping ? "an item" : "a task"}
            </Btn>
          }
        />
      ) : (
        <div className="mt-2">
          {open.map((t) => (
            <ActionTaskRow
              key={t.id}
              task={t}
              list={
                smart
                  ? t.listId
                    ? (listMap.get(t.listId) ?? null)
                    : null
                  : undefined
              }
              shopping={shopping}
              reorder={sort === "manual" && !shopping ? ids : undefined}
            />
          ))}
          {open.length === 0 && shopping && (
            <p className="px-1 py-4 text-center text-muted-foreground text-sm">
              Everything's in the cart 🛒
            </p>
          )}
        </div>
      )}

      {shopping && cart.length > 0 && state !== "empty" && (
        <>
          <SectionTitle
            action={
              <button
                type="button"
                className="font-medium text-tsk text-xs"
                onClick={() => {
                  const cleared = clearChecked(id)
                  toast(`Cleared ${cleared.length} items`, {
                    description: "Kept in your stats.",
                    action: { label: "Undo", onClick: () => unclear(cleared) },
                  })
                }}
              >
                Clear checked
              </button>
            }
          >
            In cart · {cart.length}
          </SectionTitle>
          {cart.map((t) => (
            <ActionTaskRow key={t.id} task={t} shopping />
          ))}
        </>
      )}

      {done.length > 0 && state !== "empty" && (
        <>
          <button
            type="button"
            onClick={() => setShowDone((s) => !s)}
            className="mt-6 flex w-full items-center gap-1 px-1 font-medium text-muted-foreground text-xs uppercase tracking-wider"
          >
            <ChevronRight
              className={cn(
                "size-4 transition-transform",
                showDone && "rotate-90",
              )}
            />
            Completed · {done.length}
          </button>
          {showDone &&
            done.slice(0, 30).map((t) => (
              <div key={t.id} className="flex items-center">
                <div className="min-w-0 flex-1">
                  <ActionTaskRow
                    task={t}
                    shopping={shopping}
                    showList={false}
                  />
                </div>
                <span className="w-14 text-right text-[11px] text-muted-foreground">
                  {doneDay(t)?.slice(5)}
                </span>
              </div>
            ))}
        </>
      )}

      <ListEditSheet open={edit} onClose={() => setEdit(false)} list={list} />
    </Screen>
  )
}
