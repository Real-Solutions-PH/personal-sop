"use client"

import {
  ArrowDownRight,
  ArrowUpRight,
  Copy,
  Download,
  ImagePlus,
  MoreHorizontal,
} from "lucide-react"
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"
import { FaInstagram } from "react-icons/fa6"
import { cn } from "@/lib/utils"
import type { Accent } from "./kit"

// Share-card kit (Strava-style). Every size inside a card is in `cqw` (percent
// of the card's width), so the composition is identical at any preview width
// and at the 1080px export. Long values shrink to fit their box instead of
// overflowing: see `fit()`.

export type Format = "9:16" | "4:5" | "1:1"
export type Backdrop = "vivid" | "night" | "paper" | "photo" | "sticker"
export type CardAccent = Exclude<Accent, "primary">

export const FORMAT_LABEL: Record<Format, string> = {
  "9:16": "Story",
  "4:5": "Post 4:5",
  "1:1": "Square",
}
export const FORMAT_PX: Record<Format, string> = {
  "9:16": "1080×1920",
  "4:5": "1080×1350",
  "1:1": "1080×1080",
}
const ASPECT: Record<Format, string> = {
  "9:16": "aspect-[9/16]",
  "4:5": "aspect-[4/5]",
  "1:1": "aspect-square",
}

/** Card-level context the building blocks read through CSS variables. */
const BACKDROP: Record<Backdrop, { cls: string; vars: CSSProperties }> = {
  vivid: {
    cls: "text-white",
    vars: {
      background:
        "radial-gradient(120% 70% at 100% 0%, color-mix(in oklch, var(--a) 75%, transparent), transparent 60%), radial-gradient(90% 60% at 0% 100%, color-mix(in oklch, var(--a2) 55%, transparent), transparent 65%), linear-gradient(160deg, var(--share-vivid-from), var(--share-vivid-to))",
      "--hi": "var(--a)",
      "--panel": "rgb(255 255 255 / 0.09)",
      "--track": "rgb(255 255 255 / 0.14)",
    } as CSSProperties,
  },
  night: {
    cls: "text-white",
    vars: {
      background:
        "radial-gradient(80% 40% at 50% 0%, color-mix(in oklch, var(--a) 22%, transparent), transparent 70%), var(--share-night)",
      "--hi": "var(--a)",
      "--panel": "rgb(255 255 255 / 0.06)",
      "--track": "rgb(255 255 255 / 0.1)",
    } as CSSProperties,
  },
  paper: {
    cls: "text-(--share-paper-ink)",
    vars: {
      background:
        "radial-gradient(90% 50% at 100% 0%, color-mix(in oklch, var(--a) 22%, transparent), transparent 70%), var(--share-paper)",
      "--hi": "color-mix(in oklch, var(--a) 62%, black)",
      "--panel": "rgb(0 0 0 / 0.05)",
      "--track": "rgb(0 0 0 / 0.1)",
    } as CSSProperties,
  },
  photo: {
    cls: "text-white [text-shadow:0_0.3cqw_1.2cqw_rgb(0_0_0/0.45)]",
    vars: {
      "--hi": "var(--a)",
      "--panel": "rgb(0 0 0 / 0.28)",
      "--track": "rgb(255 255 255 / 0.25)",
    } as CSSProperties,
  },
  // Transparent "stats sticker" to drop onto your own Instagram story.
  sticker: {
    cls: "text-white [text-shadow:0_0.3cqw_1.2cqw_rgb(0_0_0/0.5)]",
    vars: {
      "--hi": "var(--a)",
      "--panel": "transparent",
      "--track": "rgb(255 255 255 / 0.3)",
    } as CSSProperties,
  },
}

const PARTNER: Record<CardAccent, CardAccent> = {
  hab: "tsk",
  tsk: "hab",
  fit: "hab",
  nut: "life",
  foc: "hab",
  fin: "tsk",
  life: "hab",
}

const PHOTO_PLACEHOLDER =
  "repeating-linear-gradient(135deg, var(--share-placeholder-a) 0 3cqw, var(--share-placeholder-b) 3cqw 6cqw)"

export function ShareFrame({
  format,
  backdrop,
  accent,
  photo,
  children,
  className,
}: {
  format: Format
  backdrop: Backdrop
  accent: CardAccent
  photo?: string | null
  children: ReactNode
  className?: string
}) {
  const b = BACKDROP[backdrop]
  const style = {
    "--a": `var(--${accent})`,
    "--a2": `var(--${PARTNER[accent]})`,
    ...b.vars,
    ...(backdrop === "photo"
      ? {
          background: photo
            ? `center / cover no-repeat url(${photo})`
            : PHOTO_PLACEHOLDER,
        }
      : {}),
  } as CSSProperties
  return (
    <div
      data-backdrop={backdrop}
      className={cn(
        "@container relative isolate w-full overflow-hidden rounded-[5cqw] text-left font-sans",
        ASPECT[format],
        b.cls,
        backdrop === "sticker" && "checker",
        className,
      )}
      style={style}
    >
      {backdrop === "photo" && (
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-b from-black/35 via-black/5 to-black/75"
        />
      )}
      <div className="flex size-full flex-col p-[6.5cqw]">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------- sizing

/** Approximate advance widths (em) of Geist SemiBold, the display face. */
function emWidth(s: string) {
  let w = 0
  for (const ch of s) {
    if (/[0-9]/.test(ch)) w += 0.67
    else if (/[.,:'’]/.test(ch)) w += 0.27
    else if (ch === " ") w += 0.24
    else if (ch === "%") w += 0.82
    else if (/[/\-–+×]/.test(ch)) w += 0.52
    else if (/[mwMW—]/.test(ch)) w += 0.92
    else if (/[il1|!]/.test(ch)) w += 0.3
    else if (/[A-Z]/.test(ch)) w += 0.7
    else w += 0.6
  }
  return Math.max(w, 0.5)
}

/**
 * Font size (in cqw) that makes `text` fill at most `box` cqw of width,
 * capped at `max` — so "7" stays huge and "12,480" shrinks instead of spilling.
 */
export function fit(text: string, box: number, max: number, min = 0) {
  return fitEm(emWidth(text), box, max, min)
}
function fitEm(em: number, box: number, max: number, min = 0) {
  return `${Math.max(min, Math.min(max, (box / em) * 0.94)).toFixed(2)}cqw`
}

/** 12,480 → "12.5K". Short values are returned unchanged. */
export function compact(n: number) {
  if (Math.abs(n) < 10000) return n.toLocaleString("en-PH")
  return new Intl.NumberFormat("en-PH", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n)
}

// ---------------------------------------------------------------- blocks

/** Top row: app mark + kicker on the left, date / handle on the right. */
export function CardTop({
  kicker,
  right,
}: {
  kicker: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-[3cqw] font-semibold text-[3.4cqw] uppercase leading-tight tracking-[0.14em]">
      <span className="flex min-w-0 items-center gap-[1.8cqw]">
        <Logo />
        <span className="min-w-0 opacity-85">{kicker}</span>
      </span>
      {right && <span className="shrink-0 text-right opacity-70">{right}</span>}
    </div>
  )
}

function Logo() {
  return (
    <span
      aria-hidden="true"
      className="font-display grid size-[5.5cqw] shrink-0 place-items-center rounded-[1.4cqw] bg-(--hi) font-black text-[3.4cqw] text-black/85 [text-shadow:none]"
    >
      S
    </span>
  )
}

/** Bottom row: wordmark + optional handle. */
export function CardFoot({
  handle,
  mark = true,
  children,
}: {
  handle?: string | null
  mark?: boolean
  children?: ReactNode
}) {
  return (
    <div className="mt-auto flex items-end justify-between gap-[3cqw] pt-[4cqw]">
      <div className="min-w-0 text-[3.2cqw] leading-snug opacity-75">
        {children}
      </div>
      <div className="shrink-0 text-right">
        {handle && (
          <div className="text-[3.2cqw] leading-tight opacity-75">{handle}</div>
        )}
        {mark && (
          <div className="font-display font-black text-[4cqw] uppercase italic leading-none tracking-wide">
            Personal<span className="text-(--hi)"> SOP</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** Card title that wraps to at most two lines, shrinking for long text. */
export function CardTitle({
  children,
  max = 11,
  className,
}: {
  children: string
  max?: number
  className?: string
}) {
  // Two lines available → allow roughly twice the width before shrinking.
  const size = fit(children, 87 * 1.7, max, 6.2)
  return (
    <div
      className={cn(
        "font-display line-clamp-2 font-extrabold uppercase leading-[0.92] tracking-tight [text-wrap:balance]",
        className,
      )}
      style={{ fontSize: size }}
    >
      {children}
    </div>
  )
}

/** Small uppercase label. */
export function Label({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "font-semibold text-[3.2cqw] uppercase leading-tight tracking-[0.12em] opacity-75",
        className,
      )}
    >
      {children}
    </div>
  )
}

/** The hero figure. `box` is the width (cqw) it may occupy. */
export function Hero({
  value,
  unit,
  box = 87,
  max = 34,
  accent,
  className,
}: {
  value: string
  unit?: string
  box?: number
  max?: number
  accent?: boolean
  className?: string
}) {
  // The unit renders at 0.36em, so it only costs a third of its width.
  const em = emWidth(value) + (unit ? 0.08 + emWidth(unit) * 0.36 : 0)
  const size = fitEm(em, box, max)
  return (
    <div
      className={cn(
        "font-display num flex items-baseline font-black leading-[0.82] tracking-tight",
        accent && "text-(--hi)",
        className,
      )}
      style={{ fontSize: size }}
    >
      {value}
      {unit && (
        <span className="ml-[0.08em] font-bold text-[0.36em] tracking-normal opacity-80">
          {unit}
        </span>
      )}
    </div>
  )
}

export interface StatItem {
  label: string
  value: string
  unit?: string
  delta?: number | null
  /** Suffix for the delta, e.g. "%" or " pts". */
  deltaUnit?: string
}

/** Strava-style stat grid: label over a big number, auto-shrinking per cell. */
export function StatGrid({
  items,
  cols,
  size = 12,
  panel,
}: {
  items: StatItem[]
  cols?: number
  size?: number
  panel?: boolean
}) {
  if (!items.length) return null
  const c = cols ?? Math.min(items.length, items.length === 4 ? 2 : 3)
  const gap = 3
  const box = (87 - gap * (c - 1)) / c - (panel ? 6 : 1)
  return (
    <div
      className="grid gap-[3cqw]"
      style={{ gridTemplateColumns: `repeat(${c}, minmax(0, 1fr))` }}
    >
      {items.map((x) => (
        <div
          key={x.label}
          className={cn(
            "min-w-0",
            panel && "rounded-[3cqw] bg-(--panel) px-[3cqw] py-[2.6cqw]",
          )}
        >
          <Label className="line-clamp-2">{x.label}</Label>
          <div className="mt-[1cqw] flex flex-wrap items-baseline gap-x-[1.5cqw]">
            <Hero value={x.value} unit={x.unit} box={box} max={size} />
          </div>
          {x.delta != null && x.delta !== 0 && (
            <Delta value={x.delta} unit={x.deltaUnit} className="mt-[1cqw]" />
          )}
        </div>
      ))}
    </div>
  )
}

/** ▲/▼ change with an icon (colour is never the only signal). */
export function Delta({
  value,
  unit = "",
  suffix,
  className,
}: {
  value: number
  unit?: string
  suffix?: string
  className?: string
}) {
  const up = value > 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[0.6cqw] rounded-full bg-(--panel) px-[1.8cqw] py-[0.5cqw] font-bold text-[3.2cqw] leading-tight",
        up ? "text-good" : "text-bad",
        className,
      )}
    >
      <Icon className="size-[3.4cqw]" strokeWidth={3} />
      <span className="num">
        {up ? "+" : "−"}
        {Math.abs(value)}
        {unit}
      </span>
      {suffix && (
        <span className="font-medium text-current opacity-80">{suffix}</span>
      )}
    </span>
  )
}

/** Achievement pill — Strava's medal/crown callouts. */
export function Medal({
  icon,
  children,
  tone = "hi",
  className,
}: {
  icon?: ReactNode
  children: ReactNode
  tone?: "hi" | "gold" | "plain"
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-[1.4cqw] rounded-full px-[2.6cqw] py-[1.2cqw] font-bold text-[3.3cqw] uppercase leading-none tracking-wide [text-shadow:none]",
        tone === "hi" && "bg-(--hi) text-black/85",
        tone === "gold" &&
          "bg-gradient-to-br from-(--gold-from) to-(--gold-to) text-black/85",
        tone === "plain" && "bg-(--panel) ring-1 ring-current/20",
        className,
      )}
    >
      {icon && (
        <span className="grid shrink-0 place-items-center [&>svg]:size-[3.6cqw]">
          {icon}
        </span>
      )}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  )
}

/** Progress ring (0..1) sized in cqw; the centre holds any content. */
export function Ring({
  value,
  size = 50,
  stroke = 7,
  children,
  label,
}: {
  value: number
  size?: number
  stroke?: number
  children?: ReactNode
  label?: string
}) {
  const v = Math.max(0, Math.min(1, value))
  const r = 50 - stroke / 2
  const c = 2 * Math.PI * r
  const id = useRef(`g${Math.random().toString(36).slice(2, 8)}`).current
  return (
    <div
      className="relative shrink-0"
      style={{ width: `${size}cqw`, height: `${size}cqw` }}
      {...(label ? { role: "img", "aria-label": label } : {})}
    >
      <svg
        viewBox="0 0 100 100"
        className="-rotate-90 size-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--a2)" />
            <stop offset="100%" stopColor="var(--hi)" />
          </linearGradient>
        </defs>
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke="var(--track)"
        />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke={`url(#${id})`}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ filter: "drop-shadow(0 0 1.5px var(--hi))" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {children}
      </div>
    </div>
  )
}

/** Labelled horizontal meter (0..1). */
export function Meter({
  label,
  value,
  color,
  display,
}: {
  label: string
  value: number
  color?: string
  display?: string
}) {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-[2cqw]">
        <Label className="min-w-0 truncate">{label}</Label>
        <span className="font-display num font-extrabold text-[4.6cqw] leading-none">
          {display ?? Math.round(v * 100)}
        </span>
      </div>
      <div className="mt-[1.2cqw] h-[1.8cqw] overflow-hidden rounded-full bg-(--track)">
        <div
          className="h-full rounded-full"
          style={{ width: `${v * 100}%`, background: color ?? "var(--hi)" }}
        />
      </div>
    </div>
  )
}

/** Trend line — the "route map" of a stats card. */
export function Trend({
  data,
  height = 22,
  className,
}: {
  data: number[]
  height?: number
  className?: string
}) {
  if (data.length < 2) return null
  const w = 100
  const h = 40
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const pts = data.map(
    (d, i) =>
      [
        (i / (data.length - 1)) * w,
        h - 4 - ((d - min) / span) * (h - 8),
      ] as const,
  )
  const line = pts
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ")
  const [ex, ey] = pts[pts.length - 1]
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn("block w-full overflow-visible", className)}
      style={{ height: `${height}cqw` }}
      aria-hidden="true"
    >
      <path
        d={`${line} L${w},${h} L0,${h} Z`}
        fill="var(--hi)"
        opacity={0.14}
      />
      <path
        d={line}
        fill="none"
        stroke="var(--hi)"
        strokeWidth={2.4}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        style={{ filter: "drop-shadow(0 0 3px var(--hi))" }}
      />
      <circle
        cx={ex}
        cy={ey}
        r={1.6}
        fill="var(--hi)"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/** Column bars (e.g. per-day counts). `hot` marks the bars to highlight. */
export function Columns({
  data,
  labels,
  height = 18,
}: {
  data: number[]
  labels?: string[]
  height?: number
}) {
  const max = Math.max(1, ...data)
  return (
    <div>
      <div
        className="flex items-end gap-[1.2cqw]"
        style={{ height: `${height}cqw` }}
      >
        {data.map((v, i) => (
          <div
            key={i}
            className="flex-1 rounded-[0.9cqw]"
            style={{
              height: `${Math.max(4, (v / max) * 100)}%`,
              background: v ? "var(--hi)" : "var(--track)",
              opacity: v ? 0.45 + 0.55 * (v / max) : 1,
            }}
          />
        ))}
      </div>
      {labels && (
        <div className="mt-[1.2cqw] flex gap-[1.2cqw]">
          {labels.map((l, i) => (
            <div
              key={i}
              className="flex-1 text-center font-semibold text-[2.8cqw] uppercase opacity-60"
            >
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export type Dot = "hit" | "part" | "miss" | "none"

/** Calendar/heatmap dots. */
export function DotGrid({
  cells,
  cols,
  label,
}: {
  cells: Dot[]
  cols: number
  label: string
}) {
  return (
    <div
      className="grid gap-[1.3cqw]"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      role="img"
      aria-label={label}
    >
      {cells.map((c, i) => (
        <span
          key={i}
          className="aspect-square rounded-[1.1cqw]"
          style={{
            background:
              c === "hit"
                ? "var(--hi)"
                : c === "part"
                  ? "color-mix(in oklch, var(--hi) 50%, transparent)"
                  : c === "miss"
                    ? "var(--track)"
                    : "color-mix(in oklch, var(--track) 40%, transparent)",
            boxShadow: c === "hit" ? "0 0 1.4cqw -0.2cqw var(--hi)" : undefined,
          }}
        />
      ))}
    </div>
  )
}

/** Headline verdict for a 0..1 rate — the "at a glance" read. */
export function verdict(rate: number | null | undefined) {
  if (rate == null) return "Getting started"
  if (rate >= 0.9) return "Elite form"
  if (rate >= 0.75) return "On fire"
  if (rate >= 0.6) return "Locked in"
  if (rate >= 0.4) return "Building"
  return "Showing up"
}

// ---------------------------------------------------------------- composer

/**
 * Swipeable layout picker (Strava's share carousel). Each slide renders a live
 * card; swiping or tapping selects it.
 */
export function LayoutCarousel<K extends string>({
  items,
  value,
  onChange,
  format,
}: {
  items: { key: K; label: string; render: () => ReactNode }[]
  value: K
  onChange: (k: K) => void
  format: Format
}) {
  const ref = useRef<HTMLDivElement>(null)
  const idx = Math.max(
    0,
    items.findIndex((x) => x.key === value),
  )
  // Keep the selected slide centred when it changes from outside the scroller.
  // Programmatic scrolls must not be read back as a swipe to another slide.
  const auto = useRef(false)
  useEffect(() => {
    const box = ref.current
    const el = box?.children[idx] as HTMLElement | undefined
    if (!box || !el) return
    const left = el.offsetLeft + el.offsetWidth / 2 - box.clientWidth / 2
    if (Math.abs(box.scrollLeft - left) < 2) return
    auto.current = true
    box.scrollTo({ left, behavior: "smooth" })
  }, [idx])
  const timer = useRef<ReturnType<typeof setTimeout>>(null)
  const onScroll = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const box = ref.current
      if (!box) return
      if (auto.current) {
        auto.current = false
        return
      }
      const mid = box.scrollLeft + box.clientWidth / 2
      let best = 0
      let dist = Number.POSITIVE_INFINITY
      Array.from(box.children).forEach((c, i) => {
        const e = c as HTMLElement
        const d = Math.abs(e.offsetLeft + e.offsetWidth / 2 - mid)
        if (d < dist) {
          dist = d
          best = i
        }
      })
      if (items[best] && items[best].key !== value) onChange(items[best].key)
    }, 120)
  }
  const width =
    format === "9:16"
      ? "w-[min(64%,300px)]"
      : format === "4:5"
        ? "w-[min(76%,340px)]"
        : "w-[min(80%,360px)]"
  return (
    <div>
      <div
        ref={ref}
        onScroll={onScroll}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-[18%] py-2 [scrollbar-width:none]"
      >
        {items.map((x) => (
          <button
            key={x.key}
            type="button"
            aria-label={`${x.label} layout`}
            aria-pressed={x.key === value}
            onClick={() => onChange(x.key)}
            className={cn(
              "shrink-0 snap-center rounded-[calc(5cqw+4px)] transition-[opacity,transform] duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              width,
              x.key === value ? "opacity-100" : "scale-[0.94] opacity-45",
            )}
          >
            <div className="pointer-events-none shadow-2xl shadow-black/40">
              {x.render()}
            </div>
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-center gap-2">
        <span className="font-semibold text-sm">{items[idx]?.label}</span>
        <span className="flex gap-1" aria-hidden="true">
          {items.map((x) => (
            <span
              key={x.key}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                x.key === value
                  ? "w-4 bg-foreground"
                  : "w-1.5 bg-muted-foreground/40",
              )}
            />
          ))}
        </span>
      </div>
    </div>
  )
}

const BACKDROPS: { value: Backdrop; label: string; swatch: string }[] = [
  {
    value: "vivid",
    label: "Vivid",
    swatch:
      "radial-gradient(circle at 80% 20%, var(--a), transparent 65%), var(--share-vivid-swatch)",
  },
  { value: "night", label: "Night", swatch: "var(--share-night)" },
  { value: "paper", label: "Paper", swatch: "var(--share-paper)" },
  {
    value: "photo",
    label: "Photo",
    swatch:
      "linear-gradient(135deg, var(--share-photo-from), var(--share-photo-to))",
  },
  {
    value: "sticker",
    label: "Sticker",
    swatch:
      "repeating-conic-gradient(var(--checker-a) 0 25%, var(--checker-b) 0 50%) 0 0 / 10px 10px",
  },
]

/** Backdrop swatches + a photo picker when "Photo" is on. */
export function BackdropPicker({
  value,
  onChange,
  accent,
  photo,
  onPhoto,
  allow,
}: {
  value: Backdrop
  onChange: (b: Backdrop) => void
  accent: CardAccent
  photo?: string | null
  onPhoto: (url: string) => void
  allow?: Backdrop[]
}) {
  const list = allow
    ? BACKDROPS.filter((b) => allow.includes(b.value))
    : BACKDROPS
  return (
    <div style={{ "--a": `var(--${accent})` } as CSSProperties}>
      <fieldset className="grid grid-cols-5 gap-2">
        <legend className="sr-only">Background</legend>
        {list.map((b) => (
          <button
            key={b.value}
            type="button"
            aria-pressed={value === b.value}
            onClick={() => onChange(b.value)}
            className="flex min-h-11 flex-col items-center gap-1 rounded-xl py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              className={cn(
                "size-10 rounded-full ring-2 ring-offset-2 ring-offset-background transition-shadow",
                value === b.value ? "ring-foreground" : "ring-border",
              )}
              style={{ background: b.swatch }}
            />
            <span
              className={cn(
                "text-xs",
                value === b.value ? "font-semibold" : "text-muted-foreground",
              )}
            >
              {b.label}
            </span>
          </button>
        ))}
      </fieldset>
      {value === "photo" && (
        <label className="mt-3 flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-muted font-semibold text-sm focus-within:ring-2 focus-within:ring-ring">
          <ImagePlus className="size-4" />
          {photo ? "Change photo" : "Choose a photo"}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onPhoto(URL.createObjectURL(file))
            }}
          />
        </label>
      )}
      {value === "sticker" && (
        <p className="mt-2 text-muted-foreground text-xs">
          Transparent PNG — paste it on top of your own story photo.
        </p>
      )}
    </div>
  )
}

/** Hook bundling the common composer state. */
export function useCardLook(
  initial?: Partial<{ format: Format; backdrop: Backdrop }>,
) {
  const [format, setFormat] = useState<Format>(initial?.format ?? "9:16")
  const [backdrop, setBackdrop] = useState<Backdrop>(
    initial?.backdrop ?? "vivid",
  )
  const [photo, setPhoto] = useState<string | null>(null)
  return { format, setFormat, backdrop, setBackdrop, photo, setPhoto }
}

/** Strava's share row: Stories, Save, Copy caption, More. */
export function ShareTargets({
  onStory,
  onSave,
  onCopy,
  onMore,
}: {
  onStory: () => void
  onSave: () => void
  onCopy: () => void
  onMore: () => void
}) {
  const items = [
    {
      label: "Stories",
      icon: <FaInstagram className="size-5" />,
      onClick: onStory,
      cls: "bg-gradient-to-br from-(--brand-ig-1) via-(--brand-ig-2) to-(--brand-ig-3) text-white",
    },
    { label: "Save", icon: <Download className="size-5" />, onClick: onSave },
    { label: "Caption", icon: <Copy className="size-5" />, onClick: onCopy },
    {
      label: "More",
      icon: <MoreHorizontal className="size-5" />,
      onClick: onMore,
    },
  ]
  return (
    <div className="grid grid-cols-4 gap-2">
      {items.map((x) => (
        <button
          key={x.label}
          type="button"
          onClick={x.onClick}
          className="flex min-h-11 flex-col items-center gap-1.5 rounded-xl py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-80"
        >
          <span
            className={cn(
              "grid size-12 place-items-center rounded-full bg-muted",
              x.cls,
            )}
          >
            {x.icon}
          </span>
          {x.label}
        </button>
      ))}
    </div>
  )
}
