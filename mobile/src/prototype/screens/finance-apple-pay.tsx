// Logging an Apple Pay tap: the quick-add deep link a Shortcuts "Transaction"
// automation opens, and the screen that explains how to set one up.
import { finStore } from "@domain/finance/store"
import { useLocalSearchParams } from "expo-router"
import { useEffect, useMemo } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { copyText } from "../media"
import { Copy, Frame } from "../native-kit"
import { quickAdd } from "../quick-add"
import { Button, Screen } from "../ui"
import { FinanceHome } from "./finance-home"

export const QUICK_ADD_URL =
  "personalsop://finance/quick-add?amount=[Amount]&merchant=[Merchant]&card=[Card or Pass]"

/** Finance home with a new expense open, filled from the link. Never saves. */
export function FinanceQuickAdd() {
  const params = useLocalSearchParams<Record<string, string | string[]>>(),
    key = JSON.stringify(params),
    // biome-ignore lint/correctness/useExhaustiveDependencies: once per link
    q = useMemo(() => quickAdd(finStore.get(), params), [key])
  useEffect(() => {
    if (q.error) toast.error(q.error)
  }, [q])
  return <FinanceHome key={key} prefill={q.prefill} />
}

const STEPS = [
  "Open the Shortcuts app → Automation → + → Transaction.",
  "Pick the cards to watch (or all of them), keep “When I tap” on, choose Run Immediately, then Next → New Blank Automation.",
  "Add a URL Encode action and set its text to the Merchant variable (tap the field, then Shortcut Input → Merchant). Add a second URL Encode for Card or Pass.",
  "Add an Open URLs action and paste the link below. Replace each [bracket] with the matching variable: Amount from Shortcut Input, and the two URL Encode results for Merchant and Card or Pass.",
  "Tap Done. Next time you pay with Apple Pay, the app opens a new expense with the amount, payee and account filled in — check it and tap Save.",
]

export function ApplePaySetup() {
  return (
    <Screen title="Log Apple Pay taps">
      <Copy size={14} muted>
        An iOS Shortcuts automation (iOS 17 or later) opens a filled-in expense
        each time you tap your iPhone to pay. Nothing is saved until you
        confirm.
      </Copy>
      <Frame style={{ padding: 16, gap: 12 }}>
        {STEPS.map((step, i) => (
          <View key={step} style={{ flexDirection: "row", gap: 8 }}>
            <Copy weight="medium">{i + 1}.</Copy>
            <Copy style={{ flex: 1 }}>{step}</Copy>
          </View>
        ))}
      </Frame>
      <Frame style={{ padding: 16, gap: 12 }}>
        <Copy size={13}>{QUICK_ADD_URL}</Copy>
        <Button tone="quiet" onPress={() => void copyText(QUICK_ADD_URL)}>
          Copy link
        </Button>
      </Frame>
      <Copy size={12} muted>
        The account is the one whose name matches the card (name your account
        like the card in Wallet), otherwise your last-used one.
      </Copy>
    </Screen>
  )
}
