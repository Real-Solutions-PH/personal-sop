"use client"

import { cn } from "@/lib/utils"
import { dayOffset } from "../lib/day"
import { type JournalEntry, MOODS, type Mood } from "./data"
import { MOOD_ICON } from "./ui"

const WEEKS = 8

/** Weekly mood on the 1–5 scale (faces as the axis), plus how often each mood came up. */
export function MoodTrend({ entries }: { entries: JournalEntry[] }) {
  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const w = WEEKS - 1 - i
    const from = dayOffset(-7 * w - 6)
    const to = dayOffset(-7 * w)
    const m = entries
      .filter((e) => e.mood && e.day >= from && e.day <= to)
      .map((e) => e.mood as number)
    return {
      label: w === 0 ? "Now" : `${w}w`,
      avg: m.length ? m.reduce((a, b) => a + b, 0) / m.length : null,
      n: m.length,
    }
  })
  const counts = MOODS.map(
    (x) =>
      entries.filter((e) => e.mood === x.v && e.day >= dayOffset(-7 * WEEKS))
        .length,
  )
  const total = counts.reduce((a, b) => a + b, 0)
  const cur = weeks.at(-1)?.avg ?? null
  const prev = weeks.at(-2)?.avg ?? null
  const curMood = cur !== null ? (Math.round(cur) as Mood) : null
  const CurIcon = curMood ? MOOD_ICON[curMood] : null
  const delta = cur !== null && prev !== null ? cur - prev : null

  // chart geometry (viewBox units)
  const W = 280
  const H = 110
  const left = 26
  const top = 8
  const bottom = 18
  const plotH = H - top - bottom
  const x = (i: number) => left + ((W - left - 8) * i) / (WEEKS - 1)
  const y = (v: number) => top + plotH - ((v - 1) / 4) * plotH

  // line segments broken at weeks without mood data
  const segs: string[] = []
  let seg = ""
  weeks.forEach((w, i) => {
    if (w.avg === null) {
      if (seg) segs.push(seg)
      seg = ""
      return
    }
    seg += `${seg ? "L" : "M"}${x(i)},${y(w.avg)} `
  })
  if (seg) segs.push(seg)

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-end justify-between">
        <div className="text-muted-foreground text-xs">
          Mood · {WEEKS} weeks
        </div>
        {CurIcon && cur !== null && (
          <div className="flex items-center gap-1.5 text-sm">
            <CurIcon className="size-4 text-life" aria-hidden="true" />
            <span className="font-medium">
              {MOODS.find((m) => m.v === curMood)?.label}
            </span>
            <span className="num text-muted-foreground text-xs">
              {cur.toFixed(1)}
            </span>
            {delta !== null && Math.abs(delta) >= 0.05 && (
              <span
                className={cn(
                  "num text-xs",
                  delta > 0 ? "text-good" : "text-bad",
                )}
              >
                {delta > 0 ? "▲" : "▼"}
                {Math.abs(delta).toFixed(1)}
              </span>
            )}
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Weekly average mood over ${WEEKS} weeks: ${weeks
          .map((w) => (w.avg === null ? "no entries" : w.avg.toFixed(1)))
          .join(", ")}`}
      >
        {MOODS.map((m) => {
          const I = MOOD_ICON[m.v]
          return (
            <g key={m.v}>
              <line
                x1={left}
                x2={W - 8}
                y1={y(m.v)}
                y2={y(m.v)}
                className="stroke-border"
                strokeDasharray="2 4"
              />
              <I
                x={2}
                y={y(m.v) - 7}
                width={14}
                height={14}
                className="text-muted-foreground"
              />
            </g>
          )
        })}
        {segs.map((d) => (
          <path
            key={d}
            d={d}
            fill="none"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="stroke-life"
          />
        ))}
        {weeks.map((w, i) =>
          w.avg === null ? (
            <circle
              key={w.label}
              cx={x(i)}
              cy={y(3)}
              r={3}
              className="fill-none stroke-muted-foreground/40"
            />
          ) : (
            <circle
              key={w.label}
              cx={x(i)}
              cy={y(w.avg)}
              r={i === WEEKS - 1 ? 5 : 3.5}
              className="fill-life stroke-card"
              strokeWidth={2}
            />
          ),
        )}
        {weeks.map((w, i) => (
          <text
            key={w.label}
            x={x(i)}
            y={H - 3}
            textAnchor="middle"
            className="fill-muted-foreground text-[9px]"
          >
            {w.label}
          </text>
        ))}
      </svg>

      {total > 0 && (
        <div className="mt-2 flex justify-between">
          {MOODS.map((m, i) => {
            const I = MOOD_ICON[m.v]
            return (
              <div
                key={m.v}
                className="flex flex-col items-center gap-0.5 text-[11px]"
              >
                <I
                  className={cn(
                    "size-4",
                    counts[i] ? "text-life" : "text-muted-foreground/50",
                  )}
                  aria-hidden="true"
                />
                <span className="text-muted-foreground">{m.label}</span>
                <span className="num font-medium">
                  {Math.round((counts[i] / total) * 100)}%
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
