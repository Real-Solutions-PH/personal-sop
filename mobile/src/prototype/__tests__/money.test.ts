import { parseAmount, parseCapture } from "@domain/capture/parse"
import {
  containsMoney,
  currencyInfo,
  currencyStore,
  money,
  moneyCompact,
  moneyExact,
  setCurrency,
} from "@domain/lib/money"

afterEach(() => currencyStore.set({ code: "PHP" }))

test("a PHP user's amounts read as before, centavos shown when present", () => {
  expect(money(2500)).toBe("₱2,500")
  expect(money(2500.4)).toBe("₱2,500.40")
  expect(money(-5)).toBe("₱-5")
  expect(moneyExact(2500.75)).toBe("₱2,500.75")
  expect(moneyCompact(45000)).toBe("₱45k")
  expect(moneyCompact(-1500)).toBe("−₱1.5k")
})

test("the user's currency sets the symbol and the decimals", () => {
  setCurrency("USD")
  expect(money(2500)).toBe("$2,500")
  expect(moneyCompact(1_200_000)).toBe("$1.2M")
  const jpy = currencyInfo("JPY")
  expect(moneyExact(2500.75, jpy)).toBe("¥2,501")
  expect(money(1000, currencyInfo("CHF"))).toBe("CHF 1,000")
  // an unknown code is ignored, never a blank symbol
  setCurrency("XXX")
  expect(money(1)).toBe("$1")
})

test("share-card text with any currency is refused", () => {
  for (const s of ["₱1,200", "$5", "€3", "PHP 200", "price 10 USD", "A$5"])
    expect(containsMoney(s)).toBe(true)
  for (const s of ["85%", "1,234", "SARAH", "PENDING", "12-day"])
    expect(containsMoney(s)).toBe(false)
})

const ctx = { source: "text", at: new Date().toISOString() }

test("a dollar is foreign to a PHP user and home money to a USD user", () => {
  expect(parseAmount("spent $10")?.usd).toBe(true)
  setCurrency("USD")
  expect(parseAmount("spent $10")?.usd).toBe(false)
  const [d] = parseCapture("spent $12", ctx)
  expect(d.t).toBe("record")
  if (d.t !== "record") return
  expect(d.payload).toMatchObject({ kind: "expense", amount: 12 })
  expect(d.warn).toBeUndefined()
  expect(d.ask?.question).toBe("What was $12 for?")
})
