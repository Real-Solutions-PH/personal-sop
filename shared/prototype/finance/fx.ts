// Exchange rates for records kept in another currency (a USD purchase on a
// peso account). The live app asks the server (GET /finance/fx, the
// European Central Bank's daily reference rates); the prototype answers
// from a fixed sample. The last rate per currency is kept, so a record can
// still be converted offline at the rate last seen.
import { createStore } from "../lib/store"

export interface FxRate {
  /** One unit of the foreign currency in the user's currency. */
  rate: number
  /** The reference day the rate is from (YYYY-MM-DD). */
  asOf: string
  /** The user's currency it converts into. */
  quote: string
}

export const fxStore = createStore<{ rates: Record<string, FxRate> }>(
  "fx",
  () => ({ rates: {} }),
)

type Source = (base: string) => Promise<FxRate>

// A sample for the prototype: about what a US dollar fetched in pesos in
// October 2026. The live app replaces the source at start.
const sample: Source = async (base) => ({
  rate: base === "USD" ? 57.92 : 1,
  asOf: new Date().toISOString().slice(0, 10),
  quote: "PHP",
})
let source: Source = sample

export function setFxSource(next: Source | null) {
  source = next ?? sample
}

/** Fetch the latest rate for ``base``; keeps the last one on failure and
 * returns whatever is known (``undefined`` when nothing ever was). */
export async function refreshRate(base: string): Promise<FxRate | undefined> {
  try {
    const r = await source(base)
    fxStore.set((s) => ({ rates: { ...s.rates, [base]: r } }))
    return r
  } catch {
    return fxStore.get().rates[base]
  }
}

/** ``amount`` of the foreign currency in hundredth-rounded user currency. */
export const convert = (amount: number, rate: number) =>
  Math.round(amount * rate * 100) / 100
