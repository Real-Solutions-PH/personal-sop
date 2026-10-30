import { currencyInfo, currencyStore, money } from "@domain/lib/money"

afterEach(() => currencyStore.set({ code: "PHP" }))

test("a balance with centavos shows them, never cut or rounded", () => {
  // 158.82 once read as 158, and 1,708.64 as 1,709.
  expect(money(158.82)).toBe("₱158.82")
  expect(money(1708.64)).toBe("₱1,708.64")
  expect(money(-1708.64)).toBe("₱-1,708.64")
})

test("whole amounts stay whole; a lone tenth gets its second digit", () => {
  expect(money(36000)).toBe("₱36,000")
  expect(money(36000.5)).toBe("₱36,000.50")
  expect(money(0)).toBe("₱0")
})

test("float noise from adding amounts does not leak into the text", () => {
  expect(money(0.1 + 0.2)).toBe("₱0.30")
  expect(money(1.005)).toBe("₱1.01")
  expect(money(158.82 + 1708.64)).toBe("₱1,867.46")
})

test("a zero-decimal currency rounds once, to whole units", () => {
  const jpy = currencyInfo("JPY")
  expect(money(2500.4, jpy)).toBe("¥2,500")
  expect(money(2500.6, jpy)).toBe("¥2,501")
})

test("a typed sentence's amount keeps its cents (the device parser)", () => {
  const { parseAmount } =
    require("@domain/capture/parse") as typeof import("@domain/capture/parse")
  expect(parseAmount("spent 1,708.64 at SM")?.amount).toBe(1708.64)
  expect(parseAmount("coffee 158.82")?.amount).toBe(158.82)
  expect(parseAmount("grab 1,708")?.amount).toBe(1708)
  expect(parseAmount("laptop 2k")?.amount).toBe(2000)
  expect(parseAmount("rent ₱12,000.50")?.amount).toBe(12000.5)
})
