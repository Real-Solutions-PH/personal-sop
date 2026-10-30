import * as A from "@domain/finance/actions"
import type { AccountType } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { useCurrency } from "@domain/lib/money"
import { Check, Download } from "lucide-react-native"
import { useState } from "react"
import { TextInput, View } from "react-native"
import { toast } from "sonner-native"
import { MoneyInput } from "../money-input"
import { Copy, Frame, Line, SectionHeading, Tap } from "../native-kit"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Button, Screen } from "../ui"
export function FinanceSetup({
  onDone,
  embedded = false,
}: {
  onDone?: () => void
  embedded?: boolean
} = {}) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    sym = useCurrency().symbol,
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
    // Salary and rent land in the bank, else the first account just added
    // (the store's own list does not hold those yet), else an older one.
    const bank = created.bank ?? Object.values(created)[0] ?? s.accounts[0]?.id
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
    toast(`${Object.keys(created).length} accounts added`)
    if (onDone) onDone()
    else go("/finance")
  }
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
                  fontSize: 16,
                  fontFamily: fonts.medium,
                  color: t.text,
                }}
              />
              <MoneyInput
                bare
                label={`${r.name} balance`}
                placeholder={
                  r.type === "credit" ? `owed ${sym}` : `balance ${sym}`
                }
                value={r.balance}
                onChange={(balance) => set(r.key, { balance, on: true })}
                style={{
                  width: 112,
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
              <MoneyInput
                label="Credit limit"
                hideLabel
                placeholder={`Credit limit ${sym}`}
                value={r.limit}
                onChange={(limit) => set(r.key, { limit })}
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
          <MoneyInput
            label={`Salary per payday ${sym} (15th & 30th)`}
            placeholder="e.g. 27,500"
            value={salary}
            onChange={setSalary}
          />
          <MoneyInput
            label={`Rent ${sym} (5th of the month)`}
            placeholder="e.g. 12,000"
            value={rent}
            onChange={setRent}
          />
        </Frame>
      </View>
      {!embedded && (
        <Frame style={{ padding: 16 }}>
          <Line>
            <Download size={20} color={t.muted} />
            <View style={{ flex: 1 }}>
              <Copy size={14}>Coming from Wallet (BudgetBaker)?</Copy>
              <Copy size={12} muted>
                Import your CSV export for instant history.
              </Copy>
            </View>
            <Button small tone="quiet" onPress={() => go("/finance/import")}>
              Import
            </Button>
          </Line>
        </Frame>
      )}
      <Line style={{ gap: 8 }}>
        <Button
          tone="quiet"
          onPress={() => (onDone ? onDone() : go("/finance"))}
        >
          Skip
        </Button>
        <View style={{ flex: 1 }}>
          <Button
            disabled={!rows.some((r) => r.on)}
            onPress={finish}
          >{`Add ${rows.filter((r) => r.on).length} accounts`}</Button>
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
