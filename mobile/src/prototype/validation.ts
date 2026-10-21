export function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day, 12)
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  )
}
export function positiveNumber(value: string): number | null {
  const number = Number(value)
  return value.trim() && Number.isFinite(number) && number > 0 ? number : null
}
