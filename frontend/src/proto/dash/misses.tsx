"use client"

import { ArrowRight, ChevronRight, ShieldCheck, StickyNote } from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { Miss, ModuleKey } from "../contract"
import { dayKey, dayOffset } from "../lib/day"
import { rescheduleBy } from "../tasks/actions"
import { Btn, Card, Chip, Empty, Screen, SectionTitle } from "../ui/kit"
import { AREA } from "./data"
import {
  daysOf,
  RANGES,
  type RangeKey,
  useAllMisses,
  useEnabledKeys,
} from "./hooks"
import { dashStore, noteMiss } from "./store"
import {
  BottomSheet,
  Delta,
  ErrorCard,
  fmtDay,
  Loading,
  ModuleDot,
  RangeSwitch,
  useQueryParam,
  useViewState,
} from "./ui"

// DSH-13 Misses & leaks — honest, never hidden, never shaming (OQ-DSH-13):
// an annotated miss leaves the count but stays in the list.

const QUICK_NOTES = [
  "Sick",
  "Rest day",
  "Travel",
  "Work ran late",
  "Chose not to",
]

export function MissesScreen() {
  const state = useViewState()
  const rParam = useQueryParam("range")
  const [range, setRange] = useState<RangeKey>("7d")
  useEffect(() => {
    const hit = RANGES.find(
      (x) => x.value === rParam || String(x.days) === rParam,
    )
    if (hit) setRange(hit.value)
  }, [rParam])
  const days = daysOf(range)
  const t = dayKey()
  const cur = useAllMisses(dayOffset(-(days - 1)), t)
  const prev = useAllMisses(dayOffset(-(days * 2 - 1)), dayOffset(-days))
  const notes = dashStore.use((s) => s.missNotes)
  const keys = useEnabledKeys()
  const [filter, setFilter] = useState<ModuleKey | "all">("all")
  const [noting, setNoting] = useState<Miss | null>(null)

  const counted = (l: Miss[], k?: ModuleKey) =>
    l.filter((m) => (!k || m.module === k) && !notes[m.id]).length
  const grouped = useMemo(() => {
    const g = new Map<ModuleKey, Miss[]>()
    for (const m of cur)
      if (filter === "all" || m.module === filter)
        g.set(m.module, [...(g.get(m.module) ?? []), m])
    return keys.filter((k) => g.has(k)).map((k) => [k, g.get(k) ?? []] as const)
  }, [cur, filter, keys])
  const list = state === "empty" ? [] : grouped

  return (
    <Screen title="Misses & leaks" back>
      <RangeSwitch value={range} onChange={setRange} />
      {state === "loading" ? (
        <Loading rows={3} />
      ) : state === "error" ? (
        <div className="mt-3">
          <ErrorCard what="misses" />
        </div>
      ) : (
        <>
          <Card className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="font-display num font-bold text-4xl">
                {state === "empty" ? 0 : counted(cur)}
              </span>
              <span className="text-muted-foreground text-sm">
                misses · last {days}d
              </span>
              <span className="ml-auto flex items-center gap-1 text-xs">
                <Delta value={counted(cur) - counted(prev)} goodWhen="down" />
                <span className="text-muted-foreground">vs prior</span>
              </span>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {keys.map((k) => {
                const c = counted(cur, k)
                const p = counted(prev, k)
                return (
                  <div
                    key={k}
                    className="rounded-xl bg-muted/50 p-2 text-center"
                  >
                    <div className="num font-semibold text-lg">{c}</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {AREA[k].label}
                    </div>
                    <Delta
                      value={c - p}
                      goodWhen="down"
                      className="text-[10px]"
                    />
                  </div>
                )
              })}
            </div>
            <p className="mt-3 text-muted-foreground text-xs">
              Noted misses drop out of the count but stay listed. They still
              count against on-target rate.
            </p>
          </Card>

          <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
            <Chip
              active={filter === "all"}
              onClick={() => setFilter("all")}
              className="h-11 text-xs"
            >
              All
            </Chip>
            {keys.map((k) => (
              <Chip
                key={k}
                active={filter === k}
                accent={AREA[k].accent}
                onClick={() => setFilter(k)}
                className="h-11 text-xs"
              >
                {AREA[k].label}
              </Chip>
            ))}
          </div>

          {list.length === 0 ? (
            <Empty
              icon={<ShieldCheck className="size-8 text-good" />}
              title="No misses in this range"
              body="Nothing slipped. Enjoy it — then raise a target."
              action={<Btn href="/stats/goals">Raise a goal</Btn>}
            />
          ) : (
            list.map(([k, ms]) => (
              <div key={k}>
                <SectionTitle>
                  {AREA[k].label} · {ms.length}
                </SectionTitle>
                <Card className="px-3 py-1">
                  {ms.map((m) => {
                    const taskId = m.id.startsWith("task-overdue:")
                      ? m.id.slice("task-overdue:".length)
                      : null
                    return (
                      <div
                        key={m.id}
                        className="border-border/50 border-b py-2.5 last:border-0"
                      >
                        <div className="flex items-start gap-2">
                          <ModuleDot module={m.module} className="mt-1.5" />
                          <div className="min-w-0 flex-1">
                            <div
                              className={cn(
                                "text-sm",
                                notes[m.id] && "text-muted-foreground",
                              )}
                            >
                              {m.title}
                            </div>
                            <div className="text-muted-foreground text-xs">
                              {fmtDay(m.day, {
                                weekday: "short",
                                month: "short",
                                day: "numeric",
                              })}
                              {notes[m.id] && (
                                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                                  <StickyNote className="mr-0.5 inline size-3" />
                                  {notes[m.id]}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="mt-1.5 flex gap-1.5 pl-4">
                          {taskId && (
                            <button
                              type="button"
                              onClick={() => {
                                rescheduleBy(taskId, 0)
                                toast.success("Moved to today")
                              }}
                              className="inline-flex h-11 items-center gap-1 rounded-full bg-tsk/15 px-2.5 font-medium text-tsk text-xs"
                            >
                              <ArrowRight className="size-3" /> Today
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setNoting(m)}
                            className="inline-flex h-11 items-center gap-1 rounded-full bg-muted px-2.5 font-medium text-xs"
                          >
                            <StickyNote className="size-3" />
                            {notes[m.id] ? "Edit note" : "Note"}
                          </button>
                          <Link
                            href={m.href}
                            className="inline-flex h-11 items-center gap-0.5 rounded-full bg-muted px-2.5 font-medium text-xs"
                          >
                            Open <ChevronRight className="size-3" />
                          </Link>
                        </div>
                      </div>
                    )
                  })}
                </Card>
              </div>
            ))
          )}
        </>
      )}
      <NoteSheet miss={noting} onClose={() => setNoting(null)} />
    </Screen>
  )
}

function NoteSheet({
  miss,
  onClose,
}: {
  miss: Miss | null
  onClose: () => void
}) {
  const notes = dashStore.use((s) => s.missNotes)
  const [text, setText] = useState("")
  useEffect(() => {
    if (miss) setText(notes[miss.id] ?? "")
  }, [miss, notes])
  return (
    <BottomSheet
      open={!!miss}
      onClose={onClose}
      title="Add a note"
      description={miss?.title}
    >
      <div className="flex flex-wrap gap-2">
        {QUICK_NOTES.map((q) => (
          <Chip
            key={q}
            active={text === q}
            onClick={() => setText(q)}
            className="h-11 text-xs"
          >
            {q}
          </Chip>
        ))}
      </div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 80))}
        placeholder="Or say why in a few words"
        aria-label="Note"
        className="mt-3 h-12 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-primary"
      />
      <div className="mt-4 flex gap-2">
        {miss && notes[miss.id] && (
          <Btn
            variant="ghost"
            onClick={() => {
              noteMiss(miss.id, "")
              onClose()
            }}
          >
            Clear
          </Btn>
        )}
        <Btn
          className="flex-1"
          onClick={() => {
            if (miss) noteMiss(miss.id, text)
            toast.success("Noted — it stays visible, just not counted")
            onClose()
          }}
        >
          Save note
        </Btn>
      </div>
    </BottomSheet>
  )
}
