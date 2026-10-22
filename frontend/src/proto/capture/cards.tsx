"use client"

import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Camera,
  Check,
  ChevronDown,
  Clock,
  FileText,
  Lightbulb,
  Mic,
  Pencil,
  Redo2,
  RotateCw,
  Send,
  Sparkles,
  Undo2,
  X,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { finStore } from "../finance/store"
import { habitsStore } from "../habits/store"
import { dayKey, fmtDuration } from "../lib/day"
import { fmtDay, fmtTime } from "../tasks/logic"
import { tasksStore } from "../tasks/store"
import { Bars, Money, Sparkline } from "../ui/kit"
import {
  answerCard,
  confirmAll,
  confirmCard,
  discardCard,
  editCard,
  redoCard,
  retryCapture,
  skipAsk,
  undoCard,
} from "./actions"
import type {
  AnswerCard,
  Capture,
  InfoCard,
  Payload,
  RecordCard,
  ReplyItem,
} from "./data"
import { MOODS } from "./data"
import { EditSheet } from "./edit"
import { captureStore } from "./store"
import {
  AiAvatar,
  KIND_LABEL,
  MOOD_ICON,
  TARGET_META,
  timeLabel,
  tint,
} from "./ui"

// Thread pieces: user bubble, AI reply, record / answer / info cards (CAP-05,
// CAP-07, CAP-11, CAP-19).

/** Host-provided actions for info-card buttons (quick add, send a prompt). */
export const CaptureCtx = createContext<{
  quickAdd: () => void
  send: (text: string) => void
  close?: () => void
}>({ quickAdd: () => {}, send: () => {} })

// ---------------------------------------------------------------- record card helpers

export function hrefFor(c: RecordCard): string {
  const p = c.payload
  const [ref] = c.refs
  if (!ref) return TARGET_META[c.target].href
  switch (p.kind) {
    case "expense":
    case "income":
    case "transfer":
      return `/finance/records/${ref}`
    case "planned":
      return `/finance/planned/${ref}`
    case "task":
    case "taskComplete":
      return `/tasks/task/${ref}`
    case "habitLog":
      return `/habits/${p.habitId}`
    case "habitCreate":
      return `/habits/${ref}`
    case "routineStart":
      return `/habits/routines/${p.routineId}/play`
    case "workout":
      return `/fitness/workouts/${ref}`
    case "weighIn":
      return "/fitness/body"
    case "meal":
      return `/fitness/nutrition/meals/${ref}`
    case "journal":
      return `/journal/${ref}`
    default:
      return TARGET_META[c.target].href
  }
}

function useNames() {
  const cats = finStore.use((s) => s.categories)
  const accts = finStore.use((s) => s.accounts)
  const habits = habitsStore.use((s) => s.habits)
  const routines = habitsStore.use((s) => s.routines)
  const lists = tasksStore.use((s) => s.lists)
  const tasks = tasksStore.use((s) => s.tasks)
  return useMemo(
    () => ({
      cat: (id?: string) => {
        const c = cats.find((x) => x.id === id)
        return c ? `${c.icon} ${c.name}` : "Uncategorised"
      },
      acct: (id?: string) => accts.find((x) => x.id === id)?.name ?? "—",
      accts: accts.filter((a) => !a.archived && a.type !== "investment"),
      habit: (id: string) => habits.find((h) => h.id === id),
      routine: (id?: string) => routines.find((r) => r.id === id),
      list: (id: string | null) =>
        id ? lists.find((l) => l.id === id)?.name : "Inbox",
      task: (id?: string) => tasks.find((t) => t.id === id),
    }),
    [cats, accts, habits, routines, lists, tasks],
  )
}

function MoodGlyph({ v }: { v: 1 | 2 | 3 | 4 | 5 }) {
  const I = MOOD_ICON[v]
  return <I className="inline size-3.5 align-[-2px]" />
}

const ord = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`

const kgStr = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} kg`

/** Card body: the key fields of what will be / was saved. */
function Summary({ c, onAccount }: { c: RecordCard; onAccount?: () => void }) {
  const n = useNames()
  const p = c.payload
  const accent = TARGET_META[c.target].accent
  const today = dayKey()
  const dayChip =
    c.dayOffset && c.dayOffset < 0 ? (
      <span className="rounded-md bg-warn/15 px-1.5 py-0.5 font-medium text-[11px] text-warn">
        Yesterday
      </span>
    ) : null
  switch (p.kind) {
    case "expense":
      return (
        <div>
          <div className="flex items-baseline gap-2">
            <Money
              value={p.amount}
              className="font-display font-semibold text-3xl tracking-tight"
            />
            <span className="truncate text-muted-foreground text-sm">
              {n.cat(p.categoryId)}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={onAccount}
              disabled={!onAccount}
              className={cn(
                "inline-flex min-h-11 items-center gap-0.5 rounded-lg border px-2.5 font-medium text-sm",
                tint.fin.border,
                tint.fin.text,
              )}
            >
              {n.acct(p.accountId)}
              {onAccount && <ChevronDown className="size-3" />}
            </button>
            {p.payee && (
              <span className="text-muted-foreground">{p.payee}</span>
            )}
            {p.fromReceipt && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">
                from receipt
              </span>
            )}
            {p.currency && (
              <span className="rounded-md bg-warn/15 px-1.5 py-0.5 text-warn">
                {p.currency}
              </span>
            )}
            {dayChip}
          </div>
        </div>
      )
    case "income":
      return (
        <div>
          <div className="flex items-baseline gap-2">
            <Money
              value={p.amount}
              signed
              className="font-display font-semibold text-3xl tracking-tight"
            />
            <span className="text-muted-foreground text-sm">
              {n.cat(p.categoryId)}
            </span>
          </div>
          <div className="mt-1 text-muted-foreground text-xs">
            {p.accountId ? `into ${n.acct(p.accountId)}` : "Account?"}
          </div>
        </div>
      )
    case "transfer":
      return (
        <div>
          <Money
            value={p.amount}
            className="font-display font-semibold text-3xl tracking-tight"
          />
          <div className="mt-1 flex items-center gap-1.5 text-sm">
            <span className={cn(!p.from && "text-muted-foreground italic")}>
              {p.from ? n.acct(p.from) : "from?"}
            </span>
            <ArrowRight className="size-3.5 text-muted-foreground" />
            <span className={cn(!p.to && "text-muted-foreground italic")}>
              {p.to ? n.acct(p.to) : "to?"}
            </span>
          </div>
        </div>
      )
    case "planned":
      return (
        <div>
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-lg">{p.name}</span>
            <Money value={p.amount} className="text-muted-foreground" />
          </div>
          <div className="mt-1 text-muted-foreground text-xs">
            {p.date
              ? `Once, due ${p.date}`
              : `Monthly on the ${ord(p.day ?? 1)}`}
            {" · "}
            {n.acct(p.accountId)}
          </div>
        </div>
      )
    case "task":
      return (
        <ul className="space-y-1.5">
          {p.tasks.slice(0, 6).map((t, i) => (
            <li key={`${t.title}-${i}`} className="flex items-start gap-2">
              <span
                className={cn(
                  "mt-1 size-3.5 shrink-0 rounded-full border-2",
                  tint.tsk.border,
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{t.title}</div>
                <div className="flex flex-wrap gap-x-2 text-muted-foreground text-xs">
                  <span>{n.list(t.listId)}</span>
                  {t.dueDate && (
                    <span className={cn(t.dueDate < today && "text-bad")}>
                      {fmtDay(t.dueDate)}
                      {t.dueTime
                        ? ` · ${fmtTime(t.dueTime)}`
                        : t.remind
                          ? " · 9 AM"
                          : ""}
                    </span>
                  )}
                  {t.remind && (
                    <span className="inline-flex items-center gap-0.5">
                      <Bell className="size-3" /> reminder
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
          {p.tasks.length > 6 && (
            <li className="text-muted-foreground text-xs">
              +{p.tasks.length - 6} more
            </li>
          )}
        </ul>
      )
    case "taskComplete": {
      const t = n.task(p.taskId)
      return (
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "grid size-5 place-items-center rounded-full",
              tint.tsk.solid,
            )}
          >
            <Check className="size-3 text-white" strokeWidth={3} />
          </span>
          <span
            className={cn(
              "font-medium",
              c.state === "saved" && "line-through opacity-70",
            )}
          >
            {t?.title ?? `“${p.query}”`}
          </span>
        </div>
      )
    }
    case "habitLog": {
      const h = n.habit(p.habitId)
      return (
        <div className="flex items-center gap-2">
          <span className="text-2xl">{h?.icon ?? "✅"}</span>
          <div>
            <div className="font-semibold">{h?.name ?? "Habit"}</div>
            <div className="text-muted-foreground text-xs">
              {p.value !== undefined &&
                h?.type === "duration" &&
                `${p.value} min`}
              {p.value !== undefined &&
                h?.type === "count" &&
                `${p.add ? "+" : ""}${p.value} ${h.unit ?? ""}`}
              {h?.type === "check" && "Done"} {dayChip}
            </div>
          </div>
        </div>
      )
    }
    case "habitCreate": {
      const days =
        p.days.length === 7
          ? "Every day"
          : p.days.length === 5 && !p.days.includes(0) && !p.days.includes(6)
            ? "Weekdays"
            : p.days.map((d) => "SMTWTFS"[d]).join(" ")
      return (
        <div className="flex items-center gap-2">
          <span className="text-2xl">{p.icon}</span>
          <div>
            <div className="font-semibold">{p.name}</div>
            <div className="text-muted-foreground text-xs">
              {days}
              {p.time ? ` · ${fmtTime(p.time)}` : ""}
              {p.target
                ? ` · ${p.target} ${p.type === "duration" ? "min" : (p.unit ?? "")}`
                : ""}
            </div>
          </div>
        </div>
      )
    }
    case "routineStart": {
      const r = n.routine(p.routineId)
      return (
        <div className="flex items-center gap-2">
          <span className="text-2xl">{r?.icon ?? "🌅"}</span>
          <div>
            <div className="font-semibold">{r?.name ?? "Which routine?"}</div>
            {r && (
              <div className="text-muted-foreground text-xs">
                {r.steps.length} steps
              </div>
            )}
          </div>
        </div>
      )
    }
    case "workout":
      return (
        <div>
          <div className="flex items-center gap-2 font-semibold">
            {p.name} {dayChip}
          </div>
          {p.cardio ? (
            <div className="mt-1 flex gap-4 text-sm">
              {p.cardio.km !== undefined && (
                <span>
                  <b className="num text-lg">{p.cardio.km}</b>{" "}
                  <span className="text-muted-foreground">km</span>
                </span>
              )}
              {p.cardio.min !== undefined && (
                <span>
                  <b className="num text-lg">{p.cardio.min}:00</b>{" "}
                  <span className="text-muted-foreground">time</span>
                </span>
              )}
            </div>
          ) : (
            <ul className="mt-1 space-y-0.5 text-sm">
              {p.exercises.map((e, i) => (
                <li
                  key={`${e.exercise}-${i}`}
                  className="flex justify-between gap-2"
                >
                  <span className="truncate">{e.exercise}</span>
                  <span className="num shrink-0 text-muted-foreground">
                    {e.sets.length}×{e.sets[0]?.reps}
                    {e.sets[0]?.weight ? ` @ ${e.sets[0].weight} kg` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    case "weighIn":
      return (
        <div className="flex items-baseline gap-2">
          <span className="num font-display font-semibold text-3xl tracking-tight">
            {kgStr(p.kg)}
          </span>
          {p.prevKg !== undefined && (
            <span
              className={cn(
                "num text-sm",
                p.kg <= p.prevKg ? "text-good" : "text-muted-foreground",
              )}
            >
              {p.kg <= p.prevKg ? "▼" : "▲"}{" "}
              {Math.abs(p.kg - p.prevKg).toFixed(1)}
            </span>
          )}
        </div>
      )
    case "meal": {
      const tot = p.items.reduce(
        (a, i) => ({
          kcal: a.kcal + i.kcal,
          p: a.p + i.protein,
          c: a.c + i.carbs,
          f: a.f + i.fat,
        }),
        { kcal: 0, p: 0, c: 0, f: 0 },
      )
      return (
        <div>
          <div className="flex items-baseline gap-2">
            <span className="num font-display font-semibold text-3xl tracking-tight">
              {Math.round(tot.kcal)}
            </span>
            <span className="text-muted-foreground text-sm">kcal</span>
            {p.label && (
              <span className="ml-auto text-muted-foreground text-xs capitalize">
                {p.label}
              </span>
            )}
          </div>
          <div className="num mt-0.5 flex gap-3 text-xs">
            <span>
              <b className={tint.fit.text}>P</b> {Math.round(tot.p)}g
            </span>
            <span>
              <b className="text-muted-foreground">C</b> {Math.round(tot.c)}g
            </span>
            <span>
              <b className="text-muted-foreground">F</b> {Math.round(tot.f)}g
            </span>
            {c.confidence !== undefined && (
              <span className="ml-auto text-muted-foreground">
                ~{Math.round(c.confidence * 100)}% sure
              </span>
            )}
          </div>
          <ul className="mt-2 space-y-0.5 border-border/50 border-t pt-2 text-sm">
            {p.items.map((it, i) => (
              <li
                key={`${it.name}-${i}`}
                className="flex justify-between gap-2"
              >
                <span className="truncate">
                  {it.name}
                  {it.assumption && (
                    <span className="text-muted-foreground text-xs">
                      {" "}
                      · {it.assumption}
                    </span>
                  )}
                </span>
                <span className="num shrink-0 text-muted-foreground">
                  {it.kcal}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )
    }
    case "journal":
      return (
        <div>
          <p className="line-clamp-4 whitespace-pre-line text-[15px] leading-relaxed">
            {p.body}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            {p.mood && (
              <span className="rounded-md bg-muted px-1.5 py-0.5">
                <MoodGlyph v={p.mood} />{" "}
                {MOODS.find((m) => m.v === p.mood)?.label}
              </span>
            )}
            {p.area && (
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 capitalize",
                  tint.life.bg,
                  tint.life.text,
                )}
              >
                {p.area}
              </span>
            )}
            {p.tags.map((t) => (
              <span key={t} className="text-muted-foreground">
                #{t}
              </span>
            ))}
          </div>
        </div>
      )
    case "photo":
      return (
        <div className="text-muted-foreground text-sm">
          {p.caption ? `“${p.caption}”` : "Photo received."}
        </div>
      )
    case "command": {
      const t = p.recordId ? findCardSummary(p.recordId) : undefined
      return (
        <div className="text-sm">
          {p.op === "delete" ? "Delete " : "Change "}
          <b>{t ?? "the last entry"}</b>
          {p.op === "edit" && p.amount !== undefined && (
            <>
              {" "}
              → <Money value={p.amount} className="font-semibold" />
            </>
          )}
        </div>
      )
    }
  }
  void accent
  return null
}

function findCardSummary(id: string): string | undefined {
  for (const cap of captureStore.get().captures)
    for (const it of cap.reply?.items ?? [])
      if (it.t === "record" && it.id === id) {
        const p = it.payload
        if ("amount" in p && p.amount !== undefined)
          return `₱${p.amount.toLocaleString()} ${KIND_LABEL[it.kind].toLowerCase()}`
        return KIND_LABEL[it.kind]
      }
  return undefined
}

function StateBadge({ c }: { c: RecordCard }) {
  const map: Record<RecordCard["state"], [string, string]> = {
    saved: ["✓ Saved", "text-good bg-good/12"],
    edited: ["✓ Edited", "text-good bg-good/12"],
    proposed: ["Confirm?", "text-warn bg-warn/15"],
    needs_input: ["Needs answer", "text-warn bg-warn/15"],
    undone: ["Undone", "text-muted-foreground bg-muted"],
    discarded: ["Discarded", "text-muted-foreground bg-muted"],
  }
  const [label, cls] = map[c.state]
  return (
    <span
      className={cn("rounded-full px-2 py-0.5 font-semibold text-[11px]", cls)}
    >
      {label}
    </span>
  )
}

function AskPanel({ c }: { c: RecordCard }) {
  const [text, setText] = useState("")
  const ask = c.ask
  if (!ask) return null
  const accent = TARGET_META[c.target].accent
  return (
    <div className="mt-3 rounded-xl bg-muted/50 p-3">
      <div className="flex items-start gap-2 font-medium text-sm">
        <Sparkles className={cn("mt-0.5 size-4 shrink-0", tint[accent].text)} />
        {ask.question}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {ask.options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => answerCard(c.id, o.value)}
            className={cn(
              "h-11 rounded-full border bg-card px-4 font-medium text-sm transition duration-150 active:scale-95",
              tint[accent].border,
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {ask.free && (
        <form
          className="mt-2 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) answerCard(c.id, text.trim())
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Or type it…"
            aria-label="Type your answer"
            className="h-11 min-w-0 flex-1 rounded-full border border-border bg-background px-3 text-sm outline-none focus:border-primary"
          />
          <button
            type="submit"
            aria-label="Answer"
            className="grid size-11 place-items-center rounded-full bg-primary text-background"
          >
            <Send className="size-4" />
          </button>
        </form>
      )}
      <div className="mt-2 flex justify-between text-xs">
        <button
          type="button"
          onClick={() => skipAsk(c.id)}
          className="min-h-11 px-1 text-muted-foreground"
        >
          Skip for now
        </button>
        <button
          type="button"
          onClick={() => discardCard(c.id)}
          className="min-h-11 px-1 text-muted-foreground"
        >
          Discard
        </button>
      </div>
    </div>
  )
}

function AccountPicker({ c, onDone }: { c: RecordCard; onDone: () => void }) {
  const n = useNames()
  if (c.payload.kind !== "expense") return null
  const p = c.payload
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {n.accts.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => {
            editCard(c.id, { ...p, accountId: a.id })
            onDone()
          }}
          className={cn(
            "h-11 rounded-full border px-4 font-medium text-sm",
            a.id === p.accountId
              ? cn(tint.fin.solid, "border-transparent text-white")
              : "border-border bg-card",
          )}
        >
          {a.name}
        </button>
      ))}
    </div>
  )
}

export function RecordCardView({
  c,
  compact,
}: {
  c: RecordCard
  compact?: boolean
}) {
  const router = useRouter()
  const meta = TARGET_META[c.target]
  const Icon = meta.icon
  const t = tint[meta.accent]
  const [editing, setEditing] = useState(false)
  const [pickAcct, setPickAcct] = useState(false)
  const dead = c.state === "undone" || c.state === "discarded"
  const isDup = !!c.warn?.startsWith("Looks like")
  const saved = c.state === "saved" || c.state === "edited"
  const canUndo = saved && c.refs.length > 0
  const canEdit =
    c.kind !== "photo" &&
    c.kind !== "command" &&
    c.kind !== "routineStart" &&
    c.kind !== "taskComplete"

  if (c.state === "discarded" && compact)
    return (
      <div className="rounded-xl border border-border/60 border-dashed px-3 py-2 text-muted-foreground text-xs">
        {KIND_LABEL[c.kind]} discarded — nothing saved.
      </div>
    )

  return (
    <div
      className={cn(
        "motion-safe:fade-in motion-safe:slide-in-from-bottom-1 relative motion-safe:animate-in overflow-hidden rounded-2xl border bg-card duration-300",
        dead ? "border-border/50 opacity-60" : t.border,
      )}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          dead ? "bg-muted" : t.solid,
        )}
      />
      <div className="py-3 pr-3 pl-4">
        <div className="mb-2 flex items-center gap-2">
          <span
            className={cn("grid size-6 place-items-center rounded-lg", t.bg)}
          >
            <Icon className={cn("size-3.5", t.text)} />
          </span>
          <span className="flex-1 truncate font-medium text-muted-foreground text-xs">
            {meta.label} › {KIND_LABEL[c.kind]}
            {c.payload.kind === "task" &&
              c.payload.tasks.length > 1 &&
              ` ×${c.payload.tasks.length}`}
          </span>
          <StateBadge c={c} />
        </div>
        <div
          className={cn(dead && "line-through decoration-muted-foreground/50")}
        >
          <Summary
            c={c}
            onAccount={
              !dead && c.kind === "expense"
                ? () => setPickAcct((v) => !v)
                : undefined
            }
          />
        </div>
        {pickAcct && <AccountPicker c={c} onDone={() => setPickAcct(false)} />}
        {c.warn && !dead && (
          <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-warn/12 px-2.5 py-1.5 text-warn text-xs">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            {c.warn}
          </div>
        )}
        {c.note && saved && (
          <div className="mt-2 flex items-center gap-1.5 text-muted-foreground text-xs">
            <Lightbulb className="size-3.5 text-life" />
            {c.note}
          </div>
        )}
        {c.state === "needs_input" && <AskPanel c={c} />}

        {c.state === "proposed" && (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                confirmCard(c.id)
                if (c.payload.kind === "routineStart" && c.payload.routineId)
                  router.push(`/habits/routines/${c.payload.routineId}/play`)
              }}
              className={cn(
                "h-11 flex-1 rounded-xl font-semibold text-sm text-white active:opacity-80",
                t.solid,
              )}
            >
              {isDup
                ? "Keep both"
                : c.kind === "routineStart"
                  ? "Start routine"
                  : c.kind === "command"
                    ? "Do it"
                    : "Confirm"}
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="h-11 rounded-xl bg-muted px-4 font-medium text-sm"
              >
                Edit
              </button>
            )}
            <button
              type="button"
              onClick={() => discardCard(c.id)}
              aria-label="Discard"
              className="grid h-11 min-w-11 place-items-center rounded-xl bg-muted px-1 text-muted-foreground"
            >
              {isDup ? (
                <span className="px-2 text-xs">Same</span>
              ) : (
                <X className="size-4" />
              )}
            </button>
          </div>
        )}

        {saved && (
          <div className="mt-2.5 flex items-center gap-1 text-sm">
            {canUndo && (
              <button
                type="button"
                onClick={() => undoCard(c.id)}
                className="inline-flex h-11 items-center gap-1 rounded-lg px-2.5 font-medium text-muted-foreground hover:bg-muted"
              >
                <Undo2 className="size-3.5" /> Undo
              </button>
            )}
            {canEdit && canUndo && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex h-11 items-center gap-1 rounded-lg px-2.5 font-medium text-muted-foreground hover:bg-muted"
              >
                <Pencil className="size-3.5" /> Edit
              </button>
            )}
            <Link
              href={hrefFor(c)}
              className={cn(
                "ml-auto inline-flex h-11 items-center gap-1 rounded-lg px-2.5 font-medium",
                t.text,
              )}
            >
              Open <ArrowRight className="size-3.5" />
            </Link>
          </div>
        )}
        {c.state === "undone" && (
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground text-xs">
              Reverted — nothing kept.
            </span>
            <button
              type="button"
              onClick={() => redoCard(c.id)}
              className="inline-flex h-11 items-center gap-1 rounded-lg px-2.5 font-medium text-foreground hover:bg-muted"
            >
              <Redo2 className="size-3.5" /> Redo
            </button>
          </div>
        )}
      </div>
      {editing && (
        <EditSheet
          card={c}
          open={editing}
          onOpenChange={setEditing}
          onSave={(p: Payload) => editCard(c.id, p)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- answer + info

export function AnswerCardView({ a }: { a: AnswerCard }) {
  const t = tint[a.accent]
  return (
    <div
      className={cn(
        "motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:animate-in rounded-2xl border bg-card p-4 duration-300",
        t.border,
      )}
    >
      <div className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
        <span className={cn("size-2 rounded-full", t.solid)} />
        {a.title}
      </div>
      <div className="mt-1">
        {a.money !== undefined ? (
          <Money
            value={a.money}
            className={cn(
              "font-display font-semibold text-4xl tracking-tight",
              t.text,
            )}
          />
        ) : (
          <span
            className={cn(
              "num font-display font-semibold text-4xl tracking-tight",
              t.text,
            )}
          >
            {a.value}
          </span>
        )}
      </div>
      {a.sub && (
        <div className="mt-0.5 text-muted-foreground text-sm">{a.sub}</div>
      )}
      {a.bars && (
        <div className="mt-3">
          <Bars
            data={a.bars.data}
            labels={a.bars.labels}
            accent={a.accent}
            height={56}
          />
        </div>
      )}
      {a.spark && a.spark.length > 1 && (
        <div className="mt-3">
          <Sparkline data={a.spark} accent={a.accent} height={44} />
        </div>
      )}
      {a.list && a.list.length > 0 && (
        <ul className="mt-3 divide-y divide-border/50 text-sm">
          {a.list.map((r) => (
            <li key={r.label + r.value}>
              {r.href ? (
                <Link
                  href={r.href}
                  className="flex justify-between gap-2 py-1.5"
                >
                  <span className="truncate">{r.label}</span>
                  <span className="num shrink-0 text-muted-foreground">
                    {r.value}
                  </span>
                </Link>
              ) : (
                <div className="flex justify-between gap-2 py-1.5">
                  <span className="truncate">{r.label}</span>
                  <span className="num shrink-0 text-muted-foreground">
                    {r.value}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {a.basis && (
        <div className="mt-2 text-[11px] text-muted-foreground">{a.basis}</div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {a.links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "inline-flex h-11 items-center gap-1 rounded-full px-4 font-medium text-sm",
              t.bg,
              t.text,
            )}
          >
            {l.label} <ArrowRight className="size-3.5" />
          </Link>
        ))}
      </div>
    </div>
  )
}

export function InfoCardView({
  card,
  captureId,
}: {
  card: InfoCard
  captureId?: string
}) {
  const ctx = useContext(CaptureCtx)
  const router = useRouter()
  const [hidden, setHidden] = useState(false)
  const tone = {
    fallback: {
      icon: Sparkles,
      cls: "border-border bg-card",
      ic: "text-primary",
    },
    error: {
      icon: AlertTriangle,
      cls: "border-bad/30 bg-bad/5",
      ic: "text-bad",
    },
    "journal-suggest": {
      icon: Sparkles,
      cls: cn(tint.life.border, "bg-card"),
      ic: tint.life.text,
    },
    handoff: {
      icon: FileText,
      cls: cn(tint.fin.border, "bg-card"),
      ic: tint.fin.text,
    },
    advice: {
      icon: Lightbulb,
      cls: cn(tint.fin.border, "bg-card"),
      ic: tint.fin.text,
    },
  }[card.tone]
  const Icon = tone.icon
  if (hidden) return null
  return (
    <div
      className={cn(
        "motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:animate-in rounded-2xl border p-4 duration-300",
        tone.cls,
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className={cn("mt-0.5 size-4 shrink-0", tone.ic)} />
        <div className="min-w-0">
          <div className="font-semibold text-sm">{card.title}</div>
          {card.body && (
            <div className="mt-0.5 text-muted-foreground text-sm">
              {card.body}
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {card.actions.map((a, i) => (
          <button
            key={a.label}
            type="button"
            onClick={() => {
              if (a.do === "quickadd") ctx.quickAdd()
              else if (a.do === "retry" && captureId) retryCapture(captureId)
              else if (a.do === "journal")
                ctx.send(`journal: ${a.prompt ?? ""}`)
              else if (a.do === "prompt" && a.prompt) ctx.send(a.prompt)
              else if (a.do === "link") {
                if (a.href) {
                  ctx.close?.()
                  router.push(a.href)
                } else setHidden(true)
              }
            }}
            className={cn(
              "inline-flex h-11 items-center gap-1.5 rounded-full px-4 font-medium text-sm transition duration-150 active:scale-95",
              i === 0 ? "bg-primary text-primary-foreground" : "bg-muted",
            )}
          >
            {a.do === "retry" && <RotateCw className="size-3.5" />}
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function ReplyItemView({
  it,
  captureId,
  compact,
}: {
  it: ReplyItem
  captureId?: string
  compact?: boolean
}) {
  if (it.t === "record") return <RecordCardView c={it} compact={compact} />
  if (it.t === "answer") return <AnswerCardView a={it} />
  return <InfoCardView card={it} captureId={captureId} />
}

// ---------------------------------------------------------------- exchange

const THINK = ["Reading…", "Splitting it up…", "Checking your data…", "Almost…"]

export function Thinking({ text }: { text: string }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(
      () => setI((n) => Math.min(n + 1, THINK.length - 1)),
      520,
    )
    return () => clearInterval(t)
  }, [])
  const parts = text.split(/,|\band\b|\n/).filter((s) => s.trim()).length
  const label = i === 1 && parts > 1 ? `Found ${parts} things…` : THINK[i]
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <div className="flex gap-1">
        {[0, 1, 2].map((d) => (
          <span
            key={d}
            className="size-2 rounded-full bg-primary/70 motion-safe:animate-bounce"
            style={{ animationDelay: `${d * 120}ms` }}
          />
        ))}
      </div>
      <span className="text-muted-foreground text-sm motion-safe:animate-pulse">
        {label}
      </span>
    </div>
  )
}

export function UserBubble({ cap }: { cap: Capture }) {
  return (
    <div className="flex flex-col items-end">
      <Link
        href={`/capture/history/${cap.id}`}
        className="motion-safe:fade-in motion-safe:slide-in-from-bottom-2 max-w-[85%] motion-safe:animate-in overflow-hidden rounded-2xl rounded-br-md bg-primary text-primary-foreground duration-200"
      >
        {cap.photo && (
          // biome-ignore lint/performance/noImgElement: data-URL thumbnail
          <img
            src={cap.photo}
            alt="Captured"
            className="max-h-48 w-full object-cover"
          />
        )}
        {(cap.text || cap.source === "voice" || cap.source === "file") && (
          <div className="px-3.5 py-2">
            {cap.source === "voice" && (
              <div className="mb-0.5 flex items-center gap-1 text-[11px] opacity-80">
                <Mic className="size-3" /> Voice ·{" "}
                {fmtDuration(cap.durationSec ?? 0)}
              </div>
            )}
            {cap.source === "file" && (
              <div className="mb-0.5 flex items-center gap-1 text-[11px] opacity-80">
                <FileText className="size-3" /> {cap.fileName}
              </div>
            )}
            {cap.text && (
              <div className="whitespace-pre-line text-[15px] leading-snug">
                {cap.text}
              </div>
            )}
          </div>
        )}
        {cap.source === "photo" && !cap.text && (
          <div className="flex items-center gap-1 px-3.5 py-1.5 text-[11px] opacity-80">
            <Camera className="size-3" />{" "}
            {cap.hint && cap.hint !== "auto" ? cap.hint : "Photo"}
          </div>
        )}
      </Link>
      <div className="mt-1 flex items-center gap-1.5 pr-1 text-[11px] text-muted-foreground">
        {cap.status === "queued" ? (
          <>
            <Clock className="size-3 text-warn" />
            <span className="text-warn">Queued · will process when online</span>
            <button
              type="button"
              onClick={() => retryCapture(cap.id)}
              className="font-medium underline"
            >
              Retry
            </button>
          </>
        ) : (
          timeLabel(cap.at)
        )}
      </div>
    </div>
  )
}

export function Exchange({
  cap,
  compact,
}: {
  cap: Capture
  compact?: boolean
}) {
  const proposed = (cap.reply?.items ?? []).filter(
    (i): i is RecordCard => i.t === "record" && i.state === "proposed",
  )
  return (
    <div className="space-y-2">
      <UserBubble cap={cap} />
      {(cap.status === "processing" || cap.reply) && (
        <div className="flex gap-2">
          <AiAvatar className="mt-0.5" />
          <div className="min-w-0 flex-1 space-y-2">
            {cap.status === "processing" ? (
              <Thinking text={cap.text} />
            ) : (
              cap.reply && (
                <>
                  <div className="pt-1 text-[15px]">{cap.reply.text}</div>
                  {cap.reply.items.map((it) => (
                    <ReplyItemView
                      key={it.id}
                      it={it}
                      captureId={cap.id}
                      compact={compact}
                    />
                  ))}
                  {proposed.length >= 2 && (
                    <button
                      type="button"
                      onClick={() => confirmAll(cap.id)}
                      className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-primary/40 font-semibold text-primary text-sm active:bg-primary/10"
                    >
                      <Check className="size-4" /> Confirm all {proposed.length}
                    </button>
                  )}
                </>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}
