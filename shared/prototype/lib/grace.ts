/** Days a second grace day must wait after the first, within one run. */
export const GRACE_GAP_DAYS = 7

const daysApart = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000,
  )

export interface RunWalk {
  current: number
  best: number
  broken: { day: string; length: number }[]
  graceDays: string[]
}

/** Walks days oldest first: ``true`` extends the run, ``null`` is neutral,
 * ``false`` is a miss. A lone miss is a grace day (bridged, not counted)
 * when the next scored day is a hit, or has not come yet; two misses in a
 * row, or a second lone miss within ``GRACE_GAP_DAYS`` of the run's last
 * grace day, end the run on that day. ``broken`` keeps ended runs of 3+. */
export function walkRun(steps: Iterable<[string, boolean | null]>): RunWalk {
  let best = 0
  let run = 0
  let grace: string[] = []
  let held: string | null = null
  const broken: RunWalk["broken"] = []
  for (const [day, hit] of steps) {
    if (hit === true) {
      if (held) grace.push(held)
      held = null
      run++
      best = Math.max(best, run)
    } else if (hit === false) {
      const last = grace[grace.length - 1]
      if (
        !held &&
        run > 0 &&
        (!last || daysApart(last, day) >= GRACE_GAP_DAYS)
      ) {
        held = day
        continue
      }
      if (run >= 3) broken.push({ day, length: run })
      run = 0
      grace = []
      held = null
    }
  }
  return {
    current: run,
    best,
    broken,
    graceDays: held ? [...grace, held] : grace,
  }
}
