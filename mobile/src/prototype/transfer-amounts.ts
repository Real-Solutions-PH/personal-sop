// The Transfer sheet's quick amounts: a share of the From account's balance,
// typed in for the person instead of worked out on a calculator.

export type QuickShare = { label: string; fraction: number }

export const QUICK_SHARES: readonly QuickShare[] = [
  { label: "25%", fraction: 0.25 },
  { label: "50%", fraction: 0.5 },
  { label: "Full", fraction: 1 },
]

/** Down to whole centavos, never up: a quick amount must not ask for a
 * centavo more than the account holds. toPrecision drops float noise first
 * (1.005 * 100 is 100.49999999999999). */
export function floorCents(n: number): number {
  return Math.floor(Number((n * 100).toPrecision(15))) / 100
}

/**
 * The amount a quick chip fills in, or null when it has nothing to offer
 * (balance unknown, empty or overdrawn, or the fee eats all of it).
 *
 * Full with a fee: Full = balance − fee. The fee is logged as its own
 * expense from the same From account, so moving the whole balance and then
 * paying the fee would overdraw it; "Full" means "empty the account", fee
 * included. The shares below Full are a share of the balance, capped at the
 * same balance − fee so no chip ever overdraws.
 */
export function quickAmount(
  balance: number | null | undefined,
  fraction: number,
  fee = 0,
): number | null {
  if (balance == null || !Number.isFinite(balance) || balance <= 0) return null
  const f = Number.isFinite(fee) && fee > 0 ? fee : 0
  const amount = floorCents(Math.min(balance * fraction, balance - f))
  return amount > 0 ? amount : null
}

/** Amount plus fee leaves the From account below zero. A warning only:
 * a credit line or an unrecorded deposit can make it right. */
export function overdraws(
  balance: number | null | undefined,
  amount: number,
  fee = 0,
): boolean {
  if (balance == null || !Number.isFinite(balance)) return false
  if (!(amount > 0)) return false
  const f = Number.isFinite(fee) && fee > 0 ? fee : 0
  return Math.round((amount + f) * 100) > Math.round(balance * 100)
}

/** The amount as the money field holds it: "6172.83", "500". */
export const amountText = (n: number) => String(Math.round(n * 100) / 100)
