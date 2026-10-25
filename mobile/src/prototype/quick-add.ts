// An Apple Pay tap, as an iOS Shortcuts "Transaction" automation hands it to
// personalsop://finance/quick-add?amount=…&merchant=…&card=… — untrusted text
// from any app, so it only ever prefills an editor the user confirms.
import * as C from "@domain/finance/calc"
import type { Account, FinRecord, FinState } from "@domain/finance/data"

type Params = Record<string, string | string[] | undefined>

const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : v

/** Control and format characters out, whitespace collapsed, capped. */
const clean = (v: string | undefined, max: number) =>
  v
    ?.replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max) || undefined

/** "₱1,234.50", "PHP 1234.50", "1.234,50" or "1234,50" → 1234.5. A lone
 * separator with three digits after it groups thousands ("1,234"); otherwise
 * the last separator is the decimal point. Anything else is rejected. */
export function parseAmount(raw: string | undefined): number | undefined {
  const s = raw
    ?.replace(/[\s\p{Sc}]/gu, "")
    .replace(/^[a-z]{1,3}|[a-z]{3}$/gi, "")
  if (!s || !/^\d[\d.,]*$/.test(s)) return undefined
  const last = Math.max(s.lastIndexOf("."), s.lastIndexOf(",")),
    head = s.slice(0, last),
    tail = s.slice(last + 1),
    decimal =
      last >= 0 &&
      !head.includes(s[last]) &&
      (tail.length !== 3 || /[.,]/.test(head)),
    n = decimal
      ? Number(`${head.replace(/[.,]/g, "")}.${tail}`)
      : Number(s.replace(/[.,]/g, ""))
  return n > 0 && n < 1e9 ? Math.round(n * 100) / 100 : undefined
}

/** The open account named like the Wallet card: its name contains the card
 * name ("BPI Visa" → "BPI Visa"), else the card name contains it. */
export function cardAccount(accounts: Account[], card?: string) {
  const c = card?.toLowerCase()
  if (!c) return undefined
  const open = accounts.filter((a) => !a.archived && a.name)
  return (
    open.find((a) => a.name.toLowerCase().includes(c)) ??
    open.find((a) => c.includes(a.name.toLowerCase()))
  )?.id
}

/** The editor prefill for a quick-add link, or an empty expense and an
 * error when the amount is missing or unreadable. */
export function quickAdd(
  s: FinState,
  params: Params,
): { prefill: Partial<FinRecord>; error?: string } {
  const amount = parseAmount(first(params.amount))
  if (!amount)
    return {
      prefill: { type: "expense" },
      error: "Couldn't read the Apple Pay amount — enter it here",
    }
  const merchant = clean(first(params.merchant), 120),
    g = merchant ? C.guessPayee(merchant) : undefined,
    payee = g?.cat ? g.payee : merchant,
    cat = payee ? (C.suggestCategory(s, payee) ?? g?.cat) : undefined,
    // Hints name stock categories the user may have archived or deleted.
    known = s.categories.some(
      (c) => c.id === cat && !c.archived && c.kind === "expense",
    )
  return {
    prefill: {
      type: "expense",
      amount,
      payee,
      accountId: cardAccount(s.accounts, clean(first(params.card), 120)),
      categoryId: known ? cat : undefined,
    },
  }
}
