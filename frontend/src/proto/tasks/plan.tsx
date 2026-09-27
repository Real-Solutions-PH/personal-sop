"use client"

import {
  BarChart3,
  Check,
  ChevronRight,
  Flame,
  History,
  ListChecks,
  Mic,
  Plus,
  Search,
  Settings2,
  Sparkles,
  TriangleAlert,
} from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { openCapture } from "../lib/capture"
import { Btn, Card, Empty, Ring, Row, SectionTitle, Segmented } from "../ui/kit"
import type { Task } from "./data"
import { useListMap, useLists, useStats, useTodayData } from "./hooks"
import { fmtDayLong, today } from "./logic"
import { ActionTaskRow } from "./rows"
import { TaskSheets } from "./sheets"
import { tasksStore } from "./store"
import {
  EmptyAllClear,
  ListGlyph,
  LoadingRows,
  openQuickAdd,
  openTriage,
  SyncError,
  useViewState,
  type ViewState,
} from "./ui"

// TSK-01 Tasks home — exported for the Plan tab's "Tasks" segment and /tasks.

type View = "today" | "upcoming" | "overdue" | "lists"

export function TasksPlanView({ state: forced }: { state?: ViewState } = {}) {
  const url = useViewState()
  const state = forced ?? url
  const [view, setView] = useState<View>("today")
  const d = useTodayData()
  const stats = useStats(7)
  const lists = useLists()
  const listMap = useListMap()
  const tasks = tasksStore.use((s) => s.tasks)
  const listOf = (t: Task) =>
    t.listId ? (listMap.get(t.listId) ?? null) : null
  const [showDone, setShowDone] = useState(false)

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of tasks)
      if (t.status === "open" && t.listId)
        m.set(t.listId, (m.get(t.listId) ?? 0) + 1)
    return m
  }, [tasks])

  const dueCount = d.due.length + d.doneDueToday.length + d.overdue.length
  const empty = state === "empty" || !d.everHadTasks

  return (
    <div>
      <TaskSheets />
      {/* summary strip */}
      <div className="flex items-center gap-3">
        <Ring
          value={dueCount ? d.doneDueToday.length / dueCount : 1}
          size={52}
          stroke={5}
          accent="tsk"
        >
          <span className="num font-semibold text-xs">
            {empty ? 0 : d.doneDueToday.length}/{empty ? 0 : dueCount}
          </span>
        </Ring>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">
            {empty
              ? "No tasks yet"
              : d.due.length
                ? `${d.due.length} left today`
                : "Today's clear"}
          </div>
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            {!empty && d.overdue.length > 0 && (
              <button
                type="button"
                onClick={openTriage}
                className="font-medium text-warn"
              >
                {d.overdue.length} overdue
              </button>
            )}
            <span className="inline-flex items-center gap-1">
              <Flame aria-hidden="true" className="size-3.5 text-warn" />
              {empty ? 0 : stats.streak}-day streak
            </span>
          </div>
        </div>
        <div className="flex">
          <IconLink href="/tasks/search" label="Search">
            <Search className="size-[18px]" />
          </IconLink>
          <IconLink href="/tasks/stats" label="Task stats">
            <BarChart3 className="size-[18px]" />
          </IconLink>
          <button
            type="button"
            aria-label="Add task"
            onClick={() =>
              openQuickAdd({ dueDate: view === "today" ? today() : null })
            }
            className="ml-1 grid size-10 place-items-center rounded-full bg-tsk text-background shadow-md shadow-tsk/30 active:scale-95"
          >
            <Plus className="size-5" />
          </button>
        </div>
      </div>

      <div className="mt-4">
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: "today", label: "Today" },
            { value: "upcoming", label: "Upcoming" },
            {
              value: "overdue",
              label: (
                <span className="inline-flex items-center gap-1">
                  Overdue
                  {!empty && d.overdue.length > 0 && (
                    <span className="num rounded-full bg-warn/20 px-1.5 text-[10px] text-warn">
                      {d.overdue.length}
                    </span>
                  )}
                </span>
              ),
            },
            { value: "lists", label: "Lists" },
          ]}
        />
      </div>

      {state === "error" && <SyncError />}

      {state === "loading" ? (
        <LoadingRows n={6} />
      ) : empty ? (
        <Empty
          icon={<Sparkles className="size-8 text-tsk" />}
          title="Dump everything on your mind"
          body="One line per thought. Dates and lists get sorted for you."
          action={
            <div className="flex flex-col items-center gap-2">
              <Btn
                accent="tsk"
                onClick={() =>
                  openCapture({
                    mode: "text",
                    hint: "buy eggs, call Mark tomorrow 3pm",
                  })
                }
              >
                Try: “buy eggs, call Mark tomorrow 3pm”
              </Btn>
              <div className="flex gap-2">
                <Btn
                  variant="ghost"
                  onClick={() => openCapture({ mode: "voice", hint: "tasks" })}
                >
                  <Mic className="size-4" /> Say it
                </Btn>
                <Btn variant="ghost" onClick={() => openQuickAdd()}>
                  <Plus className="size-4" /> Type one
                </Btn>
              </div>
            </div>
          }
        />
      ) : view === "today" ? (
        <div className="mt-2">
          {d.overdue.length > 0 && (
            <>
              <SectionTitle
                action={
                  <button
                    type="button"
                    onClick={openTriage}
                    className="font-medium text-warn text-xs"
                  >
                    Triage
                  </button>
                }
              >
                <span className="text-warn">Overdue · {d.overdue.length}</span>
              </SectionTitle>
              {d.overdue.slice(0, 3).map((t) => (
                <ActionTaskRow key={t.id} task={t} list={listOf(t)} />
              ))}
              {d.overdue.length > 3 && (
                <button
                  type="button"
                  onClick={() => setView("overdue")}
                  className="px-1 py-2 text-muted-foreground text-sm"
                >
                  +{d.overdue.length - 3} more overdue
                </button>
              )}
            </>
          )}
          <SectionTitle>Due today · {d.due.length}</SectionTitle>
          {d.due.length === 0 ? (
            <EmptyAllClear doneToday={d.doneToday.length} />
          ) : (
            d.due.map((t) => (
              <ActionTaskRow
                key={t.id}
                task={t}
                list={listOf(t)}
                showDay={false}
              />
            ))
          )}
          {d.doneToday.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowDone((s) => !s)}
                className="mt-4 flex w-full items-center gap-1 px-1 font-medium text-muted-foreground text-xs uppercase tracking-wider"
              >
                <ChevronRight
                  className={cn(
                    "size-4 transition-transform",
                    showDone && "rotate-90",
                  )}
                />
                Done today · {d.doneToday.length}
              </button>
              {showDone &&
                d.doneToday.map((t) => (
                  <ActionTaskRow
                    key={t.id}
                    task={t}
                    list={listOf(t)}
                    showDay={false}
                  />
                ))}
            </>
          )}
        </div>
      ) : view === "upcoming" ? (
        <div className="mt-2">
          {d.upcoming.map((g) => (
            <div key={g.day}>
              <SectionTitle
                action={
                  <button
                    type="button"
                    aria-label={`Add task on ${fmtDayLong(g.day)}`}
                    onClick={() => openQuickAdd({ dueDate: g.day })}
                    className="grid size-6 place-items-center rounded-full text-muted-foreground active:bg-muted"
                  >
                    <Plus className="size-4" />
                  </button>
                }
              >
                {fmtDayLong(g.day)}
              </SectionTitle>
              {g.tasks.length === 0 ? (
                <div className="px-1 pb-1 text-muted-foreground/60 text-sm">
                  Nothing planned
                </div>
              ) : (
                g.tasks.map((t) => (
                  <ActionTaskRow
                    key={t.id}
                    task={t}
                    list={listOf(t)}
                    showDay={false}
                  />
                ))
              )}
            </div>
          ))}
          {d.later.length > 0 && (
            <>
              <SectionTitle>Later · {d.later.length}</SectionTitle>
              {d.later.map((t) => (
                <ActionTaskRow key={t.id} task={t} list={listOf(t)} />
              ))}
            </>
          )}
        </div>
      ) : view === "overdue" ? (
        <div className="mt-2">
          {d.overdue.length === 0 ? (
            <Empty
              icon={<Check className="size-8 text-good" />}
              title="Nothing overdue"
              body="Past-due tasks show up here — honestly, never hidden."
            />
          ) : (
            <>
              <Card className="mt-3 flex items-center gap-3 border-warn/30 bg-warn/5">
                <TriangleAlert className="size-5 shrink-0 text-warn" />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium">{d.overdue.length} slipped</div>
                  <div className="text-muted-foreground text-xs">
                    {stats.reschedules} reschedules this week
                  </div>
                </div>
                <Btn accent="tsk" className="h-9" onClick={openTriage}>
                  Triage
                </Btn>
              </Card>
              <div className="mt-2">
                {d.overdue.map((t) => (
                  <ActionTaskRow key={t.id} task={t} list={listOf(t)} />
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="mt-2">
          <SectionTitle>Smart views</SectionTitle>
          <Row
            icon={<ListGlyph list="inbox" />}
            title="Inbox"
            subtitle="No list yet"
            right={<Count n={d.inbox.length} />}
            href="/tasks/list/inbox"
          />
          <Row
            icon={<ListGlyph list="starred" />}
            title="Starred"
            right={<Count n={d.starred.length} />}
            href="/tasks/list/starred"
          />
          <SectionTitle
            action={
              <Link
                href="/tasks/lists"
                className="font-medium text-tsk text-xs"
              >
                Edit lists
              </Link>
            }
          >
            Lists
          </SectionTitle>
          {lists.map((l) => (
            <Row
              key={l.id}
              icon={<ListGlyph list={l} />}
              title={l.name}
              subtitle={l.kind === "shopping" ? "Shopping list" : undefined}
              right={<Count n={counts.get(l.id) ?? 0} />}
              href={`/tasks/list/${l.id}`}
            />
          ))}
          <SectionTitle>More</SectionTitle>
          <Row
            icon={
              <Icon>
                <Search className="size-4" />
              </Icon>
            }
            title="Search & filter"
            href="/tasks/search"
            right={<ChevronRight className="size-4 text-muted-foreground" />}
          />
          <Row
            icon={
              <Icon>
                <History className="size-4" />
              </Icon>
            }
            title="Completed & deleted"
            href="/tasks/completed"
            right={<ChevronRight className="size-4 text-muted-foreground" />}
          />
          <Row
            icon={
              <Icon>
                <ListChecks className="size-4" />
              </Icon>
            }
            title="Task stats"
            href="/tasks/stats"
            right={<ChevronRight className="size-4 text-muted-foreground" />}
          />
          <Row
            icon={
              <Icon>
                <Settings2 className="size-4" />
              </Icon>
            }
            title="Tasks settings"
            href="/tasks/settings"
            right={<ChevronRight className="size-4 text-muted-foreground" />}
          />
        </div>
      )}
    </div>
  )
}

function Count({ n }: { n: number }) {
  return <span className="num text-muted-foreground text-sm">{n || ""}</span>
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid size-9 place-items-center rounded-xl bg-muted text-muted-foreground">
      {children}
    </div>
  )
}

function IconLink({
  href,
  label,
  children,
}: {
  href: string
  label: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-muted"
    >
      {children}
    </Link>
  )
}
