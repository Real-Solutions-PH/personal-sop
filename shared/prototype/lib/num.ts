// Number text for everything that is not money (money goes through money.ts).
// Counts, minutes, weights, distances, paces, percentages, deltas and chart
// labels all read the same way: grouped ("1,234"), at most one decimal, and
// no trailing ".0". A raw float such as 613.0166666666667 never reaches the
// screen. Grouping is done by hand rather than Intl, whose output differs
// between Hermes builds.

/** A true minus sign, so a negative lines up with a plus in tabular figures. */
export const MINUS = "−"

/**
 * "1234567.891" → "1,234,567.9"; "60.04" → "60"; non-finite → "—".
 * `decimals` caps the fraction digits (default one); zeros after the last
 * significant digit are dropped.
 */
export function num(n: number | null | undefined, decimals = 1): string {
  if (n == null || !Number.isFinite(n)) return "—"
  const rounded = Number(Math.abs(n).toFixed(decimals))
  const sign = n < 0 && rounded !== 0 ? MINUS : ""
  const [whole, frac] = rounded.toFixed(decimals).split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  const tail = frac?.replace(/0+$/, "")
  return `${sign}${grouped}${tail ? `.${tail}` : ""}`
}

/** A change with its sign: "+1.5", "−3", "0". */
export function signedNum(n: number | null | undefined, decimals = 1): string {
  const s = num(n, decimals)
  return n != null && n > 0 && s !== "0" ? `+${s}` : s
}

/** The size of a change without its sign, for displays that draw ▲/▼. */
export function absNum(n: number | null | undefined, decimals = 1): string {
  return num(n == null ? n : Math.abs(n), decimals)
}
