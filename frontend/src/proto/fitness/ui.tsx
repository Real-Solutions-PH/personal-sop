"use client"

import { AlertTriangle, Minus, Plus, RotateCw } from "lucide-react"
import { useSearchParams } from "next/navigation"
import {
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { Btn, Card, Empty, NumberInput, Ring } from "../ui/kit"
import type { Macros } from "./data"

// Fitness-local UI pieces. Candidates for proto/ui once another module needs them.

export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[88dvh] max-w-md gap-0 rounded-t-3xl border-border/60 p-0"
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-muted" />
        <SheetHeader className="px-5 pt-3 pb-2">
          <SheetTitle className="text-lg">{title}</SheetTitle>
          <SheetDescription className={cn(!description && "sr-only")}>
            {description ?? "Bottom sheet"}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && (
          <div className="pb-safe border-border/60 border-t px-5 pt-3 pb-4">
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** Big +/- stepper; value editable by typing. */
export function Stepper({
  value,
  onChange,
  step,
  min = 0,
  max = 9999,
  label,
  unit,
  decimals = 1,
}: {
  value: number
  onChange: (v: number) => void
  step: number
  min?: number
  max?: number
  label?: string
  unit?: string
  decimals?: number
}) {
  const clamp = (v: number) =>
    Math.min(
      max,
      Math.max(min, Math.round(v * 10 ** decimals) / 10 ** decimals),
    )
  return (
    <div>
      {label && (
        <div className="mb-1.5 text-center text-muted-foreground text-xs uppercase tracking-wider">
          {label}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Decrease ${label ?? ""}`}
          onClick={() => onChange(clamp(value - step))}
          className="grid size-12 shrink-0 place-items-center rounded-2xl bg-muted active:scale-95"
        >
          <Minus className="size-5" />
        </button>
        <div className="flex min-w-0 flex-1 items-baseline justify-center gap-1">
          <NumberInput
            inputMode="decimal"
            aria-label={label}
            value={Number.isFinite(value) ? String(value) : ""}
            onChange={(e) => {
              const n = Number.parseFloat(e.target.value.replace(",", "."))
              onChange(Number.isFinite(n) ? n : 0)
            }}
            onBlur={() => onChange(clamp(value))}
            className="num w-full min-w-0 bg-transparent text-center font-semibold text-3xl outline-none"
          />
          {unit && (
            <span className="text-muted-foreground text-sm">{unit}</span>
          )}
        </div>
        <button
          type="button"
          aria-label={`Increase ${label ?? ""}`}
          onClick={() => onChange(clamp(value + step))}
          className="grid size-12 shrink-0 place-items-center rounded-2xl bg-muted active:scale-95"
        >
          <Plus className="size-5" />
        </button>
      </div>
    </div>
  )
}

// ── Toast with undo (module-local, survives route changes via the fitness layout) ──

interface Toast {
  id: number
  msg: string
  undo?: () => void
}
let toasts: Toast[] = []
const tl = new Set<() => void>()
const emitT = () => {
  for (const l of tl) l()
}
export function toast(msg: string, undo?: () => void) {
  const t = { id: Date.now() + Math.random(), msg, undo }
  toasts = [...toasts.slice(-1), t]
  emitT()
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id)
    emitT()
  }, 5000)
}
const empty: Toast[] = []
export function FitToaster() {
  const list = useSyncExternalStore(
    (l) => {
      tl.add(l)
      return () => tl.delete(l)
    },
    () => toasts,
    () => empty,
  )
  if (!list.length) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-36 z-40 mx-auto flex max-w-md flex-col gap-2 px-4">
      {list.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-foreground px-4 py-3 text-background text-sm shadow-xl"
        >
          <span className="flex-1">{t.msg}</span>
          {t.undo && (
            <button
              type="button"
              className="font-semibold text-fit"
              onClick={() => {
                t.undo?.()
                toasts = toasts.filter((x) => x.id !== t.id)
                emitT()
              }}
            >
              Undo
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ── View states (walk them with ?state=empty|error|loading) ──

export type ViewState = "loaded" | "empty" | "error" | "loading"
export function useViewState(): ViewState {
  const q = useSearchParams().get("state")
  return q === "empty" || q === "error" || q === "loading" ? q : "loaded"
}

export function ErrorState({
  title = "Couldn’t load this",
  body = "Saved on device — we’ll retry when you’re back online.",
}: {
  title?: string
  body?: string
}) {
  return (
    <Empty
      icon={<AlertTriangle className="size-8 text-bad" />}
      title={title}
      body={body}
      action={
        <Btn
          variant="secondary"
          onClick={() => window.location.replace(window.location.pathname)}
        >
          <RotateCw className="size-4" /> Retry
        </Btn>
      }
    />
  )
}

export function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div className="mt-4 space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted/60" />
      ))}
    </div>
  )
}

/** Re-render every `ms` (for timers). Returns Date.now(). */
export function useNow(ms = 1000) {
  const [n, setN] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setN(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return n
}

/** Hydration guard for pure client-only content (e.g. now-relative text). */
export function useMounted() {
  const [m, setM] = useState(false)
  useEffect(() => setM(true), [])
  return m
}

// ── Charts ──

/**
 * Line chart with optional raw dots and a goal line. `line` and `dots` are
 * index-aligned; undefined = gap.
 */
export function TrendChart({
  line,
  dots,
  goal,
  height = 160,
  labels,
  fmt = (n) => n.toFixed(1),
  className,
}: {
  line: (number | undefined)[]
  dots?: (number | undefined)[]
  goal?: number
  height?: number
  labels?: [string, string]
  fmt?: (n: number) => string
  className?: string
}) {
  const all = [
    ...line,
    ...(dots ?? []),
    ...(goal !== undefined ? [goal] : []),
  ].filter((v): v is number => v !== undefined)
  if (all.length < 2)
    return (
      <div
        style={{ height }}
        className="grid place-items-center text-muted-foreground text-sm"
      >
        Not enough data yet
      </div>
    )
  const W = 300
  const H = height
  const pad = { t: 10, b: 8, l: 4, r: 36 }
  let min = Math.min(...all)
  let max = Math.max(...all)
  const span0 = max - min || 1
  min -= span0 * 0.08
  max += span0 * 0.08
  const n = Math.max(line.length, dots?.length ?? 0)
  const x = (i: number) =>
    pad.l + (i / Math.max(1, n - 1)) * (W - pad.l - pad.r)
  const y = (v: number) =>
    pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b)
  let d = ""
  line.forEach((v, i) => {
    if (v === undefined) return
    d += `${d && line[i - 1] !== undefined ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `
  })
  const lastIdx = line
    .map((v, i) => (v === undefined ? -1 : i))
    .filter((i) => i >= 0)
    .at(-1)
  const ticks = [
    max - (max - min) * 0.08,
    (max + min) / 2,
    min + (max - min) * 0.08,
  ]
  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Trend chart"
      >
        <title>Trend chart</title>
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={y(t)}
              y2={y(t)}
              className="stroke-border"
              strokeDasharray="2 4"
            />
            <text
              x={W - pad.r + 4}
              y={y(t) + 3}
              className="fill-muted-foreground text-[9px]"
            >
              {fmt(t)}
            </text>
          </g>
        ))}
        {goal !== undefined && (
          <g>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={y(goal)}
              y2={y(goal)}
              className="stroke-good"
              strokeDasharray="5 4"
              strokeWidth={1.2}
            />
            <text
              x={pad.l + 2}
              y={y(goal) - 4}
              className="fill-good text-[9px]"
            >
              goal {fmt(goal)}
            </text>
          </g>
        )}
        {dots?.map((v, i) =>
          v === undefined ? null : (
            <circle
              key={i}
              cx={x(i)}
              cy={y(v)}
              r={2}
              className="fill-muted-foreground/50"
            />
          ),
        )}
        <path
          d={d}
          fill="none"
          strokeWidth={2.2}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="stroke-fit"
        />
        {lastIdx !== undefined && line[lastIdx] !== undefined && (
          <circle
            cx={x(lastIdx)}
            cy={y(line[lastIdx] as number)}
            r={4}
            className="fill-fit stroke-background"
            strokeWidth={2}
          />
        )}
      </svg>
      {labels && (
        <div className="mt-1 flex justify-between pr-9 text-[10px] text-muted-foreground">
          <span>{labels[0]}</span>
          <span>{labels[1]}</span>
        </div>
      )}
    </div>
  )
}

// ── Macros ──

export function MacroRings({
  totals,
  target,
  size = "lg",
}: {
  totals: Macros
  target?: Macros
  size?: "lg" | "sm"
}) {
  const big = size === "lg" ? 112 : 72
  const small = size === "lg" ? 60 : 44
  const left = target ? target.kcal - totals.kcal : undefined
  return (
    <div className="flex items-center gap-4">
      <Ring
        value={target ? totals.kcal / target.kcal : 0}
        size={big}
        stroke={size === "lg" ? 10 : 7}
        accent="nut"
      >
        <div>
          <div
            className={cn(
              "num font-semibold leading-none",
              size === "lg" ? "text-2xl" : "text-base",
              left !== undefined && left < 0 && "text-bad",
            )}
          >
            {left === undefined
              ? Math.round(totals.kcal)
              : Math.abs(Math.round(left))}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {left === undefined
              ? "kcal eaten"
              : left < 0
                ? "kcal over"
                : "kcal left"}
          </div>
        </div>
      </Ring>
      <div className="grid flex-1 grid-cols-3 gap-2">
        {(
          [
            ["protein", "Protein", "fit"],
            ["carbs", "Carbs", "tsk"],
            ["fat", "Fat", "life"],
          ] as const
        ).map(([k, label, acc]) => (
          <div key={k} className="flex flex-col items-center gap-1">
            <Ring
              value={target ? totals[k] / target[k] : 0}
              size={small}
              stroke={5}
              accent={acc}
            >
              <span className="num font-semibold text-xs">
                {Math.round(totals[k])}
              </span>
            </Ring>
            <div className="text-center text-[10px] text-muted-foreground leading-tight">
              {label}
              {target && (
                <div className="num">
                  {Math.max(0, Math.round(target[k] - totals[k]))}g left
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function MacroLine({ m, className }: { m: Macros; className?: string }) {
  return (
    <span className={cn("num text-muted-foreground text-xs", className)}>
      {Math.round(m.kcal)} kcal · P{Math.round(m.protein)} · C
      {Math.round(m.carbs)} · F{Math.round(m.fat)}
    </span>
  )
}

export function Pill({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode
  tone?: "muted" | "fit" | "nut" | "good" | "bad" | "warn"
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 font-medium text-[11px]",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "fit" && "bg-fit/15 text-fit",
        tone === "nut" && "bg-nut/15 text-nut",
        tone === "good" && "bg-good/15 text-good",
        tone === "bad" && "bg-bad/15 text-bad",
        tone === "warn" && "bg-warn/15 text-warn",
        className,
      )}
    >
      {children}
    </span>
  )
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <Card className="grid grid-cols-3 gap-3">{children}</Card>
}
