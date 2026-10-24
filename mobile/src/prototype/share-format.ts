// Number formatting for share cards. Cards are small and their numbers are
// big, so every value is grouped ("1,234") and, past a width budget,
// abbreviated ("12.3k", "1.2M"). Pure, so tests pin the strings exactly.

const MINUS = "−"

/** "1234567" → "1,234,567"; keeps up to `decimals` fraction digits. */
export function group(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return "—"
  const rounded = Number(Math.abs(n).toFixed(decimals))
  const sign = n < 0 && rounded !== 0 ? MINUS : ""
  const [whole, frac] = rounded.toFixed(decimals).split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  const tail = frac?.replace(/0+$/, "")
  return `${sign}${grouped}${tail ? `.${tail}` : ""}`
}

const STEPS = [
  { at: 1e12, suffix: "T" },
  { at: 1e9, suffix: "B" },
  { at: 1e6, suffix: "M" },
  { at: 1e3, suffix: "k" },
] as const

/** "12345" → "12.3k", "1234567" → "1.2M": one decimal under 100 of a unit. */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return "—"
  const abs = Math.abs(n)
  let i = STEPS.findIndex((s) => abs >= s.at)
  if (i === -1) return group(n, abs < 10 ? 1 : 0)
  const shown = (v: number) =>
    v < 99.95 ? v.toFixed(1).replace(/\.0$/, "") : String(Math.round(v))
  // 999,950 would read "1000k"; carry it up to "1M" instead.
  if (i > 0 && Number(shown(abs / STEPS[i].at)) >= 1000) i -= 1
  return `${n < 0 ? MINUS : ""}${shown(abs / STEPS[i].at)}${STEPS[i].suffix}`
}

/** Grouped while it fits in `max` characters, abbreviated past that. */
export function fmt(n: number, max = 6, decimals = 0): string {
  const full = group(n, decimals)
  return full.length <= max ? full : compact(n)
}

/** A 0–1 rate as "87%"; null reads as a dash, huge rates stay short. */
export function pct(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "—"
  return `${fmt(Math.round(rate * 100), 5)}%`
}

/** A signed whole change: "+12", "−3", with a true minus sign. */
export function signed(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? MINUS : ""}${fmt(Math.abs(n), 6)}`
}

/** Seconds as "45:12" or "1:05:12". */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(sec) ? sec : 0)),
    h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    r = s % 60,
    two = (v: number) => String(v).padStart(2, "0")
  return h ? `${group(h)}:${two(m)}:${two(r)}` : `${m}:${two(r)}`
}
