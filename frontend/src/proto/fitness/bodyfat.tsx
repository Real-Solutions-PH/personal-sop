"use client"

import { Percent } from "lucide-react"
import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { Card, Sparkline } from "../ui/kit"
import { useFit } from "./store"

// Body fat trend on the Body tab. Fat and lean mass come from the weigh-in the
// % was logged with, so a cut shows whether the weight lost is fat or muscle.
export function BodyFatCard({ onLog }: { onLog: () => void }) {
  const s = useFit()
  const d = useMemo(() => {
    const pts = s.weighIns
      .filter((w) => w.bodyFatPct !== undefined)
      .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
    const last = pts.at(-1)
    if (!last) return null
    const cutoff = Date.now() - 30 * 86400_000
    const base = pts.find((p) => new Date(p.measuredAt).getTime() >= cutoff)
    const mass = (w: (typeof pts)[number]) => {
      const fat = (w.weightKg * (w.bodyFatPct ?? 0)) / 100
      return { fat, lean: w.weightKg - fat }
    }
    const now = mass(last)
    const then = base && base !== last ? mass(base) : undefined
    return {
      last,
      series: pts.slice(-20).map((p) => p.bodyFatPct ?? 0),
      delta:
        base && base !== last
          ? Math.round(((last.bodyFatPct ?? 0) - (base.bodyFatPct ?? 0)) * 10) /
            10
          : null,
      now,
      dFat: then ? now.fat - then.fat : null,
      dLean: then ? now.lean - then.lean : null,
    }
  }, [s.weighIns])
  const direction = s.settings.goalDirection

  if (!d)
    return (
      <Card className="mt-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-fit/15 text-fit">
            <Percent className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-sm">Track body fat</div>
            <div className="text-muted-foreground text-xs">
              Add it when you weigh in — from a smart scale or calipers.
            </div>
          </div>
          <button
            type="button"
            onClick={onLog}
            className="h-11 rounded-xl bg-muted px-3 font-semibold text-sm"
          >
            Add
          </button>
        </div>
      </Card>
    )

  // Falling body fat is good unless bulking, where holding steady is the aim.
  const good =
    d.delta === null
      ? null
      : direction === "bulk"
        ? d.delta <= 0.5
        : d.delta <= 0
  const fmtKg = (v: number) =>
    `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} kg`

  return (
    <Card className="mt-3">
      <div className="flex items-end justify-between">
        <div>
          <div className="num font-display font-semibold text-3xl text-fit">
            {d.last.bodyFatPct}%
          </div>
          <div className="text-muted-foreground text-xs">Body fat · latest</div>
        </div>
        {d.delta !== null && (
          <span className={cn("num text-sm", good ? "text-good" : "text-bad")}>
            {d.delta > 0 ? "▲" : d.delta < 0 ? "▼" : ""} {Math.abs(d.delta)} pts
            / 30d
          </span>
        )}
      </div>
      <div
        role="img"
        aria-label={`Body fat trend, latest ${d.last.bodyFatPct}%`}
      >
        <Sparkline data={d.series} accent="fit" height={48} className="mt-2" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-muted/50 px-3 py-2">
          <div className="text-muted-foreground text-xs">Fat mass</div>
          <div className="num font-semibold">
            {d.now.fat.toFixed(1)} kg
            {d.dFat !== null && (
              <span
                className={cn(
                  "ml-1.5 font-normal text-xs",
                  d.dFat <= 0 ? "text-good" : "text-bad",
                )}
              >
                {fmtKg(d.dFat)}
              </span>
            )}
          </div>
        </div>
        <div className="rounded-xl bg-muted/50 px-3 py-2">
          <div className="text-muted-foreground text-xs">Lean mass</div>
          <div className="num font-semibold">
            {d.now.lean.toFixed(1)} kg
            {d.dLean !== null && (
              <span
                className={cn(
                  "ml-1.5 font-normal text-xs",
                  d.dLean >= -0.3 ? "text-good" : "text-bad",
                )}
              >
                {fmtKg(d.dLean)}
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}
