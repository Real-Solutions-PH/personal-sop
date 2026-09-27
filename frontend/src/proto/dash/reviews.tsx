"use client"

import {
  CalendarRange,
  Check,
  ChevronRight,
  EyeOff,
  Share2,
  Sparkles,
  Star,
  Trophy,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { addJournalEntry } from "../capture/actions"
import type { ModuleKey } from "../contract"
import { dayKey } from "../lib/day"
import {
  Btn,
  Card,
  Chip,
  Empty,
  Screen,
  SectionTitle,
  Segmented,
} from "../ui/kit"
import {
  AREA,
  addDaysKey,
  type MetricRef,
  monthStartKey,
  weekStartKey,
} from "./data"
import { GoalEditor } from "./goals"
import {
  onTargetStats,
  useAllMetrics,
  useAllMisses,
  useEnabledKeys,
  useLifeScore,
  useOnTarget,
  useTrophies,
} from "./hooks"
import { dashStore, saveReview } from "./store"
import {
  AreaIcon,
  Delta,
  ErrorCard,
  fmtDay,
  Loading,
  ModuleDot,
  pct,
  useViewState,
} from "./ui"

// DSH-26 Reviews archive · DSH-27 weekly / monthly review.

export interface ReviewPeriod {
  id: string
  kind: "week" | "month"
  from: string
  to: string
  label: string
}

export function periodOf(id: string): ReviewPeriod | null {
  const m = id.match(/^([wm])-(\d{4}-\d{2}-\d{2})$/)
  if (!m) return null
  const from = m[2]
  if (m[1] === "w")
    return {
      id,
      kind: "week",
      from,
      to: addDaysKey(from, 6),
      label: `Week of ${fmtDay(from)}`,
    }
  const d = new Date(`${from}T12:00:00`)
  d.setMonth(d.getMonth() + 1)
  d.setDate(0)
  const to = addDaysKey(from, d.getDate() - 1)
  return {
    id,
    kind: "month",
    from,
    to,
    label: new Date(`${from}T12:00:00`).toLocaleDateString("en-PH", {
      month: "long",
      year: "numeric",
    }),
  }
}

const periods = (kind: "week" | "month") =>
  (kind === "week"
    ? Array.from({ length: 8 }, (_, i) => `w-${weekStartKey(i + 1)}`)
    : Array.from({ length: 3 }, (_, i) => `m-${monthStartKey(i + 1)}`)
  )
    .map(periodOf)
    .filter((p): p is ReviewPeriod => !!p)

export function ReviewsScreen() {
  const state = useViewState()
  const reviews = dashStore.use((s) => s.reviews)
  const [kind, setKind] = useState<"week" | "month">("week")
  const list = periods(kind)
  const target = useOnTarget(365)
  const rateOf = (p: ReviewPeriod) =>
    onTargetStats(target.series.filter((d) => d.day >= p.from && d.day <= p.to))
      .rate
  const pending = list.filter((p) => !reviews[p.id]?.done).length

  return (
    <Screen title="Reviews" back>
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: "week", label: "Weekly" },
          { value: "month", label: "Monthly" },
        ]}
      />
      {state === "loading" ? (
        <Loading rows={4} />
      ) : state === "error" ? (
        <div className="mt-3">
          <ErrorCard what="reviews" />
        </div>
      ) : state === "empty" ? (
        <Empty
          icon={<CalendarRange className="size-8" />}
          title="First review lands Sunday 7pm"
          body="A 3-minute recap of wins, misses and one thing to improve."
        />
      ) : (
        <>
          <p className="mt-3 px-1 text-muted-foreground text-sm">
            {pending
              ? `${pending} pending — reviews auto-archive after 2 days but stay here.`
              : "All caught up. ✓"}
          </p>
          <Card className="mt-2 px-3 py-1">
            {list.map((p, i) => {
              const r = reviews[p.id]
              const rate = rateOf(p)
              return (
                <Link
                  key={p.id}
                  href={`/stats/reviews/${p.id}`}
                  className="flex min-h-14 items-center gap-3 border-border/50 border-b py-2 last:border-0"
                >
                  <span
                    className={cn(
                      "grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      r?.done
                        ? "bg-good/15 text-good"
                        : "bg-primary/15 text-primary",
                    )}
                  >
                    {r?.done ? (
                      <Check className="size-4" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-sm">{p.label}</span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {r?.done
                        ? r.reflection
                          ? `“${r.reflection}”`
                          : "Reviewed"
                        : i === 0
                          ? "Ready to review"
                          : "Pending · unreviewed"}
                    </span>
                  </span>
                  <span className="num text-right font-semibold text-sm">
                    {pct(rate)}
                    <span className="block font-normal text-[10px] text-muted-foreground">
                      on-target rate
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              )
            })}
          </Card>
        </>
      )}
    </Screen>
  )
}

// ================================================================= Review detail

export function ReviewScreen({ id }: { id: string }) {
  const p = periodOf(id)
  if (!p)
    return (
      <Screen title="Review" back="/stats/reviews">
        <Empty
          title="Review not found"
          action={<Btn href="/stats/reviews">All reviews</Btn>}
        />
      </Screen>
    )
  return <Review p={p} />
}

function Review({ p }: { p: ReviewPeriod }) {
  const router = useRouter()
  const state = useViewState()
  const len = p.kind === "week" ? 7 : 30
  const r = dashStore.use((s) => s.reviews[p.id])
  const target = useOnTarget(365)
  const metrics = useAllMetrics(len)
  const ls = useLifeScore(len)
  const misses = useAllMisses(p.from, p.to)
  const trophies = useTrophies()
  const keys = useEnabledKeys()
  const [reflection, setReflection] = useState("")
  const [focus, setFocus] = useState<MetricRef | undefined>()
  const [aiOn, setAiOn] = useState(true)
  const [goalFor, setGoalFor] = useState<MetricRef | null>(null)
  useEffect(() => {
    setReflection(r?.reflection ?? "")
    setFocus(r?.focus)
  }, [r])

  const snap = useMemo(() => {
    const inRange = target.series.filter(
      (d) => d.day >= p.from && d.day <= p.to,
    )
    const prevFrom = addDaysKey(p.from, -len)
    const prev = target.series.filter(
      (d) => d.day >= prevFrom && d.day < p.from,
    )
    const cur = onTargetStats(inRange)
    const before = onTargetStats(prev)
    const best = [...inRange]
      .filter((d) => d.due)
      .sort((a, b) => b.done / b.due - a.done / a.due || b.done - a.done)[0]
    return { cur, before, best }
  }, [target.series, p, len])
  const wins = trophies.filter((t) => t.day >= p.from && t.day <= p.to)
  const top = misses.slice(0, 3)
  const strongest = [...keys].sort((a, b) => ls.rates[b] - ls.rates[a])[0] as
    | ModuleKey
    | undefined
  const weakest = [...keys].sort((a, b) => ls.rates[a] - ls.rates[b])[0] as
    | ModuleKey
    | undefined
  const targetDelta =
    snap.cur.rate !== null && snap.before.rate !== null
      ? Math.round((snap.cur.rate - snap.before.rate) * 100)
      : null

  const focusOptions: { ref: MetricRef; label: string }[] = [
    { ref: "life", label: "Life Score" },
    { ref: "onTarget", label: "On-target rate" },
    ...keys.flatMap((k) =>
      metrics[k]
        .slice(0, 2)
        .map((m) => ({ ref: `${k}:${m.key}`, label: m.label })),
    ),
  ]

  const done = () => {
    saveReview(p.id, {
      done: true,
      doneAt: new Date().toISOString(),
      reflection: reflection.trim() || undefined,
      focus,
    })
    // OQ-DSH-4: review reflections double as journal entries (M5 owns the journal).
    if (reflection.trim() && reflection.trim() !== r?.reflection)
      addJournalEntry({
        body: reflection.trim(),
        day: dayKey(),
        source: "text",
        tags: [p.kind === "week" ? "weekly-review" : "monthly-review"],
      })
    toast.success("Review done", {
      description: "Archived. See you next week.",
    })
    router.push("/stats/reviews")
  }

  if (state === "loading")
    return (
      <Screen title={p.label} back="/stats/reviews">
        <Loading rows={4} />
      </Screen>
    )

  return (
    <Screen
      title={p.label}
      back="/stats/reviews"
      actions={
        <Link
          href={`/stats/share?t=${p.kind === "week" ? "weekly" : "monthly"}`}
          aria-label="Share recap"
          className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted"
        >
          <Share2 className="size-5" />
        </Link>
      }
    >
      <div className="text-muted-foreground text-xs">
        {fmtDay(p.from, { weekday: "short", month: "short", day: "numeric" })} –{" "}
        {fmtDay(p.to, { weekday: "short", month: "short", day: "numeric" })}
        {r?.done && " · reviewed ✓"}
        {p.to >= dayKey() && " · in progress"}
      </div>

      {state === "error" ? (
        <div className="mt-3">
          <ErrorCard what="this review" />
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Card className="p-3">
              <div className="font-display num font-bold text-2xl">
                {ls.score ?? "—"}
              </div>
              <div className="text-muted-foreground text-xs">Life Score</div>
              <Delta value={ls.delta} />
            </Card>
            <Card className="p-3">
              <div className="font-display num font-bold text-2xl">
                {pct(snap.cur.rate)}
              </div>
              <div className="text-muted-foreground text-xs">
                On-target rate
              </div>
              <Delta value={targetDelta} suffix="pt" />
            </Card>
            <Card className="p-3">
              <div className="font-display num font-bold text-2xl">
                {snap.cur.onTarget}
                <span className="text-base text-muted-foreground">
                  /{snap.cur.scored}
                </span>
              </div>
              <div className="text-muted-foreground text-xs">
                On-target days
              </div>
            </Card>
          </div>

          <Card className="mt-2 px-3 py-2">
            {keys.map((k) => (
              <div key={k} className="flex items-center gap-2 py-1.5 text-sm">
                <ModuleDot module={k} />
                <span className="flex-1">{AREA[k].label}</span>
                <span className="max-w-[45%] truncate text-muted-foreground text-xs">
                  {metrics[k][0]?.label} {metrics[k][0]?.value}
                </span>
                <Delta
                  value={metrics[k][0]?.delta}
                  goodWhen={metrics[k][0]?.goodWhen}
                />
              </div>
            ))}
          </Card>

          <SectionTitle>Wins</SectionTitle>
          <Card className="space-y-2 px-3 py-2 text-sm">
            {snap.best && (
              <div className="flex items-center gap-2">
                <Star className="size-4 text-life" />
                <span className="flex-1">
                  Best day: {fmtDay(snap.best.day, { weekday: "long" })} —{" "}
                  {snap.best.done}/{snap.best.due} done
                </span>
              </div>
            )}
            {wins.slice(0, 4).map((t) => (
              <div key={t.id} className="flex items-center gap-2">
                <Trophy className="size-4 text-life" />
                <span className="flex-1 truncate">{t.title}</span>
                <span className="num text-muted-foreground text-xs">
                  {t.value}
                </span>
              </div>
            ))}
            {!snap.best && wins.length === 0 && (
              <div className="text-muted-foreground">
                A quiet one. Showing up is the target.
              </div>
            )}
          </Card>

          <SectionTitle
            action={
              <Link href="/stats/misses" className="text-primary text-xs">
                All {misses.length}
              </Link>
            }
          >
            Misses & leaks · top 3
          </SectionTitle>
          <Card className="px-3 py-1">
            {top.length === 0 ? (
              <div className="py-3 text-center text-muted-foreground text-sm">
                Nothing slipped.
              </div>
            ) : (
              top.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2 border-border/50 border-b py-2.5 text-sm last:border-0"
                >
                  <ModuleDot module={m.module} />
                  <span className="min-w-0 flex-1 truncate">{m.title}</span>
                  <Link
                    href={m.href}
                    className="rounded-full bg-muted px-2.5 py-1 font-medium text-xs"
                  >
                    Recover
                  </Link>
                </div>
              ))
            )}
          </Card>

          <SectionTitle
            action={
              <button
                type="button"
                onClick={() => setAiOn((v) => !v)}
                className="flex items-center gap-1 text-muted-foreground text-xs"
              >
                <EyeOff className="size-3" /> {aiOn ? "Hide" : "Show"}
              </button>
            }
          >
            AI summary
          </SectionTitle>
          {aiOn && (
            <Card className="border-primary/30 bg-gradient-to-br from-primary/10 to-transparent text-sm">
              <div className="mb-1 flex items-center gap-1.5 font-medium text-primary text-xs">
                <Sparkles className="size-3.5" /> Summary
              </div>
              <p>
                You hit the target on {snap.cur.onTarget} of {snap.cur.scored}{" "}
                scored days ({pct(snap.cur.rate)})
                {targetDelta !== null &&
                  `, ${targetDelta >= 0 ? "up" : "down"} ${Math.abs(targetDelta)} points on the ${p.kind} before`}
                .{" "}
                {strongest &&
                  `${AREA[strongest].label} carried it at ${Math.round(ls.rates[strongest] * 100)}%`}
                {weakest &&
                  weakest !== strongest &&
                  `, while ${AREA[weakest].label.toLowerCase()} lagged at ${Math.round(ls.rates[weakest] * 100)}%`}
                .
              </p>
              <p className="mt-2 text-muted-foreground">
                <b className="text-foreground">Try:</b>{" "}
                {weakest === "tasks"
                  ? "block 30 minutes on Saturday for anything pushed twice."
                  : weakest === "fitness"
                    ? "book your sessions on the calendar like meetings."
                    : weakest === "finance"
                      ? "set a no-spend day midweek to cool the leak."
                      : "stack your weakest habit onto the morning routine."}
              </p>
            </Card>
          )}

          <SectionTitle>Reflection</SectionTitle>
          <textarea
            value={reflection}
            onChange={(e) => setReflection(e.target.value.slice(0, 280))}
            rows={3}
            placeholder="What went right, what went wrong, one thing to change."
            aria-label="Review reflection"
            className="w-full rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-primary"
          />

          <SectionTitle>Next focus</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {focusOptions.map((o) => (
              <Chip
                key={o.ref}
                active={focus === o.ref}
                onClick={() => {
                  setFocus(o.ref)
                  setGoalFor(o.ref)
                }}
                className="h-11 text-xs"
              >
                {o.label}
              </Chip>
            ))}
          </div>
          <p className="mt-1 px-1 text-muted-foreground text-xs">
            Picking a focus offers to set or adjust its goal.
          </p>

          {p.kind === "month" && (
            <Card
              href="/finance/review"
              className="mt-4 flex items-center gap-3"
            >
              <AreaIcon k="finance" />
              <span className="flex-1 text-sm">
                <b>Monthly money review</b>
                <span className="block text-muted-foreground text-xs">
                  Month-end money review lives in Finance
                </span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Card>
          )}

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Btn
              href={`/stats/share?t=${p.kind === "week" ? "weekly" : "monthly"}`}
              variant="secondary"
            >
              <Share2 className="size-4" /> Share
            </Btn>
            <Btn onClick={done}>
              <Check className="size-4" /> {r?.done ? "Update" : "Mark done"}
            </Btn>
          </div>
        </>
      )}
      <GoalEditor
        open={!!goalFor}
        metric={goalFor ?? undefined}
        onClose={() => setGoalFor(null)}
      />
    </Screen>
  )
}
