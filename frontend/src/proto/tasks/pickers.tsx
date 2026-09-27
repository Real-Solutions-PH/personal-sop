"use client"

import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { weekday } from "../lib/day"
import { Btn, Chip, SectionTitle } from "../ui/kit"
import type { Recurrence, RepeatRule } from "./data"
import { addDays, fmtDayLong, fmtTime, isoAt, today, WEEKDAYS } from "./logic"
import { BottomSheet } from "./ui"

// TSK-05 Date · time · reminder picker and TSK-06 Repeat picker.

export interface When {
  dueDate: string | null
  dueTime: string | null
  remindAt: string | null
}

type RemindOpt = "none" | "at" | "10m" | "1h" | "1d"
const REMIND: { v: RemindOpt; label: string; min: number }[] = [
  { v: "none", label: "None", min: 0 },
  { v: "at", label: "At time", min: 0 },
  { v: "10m", label: "10 min before", min: 10 },
  { v: "1h", label: "1 hr before", min: 60 },
  { v: "1d", label: "1 day before", min: 1440 },
]

function remindOf(w: When, defaultTime: string): RemindOpt {
  if (!w.remindAt || !w.dueDate) return "none"
  const due = new Date(isoAt(w.dueDate, w.dueTime ?? defaultTime)).getTime()
  const diff = Math.round((due - new Date(w.remindAt).getTime()) / 60_000)
  return REMIND.find((r) => r.v !== "none" && r.min === diff)?.v ?? "at"
}

const pad = (n: number) => String(n).padStart(2, "0")
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

export function MiniCalendar({
  value,
  onChange,
}: {
  value: string | null
  onChange: (k: string) => void
}) {
  const tk = today()
  const [cursor, setCursor] = useState(() => (value ?? tk).slice(0, 7))
  const [y, m] = cursor.split("-").map(Number)
  const first = `${cursor}-01`
  const lead = weekday(first)
  const len = new Date(y, m, 0).getDate()
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: len }, (_, i) => `${cursor}-${pad(i + 1)}`),
  ]
  const shift = (n: number) => {
    const d = new Date(y, m - 1 + n, 1)
    setCursor(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`)
  }
  return (
    <div className="rounded-2xl border border-border/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => shift(-1)}
          className="grid size-8 place-items-center rounded-full hover:bg-muted"
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="font-medium text-sm">
          {MONTHS[m - 1]} {y}
        </div>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => shift(1)}
          className="grid size-8 place-items-center rounded-full hover:bg-muted"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-[10px] text-muted-foreground uppercase">
            {d.slice(0, 2)}
          </div>
        ))}
        {cells.map((k, i) =>
          k ? (
            <button
              key={k}
              type="button"
              onClick={() => onChange(k)}
              className={cn(
                "num grid aspect-square place-items-center rounded-full text-sm transition-colors",
                k === value
                  ? "bg-tsk font-semibold text-background"
                  : k === tk
                    ? "font-semibold text-tsk"
                    : k < tk
                      ? "text-muted-foreground/50"
                      : "hover:bg-muted",
              )}
            >
              {Number(k.slice(8))}
            </button>
          ) : (
            <div key={`x${i}`} />
          ),
        )}
      </div>
    </div>
  )
}

function nextSat(tk: string) {
  for (let i = 0; i < 7; i++)
    if (weekday(addDays(tk, i)) === 6) return addDays(tk, i)
  return tk
}
function nextMon(tk: string) {
  for (let i = 1; i < 8; i++)
    if (weekday(addDays(tk, i)) === 1) return addDays(tk, i)
  return addDays(tk, 7)
}

export function WhenSheet({
  open,
  onClose,
  value,
  onSave,
  defaultTime = "09:00",
  title = "When",
  dateOnly,
}: {
  open: boolean
  onClose: () => void
  value: When
  onSave: (w: When) => void
  defaultTime?: string
  title?: string
  /** Triage "pick a new date": hide time/reminder. */
  dateOnly?: boolean
}) {
  const tk = today()
  const [date, setDate] = useState(value.dueDate)
  const [time, setTime] = useState(value.dueTime)
  const [remind, setRemind] = useState<RemindOpt>(remindOf(value, defaultTime))
  useEffect(() => {
    if (!open) return
    setDate(value.dueDate)
    setTime(value.dueTime)
    setRemind(remindOf(value, defaultTime))
  }, [open, value, defaultTime])

  const presets = [
    { label: "Today", k: tk },
    { label: "Tomorrow", k: addDays(tk, 1) },
    { label: "This weekend", k: nextSat(tk) },
    { label: "Next week", k: nextMon(tk) },
  ]
  const remindAt = useMemo(() => {
    if (!date || remind === "none") return null
    const due = new Date(isoAt(date, time ?? defaultTime)).getTime()
    const min = REMIND.find((r) => r.v === remind)?.min ?? 0
    return new Date(due - min * 60_000).toISOString()
  }, [date, time, remind, defaultTime])
  const past = remindAt && new Date(remindAt).getTime() < Date.now()

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {presets.map((p) => (
          <Chip
            key={p.label}
            accent="tsk"
            active={date === p.k}
            onClick={() => setDate(p.k)}
          >
            {p.label}
          </Chip>
        ))}
        <Chip
          active={date === null}
          onClick={() => {
            setDate(null)
            setTime(null)
            setRemind("none")
          }}
        >
          No date
        </Chip>
      </div>
      <div className="mt-3">
        <MiniCalendar value={date} onChange={setDate} />
      </div>
      {!dateOnly && (
        <>
          <SectionTitle>Time</SectionTitle>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <Chip active={!time} onClick={() => setTime(null)}>
              All day
            </Chip>
            {["09:00", "12:00", "15:00", "18:00", "20:00"].map((t) => (
              <Chip
                key={t}
                accent="tsk"
                active={time === t}
                onClick={() => {
                  setTime(t)
                  if (!date) setDate(tk)
                }}
              >
                {fmtTime(t)}
              </Chip>
            ))}
            <label className="inline-flex h-9 shrink-0 items-center rounded-full border border-border bg-card px-3 text-sm">
              <span className="sr-only">Custom time</span>
              <input
                type="time"
                value={time ?? ""}
                onChange={(e) => {
                  setTime(e.target.value || null)
                  if (!date) setDate(tk)
                }}
                className="bg-transparent outline-none [color-scheme:dark]"
              />
            </label>
          </div>
          <SectionTitle>Reminder</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {REMIND.filter(
              (r) => time || r.v === "none" || r.v === "at" || r.v === "1d",
            ).map((r) => (
              <Chip
                key={r.v}
                accent="tsk"
                active={remind === r.v}
                onClick={() => {
                  setRemind(r.v)
                  if (!date && r.v !== "none") setDate(tk)
                }}
              >
                {r.v === "at" && !time ? `At ${fmtTime(defaultTime)}` : r.label}
              </Chip>
            ))}
          </div>
          {past && (
            <p className="mt-2 text-warn text-xs">
              That reminder time has passed — saved, but no ping will fire.
            </p>
          )}
        </>
      )}
      <div className="sticky bottom-0 mt-5 flex items-center gap-3 bg-background py-3">
        <div className="min-w-0 flex-1 text-muted-foreground text-sm">
          {date ? fmtDayLong(date, tk) : "No date"}
          {time ? ` · ${fmtTime(time)}` : ""}
        </div>
        <Btn
          accent="tsk"
          onClick={() => {
            onSave({
              dueDate: date,
              dueTime: date ? time : null,
              remindAt: dateOnly ? value.remindAt : remindAt,
            })
            onClose()
          }}
        >
          Set
        </Btn>
      </div>
    </BottomSheet>
  )
}

// ---------------------------------------------------------------- repeat

type RepKind = RepeatRule["kind"]

function Stepper({
  value,
  onChange,
  min = 1,
  max = 31,
}: {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-muted p-1">
      <button
        type="button"
        aria-label="Decrease"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="grid size-7 place-items-center rounded-full bg-background"
      >
        <Minus className="size-3.5" />
      </button>
      <span className="num w-8 text-center font-semibold text-sm">{value}</span>
      <button
        type="button"
        aria-label="Increase"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="grid size-7 place-items-center rounded-full bg-background"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}

export function RepeatSheet({
  open,
  onClose,
  value,
  anchor,
  onSave,
}: {
  open: boolean
  onClose: () => void
  value: Recurrence | null
  /** Due date the rule anchors to (weekday / day-of-month defaults). */
  anchor: string | null
  onSave: (r: Recurrence | null) => void
}) {
  const a = anchor ?? today()
  const [kind, setKind] = useState<RepKind>(value?.rule.kind ?? "weekly")
  const [days, setDays] = useState<number[]>(
    value?.rule.kind === "weekly" ? value.rule.days : [weekday(a)],
  )
  const [dom, setDom] = useState(
    value?.rule.kind === "monthly" ? value.rule.day : Number(a.slice(8)),
  )
  const [n, setN] = useState(value?.rule.kind === "everyN" ? value.rule.n : 3)
  const [after, setAfter] = useState(value?.mode === "after")
  useEffect(() => {
    if (!open) return
    setKind(value?.rule.kind ?? "weekly")
    setDays(value?.rule.kind === "weekly" ? value.rule.days : [weekday(a)])
    setDom(value?.rule.kind === "monthly" ? value.rule.day : Number(a.slice(8)))
    setN(value?.rule.kind === "everyN" ? value.rule.n : 3)
    setAfter(value?.mode === "after")
  }, [open, value, a])

  const rule: RepeatRule =
    kind === "weekly"
      ? { kind, days: days.length ? [...days].sort() : [weekday(a)] }
      : kind === "monthly"
        ? { kind, day: dom }
        : kind === "everyN"
          ? { kind, n }
          : { kind }

  const opts: { v: RepKind; label: string }[] = [
    { v: "daily", label: "Daily" },
    { v: "weekdays", label: "Weekdays" },
    { v: "weekly", label: "Weekly on…" },
    { v: "monthly", label: "Monthly on…" },
    { v: "everyN", label: "Every N days" },
  ]
  return (
    <BottomSheet open={open} onClose={onClose} title="Repeat">
      <div className="flex flex-wrap gap-2">
        {opts.map((o) => (
          <Chip
            key={o.v}
            accent="tsk"
            active={kind === o.v}
            onClick={() => setKind(o.v)}
          >
            {o.label}
          </Chip>
        ))}
      </div>
      {kind === "weekly" && (
        <div className="mt-4 grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((d, i) => (
            <button
              key={d}
              type="button"
              aria-pressed={days.includes(i)}
              onClick={() =>
                setDays((x) =>
                  x.includes(i) ? x.filter((y) => y !== i) : [...x, i],
                )
              }
              className={cn(
                "h-10 rounded-xl font-medium text-sm",
                days.includes(i)
                  ? "bg-tsk text-background"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {d.slice(0, 2)}
            </button>
          ))}
        </div>
      )}
      {kind === "monthly" && (
        <div className="mt-4 flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2">
          <span className="text-sm">Day of month</span>
          <Stepper value={dom} onChange={setDom} max={31} />
        </div>
      )}
      {kind === "everyN" && (
        <div className="mt-4 flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2">
          <span className="text-sm">Every</span>
          <Stepper value={n} onChange={setN} min={2} max={60} />
          <span className="text-sm">days</span>
        </div>
      )}
      <label className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-3">
        <div>
          <div className="font-medium text-sm">Repeat after completion</div>
          <div className="text-muted-foreground text-xs">
            Next one counts from the day you finish, not the schedule.
          </div>
        </div>
        <input
          type="checkbox"
          checked={after}
          onChange={(e) => setAfter(e.target.checked)}
          className="size-5 accent-[var(--tsk)]"
        />
      </label>
      <div className="mt-5 mb-3 flex gap-2">
        {value && (
          <Btn
            variant="secondary"
            onClick={() => {
              onSave(null)
              onClose()
            }}
          >
            Don't repeat
          </Btn>
        )}
        <Btn
          accent="tsk"
          className="flex-1"
          onClick={() => {
            onSave({ rule, mode: after ? "after" : "fixed" })
            onClose()
          }}
        >
          Set repeat
        </Btn>
      </div>
    </BottomSheet>
  )
}
