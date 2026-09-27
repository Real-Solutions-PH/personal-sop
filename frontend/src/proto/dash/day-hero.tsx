"use client"

import { Check, ChevronRight, Flame, Sparkles } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { ModuleKey } from "../contract"
import { type Accent, accentBg } from "../ui/kit"
import { useLifeScore, useOnTarget, useTodayRing } from "./hooks"

// Today's progress hero: one gauge against the target (with a visible target
// tick and the numbers as text), plus a per-area bullet bar underneath.

const AREAS: { key: ModuleKey; label: string; accent: Accent; href: string }[] =
  [
    { key: "habits", label: "Habits", accent: "hab", href: "/habits" },
    { key: "tasks", label: "Tasks", accent: "tsk", href: "/tasks" },
    { key: "fitness", label: "Fitness", accent: "fit", href: "/fitness" },
    { key: "finance", label: "Finance", accent: "fin", href: "/finance" },
  ]

function Gauge({ pct, target }: { pct: number; target: number }) {
  const size = 112
  const stroke = 11
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const hit = pct >= target
  // target tick position (0 = top, clockwise)
  const a = target * 2 * Math.PI - Math.PI / 2
  const tx = size / 2 + Math.cos(a) * r
  const ty = size / 2 + Math.sin(a) * r
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, pct))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className={cn(
            "transition-[stroke-dashoffset] duration-700 ease-out",
            hit ? "stroke-life" : "stroke-primary",
          )}
        />
        {/* target tick */}
        <circle
          cx={tx}
          cy={ty}
          r={4}
          className="fill-foreground stroke-card"
          strokeWidth={2}
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <div className="num font-display font-bold text-4xl leading-none">
          {Math.round(pct * 100)}
          <span className="text-xl text-muted-foreground">%</span>
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground uppercase tracking-wider">
          done
        </div>
      </div>
    </div>
  )
}

export function DayHero({
  threshold,
  sealed,
  enabled,
}: {
  threshold: number
  sealed: boolean
  enabled: Record<ModuleKey, boolean>
}) {
  const ring = useTodayRing()
  const streak = useOnTarget(7)
  const ls = useLifeScore(7)

  const free = ring.due === 0
  const pct = free ? 1 : ring.done / ring.due
  const need = Math.max(0, Math.ceil(ring.due * threshold) - ring.done)
  const allDone = !free && ring.done >= ring.due
  const headline = free
    ? "Free day"
    : allDone
      ? "Day complete"
      : need === 0
        ? "Target hit"
        : `${need} to target`
  const sub = free
    ? "Nothing due — your streak is safe."
    : `${ring.done} of ${ring.due} done · target ${Math.round(threshold * 100)}%${sealed ? " · wrapped up" : ""}`

  const areas = AREAS.filter((a) => enabled[a.key] && ring.per[a.key].due > 0)

  return (
    <section
      aria-label={`Today's progress: ${ring.done} of ${ring.due} done, ${headline}`}
      className="overflow-hidden rounded-3xl border border-border/60 bg-card"
    >
      <div className="relative bg-gradient-to-br from-primary/15 via-transparent to-hab/10 p-4">
        <div className="flex items-center gap-4">
          <Gauge pct={pct} target={threshold} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs uppercase tracking-wider">
              Today
            </div>
            <div className="font-display font-bold text-2xl leading-tight">
              {(allDone || (need === 0 && !free)) && (
                <Check
                  className="mr-1 inline size-5 text-life"
                  aria-hidden="true"
                />
              )}
              {headline}
            </div>
            <div className="mt-0.5 text-muted-foreground text-sm">{sub}</div>
            <div className="mt-3 flex gap-2">
              <Link
                href="/stats"
                aria-label={`On-target streak ${streak.current} days, best ${streak.best}`}
                className="inline-flex h-9 items-center gap-1 rounded-full bg-life/15 px-2.5 font-semibold text-life text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Flame className="size-4 fill-current" aria-hidden="true" />
                <span className="num">{streak.current}</span>
                <span className="font-normal text-xs">streak</span>
              </Link>
              <Link
                href="/stats"
                aria-label={`Life Score ${ls.score ?? "not available yet"}`}
                className="inline-flex h-9 items-center gap-1 rounded-full bg-muted px-2.5 font-semibold text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Sparkles className="size-4 text-life" aria-hidden="true" />
                <span className="num">{ls.score ?? "—"}</span>
                <span className="font-normal text-muted-foreground text-xs">
                  score
                </span>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {areas.length > 0 && (
        <ul className="divide-y divide-border/60 border-border/60 border-t">
          {areas.map((a) => {
            const p = ring.per[a.key]
            const done = Math.min(p.done, p.due)
            return (
              <li key={a.key}>
                <Link
                  href={a.href}
                  className="flex min-h-12 items-center gap-3 px-4 py-2 outline-none focus-visible:bg-muted active:bg-muted/60"
                >
                  <span className="w-16 shrink-0 font-medium text-sm">
                    {a.label}
                  </span>
                  <span className="relative h-2 flex-1 rounded-full bg-muted">
                    <span
                      className={cn(
                        "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500",
                        accentBg[a.accent],
                      )}
                      style={{ width: `${(done / p.due) * 100}%` }}
                    />
                    {/* target marker */}
                    <span
                      aria-hidden="true"
                      className="-translate-x-1/2 -top-1 absolute h-4 w-0.5 rounded-full bg-foreground/70"
                      style={{ left: `${threshold * 100}%` }}
                    />
                  </span>
                  <span className="num w-10 shrink-0 text-right text-muted-foreground text-sm">
                    {done}/{p.due}
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
