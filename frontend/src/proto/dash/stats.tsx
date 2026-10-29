"use client"

import {
  BookOpen,
  CalendarRange,
  ChevronRight,
  Flame,
  Info,
  ListFilter,
  Minus,
  Plus,
  Share2,
  Target,
  Trophy,
  X,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import type { ModuleContract, ModuleKey } from "../contract"
import { dayKey, dayOffset } from "../lib/day"
import {
  Bars,
  Btn,
  Card,
  Empty,
  Heatmap,
  Screen,
  SectionTitle,
  Stat,
} from "../ui/kit"
import { AREA, MODULE_KEYS } from "./data"
import { GoalEditor, GoalRow } from "./goals"
import { AreaHexagon, useFacets } from "./hexagon"
import {
  daysOf,
  levelFor,
  moduleByKey,
  parseMetric,
  RANGES,
  type RangeKey,
  useAllMetrics,
  useAllMisses,
  useEnabled,
  useEnabledKeys,
  useGoals,
  useLifeScore,
  useOnTarget,
  useTrophies,
  useWeights,
} from "./hooks"
import { AllMetricsSheet } from "./metric-picker"
import { dashStore, resetWeights, setWeight } from "./store"
import {
  AreaIcon,
  BottomSheet,
  Delta,
  ErrorCard,
  fmtDay,
  Loading,
  pct,
  RangeSwitch,
  ScoreRing,
  useQueryParam,
  useViewState,
} from "./ui"

// DSH-20 Stats "player profile" · DSH-21 metric detail · DSH-29 not enough data.

export const ANALYTICS_HREF: Record<ModuleKey, string> = {
  habits: "/habits",
  tasks: "/tasks/stats",
  fitness: "/fitness/stats",
  nutrition: "/fitness?tab=eat",
  focus: "/stats",
  finance: "/finance/reports",
  screen: "/stats",
}

const RING_TEXT: Record<ModuleKey, string> = {
  habits: "text-hab",
  tasks: "text-tsk",
  fitness: "text-fit",
  nutrition: "text-nut",
  focus: "text-foc",
  finance: "text-fin",
  screen: "text-scr",
}
const BAR_BG: Record<ModuleKey, string> = {
  habits: "bg-hab",
  tasks: "bg-tsk",
  fitness: "bg-fit",
  nutrition: "bg-nut",
  focus: "bg-foc",
  finance: "bg-fin",
  screen: "bg-scr",
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("")

export function Avatar({ size = 64 }: { size?: number }) {
  const name = dashStore.use((s) => s.profile.name)
  const photo = dashStore.use((s) => s.profile.photo)
  return (
    <div
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-hab via-primary to-fit p-[3px]"
      style={{ width: size, height: size }}
    >
      {photo ? (
        // biome-ignore lint/performance/noImgElement: local data URL, nothing for next/image to optimise
        <img
          src={photo}
          alt={name}
          className="size-full rounded-full bg-card object-cover"
        />
      ) : (
        <div
          className="grid size-full place-items-center rounded-full bg-card font-bold tracking-tight"
          style={{ fontSize: size * 0.36 }}
        >
          {initials(name)}
        </div>
      )}
    </div>
  )
}

function ProfileHeader() {
  const p = dashStore.use((s) => s.profile)
  return (
    <div className="flex items-center gap-4 pt-1">
      <Avatar size={68} />
      <div className="min-w-0 flex-1">
        <div className="font-display truncate font-bold text-xl tracking-tight">
          {p.name}
        </div>
        <div className="text-muted-foreground text-sm">
          {p.handle} · since{" "}
          {fmtDay(p.since, { month: "short", year: "numeric" })}
        </div>
        {p.identities.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {p.identities.map((i) => (
              <span
                key={i.id}
                className="max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-[11px]"
              >
                {i.text}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ================================================================= Life Score hero

export function LifeScoreHero({
  days,
  onWeights,
}: {
  days: number
  onWeights: () => void
}) {
  const ls = useLifeScore(days)
  const enabled = useEnabled()
  const level = levelFor(ls.score)
  const toNext =
    level.next && ls.score !== null
      ? (ls.score - level.floor) / (level.next.floor - level.floor)
      : 1
  return (
    <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-hero-from via-hero-via to-hero-to p-5 text-white shadow-xl">
      <div className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-life/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-10 size-48 rounded-full bg-hab/30 blur-3xl" />
      <div className="relative flex items-center gap-4">
        <button
          type="button"
          onClick={onWeights}
          aria-label="How the Life Score is weighted"
          className="rounded-full active:scale-95"
        >
          <ScoreRing value={(ls.score ?? 0) / 100} size={148} stroke={11}>
            <div>
              <div className="font-display num font-black text-5xl leading-none tracking-tighter">
                {ls.score ?? "—"}
              </div>
              <div className="mt-1 text-[10px] text-white/60 uppercase tracking-[0.2em]">
                Life Score
              </div>
            </div>
          </ScoreRing>
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] text-white/60 uppercase tracking-[0.2em]">
            Level
          </div>
          <div className="font-display bg-gradient-to-r from-life to-fit bg-clip-text font-black text-2xl text-transparent uppercase italic tracking-tight">
            {level.name}
          </div>
          {level.next && (
            <div className="mt-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-life"
                  style={{ width: `${Math.max(4, toNext * 100)}%` }}
                />
              </div>
              <div className="mt-1 text-[11px] text-white/60">
                {level.next.floor - (ls.score ?? 0)} to {level.next.name}
              </div>
            </div>
          )}
          <div className="mt-2 flex items-center gap-1.5 text-xs">
            <Delta value={ls.delta} className="text-sm" />
            <span className="text-white/60">vs prior {days}d</span>
          </div>
          <button
            type="button"
            onClick={onWeights}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-white/70"
          >
            <Info className="size-3" /> How it's weighted
          </button>
        </div>
      </div>
      <div className="relative mt-4 grid grid-cols-4 gap-2">
        {MODULE_KEYS.map((k) => (
          <div key={k} className={cn("min-w-0", !enabled[k] && "opacity-30")}>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
              <div
                className={cn("h-full rounded-full", BAR_BG[k])}
                style={{ width: `${Math.round(ls.rates[k] * 100)}%` }}
              />
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-1 text-[10px] text-white/70">
              <span className="truncate">{AREA[k].label}</span>
              <span className="num font-semibold text-white">
                {enabled[k] ? Math.round(ls.rates[k] * 100) : "off"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ================================================================= Weights sheet

export function WeightsEditor({ days = 30 }: { days?: number }) {
  const weights = useWeights()
  const enabled = useEnabled()
  const ls = useLifeScore(days)
  const total = MODULE_KEYS.filter((k) => enabled[k]).reduce(
    (a, k) => a + weights[k],
    0,
  )
  return (
    <div>
      <div className="rounded-2xl bg-muted/50 p-3 text-sm">
        <b>Life Score</b> = weighted mean of each area's rate over the range.
        Weights are relative — only their ratio matters. Now:{" "}
        <b className="num">{ls.score ?? "—"}</b>
      </div>
      <div className="mt-3 space-y-1">
        {MODULE_KEYS.map((k) => {
          const share = enabled[k] && total ? weights[k] / total : 0
          return (
            <div
              key={k}
              className={cn(
                "flex items-center gap-3 py-2",
                !enabled[k] && "opacity-40",
              )}
            >
              <AreaIcon k={k} />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm">{AREA[k].label}</div>
                <div className="text-muted-foreground text-xs">
                  rate {pct(ls.rates[k])} ·{" "}
                  {enabled[k]
                    ? `${Math.round(share * 100)}% of score`
                    : "turned off"}
                </div>
              </div>
              <button
                type="button"
                aria-label={`Lower ${AREA[k].label} weight`}
                disabled={!enabled[k] || weights[k] <= 0}
                onClick={() => setWeight(k, weights[k] - 1)}
                className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring bg-muted disabled:opacity-40"
              >
                <Minus className="size-4" />
              </button>
              <span
                className={cn("num w-5 text-center font-bold", RING_TEXT[k])}
              >
                {weights[k]}
              </span>
              <button
                type="button"
                aria-label={`Raise ${AREA[k].label} weight`}
                disabled={!enabled[k] || weights[k] >= 5}
                onClick={() => setWeight(k, weights[k] + 1)}
                className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring bg-muted disabled:opacity-40"
              >
                <Plus className="size-4" />
              </button>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-muted-foreground text-xs">
        Area rates come from each section: habits = completion, tasks = on-time
        rate, fitness = sessions + calories on target, finance = savings rate +
        budgets on pace.
      </p>
      <Btn variant="ghost" className="mt-2 w-full" onClick={resetWeights}>
        Reset to default weights
      </Btn>
    </div>
  )
}

export function WeightsSheet({
  open,
  onClose,
  days,
}: {
  open: boolean
  onClose: () => void
  days: number
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Life Score weights">
      <WeightsEditor days={days} />
    </BottomSheet>
  )
}

// ================================================================= Stats profile

export function StatsScreen() {
  const state = useViewState()
  const rParam = useQueryParam("range")
  const [r, setRange] = useState<RangeKey>("7d")
  useEffect(() => {
    const hit = RANGES.find((x) => x.value === rParam)
    if (hit) setRange(hit.value)
  }, [rParam])
  const days = daysOf(r)
  const [weights, setWeightsOpen] = useState(false)
  const target = useOnTarget(days)
  const enough = target.logged >= 3 && state !== "empty"

  return (
    <Screen
      title="Stats"
      actions={
        <Link
          href="/stats/share?t=profile"
          aria-label="Share profile card"
          className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted"
        >
          <Share2 className="size-5" />
        </Link>
      }
    >
      <ProfileHeader />
      {state === "loading" ? (
        <Loading rows={4} />
      ) : !enough ? (
        <NotEnoughData logged={state === "empty" ? 0 : target.logged} />
      ) : (
        <>
          <div className="mt-4">
            <RangeSwitch
              value={r}
              onChange={(v) => {
                setRange(v)
                window.history.replaceState(null, "", `/stats?range=${v}`)
              }}
            />
          </div>
          <div className="mt-3">
            {state === "error" ? (
              <ErrorCard what="your Life Score" />
            ) : (
              <LifeScoreHero
                days={days}
                onWeights={() => setWeightsOpen(true)}
              />
            )}
          </div>
          <SecondaryStats days={days} />
          <FormCard days={days} />
          <RecordsStrip />
          <AreaSections days={days} />
          <MissesSummary days={days} />
          <GoalsSummary />
          <div className="mt-6 grid grid-cols-2 gap-2">
            <Card href="/stats/reviews" className="flex items-center gap-2">
              <CalendarRange className="size-5 text-primary" />
              <span className="flex-1 font-medium text-sm">Reviews</span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Card>
            <Card href="/stats/share" className="flex items-center gap-2">
              <Share2 className="size-5 text-primary" />
              <span className="flex-1 font-medium text-sm">Share card</span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Card>
          </div>
        </>
      )}
      <WeightsSheet
        open={weights}
        onClose={() => setWeightsOpen(false)}
        days={days}
      />
    </Screen>
  )
}

function NotEnoughData({ logged }: { logged: number }) {
  const steps = [
    { label: "Log 3 days of anything", done: logged >= 3 },
    { label: "Tick a habit or a task", done: logged >= 1 },
    { label: "Wrap up one evening", done: false },
  ]
  return (
    <Card className="mt-4">
      <Empty
        icon={<BookOpen className="size-8" />}
        title="Stats appear after 3 logged days"
        body={`You're at ${logged}/3. Keep logging — the profile fills itself.`}
      />
      <div className="space-y-2 px-2 pb-2">
        {steps.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-sm">
            <span
              className={cn(
                "grid size-5 place-items-center rounded-full text-[11px]",
                s.done ? "bg-good text-background" : "bg-muted",
              )}
            >
              {s.done ? "✓" : ""}
            </span>
            {s.label}
          </div>
        ))}
        <div className="flex gap-2 pt-2">
          <Btn href="/today" className="flex-1">
            Go to Today
          </Btn>
          <Btn href="/today" variant="secondary" className="flex-1">
            Capture
          </Btn>
        </div>
      </div>
    </Card>
  )
}

function SecondaryStats({ days }: { days: number }) {
  const target = useOnTarget(days)
  const delta =
    target.rate !== null && target.prevRate !== null
      ? Math.round((target.rate - target.prevRate) * 100)
      : undefined
  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      <Card className="p-3">
        <Stat label="On target" value={pct(target.rate)} delta={delta} />
      </Card>
      <Card className="p-3">
        <div className="font-display num flex items-center gap-0.5 font-semibold text-2xl tracking-tight text-life">
          <Flame className="size-5 fill-current" />
          {target.current}
        </div>
        <div className="text-muted-foreground text-xs">
          Streak · best {target.best}
        </div>
      </Card>
      <Card className="p-3">
        <Stat
          label="On-target days"
          value={
            <span>
              {target.onTarget}
              <span className="text-muted-foreground text-base">
                /{target.scored}
              </span>
            </span>
          }
        />
      </Card>
    </div>
  )
}

function FormCard({ days }: { days: number }) {
  const target = useOnTarget(days)
  const vals = target.range.map((d) => (d.due ? d.done / d.due : null))
  const scored = vals.filter((v): v is number => v !== null)
  const avg = scored.length
    ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 100)
    : null
  const summary = `Daily form, last ${days} days: average ${avg ?? "—"}% of due items done; ${target.onTarget} of ${target.scored} days on target.`
  return (
    <Card className="mt-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-semibold text-sm">Daily form</span>
        <span className="text-muted-foreground text-xs">
          habits + tasks done per day
        </span>
      </div>
      <div role="img" aria-label={summary}>
        {days <= 30 ? (
          <Bars
            data={vals.map((v) => v ?? 0)}
            labels={
              days === 7
                ? target.range.map((d) => fmtDay(d.day, { weekday: "narrow" }))
                : undefined
            }
            height={days === 7 ? 72 : 56}
            accent="life"
          />
        ) : (
          <Heatmap
            values={vals.slice(-(days >= 365 ? 364 : 91))}
            accent="life"
            flow="column"
            cell={days >= 365 ? 5 : 14}
          />
        )}
      </div>
      <div className="mt-2 text-muted-foreground text-xs">
        Avg {avg ?? "—"}% done · {target.onTarget}/{target.scored} days on
        target
      </div>
    </Card>
  )
}

function RecordsStrip() {
  const trophies = useTrophies().slice(0, 3)
  if (!trophies.length) return null
  return (
    <>
      <SectionTitle
        action={
          <Link href="/stats/trophies" className="text-primary text-xs">
            Trophy case
          </Link>
        }
      >
        Personal bests
      </SectionTitle>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {trophies.map((t) => (
          <Link
            key={t.id}
            href={`/stats/trophies?open=${encodeURIComponent(t.id)}`}
            className="w-36 shrink-0 rounded-2xl border border-life/30 bg-gradient-to-b from-life/15 to-transparent p-3"
          >
            <Trophy className="size-4 text-life" />
            <div className="font-display num mt-1 font-bold text-xl">
              {t.value}
            </div>
            <div className="truncate text-xs">{t.title}</div>
            <div className="text-[10px] text-muted-foreground">
              {fmtDay(t.day)}
            </div>
          </Link>
        ))}
      </div>
    </>
  )
}

function AreaSections({ days }: { days: number }) {
  const metrics = useAllMetrics(days)
  const facets = useFacets(days)
  const [sel, setSel] = useState<string | null>(null)
  const facet = facets.find((f) => f.key === sel)
  const k = facet?.module
  const [all, setAll] = useState(false)
  return (
    <>
      <SectionTitle
        action={
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setAll(true)}
            className="-my-3 -mr-2 flex min-h-11 items-center gap-1 rounded-lg px-2 text-primary text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ListFilter className="size-3.5" /> All metrics
          </button>
        }
      >
        Areas
      </SectionTitle>
      <AllMetricsSheet open={all} onClose={() => setAll(false)} days={days} />
      <Card className="px-2 pt-2 pb-4">
        <AreaHexagon
          facets={facets}
          selected={sel}
          onSelect={(key) => setSel((cur) => (cur === key ? null : key))}
        />
        <div className="mt-1 flex items-center justify-center gap-4 text-muted-foreground text-xs">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-life" /> This {days}d
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-muted-foreground border-t border-dashed" />{" "}
            Previous {days}d
          </span>
        </div>
        {!k && (
          <p className="mt-3 text-center text-muted-foreground text-xs">
            Tap an area for its stats
          </p>
        )}
        {k && facet && (
          <div className="mt-3 border-border/60 border-t px-2 pt-3">
            <div className="mb-1 flex items-center gap-2 px-2">
              <AreaIcon k={k} />
              <span className="flex-1 font-semibold">
                {AREA[k].label}
                {facet.label !== AREA[k].label && (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · {facet.label}
                  </span>
                )}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {[
                ...metrics[k].filter(
                  (m) => !facet.metricKeys || facet.metricKeys.includes(m.key),
                ),
                ...(facet.extra ?? []),
              ].map((m) => (
                <Link
                  key={m.key}
                  href={`/stats/metric/${encodeURIComponent(`${k}:${m.key}`)}?range=${days}`}
                  className="rounded-xl p-2 active:bg-muted/60"
                >
                  <Stat
                    label={m.label}
                    value={m.value}
                    delta={m.delta}
                    goodWhen={m.goodWhen}
                    className="[&>div:first-child]:text-xl"
                  />
                </Link>
              ))}
            </div>
            <Link
              href={facet.href}
              className={cn(
                "mt-1 flex min-h-11 items-center gap-1 px-2 font-medium text-sm",
                RING_TEXT[k],
              )}
            >
              Open {facet.label} details
              <ChevronRight className="size-4" />
            </Link>
          </div>
        )}
      </Card>
    </>
  )
}

function MissesSummary({ days }: { days: number }) {
  const t = dayKey()
  const cur = useAllMisses(dayOffset(-(days - 1)), t)
  const prev = useAllMisses(dayOffset(-(days * 2 - 1)), dayOffset(-days))
  const notes = dashStore.use((s) => s.missNotes)
  const keys = useEnabledKeys()
  const count = (list: typeof cur, k?: ModuleKey) =>
    list.filter((m) => (!k || m.module === k) && !notes[m.id]).length
  return (
    <>
      <SectionTitle
        action={
          <Link href="/stats/misses" className="text-primary text-xs">
            Misses & leaks
          </Link>
        }
      >
        Misses & leaks
      </SectionTitle>
      <Card href={`/stats/misses?range=${days}`}>
        <div className="flex items-baseline gap-2">
          <span className="font-display num font-bold text-3xl">
            {count(cur)}
          </span>
          <span className="text-muted-foreground text-sm">
            misses in {days}d
          </span>
          <Delta
            value={count(cur) - count(prev)}
            goodWhen="down"
            className="ml-auto"
          />
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {keys.map((k) => (
            <div key={k} className="rounded-xl bg-muted/50 p-2 text-center">
              <div className={cn("num font-semibold", RING_TEXT[k])}>
                {count(cur, k)}
              </div>
              <div className="truncate text-[10px] text-muted-foreground">
                {AREA[k].label}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}

function GoalsSummary() {
  const goals = useGoals()
    .filter((g) => g.goal.status === "active")
    .slice(0, 3)
  const [creating, setCreating] = useState(false)
  return (
    <>
      <SectionTitle
        action={
          <Link href="/stats/goals" className="text-primary text-xs">
            All goals
          </Link>
        }
      >
        Goals
      </SectionTitle>
      <Card className="px-3 py-1">
        {goals.length === 0 ? (
          <div className="py-3 text-center text-muted-foreground text-sm">
            No active goals.
          </div>
        ) : (
          goals.map((g) => (
            <Link key={g.goal.id} href="/stats/goals" className="block">
              <GoalRow g={g} />
            </Link>
          ))
        )}
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex w-full items-center justify-center gap-1.5 border-border/50 border-t py-2.5 font-medium text-primary text-sm"
        >
          <Target className="size-4" /> Set a goal
        </button>
      </Card>
      <GoalEditor open={creating} onClose={() => setCreating(false)} />
    </>
  )
}

// ================================================================= Metric detail (DSH-21)

export function MetricDetailScreen({ metricKey }: { metricKey: string }) {
  const [modKey, key] = metricKey.split(":") as [ModuleKey, string]
  const mod = moduleByKey[modKey]
  if (!mod || !key)
    return (
      <Screen title="Metric" back="/stats">
        <Empty
          icon={<X className="size-8" />}
          title="Unknown metric"
          body="This stat no longer exists."
          action={<Btn href="/stats">Back to Stats</Btn>}
        />
      </Screen>
    )
  return <MetricDetail mod={mod} metricKey={key} />
}

function MetricDetail({
  mod,
  metricKey,
}: {
  mod: Omit<ModuleContract, "TodayCard">
  metricKey: string
}) {
  const state = useViewState()
  const rParam = useQueryParam("range")
  const [d, setDays] = useState(7)
  useEffect(() => {
    const n = Number(rParam)
    if (RANGES.some((x) => x.days === n)) setDays(n)
  }, [rParam])
  const w = mod.useMetrics(7)
  const m = mod.useMetrics(30)
  const q = mod.useMetrics(90)
  const y = mod.useMetrics(365)
  const cur = mod.useMetrics(d)
  const misses = mod.useMisses(dayOffset(-(d - 1)), dayKey())
  const ref = `${mod.key}:${metricKey}`
  const goals = useGoals().filter(
    (g) => g.goal.metric === ref && g.goal.status === "active",
  )
  const [editor, setEditor] = useState(false)
  const metric = cur.find((x) => x.key === metricKey)
  const across = useMemo(
    () =>
      [w, m, q, y].map((list) => {
        const x = list.find((v) => v.key === metricKey)
        return x ? parseMetric(x.value) : null
      }),
    [w, m, q, y, metricKey],
  )
  const k = mod.key
  const goalable = metric ? parseMetric(metric.value) !== null : false

  return (
    <Screen title={metric?.label ?? "Metric"} back>
      {state === "loading" ? (
        <Loading rows={3} />
      ) : state === "error" || !metric ? (
        <ErrorCard what={metric?.label ?? "this metric"} />
      ) : (
        <>
          <div className="flex gap-2">
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setDays(r.days)}
                className={cn(
                  "h-11 flex-1 rounded-lg font-medium text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  d === r.days ? "bg-foreground text-background" : "bg-muted",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Card className="mt-3">
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <span className={cn("size-2 rounded-full", BAR_BG[k])} />
              {AREA[k].label} · last {d} days
            </div>
            <div
              className={cn(
                "font-display num mt-1 font-black text-5xl tracking-tight",
                RING_TEXT[k],
              )}
            >
              {metric.value}
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm">
              <Delta value={metric.delta} goodWhen={metric.goodWhen} />
              <span className="text-muted-foreground">
                vs previous {d} days
              </span>
            </div>
            {across.some((v) => v !== null) && (
              <div
                className="mt-4"
                role="img"
                aria-label={`${metric.label} by range: ${across
                  .map((v, i) => `${["7d", "30d", "90d", "1y"][i]} ${v ?? "—"}`)
                  .join(", ")}`}
              >
                <Bars
                  data={across.map((v) => Math.max(0, v ?? 0))}
                  labels={["7d", "30d", "90d", "1y"]}
                  accent={AREA[k].accent}
                  highlightLast={false}
                  height={64}
                />
              </div>
            )}
          </Card>

          <SectionTitle>Goal</SectionTitle>
          <Card className="px-3 py-1">
            {goals.map((g) => (
              <GoalRow key={g.goal.id} g={g} onClick={() => setEditor(true)} />
            ))}
            {goalable ? (
              <button
                type="button"
                onClick={() => setEditor(true)}
                className="flex w-full items-center justify-center gap-1.5 py-2.5 font-medium text-primary text-sm"
              >
                <Target className="size-4" />
                {goals.length ? "Edit goal" : "Set goal"}
              </button>
            ) : (
              <div className="py-3 text-muted-foreground text-sm">
                This one's a ratio — set goals on the numbers it's made of.
              </div>
            )}
          </Card>

          <SectionTitle>What moved it · {misses.length}</SectionTitle>
          {misses.length === 0 ? (
            <Card className="text-center text-muted-foreground text-sm">
              No misses in this range. Clean.
            </Card>
          ) : (
            <Card className="px-3 py-1">
              {misses.slice(0, 6).map((x) => (
                <Link
                  key={x.id}
                  href={x.href}
                  className="flex items-center gap-2 border-border/50 border-b py-2.5 text-sm last:border-0"
                >
                  <span className="flex-1 truncate">{x.title}</span>
                  <span className="text-muted-foreground text-xs">
                    {fmtDay(x.day)}
                  </span>
                </Link>
              ))}
            </Card>
          )}

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Btn href={ANALYTICS_HREF[k]} variant="secondary">
              Open {AREA[k].label}
            </Btn>
            {metric.shareable ? (
              <Btn
                href={`/stats/share?t=${k === "finance" ? "finance" : "weekly"}`}
              >
                <Share2 className="size-4" /> Share
              </Btn>
            ) : (
              <Btn variant="secondary" disabled>
                Private metric
              </Btn>
            )}
          </div>
          <GoalEditor
            open={editor}
            onClose={() => setEditor(false)}
            metric={ref}
            goal={goals[0]?.goal}
          />
        </>
      )}
    </Screen>
  )
}
