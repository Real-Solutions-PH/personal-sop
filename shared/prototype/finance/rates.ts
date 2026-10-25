// PH digital-bank savings products and their advertised rates (% p.a.).
// ponytail: hand-kept list; move to a server feed if it must change between
// releases. Refresh RATES_AS_OF with every edit.

export const RATES_AS_OF = "2026-08-15"

export type RateKind = "daily" | "monthly" | "deposit"
export interface RateProduct {
  bank: string
  product: string
  min: number
  max: number
  kind: RateKind
}

const p = (
  bank: string,
  product: string,
  min: number,
  max: number,
  kind: RateKind,
): RateProduct => ({ bank, product, min, max, kind })

export const RATES: RateProduct[] = [
  p("Maya Bank", "Savings", 3.5, 15, "daily"),
  p("Maya Bank", "Personal Goals", 4, 8, "monthly"),
  p("Maya Bank", "Time Deposit", 5, 6, "deposit"),
  p("BPI BanKo", "TODO Savings", 5, 5, "monthly"),
  p("Tonik", "Solo Stash", 4, 4, "monthly"),
  p("Tonik", "Group Stash", 4.5, 4.5, "monthly"),
  p("Tonik", "Time Deposit", 4.5, 5.5, "deposit"),
  p("RCBC DiskarTech", "Savings", 4, 4, "monthly"),
  p("MariBank", "Savings", 3.25, 3.25, "daily"),
  p("OwnBank", "Own It", 3.8, 3.8, "daily"),
  p("OwnBank", "Time Deposit", 4, 5.2, "deposit"),
  p("Netbank", "Savings", 3.25, 3.25, "daily"),
  p("Netbank", "Time Deposit", 4.5, 5, "deposit"),
  p("GoTyme Bank", "GoalSave", 3, 3, "monthly"),
  p("CIMB Bank", "UpSave", 2.3, 4.15, "monthly"),
  p("CIMB Bank", "MaxSave", 3.25, 3.5, "deposit"),
  p("UNO Digital Bank", "#UNOready", 3, 3.5, "daily"),
  p("UNO Digital Bank", "#UNOboost", 4, 5.5, "deposit"),
  p("UNO Digital Bank", "#UNOearn", 4.75, 5, "deposit"),
  p("UnionDigital Bank", "UD Save", 3, 3.25, "monthly"),
  p("UnionDigital Bank", "Time Deposit", 2.5, 3.15, "deposit"),
]

export const rateLabel = (r: RateProduct) =>
  r.min === r.max ? `${r.min}%` : `${r.min}% – ${r.max}%`
