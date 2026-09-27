"use client"

import {
  AlertTriangle,
  Banknote,
  CreditCard,
  Delete,
  Landmark,
  RefreshCw,
  Smartphone,
  TrendingUp,
} from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import type { ReactNode } from "react"
import { toast } from "sonner"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { privacyStore } from "../lib/privacy"
import { Money, SwitchTrack } from "../ui/kit"
import { compact, timeOf } from "./calc"
import type { Account, AccountType, Category, FinRecord } from "./data"

// ------------------------------------------------------------------ sheet

/** Bottom sheet sized to the phone column (FIN sheets). */
export function FinSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92dvh] w-full max-w-md gap-0 rounded-t-3xl border-x p-0"
      >
        <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-muted" />
        <div className="px-5 pt-3 pb-2">
          <SheetTitle className="text-lg">{title}</SheetTitle>
          <SheetDescription className={cn(!description && "sr-only")}>
            {description ?? "Finance sheet"}
          </SheetDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {children}
        </div>
        {footer && (
          <div className="pb-safe border-border/60 border-t bg-background px-5 pt-3 pb-4">
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ------------------------------------------------------------------ badges

const ACCT_ICON: Record<AccountType, typeof Banknote> = {
  cash: Banknote,
  bank: Landmark,
  ewallet: Smartphone,
  credit: CreditCard,
  investment: TrendingUp,
}
export const ACCT_GROUP: Record<AccountType, string> = {
  cash: "Cash",
  bank: "Banks",
  ewallet: "E-wallets",
  credit: "Credit cards",
  investment: "Savings & investments",
}

export function AcctIcon({
  acct,
  size = "md",
}: {
  acct?: Account
  size?: "sm" | "md"
}) {
  const Icon = ACCT_ICON[acct?.type ?? "cash"]
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full text-white",
        size === "sm" ? "size-6" : "size-10",
      )}
      style={{ background: acct?.color ?? "#64748b" }}
    >
      <Icon className={size === "sm" ? "size-3.5" : "size-5"} />
    </span>
  )
}

export function CatIcon({
  cat,
  size = "md",
}: {
  cat?: Category
  size?: "sm" | "md"
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-muted",
        size === "sm" ? "size-7 text-sm" : "size-10 text-lg",
      )}
    >
      {cat?.icon ?? "💸"}
    </span>
  )
}

export function Pill({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode
  tone?: "muted" | "fin" | "good" | "bad" | "warn"
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-[11px]",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "fin" && "bg-fin/15 text-fin",
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

const SOURCE_LABEL: Record<FinRecord["source"], string> = {
  chat: "chat",
  "quick-add": "quick",
  photo: "receipt",
  import: "import",
  planned: "scheduled",
  manual: "manual",
  adjustment: "adjust",
}
export const sourceLabel = (s: FinRecord["source"]) => SOURCE_LABEL[s]

/** One record line — icon, payee, category · account, signed amount. */
export function RecordRow({
  r,
  cats,
  accts,
  onClick,
  href,
  showTime = true,
  selected,
}: {
  r: FinRecord
  cats: Map<string, Category>
  accts: Map<string, Account>
  onClick?: () => void
  href?: string
  showTime?: boolean
  selected?: boolean
}) {
  const cat = r.categoryId ? cats.get(r.categoryId) : undefined
  const acct = accts.get(r.accountId)
  const to = r.toAccountId ? accts.get(r.toAccountId) : undefined
  const title =
    r.type === "transfer"
      ? (r.payee ?? `${acct?.name} → ${to?.name}`)
      : (r.payee ?? cat?.name ?? "Untitled")
  const sub =
    r.type === "transfer"
      ? `${acct?.name ?? "?"} → ${to?.name ?? "?"}`
      : `${cat?.name ?? "Uncategorised"} · ${acct?.name ?? "?"}`
  const value =
    r.type === "income" ? r.amount : r.type === "expense" ? -r.amount : 0
  const inner = (
    <>
      <div className="relative">
        {r.type === "transfer" ? (
          <span className="grid size-10 place-items-center rounded-full bg-muted text-lg">
            ⇄
          </span>
        ) : (
          <CatIcon cat={cat} />
        )}
        {selected && (
          <span className="absolute inset-0 grid place-items-center rounded-full bg-fin text-background">
            ✓
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{title}</span>
          {r.status === "pending" && <Pill tone="warn">review</Pill>}
          {r.isRefund && <Pill tone="good">refund</Pill>}
          {r.isAdjustment && <Pill>adjust</Pill>}
        </div>
        <div className="truncate text-muted-foreground text-xs">
          {sub}
          {showTime && ` · ${timeOf(r.at)}`}
          {r.source !== "manual" && ` · ${sourceLabel(r.source)}`}
        </div>
      </div>
      <div className="shrink-0 text-right">
        {r.type === "transfer" ? (
          <Money value={r.amount} className="text-muted-foreground" />
        ) : (
          <Money
            value={value}
            signed
            className={cn("font-semibold", value < 0 && "text-foreground")}
          />
        )}
      </div>
    </>
  )
  const cls = cn(
    "flex min-h-14 w-full items-center gap-3 rounded-xl px-1 py-2 text-left active:bg-muted/60",
    selected && "bg-fin/10",
  )
  if (href)
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    )
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  )
}

// ------------------------------------------------------------------ charts

const TONE_STROKE = {
  fin: "stroke-fin",
  muted: "stroke-muted-foreground",
  bad: "stroke-bad",
  warn: "stroke-warn",
  tsk: "stroke-tsk",
} as const
const TONE_FILL = {
  fin: "fill-fin",
  muted: "fill-muted-foreground",
  bad: "fill-bad",
  warn: "fill-warn",
  tsk: "fill-tsk",
} as const
export type Tone = keyof typeof TONE_STROKE

/** Multi-series line chart with y ticks, x labels, optional floor line. */
export function LineChart({
  series,
  labels,
  floor,
  height = 170,
  zero,
}: {
  series: { values: number[]; tone: Tone; dashed?: boolean; area?: boolean }[]
  labels: string[]
  floor?: number
  height?: number
  zero?: boolean
}) {
  const hidden = privacyStore.use((s) => s.hidden)
  const W = 340
  const padL = 40
  const padR = 8
  const padT = 10
  const padB = 20
  const all = series.flatMap((s) => s.values)
  if (floor !== undefined) all.push(floor)
  if (zero) all.push(0)
  let min = Math.min(...all)
  let max = Math.max(...all)
  if (min === max) {
    min -= 1
    max += 1
  }
  const span = max - min
  min -= span * 0.08
  max += span * 0.08
  const n = Math.max(2, series[0]?.values.length ?? 2)
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR)
  const y = (v: number) =>
    padT + (1 - (v - min) / (max - min)) * (height - padT - padB)
  const ticks = [
    max - (max - min) * 0.08,
    (max + min) / 2,
    min + (max - min) * 0.08,
  ]
  const labelEvery = Math.ceil(labels.length / 6)
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      className="w-full"
      role="img"
      aria-label="chart"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={padL}
            x2={W - padR}
            y1={y(t)}
            y2={y(t)}
            className="stroke-border"
            strokeDasharray="2 4"
          />
          <text
            x={padL - 6}
            y={y(t) + 3}
            textAnchor="end"
            className={cn(
              "fill-muted-foreground text-[9px]",
              hidden && "blur-amount",
            )}
          >
            {compact(t)}
          </text>
        </g>
      ))}
      {floor !== undefined && (
        <g>
          <line
            x1={padL}
            x2={W - padR}
            y1={y(floor)}
            y2={y(floor)}
            className="stroke-warn"
            strokeDasharray="4 3"
          />
          <text
            x={W - padR}
            y={y(floor) - 3}
            textAnchor="end"
            className="fill-warn text-[8px]"
          >
            minimum
          </text>
        </g>
      )}
      {series.map((s, si) => {
        if (s.values.length < 2) return null
        const d = s.values
          .map(
            (v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`,
          )
          .join(" ")
        return (
          <g key={si}>
            {s.area && (
              <path
                d={`${d} L${x(s.values.length - 1)},${height - padB} L${x(0)},${height - padB} Z`}
                className={cn(TONE_FILL[s.tone], "opacity-10")}
              />
            )}
            <path
              d={d}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeDasharray={s.dashed ? "5 4" : undefined}
              className={TONE_STROKE[s.tone]}
            />
            {!s.dashed && (
              <circle
                cx={x(s.values.length - 1)}
                cy={y(s.values[s.values.length - 1])}
                r={3}
                className={TONE_FILL[s.tone]}
              />
            )}
          </g>
        )
      })}
      {labels.map((l, i) =>
        i % labelEvery === 0 || i === labels.length - 1 ? (
          <text
            key={`${l}-${i}`}
            x={x(i)}
            y={height - 5}
            textAnchor="middle"
            className="fill-muted-foreground text-[9px]"
          >
            {l}
          </text>
        ) : null,
      )}
    </svg>
  )
}

export const PALETTE = [
  { stroke: "stroke-fin", bg: "bg-fin" },
  { stroke: "stroke-tsk", bg: "bg-tsk" },
  { stroke: "stroke-hab", bg: "bg-hab" },
  { stroke: "stroke-fit", bg: "bg-fit" },
  { stroke: "stroke-life", bg: "bg-life" },
  { stroke: "stroke-warn", bg: "bg-warn" },
  { stroke: "stroke-muted-foreground", bg: "bg-muted-foreground" },
]

/** Donut from values (palette order). */
export function Donut({
  values,
  size = 132,
  children,
}: {
  values: number[]
  size?: number
  children?: ReactNode
}) {
  const stroke = 16
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const total = values.reduce((s, v) => s + Math.max(0, v), 0) || 1
  let acc = 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        className="-rotate-90"
        role="img"
        aria-label="Breakdown chart"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        {values.map((v, i) => {
          const len = (Math.max(0, v) / total) * circ
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={stroke}
              strokeDasharray={`${Math.max(0, len - 2)} ${circ}`}
              strokeDashoffset={-acc}
              className={PALETTE[i % PALETTE.length].stroke}
            />
          )
          acc += len
          return el
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        {children}
      </div>
    </div>
  )
}

/** Paired bars (e.g. income vs spend) per label. */
export function PairBars({
  pairs,
  labels,
  height = 96,
}: {
  pairs: [number, number][]
  labels: string[]
  height?: number
}) {
  const max = Math.max(1, ...pairs.flat())
  return (
    <div>
      <div className="flex items-end gap-3" style={{ height }}>
        {pairs.map(([a, b], i) => (
          <div key={labels[i]} className="flex h-full flex-1 items-end gap-1">
            <div
              className="flex-1 rounded-t-md bg-good/80"
              style={{ height: `${Math.max(2, (a / max) * 100)}%` }}
            />
            <div
              className="flex-1 rounded-t-md bg-bad/70"
              style={{ height: `${Math.max(2, (b / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-3">
        {labels.map((l) => (
          <div
            key={l}
            className="flex-1 text-center text-[10px] text-muted-foreground"
          >
            {l}
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ keypad

export function Keypad({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const press = (k: string) => {
    if (k === "del") return onChange(value.slice(0, -1))
    if (k === "." && value.includes(".")) return
    if (value.includes(".") && value.split(".")[1].length >= 2) return
    if (value.replace(".", "").length >= 8) return
    if (k === "000") return onChange(value ? `${value}000` : "")
    onChange(value === "0" && k !== "." ? k : value + k)
  }
  return (
    <div className="grid grid-cols-3 gap-2">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0", "del"].map(
        (k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            aria-label={k === "del" ? "Backspace" : k}
            className="grid h-12 place-items-center rounded-xl bg-muted/60 font-semibold text-xl active:bg-muted"
          >
            {k === "del" ? <Delete className="size-5" /> : k}
          </button>
        ),
      )}
    </div>
  )
}

/** Big amount readout for keypad sheets. */
export function AmountDisplay({
  value,
  tone,
}: {
  value: string
  tone: "expense" | "income" | "transfer"
}) {
  const n = Number(value || 0)
  return (
    <div
      className={cn(
        "num py-2 text-center font-semibold text-5xl tracking-tight",
        tone === "income" && "text-good",
        tone === "transfer" && "text-tsk",
        !value && "text-muted-foreground/50",
      )}
    >
      ₱{n.toLocaleString("en-PH", { maximumFractionDigits: 2 })}
    </div>
  )
}

// ------------------------------------------------------------------ states

/** `?state=empty|error|loading` lets the owner walk every state of a screen. */
export function useDemoState(): "empty" | "error" | "loading" | null {
  const sp = useSearchParams()
  const s = sp.get("state")
  return s === "empty" || s === "error" || s === "loading" ? s : null
}

export function StaleBanner({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="mb-3 flex items-center gap-2 rounded-xl bg-warn/15 px-3 py-2.5 text-sm text-warn">
      <AlertTriangle className="size-4 shrink-0" />
      <span className="flex-1">
        Couldn't refresh — showing data from 2 hours ago.
      </span>
      <button
        type="button"
        onClick={onRetry ?? (() => toast("Retrying…"))}
        className="flex items-center gap-1 font-semibold"
      >
        <RefreshCw className="size-3.5" /> Retry
      </button>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-2xl bg-muted/70", className)} />
  )
}

export function LoadingList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 pt-2">
      <Skeleton className="h-28" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </div>
  )
}

/** Toast with an Undo action. */
export function undoToast(message: string, undo: () => void) {
  toast(message, { action: { label: "Undo", onClick: undo }, duration: 5000 })
}

/** Plain-language disclaimer footer for AI output (FIN-32/33). */
export function NotAdvice({ className }: { className?: string }) {
  return (
    <p className={cn("text-[11px] text-muted-foreground", className)}>
      AI commentary from your own data — not licensed financial advice.
    </p>
  )
}

// ------------------------------------------------------------------ form bits

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  hint?: ReactNode
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 py-2.5 text-left"
    >
      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm">{label}</div>
        {hint && <div className="text-muted-foreground text-xs">{hint}</div>}
      </div>
      <SwitchTrack on={checked} accent="fin" />
    </button>
  )
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: ReactNode
  error?: string | null
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5 py-2">
      <div className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
        {label}
      </div>
      {children}
      {error ? (
        <div className="text-bad text-xs">{error}</div>
      ) : hint ? (
        <div className="text-muted-foreground text-xs">{hint}</div>
      ) : null}
    </div>
  )
}

export const inputCls =
  "h-11 w-full rounded-xl border border-border bg-card px-3 text-base outline-none focus:border-fin"

/** Horizontal scroll row of chips. */
export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
      {children}
    </div>
  )
}
