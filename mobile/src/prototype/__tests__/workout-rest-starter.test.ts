// The starter gym library and splits, the rest timer's −15/+15, and the
// alarm that rings when rest is over.
import * as FA from "@domain/fitness/actions"
import { installStarter, STARTER_EXERCISES } from "@domain/fitness/starter"
import { fitStore } from "@domain/fitness/store"
import { isUuid } from "@domain/lib/ids"
import { configureStorage, resetAll } from "@domain/lib/store"
import { restNotice } from "../rest-alarm"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

const OWNER = "8b1f7c55-0c0e-4b7e-9a51-2f7e2d1c3a10"

describe("starter library", () => {
  it("gives an empty account every exercise and complete splits", () => {
    fitStore.set((s) => ({ ...s, exercises: [], templates: [] }))
    const added = installStarter(OWNER)
    const s = fitStore.get()
    expect(added.exercises).toBe(STARTER_EXERCISES.length)
    expect(added.templates).toBeGreaterThanOrEqual(10)
    const ids = new Set(s.exercises.map((e) => e.id))
    for (const e of s.exercises) expect(isUuid(e.id)).toBe(true)
    for (const t of s.templates) {
      expect(isUuid(t.id)).toBe(true)
      expect(t.items.length).toBeGreaterThanOrEqual(5)
      for (const it of t.items) expect(ids.has(it.exerciseId)).toBe(true)
    }
    // Synced rows: names fit the server's 80 characters, reps its check.
    for (const e of s.exercises) {
      expect(e.name.length).toBeLessThanOrEqual(80)
      expect(e.repMax).toBeGreaterThanOrEqual(e.repMin)
    }
  })

  it("never doubles what the account already has, and runs again as a no-op", () => {
    fitStore.set((s) => ({
      ...s,
      exercises: s.exercises.filter((e) => e.name === "Barbell Bench Press"),
      templates: [{ id: "mine", name: "Push", items: [] }],
    }))
    const bench = fitStore.get().exercises[0]
    installStarter(OWNER)
    const s = fitStore.get()
    expect(
      s.exercises.filter((e) => e.name === "Barbell Bench Press"),
    ).toHaveLength(1)
    expect(s.templates.filter((t) => t.name === "Push")).toHaveLength(1)
    // A split using the bench uses the account's own bench.
    const upper = s.templates.find((t) => t.name === "Upper")
    expect(upper?.items[0].exerciseId).toBe(bench.id)
    expect(installStarter(OWNER)).toEqual({ exercises: 0, templates: 0 })
  })
})

describe("rest timer", () => {
  const ends = () => new Date(fitStore.get().rest?.endsAt ?? 0).getTime()

  it("+15 and −15 move the end and the length together", () => {
    FA.startRest(90)
    const before = ends()
    FA.adjustRest(15)
    expect(ends()).toBe(before + 15_000)
    expect(fitStore.get().rest?.durationSec).toBe(105)
    FA.adjustRest(-15)
    FA.adjustRest(-15)
    expect(ends()).toBe(before - 15_000)
    expect(fitStore.get().rest?.durationSec).toBe(75)
  })

  it("−15 with less than 15 seconds left ends rest now, not in the past", () => {
    FA.startRest(10)
    FA.adjustRest(-15)
    expect(ends()).toBeGreaterThanOrEqual(Date.now() - 1000)
    expect(ends()).toBeLessThanOrEqual(Date.now() + 1000)
    expect(fitStore.get().rest?.durationSec).toBe(0)
  })

  it("rings when rest is over, following every adjustment", () => {
    FA.startRest(60)
    expect(restNotice(fitStore.get())?.at.getTime()).toBe(ends())
    FA.adjustRest(15)
    expect(restNotice(fitStore.get())?.at.getTime()).toBe(ends())
    FA.skipRest()
    expect(restNotice(fitStore.get())).toBeNull()
  })
})
