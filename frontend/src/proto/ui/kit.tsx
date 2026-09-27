"use client"

import { ChevronLeft } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  type ComponentProps,
  type ComponentType,
  type InputHTMLAttributes,
  type ReactNode,
  useLayoutEffect,
  useRef,
} from "react"
import { cn } from "@/lib/utils"
import { peso } from "../lib/day"
import { privacyStore } from "../lib/privacy"

// Shared mobile UI kit for the prototype. Module screens compose these; module
// accents are the tailwind colours hab / tsk / fit / fin / life / good / bad / warn.

export type Accent = "hab" | "tsk" | "fit" | "fin" | "life" | "primary"
const accentText: Record<Accent, string> = {
  hab: "text-hab",
  tsk: "text-tsk",
  fit: "text-fit",
  fin: "text-fin",
  life: "text-life",
  primary: "text-primary",
}
const accentStroke: Record<Accent, string> = {
  hab: "stroke-hab",
  tsk: "stroke-tsk",
  fit: "stroke-fit",
  fin: "stroke-fin",
  life: "stroke-life",
  primary: "stroke-primary",
}
const accentFill: Record<Accent, string> = {
  hab: "fill-hab",
  tsk: "fill-tsk",
  fit: "fill-fit",
  fin: "fill-fin",
  life: "fill-life",
  primary: "fill-primary",
}
const accentBg: Record<Accent, string> = {
  hab: "bg-hab",
  tsk: "bg-tsk",
  fit: "bg-fit",
  fin: "bg-fin",
  life: "bg-life",
  primary: "bg-primary",
}

export { accentBg, accentText }

/** Screen scaffold: sticky header (optional back), scrollable body. */
export function Screen({
  title,
  back,
  actions,
  children,
  className,
}: {
  title?: ReactNode
  /** true = previous page (Today if none); string = href */
  back?: boolean | string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  const router = useRouter()
  return (
    <div className="flex min-h-full flex-col">
      {(title || back || actions) && (
        <header className="pt-safe sticky top-0 z-20 bg-background/85 backdrop-blur-md">
          <div className="flex h-14 items-center gap-1 px-2">
            {back &&
              (typeof back === "string" ? (
                <Link
                  href={back}
                  aria-label="Back"
                  className="grid size-10 place-items-center rounded-full hover:bg-muted"
                >
                  <ChevronLeft className="size-5" />
                </Link>
              ) : (
                <button
                  type="button"
                  aria-label="Back"
                  onClick={() =>
                    // Opened directly (deep link, notification): no in-app history.
                    window.history.length > 1
                      ? router.back()
                      : router.push("/today")
                  }
                  className="grid size-10 place-items-center rounded-full hover:bg-muted"
                >
                  <ChevronLeft className="size-5" />
                </button>
              ))}
            <h1
              className={cn(
                "flex-1 truncate font-display font-semibold text-xl",
                !back && "px-2 text-3xl",
              )}
            >
              {title}
            </h1>
            <div className="flex items-center gap-1 pr-1">{actions}</div>
          </div>
        </header>
      )}
      <div className={cn("flex-1 px-4 pb-6", className)}>{children}</div>
    </div>
  )
}

export function Card({
  children,
  className,
  href,
  onClick,
}: {
  children: ReactNode
  className?: string
  href?: string
  onClick?: () => void
}) {
  const cls = cn(
    "block rounded-2xl border border-border/60 bg-card p-4 text-left",
    (href || onClick) && "transition-colors active:bg-muted/60",
    className,
  )
  if (href)
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    )
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cn(cls, "w-full")}>
        {children}
      </button>
    )
  return <div className={cls}>{children}</div>
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mt-6 mb-2 flex items-center justify-between px-1">
      <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
        {children}
      </h2>
      {action}
    </div>
  )
}

/** Big number + label, optional delta vs previous period. */
export function Stat({
  label,
  value,
  delta,
  goodWhen = "up",
  accent,
  className,
}: {
  label: ReactNode
  value: ReactNode
  delta?: number // percentage points or %, signed
  goodWhen?: "up" | "down"
  accent?: Accent
  className?: string
}) {
  const good = delta === undefined ? null : delta >= 0 === (goodWhen === "up")
  return (
    <div className={cn("min-w-0", className)}>
      <div
        className={cn(
          "num truncate font-display font-semibold text-3xl",
          accent && accentText[accent],
        )}
      >
        {value}
      </div>
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <span className="truncate">{label}</span>
        {delta !== undefined && delta !== 0 && (
          <span className={cn("num", good ? "text-good" : "text-bad")}>
            {delta > 0 ? "▲" : "▼"}
            {Math.abs(delta)}
          </span>
        )}
      </div>
    </div>
  )
}

/** Progress ring. value 0..1 */
export function Ring({
  value,
  size = 56,
  stroke = 6,
  accent = "primary",
  children,
}: {
  value: number
  size?: number
  stroke?: number
  accent?: Accent
  children?: ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
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
          strokeDashoffset={c * (1 - v)}
          className={cn(
            accentStroke[accent],
            "transition-[stroke-dashoffset] duration-500",
          )}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center font-display">
        {children}
      </div>
    </div>
  )
}

/** Horizontal progress bar. value 0..1 (over 1 renders as overflow in bad colour). */
export function Bar({
  value,
  accent = "primary",
  className,
}: {
  value: number
  accent?: Accent
  className?: string
}) {
  const over = value > 1
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          over ? "bg-bad" : accentBg[accent],
        )}
        style={{ width: `${Math.min(1, Math.max(0, value)) * 100}%` }}
      />
    </div>
  )
}

/** Minimal line/area chart. */
export function Sparkline({
  data,
  height = 48,
  accent = "primary",
  area = true,
  className,
}: {
  data: number[]
  height?: number
  accent?: Accent
  area?: boolean
  className?: string
}) {
  if (data.length < 2) return <div style={{ height }} className={className} />
  const w = 100
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const pts = data.map(
    (d, i) =>
      [
        (i / (data.length - 1)) * w,
        height - ((d - min) / span) * (height - 4) - 2,
      ] as const,
  )
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ")
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className={cn("w-full", className)}
      style={{ height }}
      aria-hidden="true"
    >
      {area && (
        <path
          d={`${line} L${w},${height} L0,${height} Z`}
          className={cn(accentFill[accent], "opacity-15")}
        />
      )}
      <path
        d={line}
        fill="none"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        className={accentStroke[accent]}
      />
    </svg>
  )
}

/** Vertical bars with optional labels; values >= 0. */
export function Bars({
  data,
  labels,
  height = 80,
  accent = "primary",
  highlightLast = true,
}: {
  data: number[]
  labels?: string[]
  height?: number
  accent?: Accent
  highlightLast?: boolean
}) {
  const max = Math.max(1, ...data)
  return (
    <div>
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((d, i) => (
          <div
            key={i}
            className={cn(
              "flex-1 rounded-t-md",
              accentBg[accent],
              highlightLast && i !== data.length - 1 && "opacity-45",
            )}
            style={{ height: `${Math.max(2, (d / max) * 100)}%` }}
          />
        ))}
      </div>
      {labels && (
        <div className="mt-1 flex gap-1">
          {labels.map((l, i) => (
            <div
              key={i}
              className="flex-1 text-center text-[10px] text-muted-foreground"
            >
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Compact heatmap with fixed-size cells (never stretches to full width).
 * values 0..1 or null (not due), in chronological order.
 * flow "column": each column is one group of `cols` values (e.g. a week) —
 * GitHub-style, weeks run left to right. flow "row": `cols` values per row.
 */
export function Heatmap({
  values,
  accent = "primary",
  cols = 7,
  flow = "row",
  cell = 14,
  rowLabels,
}: {
  values: (number | null)[]
  accent?: Accent
  cols?: number
  flow?: "row" | "column"
  cell?: number
  /** Labels for each row in column flow (e.g. weekday initials). */
  rowLabels?: string[]
}) {
  const gap = cell >= 10 ? 3 : 2
  const track = `repeat(${cols}, ${cell}px)`
  const grid = (
    <div
      className="grid w-fit"
      style={{
        gap,
        ...(flow === "column"
          ? { gridTemplateRows: track, gridAutoFlow: "column" }
          : { gridTemplateColumns: track }),
        gridAutoColumns: flow === "column" ? `${cell}px` : undefined,
      }}
    >
      {values.map((v, i) => (
        <div
          key={i}
          className={cn(
            cell >= 10 ? "rounded-[3px]" : "rounded-[1px]",
            v === null
              ? "bg-muted/40"
              : v === 0
                ? "bg-muted"
                : accentBg[accent],
          )}
          style={{
            width: cell,
            height: cell,
            ...(v ? { opacity: 0.35 + v * 0.65 } : {}),
          }}
        />
      ))}
    </div>
  )
  if (!rowLabels) return grid
  return (
    <div className="flex w-fit" style={{ gap: gap + 3 }}>
      <div
        className="grid text-[10px] text-muted-foreground leading-none"
        style={{ gap, gridTemplateRows: track }}
        aria-hidden="true"
      >
        {rowLabels.map((l, i) => (
          <span key={i} className="flex items-center">
            {l}
          </span>
        ))}
      </div>
      {grid}
    </div>
  )
}

export function Chip({
  children,
  active,
  onClick,
  accent = "primary",
  className,
}: {
  children: ReactNode
  active?: boolean
  onClick?: () => void
  accent?: Accent
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 font-medium text-sm transition-colors",
        active
          ? cn(accentBg[accent], "border-transparent text-background")
          : "border-border bg-card text-foreground active:bg-muted",
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-xl bg-muted p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-10 flex-1 rounded-lg font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === o.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Row({
  icon,
  title,
  subtitle,
  right,
  href,
  onClick,
  className,
}: {
  icon?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  right?: ReactNode
  href?: string
  onClick?: () => void
  className?: string
}) {
  const inner = (
    <>
      {icon && <div className="shrink-0">{icon}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        {subtitle && (
          <div className="truncate text-muted-foreground text-sm">
            {subtitle}
          </div>
        )}
      </div>
      {right && <div className="shrink-0 text-right">{right}</div>}
    </>
  )
  const cls = cn(
    "flex min-h-14 w-full items-center gap-3 px-1 py-2 text-left",
    (href || onClick) && "rounded-xl active:bg-muted/60",
    className,
  )
  if (href)
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    )
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cls}>
        {inner}
      </button>
    )
  return <div className={cls}>{inner}</div>
}

/** Empty state: never just "no data" — say why and give the next action. */
export function Empty({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode
  title: ReactNode
  body?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {icon && <div className="mb-1 text-muted-foreground">{icon}</div>}
      <div className="font-semibold">{title}</div>
      {body && <div className="text-muted-foreground text-sm">{body}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function Btn({
  children,
  onClick,
  href,
  variant = "primary",
  accent = "primary",
  className,
  type = "button",
  disabled,
  "aria-label": ariaLabel,
}: {
  children: ReactNode
  onClick?: () => void
  href?: string
  variant?: "primary" | "secondary" | "ghost" | "danger"
  accent?: Accent
  className?: string
  type?: "button" | "submit"
  disabled?: boolean
  "aria-label"?: string
}) {
  const cls = cn(
    "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 font-semibold text-sm transition-opacity active:opacity-80 disabled:opacity-40",
    variant === "primary" && cn(accentBg[accent], "text-background"),
    variant === "secondary" && "bg-muted text-foreground",
    variant === "ghost" && "text-foreground hover:bg-muted",
    variant === "danger" && "bg-bad/15 text-bad",
    className,
  )
  if (href)
    return (
      <Link href={href} className={cls} aria-label={ariaLabel}>
        {children}
      </Link>
    )
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cls}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  )
}

/** ₱ amount that respects app-wide privacy mode. */
export function Money({
  value,
  signed,
  className,
}: {
  value: number
  signed?: boolean
  className?: string
}) {
  const hidden = privacyStore.use((s) => s.hidden)
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "−" : "") : ""
  return (
    <span
      className={cn(
        "num",
        hidden && "blur-amount",
        signed && value > 0 && "text-good",
        className,
      )}
    >
      {sign}
      {peso(signed ? Math.abs(value) : value)}
    </span>
  )
}

export { accentFill, accentStroke }

/**
 * The one switch visual. Thumb is pinned with an explicit left edge: an
 * absolutely positioned child with `left: auto` inside a <button> takes the
 * button's centred static position, which pushed thumbs off the track.
 */
export function SwitchTrack({
  on,
  accent = "primary",
}: {
  on: boolean
  accent?: Accent
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-block h-7 w-12 shrink-0 rounded-full transition-colors duration-200",
        on ? accentBg[accent] : "bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform duration-200",
          on && "translate-x-5",
        )}
      />
    </span>
  )
}

/** Accessible switch with a 44px hit area. */
export function Switch({
  checked,
  onChange,
  label,
  accent,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  accent?: Accent
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="grid h-11 w-14 shrink-0 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
    >
      <SwitchTrack on={checked} accent={accent} />
    </button>
  )
}

/** "30000.5" → "30,000.5"; leaves partial input ("", "-", "12.") intact. */
export function groupDigits(v: string | number | null | undefined): string {
  const s = String(v ?? "").replace(/,/g, "")
  const m = /^(-?)(\d*)(\.\d*)?$/.exec(s)
  if (!m) return s
  return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (m[3] ?? "")
}

/**
 * Drop-in <input> for numbers: shows thousands separators, but callers' onChange
 * still reads a plain, comma-free e.target.value. Keeps the caret in place as
 * commas appear.
 */
export function NumberInput({
  value,
  onChange,
  inputMode = "decimal",
  as: Comp = "input",
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "type"> & {
  value: string | number | null | undefined
  /** Render through a styled input (e.g. the shadcn Input). */
  as?: "input" | ComponentType<ComponentProps<"input">>
}) {
  const ref = useRef<HTMLInputElement>(null)
  const caret = useRef<number | null>(null) // non-comma chars before the caret
  const shown = groupDigits(value)
  useLayoutEffect(() => {
    const el = ref.current
    if (caret.current === null || !el || document.activeElement !== el) return
    let seen = 0
    let pos = 0
    while (pos < shown.length && seen < caret.current) {
      if (shown[pos] !== ",") seen++
      pos++
    }
    el.setSelectionRange(pos, pos)
    caret.current = null
  }, [shown])
  return (
    <Comp
      {...rest}
      ref={ref}
      type="text"
      inputMode={inputMode}
      value={shown}
      onChange={(e) => {
        const el = e.target
        const at = el.selectionStart ?? el.value.length
        caret.current = el.value.slice(0, at).replace(/,/g, "").length
        el.value = el.value.replace(/,/g, "")
        onChange?.(e)
      }}
    />
  )
}
