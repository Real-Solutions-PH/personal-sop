export const DAY_START_HOUR = 4
const pad = (n: number) => String(n).padStart(2, "0")
export function dayKey(d: Date = new Date()): string {
  const shifted = new Date(d.getTime() - DAY_START_HOUR * 3600000)
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`
}
export function dayOffset(n: number, from: Date = new Date()): string {
  const d = new Date(from)
  d.setDate(d.getDate() + n)
  return dayKey(d)
}
export function at(n: number, hh: number, mm = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  d.setHours(hh, mm, 0, 0)
  return d.toISOString()
}
export const weekday = (key: string) => new Date(`${key}T12:00:00`).getDay()
export const isEvening = (d: Date = new Date(), start = "18:00") =>
  `${pad(d.getHours())}:${pad(d.getMinutes())}` >= start ||
  d.getHours() < DAY_START_HOUR
const pesoFmt = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 })
export const peso = (n: number) => `₱${pesoFmt.format(n)}`
export function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
