// An account drawn as the thing it is: a place your money is kept, like a
// card in a wallet, filled with the account's own colour. Stat cards stay
// outlined, so a glance tells "where money lives" from "what it adds up to".
import * as C from "@domain/finance/calc"
import type { Account, AccountType } from "@domain/finance/data"
import {
  Banknote,
  CreditCard,
  Landmark,
  Smartphone,
  TrendingUp,
} from "lucide-react-native"
import { View } from "react-native"
import { Copy, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { useMoney } from "./finance"

const ICONS = {
  cash: Banknote,
  ewallet: Smartphone,
  bank: Landmark,
  credit: CreditCard,
  investment: TrendingUp,
}
const KIND: Record<AccountType, string> = {
  cash: "Cash",
  ewallet: "E-wallet",
  bank: "Bank",
  credit: "Credit card",
  investment: "Savings",
}

/** ``#rrggbb`` mixed toward black by ``amount`` (0–1). Darkening keeps white
 * text readable on the brighter account colours (emerald, orange). */
export function shade(hex: string, amount: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = Number.parseInt(m[1], 16)
  const ch = (v: number) =>
    Math.round(v * (1 - amount))
      .toString(16)
      .padStart(2, "0")
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`
}

const luminance = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16)
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  )
}
/** The least darkening (0–0.6, in steps of 0.02) at which white text reads
 * at 4.5:1 on ``shade(hex, amount)``: dark colours (red, rose, violet) stay
 * vivid, bright ones (emerald, orange) darken only as far as they must. */
export function readableShade(hex: string) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return 0.3
  for (let i = 0; i <= 30; i++) {
    const amount = i / 50
    if (1.05 / (luminance(shade(hex, amount)) + 0.05) >= 4.5) return amount
  }
  return 0.6
}

/** The account colours a person can pick (docs/brand: ``acct-*``). */
export const ACCOUNT_COLORS = [
  "green",
  "blue",
  "emerald",
  "red",
  "rose",
  "violet",
  "orange",
  "cyan",
  "slate",
] as const
// For an account nobody picked a colour for, in the brand's order.
const DEFAULTS = [
  "blue",
  "emerald",
  "violet",
  "orange",
  "cyan",
  "rose",
  "green",
  "red",
  "slate",
]

/** The ``acct-*`` key an account is drawn in, or its own hex. An account
 * with no colour of its own ("fin", the server's default for accounts Fern
 * or another device added, which drew the card black) gets one from its id,
 * so it keeps the same colour everywhere and two such accounts differ. */
export function accountColorKey(a: Pick<Account, "id" | "color">): string {
  const picked = /^var\(--(acct-[a-z]+)\)$/.exec(a.color ?? "")?.[1]
  if (picked && ACCOUNT_COLORS.includes(picked.slice(5) as "green"))
    return picked
  // Only full ``#rrggbb``: ``shade`` cannot darken ``#fff``, so a short hex
  // would draw white text on white.
  if (/^#[0-9a-f]{6}$/i.test(a.color ?? "")) return a.color
  let h = 0
  for (const ch of a.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `acct-${DEFAULTS[h % DEFAULTS.length]}`
}

export function useAccountColor(a: Account) {
  const t = useTheme() as unknown as Record<string, string>
  const key = accountColorKey(a)
  return key.startsWith("#") ? key : (t[key] ?? t["acct-blue"])
}

/** What the card says under the balance: how much of the limit is used, a
 * deposit's maturity, the goal, or how the balance is kept. */
function footnote(
  a: Account,
  balance: number,
): {
  text: string
  stale: boolean
} {
  if (a.type === "credit" && a.limit)
    return {
      text: `${Math.round((Math.abs(balance) / a.limit) * 100)}% of limit used`,
      stale: false,
    }
  if (a.maturesOn) {
    const days = C.diffDays(a.maturesOn, C.today())
    return {
      text: days > 0 ? `Matures in ${days}d` : "Matured",
      stale: days <= 0,
    }
  }
  if (a.goal)
    return {
      text: `${Math.round((Math.max(0, balance) / a.goal) * 100)}% of goal`,
      stale: false,
    }
  // Balances are kept by logging; no account needs matching to a statement.
  return {
    text: a.manual ? "Value you set" : "Kept up as you log",
    stale: false,
  }
}

export function AccountCard({
  account: a,
  balance,
  compact = false,
  onPress,
}: {
  account: Account
  balance: number
  /** The small card in the Finance home row; full width otherwise. */
  compact?: boolean
  onPress?: () => void
}) {
  const money = useMoney()
  const base = useAccountColor(a)
  const Icon = ICONS[a.type]
  const owed = a.type === "credit"
  const note = footnote(a, balance)
  const used = owed && a.limit ? Math.min(1, Math.abs(balance) / a.limit) : null
  const label = `${a.name}, ${KIND[a.type]}, ${owed ? "owed " : balance < 0 ? "minus " : ""}${money(Math.abs(balance))}. ${note.text}`
  return (
    <Tap
      label={label}
      onPress={onPress ?? (() => go(`/finance/accounts/${a.id}`))}
      style={compact ? { width: 168 } : undefined}
    >
      {/* One flat account colour (the brand keeps gradients for Fern),
          darkened so white text stays readable on the brighter ones. */}
      <View
        style={{
          backgroundColor: shade(base, readableShade(base)),
          borderRadius: 18,
          padding: compact ? 12 : 16,
          minHeight: compact ? 112 : 0,
          overflow: "hidden",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        {/* A soft sheen in the corner, so it reads as a card, not a panel. */}
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            width: 140,
            height: 140,
            borderRadius: 70,
            right: -50,
            top: -60,
            backgroundColor: "rgba(255,255,255,0.10)",
          }}
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View
            style={{
              width: compact ? 26 : 32,
              height: compact ? 26 : 32,
              borderRadius: 999,
              backgroundColor: "rgba(255,255,255,0.18)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon size={compact ? 14 : 16} color="white" />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Copy
              size={compact ? 12 : 14}
              weight="semibold"
              style={{ color: "white" }}
            >
              {a.name}
            </Copy>
            <Copy
              size={10}
              lines={1}
              style={{ color: "rgba(255,255,255,0.78)", letterSpacing: 0.6 }}
            >
              {KIND[a.type].toUpperCase()}
            </Copy>
          </View>
        </View>
        <View style={{ gap: 2 }}>
          <Copy
            size={compact ? 18 : 24}
            weight="semibold"
            fit
            style={{ color: "white", letterSpacing: -0.4 }}
          >
            {!owed && balance < 0 ? "−" : ""}
            {money(Math.abs(balance))}
          </Copy>
          <Copy size={10} lines={1} style={{ color: "rgba(255,255,255,0.78)" }}>
            {owed ? "owed" : balance < 0 ? "overdrawn" : "available"}
          </Copy>
        </View>
        {used !== null ? (
          <View style={{ gap: 4 }}>
            <View
              style={{
                height: 4,
                borderRadius: 2,
                backgroundColor: "rgba(255,255,255,0.22)",
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  width: `${Math.round(used * 100)}%`,
                  height: 4,
                  backgroundColor: "white",
                }}
              />
            </View>
            <Copy size={10} style={{ color: "rgba(255,255,255,0.85)" }}>
              {note.text}
            </Copy>
          </View>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {note.stale && (
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: "#ffd166",
                }}
              />
            )}
            <Copy size={10} style={{ color: "rgba(255,255,255,0.85)" }}>
              {note.text}
            </Copy>
          </View>
        )}
      </View>
    </Tap>
  )
}
