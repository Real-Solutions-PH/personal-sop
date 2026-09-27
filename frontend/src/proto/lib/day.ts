// App-wide day boundary (IA ruling X-1): a "day" starts at DAY_START_HOUR local
// time, so a 01:30 log after a late shift still counts for the previous day.
// ponytail: constant for the prototype; becomes a user setting with the backend.
export const DAY_START_HOUR = 4

const pad = (n: number) => String(n).padStart(2, "0")

/** YYYY-MM-DD of the logical day containing `d`. */
export function dayKey(d: Date = new Date()): string {
  const shifted = new Date(d.getTime() - DAY_START_HOUR * 3600_000)
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`
}

/** Logical day key `n` days from today (negative = past). */
export function dayOffset(n: number, from: Date = new Date()): string {
  const d = new Date(from)
  d.setDate(d.getDate() + n)
  return dayKey(d)
}

/** Date at local hh:mm on day `n` days from today — for seeding timestamps. */
export function at(n: number, hh: number, mm = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  d.setHours(hh, mm, 0, 0)
  return d.toISOString()
}

/** 0=Sun … 6=Sat for a day key. */
export const weekday = (key: string) => new Date(`${key}T12:00:00`).getDay()

export const isEvening = (d: Date = new Date()) =>
  d.getHours() >= 18 || d.getHours() < DAY_START_HOUR

const pesoFmt = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 })
export const peso = (n: number) => `₱${pesoFmt.format(n)}`

export function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
