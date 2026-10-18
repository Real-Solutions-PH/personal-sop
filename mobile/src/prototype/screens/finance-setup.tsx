import * as A from "@domain/finance/actions"
import type { AccountType } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { Check, Download } from "lucide-react-native"
import { useState } from "react"
import { TextInput, View } from "react-native"
import { toast } from "sonner-native"
import { Copy, Frame, Line, SectionHeading, Tap } from "../native-kit"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Button, Field, Screen } from "../ui"
export function FinanceSetup({
  onDone,
  embedded = false,
}: {
  onDone?: () => void
  embedded?: boolean
} = {}) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    [rows, setRows] = useState(() =>
      [
        {
          key: "cash",
          name: "Cash",
          type: "cash",
          color: "green",
          on: true,
          balance: "",
          limit: "",
        },
        {
          key: "gcash",
          name: "GCash",
          type: "ewallet",
          color: "blue",
          on: true,
          balance: "",
          limit: "",
        },
        {
          key: "maya",
          name: "Maya",
          type: "ewallet",
          color: "emerald",
          on: true,
          balance: "",
          limit: "",
        },
        {
          key: "bank",
          name: "BPI Savings",
          type: "bank",
          color: "red",
          on: true,
          balance: "",
          limit: "",
        },
        {
          key: "cc",
          name: "Credit card",
          type: "credit",
          color: "rose",
          on: false,
          balance: "",
          limit: "",
        },
      ].filter(
        (r) =>
          !s.accounts.some(
            (a) => a.name.toLowerCase() === r.name.toLowerCase(),
          ),
      ),
    ),
    [salary, setSalary] = useState(""),
    [rent, setRent] = useState(""),
    set = (key: string, patch: Partial<(typeof rows)[number]>) =>
      setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const finish = () => {
    if (
      rows.some(
        (r) =>
          r.on &&
          (!r.name.trim() ||
            !Number.isFinite(Number(r.balance)) ||
            Number(r.balance) < 0),
      )
    ) {
      toast.error("Check account names and balances")
      return
    }
    const created: Record<string, string> = {}
    for (const r of rows.filter((r) => r.on)) {
      created[r.key] = A.addAccount({
        name: r.name.trim(),
        type: r.type as AccountType,
        opening: (r.type === "credit" ? -1 : 1) * Number(r.balance || 0),
        color: `var(--acct-${r.color})`,
        limit: r.type === "credit" ? Number(r.limit || 0) : undefined,
        inNetWorth: true,
        inProjection: r.type !== "credit",
      }).id
    }
    const bank = created.bank ?? s.accounts[0]?.id
    if (Number(salary) > 0 && bank)
      A.addPlanned({
        name: "Salary",
        type: "income",
        amount: Number(salary),
        estimated: false,
        accountId: bank,
        categoryId: "salary",
        schedule: { kind: "semimonthly", days: [15, 30] },
        end: { kind: "never" },
        autoLog: true,
        isWhatIf: false,
        inProjection: true,
      })
    if (Number(rent) > 0 && bank)
      A.addPlanned({
        name: "Rent",
        type: "expense",
        amount: Number(rent),
        estimated: false,
        accountId: bank,
        categoryId: "rent",
        schedule: { kind: "monthly", day: 5 },
        end: { kind: "never" },
        autoLog: false,
        isWhatIf: false,
        inProjection: true,
      })
    if (created.gcash) A.updateSettings({ defaultAccountId: created.gcash })
    const added = Object.keys(created).length
    toast(`${added} account${added === 1 ? "" : "s"} added`)
    if (onDone) onDone()
    else go("/finance")
  }
  const picked = rows.filter((r) => r.on).length
  const content = (
    <>
      <Copy size={14} muted style={{ paddingHorizontal: 4 }}>
        Pick where your money lives and type today's balance. You can fine-tune
        later.
      </Copy>
      <View style={{ gap: 8 }}>
        {rows.map((r) => (
          <Frame key={r.key} style={{ padding: 12, opacity: r.on ? 1 : 0.6 }}>
            <Line>
              <Tap
                label={`Include ${r.name}`}
                onPress={() => set(r.key, { on: !r.on })}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: r.on ? t.fin : t.line,
                  backgroundColor: r.on ? t.fin : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {r.on && <Check size={14} color={t.bg} />}
              </Tap>
              <View
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  backgroundColor: t[`acct-${r.color}` as "acct-green"],
                }}
              />
              <TextInput
                accessibilityLabel={`${r.key} account name`}
                value={r.name}
                onChangeText={(name) => set(r.key, { name })}
                style={{
                  flex: 1,
                  // Web TextInputs have an intrinsic width; let it shrink so
                  // the balance input stays inside the card.
                  minWidth: 0,
                  fontSize: 16,
                  fontFamily: fonts.medium,
                  color: t.text,
                }}
              />
              <TextInput
                accessibilityLabel={`${r.name} balance`}
                placeholder={r.type === "credit" ? "owed ₱" : "balance ₱"}
                placeholderTextColor={t.muted}
                value={r.balance}
                onChangeText={(v) =>
                  set(r.key, { balance: v.replace(/[^\d.]/g, ""), on: true })
                }
                keyboardType="decimal-pad"
                style={{
                  width: 104,
                  flexShrink: 0,
                  height: 36,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: t.line,
                  paddingHorizontal: 8,
                  backgroundColor: t.bg,
                  color: t.text,
                  fontFamily: fonts.body,
                  fontSize: 14,
                  textAlign: "right",
                }}
              />
            </Line>
            {r.type === "credit" && r.on && (
              <Field
                label="Credit limit"
                hideLabel
                placeholder="Credit limit ₱"
                value={r.limit}
                onChangeText={(v) =>
                  set(r.key, { limit: v.replace(/[^\d.]/g, "") })
                }
                keyboardType="decimal-pad"
              />
            )}
          </Frame>
        ))}
        {!rows.length && (
          <Copy size={14} muted style={{ textAlign: "center" }}>
            All suggested accounts already exist.
          </Copy>
        )}
      </View>
      <View style={{ marginTop: -12 }}>
        <SectionHeading>Unlock the projection · optional</SectionHeading>
        <Frame style={{ padding: 16 }}>
          <Field
            label="Salary per payday ₱ (15th & 30th)"
            placeholder="e.g. 27500"
            value={salary}
            onChangeText={(v) => setSalary(v.replace(/[^\d]/g, ""))}
            keyboardType="decimal-pad"
          />
          <Field
            label="Rent ₱ (5th of the month)"
            placeholder="e.g. 12000"
            value={rent}
            onChangeText={(v) => setRent(v.replace(/[^\d]/g, ""))}
            keyboardType="decimal-pad"
          />
        </Frame>
      </View>
      <Frame style={{ padding: 16 }}>
        <Line>
          <Download size={20} color={t.muted} />
          <View style={{ flex: 1 }}>
            <Copy size={14}>Coming from Wallet (BudgetBaker)?</Copy>
            <Copy size={12} muted>
              Import your CSV export for instant history.
            </Copy>
          </View>
          <Button
            small
            tone="quiet"
            onPress={() =>
              toast(
                "Mock: the Wallet CSV runs through the statement-import pipeline",
              )
            }
          >
            Import
          </Button>
        </Line>
      </Frame>
      <Line style={{ gap: 8 }}>
        <Button
          tone="quiet"
          onPress={() => (onDone ? onDone() : go("/finance"))}
        >
          Skip
        </Button>
        <View style={{ flex: 1 }}>
          <Button disabled={!picked} onPress={finish}>
            {picked === 0
              ? "Pick an account"
              : `Add ${picked} account${picked === 1 ? "" : "s"}`}
          </Button>
        </View>
      </Line>
    </>
  )
  return embedded ? (
    <View style={{ gap: 12 }}>{content}</View>
  ) : (
    <Screen title="Set up Finance">{content}</Screen>
  )
}
