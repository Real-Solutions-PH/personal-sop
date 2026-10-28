// Eat-back: the burned kcal the user chose to add to one day's budget.
import {
  macrosLeftToday,
  setBurnAdjustment,
  setMacroTarget,
} from "@domain/fitness/actions"
import {
  adjustmentOn,
  budgetFor,
  nutritionDays,
  targetFor,
} from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"

const today = () => dayKey()

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  fitStore.set((s) => ({ ...s, targets: [], adjustments: [] }))
})

const base = () =>
  setMacroTarget({ kcal: 2000, protein: 150, carbs: 200, fat: 600 / 9 })

test("budgetFor adds burn to carbs and fat by calorie ratio, protein fixed", () => {
  base()
  setBurnAdjustment(today(), 350)
  const b = budgetFor(fitStore.get(), today())
  expect(b?.kcal).toBe(2350)
  expect(b?.protein).toBe(150)
  // Whole grams: 200 + 50 carbs, 66.7 + 16.7 fat.
  expect(b?.carbs).toBe(250)
  expect(b?.fat).toBe(83)
})

test("adjustment does not carry to the next day", () => {
  base()
  setBurnAdjustment(today(), 350)
  expect(budgetFor(fitStore.get(), dayOffset(1))?.kcal).toBe(2000)
})

test("re-tap replaces the day's adjustment instead of summing", () => {
  base()
  setBurnAdjustment(today(), 300)
  setBurnAdjustment(today(), 450)
  expect(adjustmentOn(fitStore.get(), today())).toBe(450)
  expect(fitStore.get().adjustments).toHaveLength(1)
})

test("kcal 0 removes the row", () => {
  base()
  setBurnAdjustment(today(), 300)
  setBurnAdjustment(today(), 0)
  expect(fitStore.get().adjustments).toHaveLength(0)
  expect(adjustmentOn(fitStore.get(), today())).toBe(0)
})

test("no base target means no budget from burn alone", () => {
  setBurnAdjustment(today(), 300)
  expect(budgetFor(fitStore.get(), today())).toBeUndefined()
})

test("targetFor ignores adjustments", () => {
  base()
  setBurnAdjustment(today(), 350)
  expect(targetFor(fitStore.get(), today())?.kcal).toBe(2000)
})

test("base with no carbs or fat puts the burn into carbs", () => {
  setMacroTarget({ kcal: 600, protein: 150, carbs: 0, fat: 0 })
  setBurnAdjustment(today(), 400)
  const b = budgetFor(fitStore.get(), today())
  expect(b?.carbs).toBe(100)
  expect(b?.fat).toBe(0)
})

test("what is left today and the day verdict use the budget", () => {
  base()
  fitStore.set((st) => ({ ...st, meals: [] }))
  setBurnAdjustment(today(), 400)
  expect(macrosLeftToday()?.kcal).toBe(2400)
  expect(macrosLeftToday()?.protein).toBe(150)
  expect(nutritionDays(fitStore.get(), 1)[0]?.target?.kcal).toBe(2400)
})

test("re-saving the target on an eat-back day keeps the base", () => {
  base()
  setBurnAdjustment(today(), 400)
  const t = targetFor(fitStore.get(), today())
  if (t) setMacroTarget(t)
  expect(targetFor(fitStore.get(), today())?.kcal).toBe(2000)
})

test("state saved by a build before eat-back loads with no adjustments", () => {
  // The phone's stored fitness state from build 12 has no `adjustments`.
  const { adjustments: _, ...rest } = fitStore.get()
  const old = {
    ...rest,
    meals: [],
    settings: { ...rest.settings, restSec: 97 },
  }
  jest.isolateModules(() => {
    const lib =
      require("@domain/lib/store") as typeof import("@domain/lib/store")
    const errors: unknown[] = []
    lib.configureStorage(
      {
        getItem: (k) =>
          k === "sop-proto:fitness" ? JSON.stringify(old) : null,
        setItem: () => {},
        removeItem: () => {},
      },
      (e) => errors.push(e),
    )
    const { fitStore: fresh } =
      require("@domain/fitness/store") as typeof import("@domain/fitness/store")
    const C =
      require("@domain/fitness/calc") as typeof import("@domain/fitness/calc")
    expect(fresh.get().adjustments).toEqual([])
    // Hydrated, not reseeded: the stored meals came back.
    expect(fresh.get().settings.restSec).toBe(97)
    expect(fresh.get().meals).toEqual([])
    expect(C.budgetFor(fresh.get(), today())).toEqual(
      C.targetFor(fresh.get(), today()),
    )
    expect(errors).toEqual([])
  })
})
