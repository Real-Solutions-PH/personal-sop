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

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`
const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

export function FinanceSetup({
  onDone,
  embedded = false,
  canSkip = true,
}: {
  onDone?: () => void
  embedded?: boolean
  /** First-run setup leaves no step unanswered: no Skip there. */
  canSkip?: boolean
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
        },
        {
          key: "gcash",
          name: "GCash",
          type: "ewallet",
          color: "blue",
          on: true,
          balance: "",
        },
        {
          key: "maya",
          name: "Maya",
          type: "ewallet",
          color: "emerald",
          on: true,
          balance: "",
        },
        {
          key: "bank",
          name: "BPI Savings",
          type: "bank",
          color: "red",
          on: true,
          balance: "",
        },
      ].map((r) => ({ ...r, suggested: r.name })),
    ),
    [salary, setSalary] = useState(""),
    [rent, setRent] = useState(""),
    [tried, setTried] = useState(false),
    set = (key: string, patch: Partial<(typeof rows)[number]>) =>
      setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r))),
    live = s.accounts.filter((a) => !a.archived),
    // Checked as it renders, not once at mount: an account that syncs in
    // while the step is open drops its suggestion.
    shown = rows.filter((r) => !live.some((a) => same(a.name, r.suggested))),
    picked = shown.filter((r) => r.on),
    // Where salary and rent land: the bank row, else the first other
    // account being added, else a non-card one the person already has.
    landing = picked.find((r) => r.key === "bank") ?? picked[0],
    existing = live.find((a) => a.type !== "credit"),
    plans = Number(salary) > 0 || Number(rent) > 0,
    homeless = plans && !landing && !existing,
    dupe = (r: (typeof rows)[number]) =>
      live.some((a) => same(a.name, r.name)) ||
      picked.some((o) => o.key !== r.key && same(o.name, r.name))
  const finish = () => {
    setTried(true)
    const unnamed = picked.find((r) => !r.name.trim()),
      twin = picked.find(dupe)
    if (unnamed) {
      toast.error("Give every ticked account a name")
      return
    }
    if (twin) {
      toast.error(`You already have an account called “${twin.name.trim()}”`)
      return
    }
    if (homeless) return
    const created: Record<string, string> = {}
    for (const r of picked) {
      created[r.key] = A.addAccount({
        name: r.name.trim(),
        type: r.type as AccountType,
        opening: Number(r.balance || 0),
        color: `var(--acct-${r.color})`,
        inNetWorth: true,
        inProjection: true,
      }).id
    }
    const home = landing ? created[landing.key] : existing?.id
    if (Number(salary) > 0 && home) {
      A.addPlanned({
        name: "Salary",
        type: "income",
        amount: Number(salary),
        estimated: false,
        accountId: home,
        categoryId: "salary",
        schedule: { kind: "semimonthly", days: [15, 30] },
        end: { kind: "never" },
        autoLog: true,
        isWhatIf: false,
        inProjection: true,
      })
    }
    if (Number(rent) > 0 && home) {
      A.addPlanned({
        name: "Rent",
        type: "expense",
        amount: Number(rent),
        estimated: false,
        accountId: home,
        categoryId: "rent",
        schedule: { kind: "monthly", day: 5 },
        end: { kind: "never" },
        autoLog: false,
        isWhatIf: false,
        inProjection: true,
      })
    }
    // A default account, so the first transaction has somewhere to go:
    // GCash, else the one already set, else the first everyday account.
    const firstSpend = picked[0],
      current = s.settings.defaultAccountId
    const fallback =
      current && live.some((a) => a.id === current)
        ? undefined
        : firstSpend
          ? created[firstSpend.key]
          : undefined
    const def = created.gcash ?? fallback
    if (def) A.updateSettings({ defaultAccountId: def })
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
        {shown.map((r) => (
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
                  // Lets the balance box keep its width beside a long name.
                  minWidth: 0,
                  // A name that clashes with another account, once Add was
                  // tapped.
                  ...(tried && r.on && dupe(r)
                    ? {
                        borderBottomWidth: 1,
                        borderColor: t.bad,
                      }
                    : {}),
                  fontSize: 16,
                  fontFamily: fonts.medium,
                  color: t.text,
                }}
              />
              <MoneyInput
                bare
                label={`${r.name} balance`}
                placeholder={`balance ${sym}`}
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
          </Frame>
        ))}
        {/* Every suggestion exists already: the accounts themselves,
            dimmed, rather than a line of text. */}
        {!shown.length &&
          live.slice(0, 5).map((a) => (
            <Frame key={a.id} style={{ padding: 12, opacity: 0.32 }}>
              <Line>
                <Check size={16} color={t.muted} />
                <Copy size={16} weight="medium" style={{ flex: 1 }}>
                  {a.name}
                </Copy>
              </Line>
            </Frame>
          ))}
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
            error={
              tried && homeless
                ? "Add an account for your salary and rent to land in"
                : undefined
            }
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
        {canSkip && (
          <Button
            tone="quiet"
            onPress={() => (onDone ? onDone() : go("/finance"))}
          >
            Skip
          </Button>
        )}
        <View style={{ flex: 1 }}>
          {!picked.length && live.length && !plans ? (
            // Nothing new to add and accounts exist: the step is done.
            <Button onPress={() => (onDone ? onDone() : go("/finance"))}>
              Continue
            </Button>
          ) : (
            <Button disabled={!picked.length && !plans} onPress={finish}>
              {picked.length
                ? `Add ${plural(picked.length, "account")}`
                : "Schedule"}
            </Button>
          )}
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
