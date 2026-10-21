import { beforeAll, expect, test } from "bun:test"
import { emit, freeze } from "./harness"

beforeAll(freeze)

// The canonical source is Intl itself ("en" locale, currencyDisplay
// "symbol"), never either table: the fixture is what Intl says for every
// code the app offers, and both tables (shared/prototype/lib/money.ts and
// backend/app/shared/currency.py) are asserted against it.
test("currency symbols, decimals and names", async () => {
  const { CURRENCIES } = await import("../../shared/prototype/lib/money")
  const names = new Intl.DisplayNames("en", { type: "currency" })
  const intl: Record<string, { symbol: string; digits: number; name: string }> =
    {}
  for (const { code } of CURRENCIES) {
    const f = new Intl.NumberFormat("en", { style: "currency", currency: code })
    intl[code] = {
      symbol:
        f.formatToParts(1).find((p) => p.type === "currency")?.value ?? "",
      digits: f.resolvedOptions().maximumFractionDigits ?? 2,
      name: names.of(code) ?? code,
    }
  }
  expect(
    Object.fromEntries(
      CURRENCIES.map((c) => [
        c.code,
        { symbol: c.symbol, digits: c.digits, name: c.name },
      ]),
    ),
  ).toEqual(intl)
  emit("currency", { intl })
})
