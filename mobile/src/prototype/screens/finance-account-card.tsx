// An account drawn as the thing it is: a place your money is kept, like a
// card in a wallet, filled with the account's own colour. Stat cards stay
// outlined, so a glance tells "where money lives" from "what it adds up to".
import * as C from "@domain/finance/calc"
import type { Account, AccountType } from "@domain/finance/data"
import { LinearGradient } from "expo-linear-gradient"
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

export function useAccountColor(a: Account) {
  const t = useTheme() as unknown as Record<string, string>
  if (!a.color?.startsWith("var(")) return a.color || t["acct-slate"]
  return t[a.color.slice(6, -1)] ?? t["acct-slate"]
}

/** What the card says under the balance: how much of the limit is used, or
 * how fresh the balance is. */
function footnote(
  a: Account,
  balance: number,
  nudgeDays: number,
): {
  text: string
  stale: boolean
} {
  if (a.type === "credit" && a.limit)
    return {
      text: `${Math.round((Math.abs(balance) / a.limit) * 100)}% of limit used`,
      stale: false,
    }
  if (a.manual) return { text: "Value you set", stale: false }
  const days = C.lastReconciledDays(a)
  if (days === null) return { text: "Not matched yet", stale: true }
  return {
    text: `Matched ${days === 0 ? "today" : `${days}d ago`}`,
    stale: days > nudgeDays,
  }
}

export function AccountCard({
  account: a,
  balance,
  nudgeDays,
  compact = false,
  onPress,
}: {
  account: Account
  balance: number
  nudgeDays: number
  /** The small card in the Finance home row; full width otherwise. */
  compact?: boolean
  onPress?: () => void
}) {
  const money = useMoney()
  const base = useAccountColor(a)
  const Icon = ICONS[a.type]
  const owed = a.type === "credit"
  const note = footnote(a, balance, nudgeDays)
  const used = owed && a.limit ? Math.min(1, Math.abs(balance) / a.limit) : null
  const label = `${a.name}, ${KIND[a.type]}, ${owed ? "owed " : balance < 0 ? "minus " : ""}${money(Math.abs(balance))}. ${note.text}`
  return (
    <Tap
      label={label}
      onPress={onPress ?? (() => go(`/finance/accounts/${a.id}`))}
      style={compact ? { width: 168 } : undefined}
    >
      <LinearGradient
        colors={[shade(base, 0.28), shade(base, 0.55)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: 18,
          padding: compact ? 12 : 16,
          minHeight: compact ? 112 : 128,
          overflow: "hidden",
          justifyContent: "space-between",
          gap: compact ? 8 : 12,
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
              lines={1}
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
            lines={1}
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
            <Copy
              size={10}
              lines={1}
              style={{ color: "rgba(255,255,255,0.85)" }}
            >
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
            <Copy
              size={10}
              lines={1}
              style={{ color: "rgba(255,255,255,0.85)" }}
            >
              {note.text}
            </Copy>
          </View>
        )}
      </LinearGradient>
    </Tap>
  )
}
