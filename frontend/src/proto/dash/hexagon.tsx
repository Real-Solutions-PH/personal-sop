"use client"

import type { Facet } from "../../../../shared/prototype/dash/facets"
import type { ModuleKey } from "../contract"

export type { Facet } from "../../../../shared/prototype/dash/facets"
export { useFacets } from "../../../../shared/prototype/dash/facets"

import { cn } from "@/lib/utils"

// Area hexagon (Mobile-Legends-style stat radar). Six facets, because the four
// Life Score areas split naturally: Habits → habits + routines, Fitness →
// training + nutrition. The Life Score itself still weights the four areas.

const FACET_TEXT: Record<ModuleKey, string> = {
  habits: "text-hab",
  tasks: "text-tsk",
  fitness: "text-fit",
  nutrition: "text-nut",
  focus: "text-foc",
  finance: "text-fin",
}

const SIZE = 320
const C = SIZE / 2
const R = 100

function point(i: number, r: number): [number, number] {
  const a = ((-90 + i * 60) * Math.PI) / 180
  return [C + r * Math.cos(a), C + r * Math.sin(a)]
}
const poly = (vals: number[]) =>
  vals
    .map((v, i) => point(i, R * Math.max(0.04, Math.min(1, v))).join(","))
    .join(" ")

export function AreaHexagon({
  facets,
  selected,
  onSelect,
}: {
  facets: Facet[]
  selected: string | null
  onSelect: (key: string) => void
}) {
  const cur = facets.map((f) => (f.off ? 0 : f.value))
  const prev = facets.map((f) => (f.off ? 0 : f.prev))
  const summary = facets
    .map(
      (f) =>
        `${f.label} ${f.off ? "off" : `${Math.round(f.value * 100)} (previous ${Math.round(f.prev * 100)})`}`,
    )
    .join(", ")
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[340px]">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="absolute inset-0 size-full"
        role="img"
        aria-label={`Area hexagon: ${summary}`}
      >
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <polygon
            key={t}
            points={poly(Array(6).fill(t))}
            fill="none"
            className={cn(
              "stroke-border",
              t === 1 && "stroke-muted-foreground/40",
            )}
            strokeWidth={1}
          />
        ))}
        {facets.map((f, i) => {
          const [x, y] = point(i, R)
          return (
            <line
              key={f.key}
              x1={C}
              y1={C}
              x2={x}
              y2={y}
              className="stroke-border"
              strokeWidth={1}
            />
          )
        })}
        {/* previous period — dashed outline for comparison */}
        <polygon
          points={poly(prev)}
          fill="none"
          strokeDasharray="4 4"
          strokeWidth={1.5}
          className="stroke-muted-foreground"
        />
        <polygon
          points={poly(cur)}
          strokeWidth={2.5}
          strokeLinejoin="round"
          className="fill-life/25 stroke-life transition-all duration-500"
        />
        {cur.map((v, i) => {
          const [x, y] = point(i, R * Math.max(0.04, Math.min(1, v)))
          return (
            <circle
              key={facets[i].key}
              cx={x}
              cy={y}
              r={facets[i].key === selected ? 6 : 4}
              className="fill-life stroke-background"
              strokeWidth={2}
            />
          )
        })}
      </svg>
      {facets.map((f, i) => {
        const [x, y] = point(i, R + 38)
        const d = Math.round((f.value - f.prev) * 100)
        return (
          <button
            key={f.key}
            type="button"
            aria-pressed={selected === f.key}
            aria-label={`${f.label}: ${f.off ? "off" : `${Math.round(f.value * 100)}, ${d >= 0 ? "up" : "down"} ${Math.abs(d)} vs previous period`}. Show details`}
            onClick={() => onSelect(f.key)}
            className={cn(
              "-translate-x-1/2 -translate-y-1/2 absolute flex min-h-11 min-w-16 flex-col items-center justify-center rounded-xl px-2 leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected === f.key ? "bg-muted" : "active:bg-muted/60",
            )}
            style={{
              left: `${(x / SIZE) * 100}%`,
              top: `${(y / SIZE) * 100}%`,
            }}
          >
            <span
              className={cn(
                "num font-bold font-display text-xl",
                f.off ? "text-muted-foreground" : FACET_TEXT[f.module],
              )}
            >
              {f.off ? "—" : Math.round(f.value * 100)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {f.label}
              {!f.off && d !== 0 && (
                <span
                  className={cn("num ml-1", d > 0 ? "text-good" : "text-bad")}
                >
                  {d > 0 ? "▲" : "▼"}
                  {Math.abs(d)}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}

const FACET_FILL: Record<ModuleKey, string> = {
  habits: "fill-hab",
  tasks: "fill-tsk",
  fitness: "fill-fit",
  nutrition: "fill-nut",
  focus: "fill-foc",
  finance: "fill-fin",
}

/** Static share-card variant: no controls, labels drawn in the SVG, inherits
 *  the card's text colour so it reads on both the dark and light themes.
 *  Fills whatever height its flex parent gives it. */
export function ShareHexagon({
  facets,
  className,
}: {
  facets: Facet[]
  className?: string
}) {
  const cur = facets.map((f) => (f.off ? 0 : f.value))
  const prev = facets.map((f) => (f.off ? 0 : f.prev))
  const summary = facets
    .map(
      (f) =>
        `${f.label} ${f.off ? "off" : `${Math.round(f.value * 100)} (previous ${Math.round(f.prev * 100)})`}`,
    )
    .join(", ")
  return (
    <svg
      viewBox="-12 -6 344 332"
      className={cn("block size-full", className)}
      role="img"
      aria-label={`Area hexagon: ${summary}`}
    >
      {[0.25, 0.5, 0.75, 1].map((t) => (
        <polygon
          key={t}
          points={poly(Array(6).fill(t))}
          fill="none"
          stroke="currentColor"
          strokeOpacity={t === 1 ? 0.35 : 0.15}
          strokeWidth={1.5}
        />
      ))}
      {facets.map((f, i) => {
        const [x, y] = point(i, R)
        return (
          <line
            key={f.key}
            x1={C}
            y1={C}
            x2={x}
            y2={y}
            stroke="currentColor"
            strokeOpacity={0.15}
            strokeWidth={1.5}
          />
        )
      })}
      <polygon
        points={poly(prev)}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.6}
        strokeDasharray="6 5"
        strokeWidth={2}
      />
      <polygon
        points={poly(cur)}
        strokeWidth={3.5}
        strokeLinejoin="round"
        className="fill-life/30 stroke-life"
      />
      {facets.map((f, i) => {
        const [x, y] = point(i, R + 36)
        return (
          <text
            key={f.key}
            x={x}
            y={y}
            textAnchor="middle"
            className="font-display"
          >
            <tspan
              x={x}
              dy="-0.1em"
              fontSize={30}
              fontWeight={800}
              className={cn(
                "num",
                f.off ? "fill-current opacity-50" : FACET_FILL[f.module],
              )}
            >
              {f.off ? "—" : Math.round(f.value * 100)}
            </tspan>
            <tspan
              x={x}
              dy="1.05em"
              fontSize={18}
              fontWeight={600}
              className="fill-current opacity-75"
            >
              {f.label}
            </tspan>
          </text>
        )
      })}
    </svg>
  )
}
