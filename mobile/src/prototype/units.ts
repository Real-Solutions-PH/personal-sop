export function displayMass(kg: number, unit: "kg" | "lb") {
  return Math.round(kg * (unit === "lb" ? 2.2046226218 : 1) * 10) / 10
}
export function kilograms(value: number, unit: "kg" | "lb") {
  return unit === "lb" ? value / 2.2046226218 : value
}
/**
 * Human span for summaries — "1h 10m", "57m", "5m 54s", "40s". Live timers
 * keep the clock format (`fmtDuration`); anything read after the fact uses
 * this so actual and planned durations read in the same units.
 */
export function fmtSpan(sec: number) {
  const total = Math.max(0, Math.round(sec)),
    h = Math.floor(total / 3600),
    m = Math.floor((total % 3600) / 60),
    s = total % 60
  if (h) return m ? `${h}h ${m}m` : `${h}h`
  if (m) return s ? `${m}m ${s}s` : `${m}m`
  return `${s}s`
}
