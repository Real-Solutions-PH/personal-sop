// Logging an Apple Pay tap: the quick-add deep link a Shortcuts "Transaction"
// automation opens, and the screen that explains how to set one up.
import * as A from "@domain/finance/actions"
import type { FinRecord } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { useLocalSearchParams } from "expo-router"
import { useEffect, useMemo, useRef } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { copyText } from "../media"
import { Copy, Frame } from "../native-kit"
import { quickAdd } from "../quick-add"
import { Button, Screen, undo } from "../ui"
import { FinanceHome } from "./finance-home"

export const QUICK_ADD_URL =
  "personalsop://finance/quick-add?amount=[Amount]&merchant=[Merchant]&card=[Card or Pass]"

/** A tap whose card has a certain account (tied earlier, or the only one
 * named like it) saves straight away, with Undo. Otherwise finance home opens
 * a new expense filled from the link, and saving it ties the card to the
 * account picked. */
export function FinanceQuickAdd() {
  const params = useLocalSearchParams<Record<string, string | string[]>>(),
    key = JSON.stringify(params),
    // biome-ignore lint/correctness/useExhaustiveDependencies: once per link
    q = useMemo(() => quickAdd(finStore.get(), params), [key]),
    saved = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (q.error) toast.error(q.error)
    else if (q.auto && saved.current !== key) {
      saved.current = key
      const { amount = 0, accountId, categoryId, payee } = q.prefill,
        r = A.logExpense({
          amount,
          accountId,
          categoryId,
          payee,
          source: "quick-add",
        })
      undo(`Saved ${q.prefill.payee ?? "Apple Pay"} expense`, () =>
        A.deleteRecord(r.id),
      )
    }
  }, [q, key])
  function remember(r: FinRecord) {
    const { card } = q
    if (!card || r.type !== "expense") return
    const map = finStore.get().settings.cardAccounts
    if (map?.[card] !== r.accountId)
      A.updateSettings({ cardAccounts: { ...map, [card]: r.accountId } })
  }
  return (
    <FinanceHome
      key={key}
      prefill={q.auto ? undefined : q.prefill}
      onSaved={remember}
    />
  )
}

const STEPS = [
  "Open the Shortcuts app → Automation → + → Transaction.",
  "Pick the cards to watch (or all of them), keep “When I tap” on, choose Run Immediately, then Next → New Blank Automation.",
  "Add a URL Encode action and set its text to the Merchant variable (tap the field, then Shortcut Input → Merchant). Add a second URL Encode for Card or Pass.",
  "Add an Open URLs action and paste the link below. Replace each [bracket] with the matching variable: Amount from Shortcut Input, and the two URL Encode results for Merchant and Card or Pass.",
  "Tap Done. Next time you pay, the expense saves straight away to the account named like the card, with Undo. If no account (or more than one) matches, the app opens the expense to pick one — after that, that card saves straight away too.",
]

export function ApplePaySetup() {
  return (
    <Screen title="Log Apple Pay taps">
      <Copy size={14} muted>
        An iOS Shortcuts automation (iOS 17 or later) logs an expense each time
        you tap your iPhone to pay, straight to the account named like the card.
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
        Name each account like its card in Wallet. Picking an account for a card
        remembers it; pick a different one later to change it. A merchant with
        no category yet still opens the expense to check.
      </Copy>
    </Screen>
  )
}
