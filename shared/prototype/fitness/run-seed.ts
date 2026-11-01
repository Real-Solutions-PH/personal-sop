// Demo runs and walks for the prototype: loops around a park in Taguig,
// one fix every 4 seconds, so the history, map and splits have real shape.

import type { RunKind, RunPoint, RunSession } from "./data"
import { defaultRunName, runKcal, summarize } from "./runs"

const CENTER: [number, number] = [14.5509, 121.0503]

function track(
  rnd: () => number,
  kind: RunKind,
  km: number,
): { points: RunPoint[]; sec: number } {
  const speed = kind === "run" ? 2.75 + rnd() * 0.5 : 1.35 + rnd() * 0.15
  const loopM = 1650
  const points: RunPoint[] = []
  let d = 0,
    t = 0
  while (d < km * 1000) {
    const a = (d / loopM) * 2 * Math.PI
    // An oval loop, wider east-west, with a little wobble.
    const lat = CENTER[0] + 0.0021 * Math.sin(a) + (rnd() - 0.5) * 0.00002
    const lng = CENTER[1] + 0.0032 * Math.cos(a) + (rnd() - 0.5) * 0.00002
    const alt = 24 + 6 * Math.sin(a * 2)
    points.push([lat, lng, Math.round(alt * 10) / 10, t])
    const v = speed * (0.9 + rnd() * 0.2)
    t += 4
    d += v * 4
  }
  return { points, sec: t }
}

/** `at(dayOffset, hour, minute)` as the main seed builds instants. */
export function seedRuns(
  rnd: () => number,
  at: (n: number, h: number, m?: number) => string,
): RunSession[] {
  const plan: [number, RunKind, number][] = [
    [-20, "run", 5.1],
    [-16, "walk", 3.2],
    [-13, "run", 6.4],
    [-9, "run", 5.0],
    [-6, "walk", 4.1],
    [-3, "run", 8.2],
    [-1, "walk", 2.6],
  ]
  return plan.map(([n, kind, km], i) => {
    const startedAt = at(n, kind === "run" ? 6 : 17, 10 + i * 3)
    const { points, sec } = track(rnd, kind, km)
    const sum = summarize(points, [])
    return {
      id: `run-seed-${i}`,
      kind,
      name: defaultRunName(kind, new Date(startedAt)),
      startedAt,
      endedAt: new Date(
        new Date(startedAt).getTime() + sec * 1000,
      ).toISOString(),
      movingSec: sec,
      distanceM: Math.round(sum.distanceM),
      ...(sum.elevationGainM !== null
        ? { elevationGainM: sum.elevationGainM }
        : {}),
      steps: Math.round(sum.distanceM / (kind === "run" ? 1.1 : 0.75)),
      ...(kind === "run" ? { avgHr: 152 + i, maxHr: 171 + i } : {}),
      kcal: runKcal(points, [], 78),
      route: points,
      splits: sum.splits,
    }
  })
}
