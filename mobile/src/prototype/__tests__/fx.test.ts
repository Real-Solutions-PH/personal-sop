// Rates for records kept in another currency: fetched through the source
// the app sets, kept for offline use, and the conversion rounds to
// hundredths once.
import { convert, fxStore, refreshRate, setFxSource } from "@domain/finance/fx"
import { configureStorage, resetAll } from "@domain/lib/store"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  setFxSource(null)
})

test("$100 at 57.92 is 5,792.00 and rounds once", () => {
  expect(convert(100, 57.92)).toBe(5792)
  expect(convert(1.01, 57.925)).toBe(58.5)
})

test("the last rate is kept when the source fails", async () => {
  setFxSource(async () => ({ rate: 58.1, asOf: "2026-10-21", quote: "PHP" }))
  expect((await refreshRate("USD"))?.rate).toBe(58.1)
  setFxSource(async () => {
    throw new Error("offline")
  })
  expect((await refreshRate("USD"))?.rate).toBe(58.1)
  expect(fxStore.get().rates.USD.asOf).toBe("2026-10-21")
  expect(await refreshRate("EUR")).toBeUndefined()
})
