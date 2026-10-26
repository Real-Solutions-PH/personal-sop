// An Apple Pay tap, as an iOS Shortcuts "Transaction" automation hands it to
// personalsop://finance/quick-add?amount=…&merchant=…&card=… — untrusted text
// from any app, so it saves on its own only when the card's account is
// certain; anything else prefills an editor the user confirms.
import * as C from "@domain/finance/calc"
import type { FinRecord, FinState } from "@domain/finance/data"

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

/** The open account for a Wallet card: the one the user tied it to, else
 * one named like it — its name contains the card name ("BPI Visa" → "BPI
 * Visa"), else the card name contains it. `sure` when tied, or when only one
 * account matches by name ("UnionBank" against "UnionBank Debit" and
 * "UnionBank Visa" is a guess). */
export function cardAccount(
  s: Pick<FinState, "accounts" | "settings">,
  card?: string,
): { id: string; sure: boolean } | undefined {
  const c = card?.toLowerCase()
  if (!c) return undefined
  const open = s.accounts.filter((a) => !a.archived && a.name),
    tied = s.settings.cardAccounts?.[c]
  if (tied && open.some((a) => a.id === tied)) return { id: tied, sure: true }
  const named = open.filter((a) => a.name.toLowerCase().includes(c)),
    within = open.filter((a) => c.includes(a.name.toLowerCase())),
    id = (named[0] ?? within[0])?.id
  return id
    ? { id, sure: new Set([...named, ...within]).size === 1 }
    : undefined
}

/** The editor prefill for a quick-add link, or an empty expense and an
 * error when the amount is missing or unreadable. `auto` when the card's
 * account is certain, so the expense can save straight away;
 * `card` is the cleaned, lowercased card name to remember on save. */
export function quickAdd(
  s: FinState,
  params: Params,
): {
  prefill: Partial<FinRecord>
  error?: string
  card?: string
  auto?: boolean
} {
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
    ),
    card = clean(first(params.card), 120)?.toLowerCase(),
    account = cardAccount(s, card),
    categoryId = known ? cat : undefined
  return {
    prefill: {
      type: "expense",
      amount,
      payee,
      accountId: account?.id,
      categoryId,
    },
    card,
    // An expense can't save without a category, so that one still asks.
    auto: !!account?.sure && !!categoryId,
  }
}
