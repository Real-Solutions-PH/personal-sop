"use client"
// Money text in the user's currency. Every surface that shows an amount goes
// through here; nothing else writes a currency symbol.
//
// Amounts on the device are major units (a float: 12.5 = $12.50). The server
// stores integer hundredths (``*_minor``) for EVERY currency, so 100 is the
// conversion factor everywhere, also for zero-decimal currencies: ¥1,000 is
// stored as 100000. That keeps one meaning for the column whichever currency
// a user picks (and when they switch). The ISO 4217 minor-unit exponent is
// used for DISPLAY only (``digits``), which is why the list below holds no
// three-decimal currency (KWD, BHD, ...): hundredths would lose their third
// place. Changing the currency relabels amounts; it never converts them.
//
// The symbol and digits are Intl's ("en" locale, currencyDisplay "symbol"),
// pinned in a table because Hermes's Intl differs by platform;
// scripts/golden/currency.golden.test.ts checks the table against Intl and
// emits it for the backend's twin (app/shared/currency.py).
import { createStore } from "./store"

export interface CurrencyInfo {
  code: string
  symbol: string
  /** ISO 4217 minor-unit exponent: decimals a full amount is shown with. */
  digits: number
  name: string
}

const row = (
  code: string,
  symbol: string,
  digits: number,
  name: string,
): CurrencyInfo => ({ code, symbol, digits, name })

export const CURRENCIES: readonly CurrencyInfo[] = [
  row("PHP", "₱", 2, "Philippine Peso"),
  row("USD", "$", 2, "US Dollar"),
  row("EUR", "€", 2, "Euro"),
  row("GBP", "£", 2, "British Pound"),
  row("JPY", "¥", 0, "Japanese Yen"),
  row("CNY", "CN¥", 2, "Chinese Yuan"),
  row("KRW", "₩", 0, "South Korean Won"),
  row("INR", "₹", 2, "Indian Rupee"),
  row("IDR", "IDR", 2, "Indonesian Rupiah"),
  row("MYR", "MYR", 2, "Malaysian Ringgit"),
  row("SGD", "SGD", 2, "Singapore Dollar"),
  row("THB", "THB", 2, "Thai Baht"),
  row("VND", "₫", 0, "Vietnamese Dong"),
  row("HKD", "HK$", 2, "Hong Kong Dollar"),
  row("TWD", "NT$", 2, "New Taiwan Dollar"),
  row("AUD", "A$", 2, "Australian Dollar"),
  row("NZD", "NZ$", 2, "New Zealand Dollar"),
  row("CAD", "CA$", 2, "Canadian Dollar"),
  row("MXN", "MX$", 2, "Mexican Peso"),
  row("BRL", "R$", 2, "Brazilian Real"),
  row("CHF", "CHF", 2, "Swiss Franc"),
  row("SEK", "SEK", 2, "Swedish Krona"),
  row("NOK", "NOK", 2, "Norwegian Krone"),
  row("DKK", "DKK", 2, "Danish Krone"),
  row("PLN", "PLN", 2, "Polish Zloty"),
  row("ZAR", "ZAR", 2, "South African Rand"),
  row("AED", "AED", 2, "United Arab Emirates Dirham"),
  row("SAR", "SAR", 2, "Saudi Riyal"),
  row("TRY", "TRY", 2, "Turkish Lira"),
  row("NGN", "NGN", 2, "Nigerian Naira"),
  row("KES", "KES", 2, "Kenyan Shilling"),
  row("EGP", "EGP", 2, "Egyptian Pound"),
  row("ILS", "₪", 2, "Israeli New Shekel"),
  row("CZK", "CZK", 2, "Czech Koruna"),
  row("HUF", "HUF", 2, "Hungarian Forint"),
  row("PKR", "PKR", 2, "Pakistani Rupee"),
  row("BDT", "BDT", 2, "Bangladeshi Taka"),
  row("COP", "COP", 2, "Colombian Peso"),
  row("CLP", "CLP", 0, "Chilean Peso"),
  row("PEN", "PEN", 2, "Peruvian Sol"),
]

export const DEFAULT_CURRENCY = "PHP"

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]))

/** A code's row; an unknown code falls back to the default (fail closed). */
export const currencyInfo = (code: string): CurrencyInfo =>
  BY_CODE.get(code) ?? (BY_CODE.get(DEFAULT_CURRENCY) as CurrencyInfo)

export const isCurrency = (code: unknown): code is string =>
  typeof code === "string" && BY_CODE.has(code)

/** The signed-in user's currency (the profile's ``currency``). */
export const currencyStore = createStore("currency", () => ({
  code: DEFAULT_CURRENCY,
}))

export const setCurrency = (code: string) => {
  if (isCurrency(code) && currencyStore.get().code !== code)
    currencyStore.set({ code })
}

export const currentCurrency = (): CurrencyInfo =>
  currencyInfo(currencyStore.get().code)

/** React: the current currency, re-rendering when it changes. */
export const useCurrency = (): CurrencyInfo =>
  currencyInfo(currencyStore.use((s) => s.code))

/** The symbol as a prefix: a letter symbol ("CHF") gets a space. */
export const currencyPrefix = (c: CurrencyInfo = currentCurrency()) =>
  /\p{L}$/u.test(c.symbol) ? `${c.symbol} ` : c.symbol

const formatters = new Map<string, Intl.NumberFormat>()
const numberFmt = (min: number, max: number) => {
  const key = `${min}:${max}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat("en", {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    })
    formatters.set(key, f)
  }
  return f
}

/** The symbol readers see in labels: "Amount $", "$•••". */
export const currencySymbol = (c: CurrencyInfo = currentCurrency()) => c.symbol

/** Grouped, with the currency's decimals only when the amount has them:
 * ``money(2500)`` = "₱2,500", ``money(158.82)`` = "₱158.82",
 * ``money(2500.4)`` = "₱2,500.40". Rounding happens once, in whole minor
 * units, so no amount is cut short or rounded to a different peso by the
 * platform's Intl (158.82 read as 158 on one path and 1,708.64 as 1,709 on
 * another). The sign follows the symbol ("₱-5"), as it always has. */
export function money(n: number, c: CurrencyInfo = currentCurrency()): string {
  const f = 10 ** c.digits
  // toPrecision drops float noise first: 1.005 * 100 is 100.49999999999999.
  const minor = Math.round(Number((Math.abs(n) * f).toPrecision(15)))
  const whole = Math.floor(minor / f),
    part = minor % f
  const sign = n < 0 && minor > 0 ? "-" : ""
  const cents = part ? `.${String(part).padStart(c.digits, "0")}` : ""
  return `${currencyPrefix(c)}${sign}${numberFmt(0, 0).format(whole)}${cents}`
}

/** Up to the currency's own decimals: "$2,500.75", "¥2,501". */
export const moneyExact = (n: number, c: CurrencyInfo = currentCurrency()) =>
  `${currencyPrefix(c)}${numberFmt(0, c.digits).format(n)}`

/** Compact for charts and tight rows: "₱1.2M", "₱45k", "₱1.5k", "₱800". */
export function moneyCompact(
  n: number,
  c: CurrencyInfo = currentCurrency(),
): string {
  const a = Math.abs(n)
  const sign = n < 0 ? "−" : ""
  const p = currencyPrefix(c)
  if (a >= 1000000) return `${sign}${p}${(a / 1000000).toFixed(1)}M`
  if (a >= 10000) return `${sign}${p}${Math.round(a / 1000)}k`
  if (a >= 1000) return `${sign}${p}${(a / 1000).toFixed(1)}k`
  return `${sign}${p}${Math.round(a)}`
}

/** Text that names the currency for a model prompt. */
export const currencyPhrase = (c: CurrencyInfo = currentCurrency()) =>
  `${c.name} (${c.code}, written ${c.symbol})`

// Every symbol and code in the table: share cards refuse text that carries
// one, whichever currency the user picked (the old check looked for ₱ only).
const MONEY_MARK = new RegExp(
  [
    ...new Set(
      CURRENCIES.flatMap((c) => [c.symbol, c.code]).map((m) =>
        /^\p{L}+$/u.test(m)
          ? `(?<!\\p{L})${m}(?!\\p{L})`
          : m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      ),
    ),
    "\\$",
  ].join("|"),
  "u",
)

/** True when the text shows a money amount or a currency mark. */
export const containsMoney = (s: string) => MONEY_MARK.test(s)
