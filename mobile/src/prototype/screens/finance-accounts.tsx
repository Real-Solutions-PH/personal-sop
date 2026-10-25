import * as A from "@domain/finance/actions"
import * as C from "@domain/finance/calc"
import type { Account, AccountType } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { currentCurrency } from "@domain/lib/money"
import {
  Archive,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Banknote,
  CreditCard,
  FileUp,
  Landmark,
  Pencil,
  Plus,
  Scale,
  Smartphone,
  TrendingUp,
} from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { FinanceLineChart } from "../chart"
import {
  Bar,
  Copy,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Button, confirm, Empty, Field, Screen, Sheet, undo } from "../ui"
import { RecordEditor, useMoney } from "./finance"
import { AccountCard } from "./finance-account-card"
import { AccountEditor } from "./finance-account-editor"
import { FinanceRecord } from "./finance-home"
import { FinPill } from "./finance-planned"

const groups: Record<AccountType, string> = {
  cash: "Cash",
  ewallet: "E-wallets",
  bank: "Banks",
  credit: "Credit cards",
  investment: "Savings & investments",
}
export function AccountIcon({
  account: a,
  size = 40,
}: {
  account: Account
  size?: number
}) {
  const t = useTheme(),
    Icon = {
      cash: Banknote,
      ewallet: Smartphone,
      bank: Landmark,
      credit: CreditCard,
      investment: TrendingUp,
    }[a.type],
    key = a.color.replace(/var\(--|\)/g, ""),
    color = a.color.startsWith("var(")
      ? (((t as Record<string, unknown>)[key] as string) ?? t.fin)
      : a.color
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon size={size / 2} color="white" />
    </View>
  )
}
/** Interest, maturity and goal for a savings account or time deposit. */
function SavingsPanel({
  account: a,
  balance,
}: {
  account: Account
  balance: number
}) {
  const t = useTheme(),
    money = useMoney(),
    s = finStore.use((s) => s),
    v = C.savingsView(s, a, balance)
  const row = (label: string, value: string) => (
    <Line key={label} style={{ justifyContent: "space-between" }}>
      <Copy size={14} muted>
        {label}
      </Copy>
      <Copy size={14}>{value}</Copy>
    </Line>
  )
  return (
    <Frame style={{ padding: 16, gap: 8 }}>
      {v.goalProgress !== null && a.goal && (
        <>
          <Line style={{ justifyContent: "space-between" }}>
            <Copy size={14}>Goal</Copy>
            <Copy size={14}>
              {money(Math.max(0, balance))} / {money(a.goal)}
            </Copy>
          </Line>
          <Bar value={v.goalProgress} color={t.fin} />
          <Copy
            size={12}
            style={{ color: v.goalProgress >= 1 ? t.good : t.muted }}
          >
            {v.goalProgress >= 1
              ? "Goal reached"
              : v.perMonth !== null && a.goalBy
                ? `${money(v.perMonth)} a month to reach it by ${C.shortDate(a.goalBy)}`
                : `${money(a.goal - balance)} to go`}
          </Copy>
        </>
      )}
      {a.rate !== undefined && row("Interest", `${a.rate}% a year`)}
      {v.monthlyInterest !== null &&
        row("Est. a month, after 20% tax", money(v.monthlyInterest))}
      {row("Interest earned this year", money(v.earnedThisYear))}
      {v.maturesIn !== null &&
        a.maturesOn &&
        row(
          v.maturesIn > 0 ? "Matures" : "Matured",
          `${C.shortDate(a.maturesOn)}${v.maturesIn > 0 ? ` · ${v.maturesIn}d` : ""}`,
        )}
      {v.maturityValue !== null &&
        v.maturesIn !== null &&
        v.maturesIn > 0 &&
        row("Value at maturity, after tax", money(v.maturityValue))}
    </Frame>
  )
}
export function Accounts({ id }: { id?: string }) {
  const t = useTheme(),
    s = finStore.use((s) => s),
    money = useMoney(),
    a = s.accounts.find((a) => a.id === id),
    [edit, setEdit] = useState(false),
    [reorder, setReorder] = useState(false),
    [adjust, setAdjust] = useState(false),
    [transfer, setTransfer] = useState(false),
    [actual, setActual] = useState(""),
    bal = C.balances(s),
    live = s.accounts
      .filter((a) => !a.archived)
      .sort((a, b) => a.order - b.order)
  const move = (id: string, delta: number) => {
    const i = live.findIndex((a) => a.id === id),
      j = i + delta
    if (j < 0 || j >= live.length) return
    A.updateAccount(id, { order: live[j].order })
    A.updateAccount(live[j].id, { order: live[i].order })
  }
  const [from, to] = C.monthRange(
      C.monthOf(dayKey(), s.settings.monthStartDay),
      s.settings.monthStartDay,
    ),
    recs = a
      ? s.records
          .filter((r) => r.accountId === a.id || r.toAccountId === a.id)
          .reverse()
      : [],
    current = recs.filter((r) => C.recDay(r) >= from && C.recDay(r) <= to),
    inflow = a
      ? current.reduce(
          (n, r) =>
            n +
            ((r.accountId === a.id && r.type === "income") ||
            r.toAccountId === a.id
              ? r.amount
              : 0),
          0,
        )
      : 0,
    outflow = a
      ? current.reduce(
          (n, r) =>
            n + (r.accountId === a.id && r.type !== "income" ? r.amount : 0),
          0,
        )
      : 0,
    days = a ? C.lastReconciledDays(a) : null,
    imports = a ? s.imports.filter((i) => i.accountId === a.id) : []
  return (
    <Screen
      prototypeLayout
      title={a?.name ?? (id ? "Account" : "Accounts")}
      actions={
        a ? (
          <IconTap
            size={40}
            icon={Pencil}
            label="Edit account"
            color={t.text}
            onPress={() => setEdit(true)}
          />
        ) : (
          <Line style={{ gap: 0 }}>
            <Tap
              onPress={() => setReorder(!reorder)}
              style={{
                height: 40,
                paddingHorizontal: 12,
                justifyContent: "center",
              }}
            >
              <Copy size={14} style={{ color: reorder ? t.fin : t.muted }}>
                {reorder ? "Done" : "Reorder"}
              </Copy>
            </Tap>
            <IconTap
              size={40}
              icon={Plus}
              label="Add account"
              color={t.text}
              onPress={() => setEdit(true)}
            />
          </Line>
        )
      }
    >
      {id && !a ? (
        <Empty title="Account not found" />
      ) : a ? (
        <>
          <AccountCard
            account={a}
            balance={bal[a.id]}
            nudgeDays={s.settings.nudgeDays}
            onPress={() => setEdit(true)}
          />
          <Frame
            style={{ paddingHorizontal: 8, paddingTop: 16, paddingBottom: 4 }}
          >
            <FinanceLineChart
              series={[
                { values: C.accountSeries(s, a, 60), color: t.fin, area: true },
              ]}
              labels={Array.from({ length: 60 }, (_, i) =>
                i % 15 === 0 ? C.shortDate(C.addDays(dayKey(), i - 59)) : "",
              )}
              height={140}
            />
          </Frame>
          {!!(a.rate !== undefined || a.maturesOn || a.goal) && (
            <SavingsPanel account={a} balance={bal[a.id]} />
          )}
          {a.type === "credit" && a.limit ? (
            <Frame style={{ padding: 16, gap: 8 }}>
              <Line style={{ justifyContent: "space-between" }}>
                <Copy size={14}>Credit used</Copy>
                <Copy size={14}>
                  {money(Math.abs(bal[a.id]))} / {money(a.limit)}
                </Copy>
              </Line>
              <Bar value={Math.abs(bal[a.id]) / a.limit} color={t.fin} />
              <Copy size={12} style={{ color: t.good }}>
                Paid in full 3 cycles in a row
              </Copy>
            </Frame>
          ) : (
            <Line>
              <Frame style={{ padding: 16, flex: 1 }}>
                <Copy size={30} weight="displayMedium">
                  {money(inflow)}
                </Copy>
                <Copy size={12} muted>
                  In this month
                </Copy>
              </Frame>
              <Frame style={{ padding: 16, flex: 1 }}>
                <Copy size={30} weight="displayMedium">
                  {money(outflow)}
                </Copy>
                <Copy size={12} muted>
                  Out this month
                </Copy>
              </Frame>
            </Line>
          )}
          <Line style={{ gap: 8 }}>
            {[
              {
                name: "Transfer",
                icon: ArrowLeftRight,
                action: () => setTransfer(true),
              },
              {
                name: a.manual ? "Update" : "Adjust",
                icon: Scale,
                action: () => {
                  setActual(String(bal[a.id]))
                  setAdjust(true)
                },
              },
              {
                name: "Import",
                icon: FileUp,
                action: () => go(`/finance/import?account=${a.id}`),
              },
              {
                name: "Archive",
                icon: Archive,
                action: () =>
                  confirm(
                    `Archive ${a.name}?`,
                    `It has ${recs.length} transactions, so it can't be deleted. Archiving hides it from lists and pickers but keeps history.`,
                    () => {
                      A.updateAccount(a.id, { archived: true })
                      undo(`${a.name} archived`, () =>
                        A.updateAccount(a.id, { archived: false }),
                      )
                    },
                  ),
              },
            ].map((x) => (
              <Tap
                key={x.name}
                onPress={x.action}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 16,
                  backgroundColor: t.card,
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <x.icon size={20} color={t.fin} />
                <Copy size={12}>{x.name}</Copy>
              </Tap>
            ))}
          </Line>
          {!a.manual && (
            <Frame style={{ padding: 16 }}>
              <Line style={{ justifyContent: "space-between", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Copy size={14}>Last matched with statement</Copy>
                  <Copy
                    size={12}
                    style={{
                      color:
                        days !== null && days > s.settings.nudgeDays
                          ? t.warn
                          : t.muted,
                    }}
                  >
                    {a.lastReconciled
                      ? `${C.shortDate(a.lastReconciled)} · ${days} days ago`
                      : "Never"}
                  </Copy>
                </View>
                <Button
                  small
                  tone="quiet"
                  href={`/finance/import?account=${a.id}`}
                >
                  Match with statement
                </Button>
              </Line>
            </Frame>
          )}
          <View style={{ marginTop: -12 }}>
            <SectionHeading
              action={
                <Tap onPress={() => go(`/finance/records?account=${a.id}`)}>
                  <Copy size={12} style={{ color: t.fin }}>
                    See all {recs.length}
                  </Copy>
                </Tap>
              }
            >
              Transactions
            </SectionHeading>
            <Frame style={{ paddingHorizontal: 8, paddingVertical: 2 }}>
              {recs.slice(0, 12).map((r) => (
                <FinanceRecord key={r.id} record={r} />
              ))}
              {!recs.length && (
                <Copy
                  size={14}
                  muted
                  style={{ paddingVertical: 24, textAlign: "center" }}
                >
                  No transactions on this account yet.
                </Copy>
              )}
            </Frame>
          </View>
          {!!imports.length && (
            <View style={{ marginTop: -12 }}>
              <SectionHeading>Imports</SectionHeading>
              <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
                {imports.map((i) => (
                  <Tap
                    key={i.id}
                    onPress={() =>
                      go(
                        i.status === "review"
                          ? `/finance/import/${i.id}`
                          : "/finance/imports",
                      )
                    }
                    style={{ paddingVertical: 12 }}
                  >
                    <Line>
                      <View style={{ flex: 1 }}>
                        <Copy weight="medium" lines={1}>
                          {i.fileName}
                        </Copy>
                        <Copy size={12} muted>
                          {C.shortDate(i.from)} – {C.shortDate(i.to)}
                        </Copy>
                      </View>
                      <FinPill
                        tone={
                          i.status === "done"
                            ? "good"
                            : i.status === "failed"
                              ? "bad"
                              : i.status === "undone"
                                ? "muted"
                                : "warn"
                        }
                      >
                        {i.status}
                      </FinPill>
                    </Line>
                  </Tap>
                ))}
              </Frame>
            </View>
          )}
          <Sheet
            title={a.manual ? "Update value" : "Adjust balance"}
            open={adjust}
            onClose={() => setAdjust(false)}
          >
            <Field
              label={`Actual balance (${currentCurrency().code})`}
              value={actual}
              onChangeText={setActual}
              keyboardType="decimal-pad"
            />
            <Button
              disabled={!actual || !Number.isFinite(Number(actual))}
              onPress={() => {
                A.adjustBalance(a.id, Number(actual))
                A.updateAccount(a.id, { lastReconciled: dayKey() })
                setAdjust(false)
              }}
            >
              Save adjustment
            </Button>
          </Sheet>
          <RecordEditor
            open={transfer}
            onClose={() => setTransfer(false)}
            prefill={{ type: "transfer", accountId: a.id }}
          />
        </>
      ) : !live.length ? (
        <Empty title="No accounts yet" />
      ) : (
        <>
          <Frame style={{ padding: 16 }}>
            <Line style={{ justifyContent: "space-between" }}>
              <View>
                <Copy size={30} weight="displayMedium" style={{ color: t.fin }}>
                  {money(C.netWorth(s, bal))}
                </Copy>
                <Copy size={12} muted>
                  Net worth
                </Copy>
              </View>
              <Copy size={12} muted style={{ textAlign: "right" }}>
                {live.length} accounts{"\n"}credit cards count as debt
              </Copy>
            </Line>
          </Frame>
          {reorder ? (
            <Frame style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
              {live.map((a, i) => (
                <Line key={a.id} style={{ paddingVertical: 8 }}>
                  <AccountIcon account={a} />
                  <Copy weight="medium" style={{ flex: 1 }}>
                    {a.name}
                  </Copy>
                  <IconTap
                    icon={ArrowUp}
                    label={`Move ${a.name} up`}
                    background={t.soft}
                    onPress={() => i > 0 && move(a.id, -1)}
                  />
                  <IconTap
                    icon={ArrowDown}
                    label={`Move ${a.name} down`}
                    background={t.soft}
                    onPress={() => move(a.id, 1)}
                  />
                </Line>
              ))}
            </Frame>
          ) : (
            (Object.keys(groups) as AccountType[]).map((type) => {
              const group = live.filter((a) => a.type === type)
              return !group.length ? null : (
                <View key={type} style={{ marginTop: -12 }}>
                  <SectionHeading
                    action={
                      <Copy size={12} muted>
                        {money(group.reduce((n, a) => n + bal[a.id], 0))}
                      </Copy>
                    }
                  >
                    {groups[type]}
                  </SectionHeading>
                  <View style={{ gap: 10 }}>
                    {group.map((a) => (
                      <AccountCard
                        key={a.id}
                        account={a}
                        balance={bal[a.id]}
                        nudgeDays={s.settings.nudgeDays}
                      />
                    ))}
                  </View>
                </View>
              )
            })
          )}
          <Button tone="quiet" href="/finance/rates">
            Compare savings rates
          </Button>
          {s.accounts.some((a) => a.archived) && (
            <Tap onPress={() => go("/finance/archived")}>
              <Copy
                size={14}
                muted
                style={{ textAlign: "center", marginTop: 16 }}
              >
                Show {s.accounts.filter((a) => a.archived).length} archived
              </Copy>
            </Tap>
          )}
        </>
      )}
      {edit && (
        <AccountEditor
          key={a?.id ?? "new"}
          account={a}
          open={edit}
          onClose={() => setEdit(false)}
        />
      )}
    </Screen>
  )
}
