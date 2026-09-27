"use client"

import {
  Archive,
  ArrowDown,
  ArrowUp,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  X,
} from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  Btn,
  Chip,
  Empty,
  Row,
  Screen,
  SectionTitle,
  Segmented,
} from "../../ui/kit"
import {
  moveList,
  restoreTask,
  setListArchived,
  uncompleteTask,
} from "../actions"
import type { Task, TaskList } from "../data"
import { useListMap, useLists } from "../hooks"
import {
  addDays,
  byDue,
  doneDay,
  fmtDayLong,
  fmtTime,
  isOverdue,
  today,
} from "../logic"
import { ActionTaskRow } from "../rows"
import { ListEditSheet, TaskSheets } from "../sheets"
import { tasksStore } from "../store"
import {
  LIST_DOT,
  ListGlyph,
  LoadingRows,
  openTask,
  SyncError,
  useViewState,
} from "../ui"

// TSK-09 Search & filter · TSK-10 Completed & deleted · TSK-08 Manage lists.

type Status = "open" | "done" | "all"
type Sort = "due" | "created" | "manual"

export function SearchScreen() {
  const state = useViewState()
  const tasks = tasksStore.use((s) => s.tasks)
  const lists = useLists()
  const listMap = useListMap()
  const [q, setQ] = useState(state === "empty" ? "zzz" : "")
  const [listId, setListId] = useState<string | "any">("any")
  const [status, setStatus] = useState<Status>("open")
  const [starred, setStarred] = useState(false)
  const [overdue, setOverdue] = useState(false)
  const [hasDate, setHasDate] = useState(false)
  const [sort, setSort] = useState<Sort>("due")

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const tk = today()
    const r = tasks.filter(
      (t) =>
        t.status !== "deleted" &&
        (status === "all" || t.status === status) &&
        (listId === "any" ||
          (listId === "inbox" ? t.listId === null : t.listId === listId)) &&
        (!starred || t.starred) &&
        (!overdue || isOverdue(t, tk)) &&
        (!hasDate || !!t.dueDate) &&
        (!needle ||
          t.title.toLowerCase().includes(needle) ||
          (t.notes ?? "").toLowerCase().includes(needle)),
    )
    return r.sort(
      sort === "created"
        ? (a, b) => b.createdAt.localeCompare(a.createdAt)
        : sort === "manual"
          ? (a, b) => a.order - b.order
          : byDue,
    )
  }, [tasks, q, listId, status, starred, overdue, hasDate, sort])

  const filtered =
    listId !== "any" || status !== "open" || starred || overdue || hasDate

  return (
    <Screen back title="Search">
      <TaskSheets />
      <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-card px-3">
        <Search className="size-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search titles and notes"
          aria-label="Search tasks"
          className="h-12 flex-1 bg-transparent text-base outline-none"
        />
        {q && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQ("")}
          >
            <X className="size-4 text-muted-foreground" />
          </button>
        )}
      </div>
      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
        {(["open", "done", "all"] as const).map((s) => (
          <Chip
            key={s}
            accent="tsk"
            active={status === s}
            onClick={() => setStatus(s)}
          >
            {s === "open" ? "Open" : s === "done" ? "Done" : "All"}
          </Chip>
        ))}
        <Chip
          accent="tsk"
          active={starred}
          onClick={() => setStarred((x) => !x)}
        >
          Starred
        </Chip>
        <Chip
          accent="tsk"
          active={overdue}
          onClick={() => setOverdue((x) => !x)}
        >
          Overdue
        </Chip>
        <Chip
          accent="tsk"
          active={hasDate}
          onClick={() => setHasDate((x) => !x)}
        >
          Has date
        </Chip>
      </div>
      <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={listId === "any"} onClick={() => setListId("any")}>
          Any list
        </Chip>
        <Chip active={listId === "inbox"} onClick={() => setListId("inbox")}>
          Inbox
        </Chip>
        {lists.map((l) => (
          <Chip
            key={l.id}
            active={listId === l.id}
            onClick={() => setListId(l.id)}
          >
            <span className={cn("size-2 rounded-full", LIST_DOT[l.color])} />
            {l.name}
          </Chip>
        ))}
      </div>
      <div className="mt-3">
        <Segmented<Sort>
          value={sort}
          onChange={setSort}
          options={[
            { value: "due", label: "Due" },
            { value: "created", label: "Created" },
            { value: "manual", label: "Manual" },
          ]}
        />
      </div>
      {state === "error" && <SyncError />}
      {state === "loading" ? (
        <LoadingRows />
      ) : results.length === 0 ? (
        <Empty
          icon={<Search className="size-8" />}
          title="No matches"
          body={
            q
              ? `Nothing for “${q}”${status === "open" ? " in open tasks" : ""}.`
              : "Try fewer filters."
          }
          action={
            status === "open" ? (
              <Btn variant="secondary" onClick={() => setStatus("all")}>
                Include completed?
              </Btn>
            ) : filtered ? (
              <Btn
                variant="secondary"
                onClick={() => {
                  setListId("any")
                  setStarred(false)
                  setOverdue(false)
                  setHasDate(false)
                }}
              >
                Clear filters
              </Btn>
            ) : undefined
          }
        />
      ) : (
        <>
          <SectionTitle>
            {results.length} result{results.length === 1 ? "" : "s"}
          </SectionTitle>
          {results.slice(0, 60).map((t) => (
            <ActionTaskRow
              key={t.id}
              task={t}
              list={t.listId ? (listMap.get(t.listId) ?? null) : null}
            />
          ))}
          {results.length > 60 && (
            <p className="py-3 text-center text-muted-foreground text-xs">
              Showing 60 — narrow the search to see more.
            </p>
          )}
        </>
      )}
    </Screen>
  )
}

// ---------------------------------------------------------------- TSK-10

export function CompletedScreen() {
  const state = useViewState()
  const tasks = tasksStore.use((s) => s.tasks)
  const listMap = useListMap()
  const [tab, setTab] = useState<"done" | "deleted">("done")
  const [days, setDays] = useState(14)
  const tk = today()

  const groups = useMemo(() => {
    const from = addDays(tk, -(days - 1))
    const done = tasks.filter(
      (t) => t.status === "done" && (doneDay(t) ?? "") >= from,
    )
    const by = new Map<string, Task[]>()
    for (const t of done) {
      const k = doneDay(t) ?? ""
      by.set(k, [...(by.get(k) ?? []), t])
    }
    return [...by.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [tasks, days, tk])

  const deleted = useMemo(() => {
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString()
    return tasks
      .filter((t) => t.status === "deleted" && (t.deletedAt ?? "") >= cutoff)
      .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""))
  }, [tasks])

  const empty = state === "empty"
  return (
    <Screen back title="Completed">
      <TaskSheets />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "done", label: "Completed" },
          {
            value: "deleted",
            label: `Recently deleted${deleted.length ? ` · ${deleted.length}` : ""}`,
          },
        ]}
      />
      {state === "error" && <SyncError />}
      {state === "loading" ? (
        <LoadingRows />
      ) : tab === "done" ? (
        empty || groups.length === 0 ? (
          <Empty
            title="Nothing completed yet"
            body="Ticked tasks land here, grouped by day."
          />
        ) : (
          <>
            {groups.map(([day, ts]) => (
              <div key={day}>
                <SectionTitle>
                  {fmtDayLong(day, tk)} · {ts.length}
                </SectionTitle>
                {ts.map((t) => {
                  const list = t.listId ? (listMap.get(t.listId) ?? null) : null
                  return (
                    <div key={t.id} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <Row
                          onClick={() => openTask(t.id)}
                          icon={<ListGlyph list={list} size="sm" />}
                          title={
                            <span className="text-muted-foreground line-through decoration-muted-foreground/40">
                              {t.title}
                            </span>
                          }
                          subtitle={
                            t.completedAt
                              ? fmtTime(
                                  new Date(t.completedAt)
                                    .toTimeString()
                                    .slice(0, 5),
                                )
                              : undefined
                          }
                        />
                      </div>
                      <Btn
                        variant="secondary"
                        className="h-8 px-3 text-xs"
                        onClick={() => {
                          uncompleteTask(t.id)
                          toast("Reopened", { description: t.title })
                        }}
                      >
                        Reopen
                      </Btn>
                    </div>
                  )
                })}
              </div>
            ))}
            {days < 90 && (
              <Btn
                variant="secondary"
                className="mt-4 w-full"
                onClick={() => setDays((d) => Math.min(90, d + 30))}
              >
                Show older
              </Btn>
            )}
          </>
        )
      ) : empty || deleted.length === 0 ? (
        <Empty
          icon={<Archive className="size-8" />}
          title="Nothing deleted"
          body="Deleted tasks stay here for 30 days."
        />
      ) : (
        <>
          <p className="mt-3 px-1 text-muted-foreground text-xs">
            Kept for 30 days, then gone for good.
          </p>
          {deleted.map((t) => (
            <Row
              key={t.id}
              icon={
                <ListGlyph
                  list={t.listId ? (listMap.get(t.listId) ?? null) : null}
                  size="sm"
                />
              }
              title={t.title}
              subtitle={`Deleted ${t.deletedAt ? fmtDayLong(t.deletedAt.slice(0, 10), tk) : ""}`}
              right={
                <Btn
                  variant="secondary"
                  className="h-8 px-3"
                  onClick={() => {
                    restoreTask(t.id)
                    toast.success("Restored", { description: t.title })
                  }}
                >
                  <RotateCcw className="size-3.5" /> Restore
                </Btn>
              }
            />
          ))}
        </>
      )}
    </Screen>
  )
}

// ---------------------------------------------------------------- TSK-08

export function ManageListsScreen() {
  const state = useViewState()
  const all = useLists(true)
  const tasks = tasksStore.use((s) => s.tasks)
  const [editing, setEditing] = useState<TaskList | null | "new">(null)
  const active = all.filter((l) => !l.archivedAt)
  const archived = all.filter((l) => l.archivedAt)
  const count = (id: string) =>
    tasks.filter((t) => t.listId === id && t.status === "open").length

  return (
    <Screen
      back
      title="Lists"
      actions={
        <button
          type="button"
          aria-label="New list"
          onClick={() => setEditing("new")}
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <Plus className="size-5" />
        </button>
      }
    >
      {state === "error" && <SyncError />}
      {state === "loading" ? (
        <LoadingRows n={4} />
      ) : state === "empty" || active.length === 0 ? (
        <Empty
          title="No lists yet"
          body="Everything goes to Inbox until you make one. Buckets like Work, Life, Groceries help."
          action={
            <Btn accent="tsk" onClick={() => setEditing("new")}>
              New list
            </Btn>
          }
        />
      ) : (
        <>
          <p className="mb-2 px-1 text-muted-foreground text-xs">
            Order here is the order everywhere.
          </p>
          {active.map((l, i) => (
            <div key={l.id} className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <Row
                  icon={<ListGlyph list={l} />}
                  title={l.name}
                  subtitle={`${count(l.id)} open${l.kind === "shopping" ? " · shopping" : ""}`}
                  onClick={() => setEditing(l)}
                />
              </div>
              <button
                type="button"
                aria-label={`Move ${l.name} up`}
                disabled={i === 0}
                onClick={() => moveList(l.id, -1)}
                className="grid size-9 place-items-center rounded-full text-muted-foreground disabled:opacity-30"
              >
                <ArrowUp className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Move ${l.name} down`}
                disabled={i === active.length - 1}
                onClick={() => moveList(l.id, 1)}
                className="grid size-9 place-items-center rounded-full text-muted-foreground disabled:opacity-30"
              >
                <ArrowDown className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Edit ${l.name}`}
                onClick={() => setEditing(l)}
                className="grid size-9 place-items-center rounded-full text-muted-foreground"
              >
                <Pencil className="size-4" />
              </button>
            </div>
          ))}
          <Btn
            variant="secondary"
            className="mt-3 w-full"
            onClick={() => setEditing("new")}
          >
            <Plus className="size-4" /> New list
          </Btn>
        </>
      )}
      {archived.length > 0 && state !== "empty" && (
        <>
          <SectionTitle>Archived</SectionTitle>
          {archived.map((l) => (
            <Row
              key={l.id}
              icon={<ListGlyph list={l} />}
              title={<span className="text-muted-foreground">{l.name}</span>}
              subtitle={`${count(l.id)} open — hidden from Tasks`}
              right={
                <Btn
                  variant="secondary"
                  className="h-8 px-3"
                  onClick={() => setListArchived(l.id, false)}
                >
                  Unarchive
                </Btn>
              }
            />
          ))}
        </>
      )}
      <ListEditSheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        list={editing === "new" || editing === null ? null : editing}
      />
    </Screen>
  )
}
