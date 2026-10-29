"use client"

import { AlertTriangle, RotateCw } from "lucide-react"
import { type ReactNode, useEffect, useId, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  SheetContent,
  SheetDescription,
  Sheet as SheetRoot,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import type { ModuleKey } from "../contract"
import { Btn, Card, Segmented } from "../ui/kit"
import { AREA } from "./data"
import { RANGES, type RangeKey } from "./hooks"

// ---------------------------------------------------------------- view state

export type ViewState = "loaded" | "empty" | "error" | "loading" | "new"

/** `?state=empty|error|loading|new` so the owner can walk every state. */
export function useViewState(): ViewState {
  const [v, setV] = useState<ViewState>("loaded")
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("state")
    if (s === "empty" || s === "error" || s === "loading" || s === "new")
      setV(s)
  }, [])
  return v
}

export function useQueryParam(name: string): string | null {
  const [v, setV] = useState<string | null>(null)
  useEffect(() => {
    setV(new URLSearchParams(window.location.search).get(name))
  }, [name])
  return v
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 pt-2" aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-2xl bg-muted/60"
          style={{ animationDelay: `${i * 90}ms` }}
        />
      ))}
    </div>
  )
}

export function ErrorCard({
  what,
  onRetry,
}: {
  what: string
  onRetry?: () => void
}) {
  return (
    <Card className="flex items-center gap-3 border-bad/30 bg-bad/5">
      <AlertTriangle className="size-5 shrink-0 text-bad" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium">Couldn't load {what}</div>
        <div className="text-muted-foreground text-xs">
          Your data is safe — this is a display error.
        </div>
      </div>
      <Btn
        variant="secondary"
        className="h-9 px-3"
        onClick={onRetry ?? (() => window.location.replace(location.pathname))}
      >
        <RotateCw className="size-4" /> Retry
      </Btn>
    </Card>
  )
}

// ---------------------------------------------------------------- sheets

/** Phone-column bottom sheet (shadcn Sheet constrained to max-w-md). */
export function BottomSheet({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <SheetRoot open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className={cn(
          "pb-safe mx-auto max-h-[90dvh] w-full max-w-md gap-0 overflow-y-auto rounded-t-3xl border-border/60 px-4 pt-3",
          className,
        )}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted" />
        <SheetTitle className="pr-8 text-lg">{title}</SheetTitle>
        <SheetDescription
          className={cn("mb-3 text-sm", !description && "sr-only")}
        >
          {description ?? title}
        </SheetDescription>
        <div className="pb-4">{children}</div>
      </SheetContent>
    </SheetRoot>
  )
}

export function Confirm({
  open,
  onClose,
  title,
  body,
  confirm,
  danger,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  title: string
  body: string
  confirm: string
  danger?: boolean
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2">
          <Btn variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Btn>
          <Btn
            variant={danger ? "danger" : "primary"}
            className="flex-1"
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirm}
          </Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- bits

export function RangeSwitch({
  value,
  onChange,
}: {
  value: RangeKey
  onChange: (v: RangeKey) => void
}) {
  return (
    <Segmented
      value={value}
      onChange={onChange}
      options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
    />
  )
}

export function Delta({
  value,
  goodWhen = "up",
  suffix = "",
  className,
}: {
  value: number | null | undefined
  goodWhen?: "up" | "down"
  suffix?: string
  className?: string
}) {
  if (value === null || value === undefined || value === 0)
    return (
      <span className={cn("num text-muted-foreground text-xs", className)}>
        ±0{suffix}
      </span>
    )
  const good = value > 0 === (goodWhen === "up")
  return (
    <span
      className={cn(
        "num font-medium text-xs",
        good ? "text-good" : "text-bad",
        className,
      )}
    >
      {value > 0 ? "▲" : "▼"}
      {Math.abs(Math.round(value * 10) / 10)}
      {suffix}
    </span>
  )
}

const AREA_TINT: Record<ModuleKey, string> = {
  habits: "bg-hab/15 text-hab",
  tasks: "bg-tsk/15 text-tsk",
  fitness: "bg-fit/15 text-fit",
  nutrition: "bg-nut/15 text-nut",
  focus: "bg-foc/15 text-foc",
  finance: "bg-fin/15 text-fin",
  screen: "bg-scr/15 text-scr",
}

/** Module glyph in its accent tint (lucide, never emoji — design MASTER). */
export function AreaIcon({
  k,
  size = "md",
  className,
}: {
  k: ModuleKey
  size?: "sm" | "md" | "lg"
  className?: string
}) {
  const Icon = AREA[k].icon
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-xl",
        size === "sm" ? "size-7" : size === "lg" ? "size-11" : "size-9",
        AREA_TINT[k],
        className,
      )}
    >
      <Icon className={size === "lg" ? "size-5" : "size-4"} />
    </span>
  )
}

/** Shared focus ring for custom (non-kit) controls. */
export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

export function ModuleDot({
  module,
  className,
}: {
  module: ModuleKey
  className?: string
}) {
  const bg = {
    habits: "bg-hab",
    tasks: "bg-tsk",
    fitness: "bg-fit",
    nutrition: "bg-nut",
    focus: "bg-foc",
    finance: "bg-fin",
    screen: "bg-scr",
  }[module]
  return (
    <span
      title={AREA[module].label}
      className={cn("inline-block size-2 shrink-0 rounded-full", bg, className)}
    >
      <span className="sr-only">{AREA[module].label}</span>
    </span>
  )
}

/** Big gradient score ring for the Life Score hero. */
export function ScoreRing({
  value,
  size = 168,
  stroke = 12,
  children,
}: {
  value: number
  size?: number
  stroke?: number
  children?: ReactNode
}) {
  const id = useId().replace(/:/g, "")
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        className="-rotate-90"
        role="img"
        aria-label={`${Math.round(v * 100)} of 100`}
      >
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--hab)" />
            <stop offset="50%" stopColor="var(--life)" />
            <stop offset="100%" stopColor="var(--fit)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted/70"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          stroke={`url(#g${id})`}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        {children}
      </div>
    </div>
  )
}

export const fmtDay = (key: string, opts?: Intl.DateTimeFormatOptions) =>
  new Date(`${key}T12:00:00`).toLocaleDateString(
    "en-PH",
    opts ?? { month: "short", day: "numeric" },
  )

export const pct = (v: number | null) =>
  v === null ? "—" : `${Math.round(v * 100)}%`
