// A treadmill session syncs its flag and incline; an outdoor one says
// outdoors, and a row from before the flag existed reads as outdoors.
import type { RunSession } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { runMapper } from "../mappers/fitness"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

const run: RunSession = {
  id: "r1",
  kind: "walk",
  name: "Treadmill walk",
  startedAt: "2026-11-02T23:00:00.000Z",
  endedAt: "2026-11-02T23:40:00.000Z",
  movingSec: 2400,
  distanceM: 3000,
  kcal: 200,
  route: [],
  splits: [],
  indoor: true,
  inclinePct: 5,
}

it("round-trips the treadmill flag and incline", () => {
  const m = runMapper()
  const row = m.toServer(run, fitStore.get())
  expect(row).toMatchObject({ indoor: true, incline_pct: 5, route: [] })
  const back = m.fromServer({ id: "r1", ...row }, fitStore.get())
  expect(back).toEqual(run)
})

it("outdoors is sent as such, and an old row without the flag is outdoors", () => {
  const m = runMapper()
  const { indoor: _i, inclinePct: _p, ...outdoor } = run
  const row = m.toServer(outdoor, fitStore.get())
  expect(row).toMatchObject({ indoor: false, incline_pct: null })
  const { indoor: _x, incline_pct: _y, ...old } = row as Record<string, unknown>
  const back = m.fromServer({ id: "r1", ...old }, fitStore.get())
  expect(back?.indoor).toBeUndefined()
  expect(back?.inclinePct).toBeUndefined()
})
