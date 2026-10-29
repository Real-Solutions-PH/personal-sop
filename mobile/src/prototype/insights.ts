// Patterns across areas, worked out on the phone from data it already has:
// for each driver (7h+ sleep, a workout, 10,000 steps), how mood and habit
// completion differ between days with it and days without. Pure.
// ponytail: a plain difference of averages, no significance test; the
// 5-days-a-side floor and the minimum gap keep noise out. Correlation, not
// cause, which is why the copy only states the two numbers.

export interface InsightDay {
  day: string
  /** Minutes asleep the night before; null or 0 = not tracked. */
  sleepMin: number | null
  workout: boolean
  /** null or 0 = not tracked. */
  steps: number | null
  /** The day's average mood, 1–5. */
  mood: number | undefined
  /** Share of the day's due habits done, 0–1; null when none were due. */
  habits: number | null
}
export interface Insight {
  id: string
  text: string
  /** The difference scaled to 0–1, for ranking. */
  gap: number
}

const MIN_DAYS = 5
const DRIVERS: {
  id: string
  /** true / false for a side; undefined when the day can't say. */
  side: (d: InsightDay) => boolean | undefined
  on: string
  off: string
}[] = [
  {
    id: "sleep",
    side: (d) => (d.sleepMin ? d.sleepMin >= 420 : undefined),
    on: "After 7h+ of sleep",
    off: "after shorter nights",
  },
  {
    id: "workout",
    side: (d) => d.workout,
    on: "On days you work out",
    off: "on days you don't",
  },
  {
    id: "steps",
    side: (d) => (d.steps ? d.steps >= 10_000 : undefined),
    on: "On 10,000-step days",
    off: "on other days",
  },
]
const OUTCOMES: {
  id: string
  value: (d: InsightDay) => number | null | undefined
  /** The smallest gap worth saying, and the scale it's ranked on. */
  min: number
  range: number
  say: (on: number, off: number) => [string, string]
}[] = [
  {
    id: "mood",
    value: (d) => d.mood,
    min: 0.5,
    range: 4,
    say: (on, off) => [`your mood averages ${on.toFixed(1)}/5`, off.toFixed(1)],
  },
  {
    id: "habits",
    value: (d) => d.habits,
    min: 0.15,
    range: 1,
    say: (on, off) => [
      `you finish ${Math.round(on * 100)}% of your habits`,
      `${Math.round(off * 100)}%`,
    ],
  },
]

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

export function findInsights(days: readonly InsightDay[]): Insight[] {
  const found: Insight[] = []
  for (const dr of DRIVERS)
    for (const out of OUTCOMES) {
      const on: number[] = [],
        off: number[] = []
      for (const d of days) {
        const side = dr.side(d),
          v = out.value(d)
        if (side === undefined || v === null || v === undefined) continue
        ;(side ? on : off).push(v)
      }
      if (on.length < MIN_DAYS || off.length < MIN_DAYS) continue
      const a = avg(on),
        b = avg(off)
      if (Math.abs(a - b) < out.min) continue
      const [said, other] = out.say(a, b)
      found.push({
        id: `${dr.id}-${out.id}`,
        text: `${dr.on}, ${said}, vs ${other} ${dr.off}.`,
        gap: Math.abs(a - b) / out.range,
      })
    }
  return found.sort((x, y) => y.gap - x.gap).slice(0, 3)
}
