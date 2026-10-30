import { confirmRecord } from "@domain/finance/actions"
import * as N from "@domain/finance/calc"
import type { FinRecord } from "@domain/finance/data"
import { reportData } from "@domain/finance/reports"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { useLocalSearchParams } from "expo-router"
import {
  CalendarClock,
  ChartLine,
  FileUp,
  FolderTree,
  History,
  ListOrdered,
  Plus,
  Settings,
  Sparkles,
  Target,
  Wallet,
} from "lucide-react-native"
import { useState } from "react"
import { Text, View } from "react-native"
import { Sparkline } from "../chart"
import {
  Copy,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  SmallButton,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { PrivacyEye } from "../privacy-eye"
import { useTheme } from "../theme"
import { Screen } from "../ui"
import { RecordEditor, useMoney } from "./finance"
import {
  BudgetsSection,
  CashFlowSection,
  SavingsSection,
} from "./finance-home-cards"
import { FinPill } from "./finance-planned"
import {
  BudgetHistoryCard,
  CategoryCard,
  ExpectedNetWorthCard,
  SavingsRateCard,
  TopPayeesCard,
  WeekdayCard,
} from "./finance-report-cards"
import { LockedPreview } from "./locked-preview"

export const sourceLabel = (source: FinRecord["source"]) =>
  ({
    chat: "chat",
    "quick-add": "quick",
    photo: "receipt",
    import: "import",
    planned: "scheduled",
    manual: "manual",
    adjustment: "adjust",
  })[source]
export function FinanceRecord({
  record,
  onPress,
  selected,
}: {
  record: FinRecord
  onPress?: () => void
  selected?: boolean
}) {
  const t = useTheme(),
    s = finStore.use((s) => s),
    money = useMoney(),
    category = s.categories.find((c) => c.id === record.categoryId),
    account = s.accounts.find((a) => a.id === record.accountId)
  return (
    <Tap
      onPress={onPress ?? (() => go(`/finance/records/${record.id}`))}
      style={{
        paddingVertical: 8,
        paddingHorizontal: 4,
        minHeight: 56,
        borderRadius: 12,
        backgroundColor: selected ? `${t.fin}1a` : undefined,
      }}
    >
      <Line>
        <View
          style={{
            height: 40,
            width: 40,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: t.soft,
          }}
        >
          <Copy size={18}>
            {selected
              ? "✓"
              : record.type === "transfer"
                ? "⇄"
                : (category?.icon ?? "💸")}
          </Copy>
        </View>
        <View style={{ flex: 1 }}>
          <Line style={{ gap: 4 }}>
            <Copy weight="medium" style={{ flexShrink: 1 }}>
              {record.payee ??
                (record.type === "transfer"
                  ? `${account?.name} → ${s.accounts.find((a) => a.id === record.toAccountId)?.name}`
                  : (category?.name ?? "Untitled"))}
            </Copy>
            {record.status === "pending" && (
              <FinPill tone="warn">review</FinPill>
            )}
          </Line>
          <Copy size={12} muted>
            {record.type === "transfer"
              ? `${account?.name ?? "?"} → ${s.accounts.find((a) => a.id === record.toAccountId)?.name ?? "?"}`
              : `${category?.name ?? "Uncategorised"} · ${account?.name ?? "?"}`}{" "}
            ·{" "}
            {new Date(record.at).toLocaleTimeString("en-PH", {
              hour: "numeric",
              minute: "2-digit",
            })}
            {record.source !== "manual"
              ? ` · ${sourceLabel(record.source)}`
              : ""}
          </Copy>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Copy
            size={16}
            weight="semibold"
            style={{
              color:
                record.type === "income"
                  ? t.fin
                  : record.type === "transfer"
                    ? t.muted
                    : t.text,
            }}
          >
            {record.type === "income"
              ? "+"
              : record.type === "expense"
                ? "−"
                : ""}
            {money(record.amount)}
          </Copy>
          {record.origCurrency && record.origAmount ? (
            <Copy size={12} muted>
              {foreignAmount(record.origAmount, record.origCurrency)}
            </Copy>
          ) : null}
        </View>
      </Line>
    </Tap>
  )
}
/** An amount kept in another currency, as spent: "$100.00", "€12.50". */
export function foreignAmount(amount: number, code: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(amount)
  } catch {
    return `${code} ${amount.toFixed(2)}`
  }
}

export function FinanceHome({
  prefill,
  onSaved,
}: {
  prefill?: Partial<FinRecord>
  onSaved?: (r: FinRecord) => void
}) {
  const params = useLocalSearchParams<{ add?: string }>()
  const t = useTheme(),
    s = finStore.use((s) => s),
    money = useMoney(),
    [adding, setAdding] = useState(
      !!prefill || params.add === "expense" || params.add === "income",
    ),
    _today = dayKey(),
    bal = N.balances(s),
    nw = N.netWorth(s, bal),
    series = N.netWorthSeries(s, 90),
    prior = series[series.length - 31] ?? nw,
    delta = prior ? ((nw - prior) / Math.abs(prior)) * 100 : 0,
    accounts = s.accounts
      .filter((a) => !a.archived)
      .sort((a, b) => a.order - b.order),
    available = accounts
      .filter((a) => a.inProjection)
      .reduce((v, a) => v + bal[a.id], 0),
    owed = Math.abs(
      accounts
        .filter((a) => a.type === "credit")
        .reduce((v, a) => v + Math.min(0, bal[a.id]), 0),
    ),
    stale = accounts.filter(
      (a) =>
        (a.type === "bank" || a.type === "ewallet") &&
        (N.lastReconciledDays(a) ?? 999) > s.settings.nudgeDays,
    ),
    pending = s.records.filter((r) => r.status === "pending"),
    report = reportData(s, "this")
  const shortcuts = [
    { label: "Transactions", href: "/finance/records", icon: ListOrdered },
    { label: "Accounts", href: "/finance/accounts", icon: Wallet },
    { label: "Budgets", href: "/finance/budgets", icon: Target },
    { label: "Scheduled", href: "/finance/planned", icon: CalendarClock },
    { label: "Reports", href: "/finance/reports", icon: ChartLine },
    { label: "Categories", href: "/finance/categories", icon: FolderTree },
    { label: "Imports", href: "/finance/imports", icon: History },
    { label: "Settings", href: "/finance/settings", icon: Settings },
  ]
  return (
    <Screen
      prototypeLayout
      title="Finance"
      actions={
        <Line style={{ gap: 0 }}>
          <PrivacyEye />
          <IconTap
            size={40}
            icon={Settings}
            label="Finance settings"
            color={t.text}
            onPress={() => go("/finance/settings")}
          />
        </Line>
      }
    >
      <View>
        <LockedPreview
          locked={!accounts.length}
          color={t.fin}
          title="Add your accounts"
          detail="Cash, GCash, Maya, your bank and credit card, with today's balances. Your net worth, budgets and reports fill in below."
          action={{
            label: "Set up Finance",
            onPress: () => go("/finance/setup"),
          }}
        >
          <Frame>
            <Tap onPress={() => go("/finance/accounts")} label="Net worth">
              <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                <Copy size={12} muted>
                  Net worth
                </Copy>
                <Copy
                  size={30}
                  weight="displayMedium"
                  fit
                  style={{ letterSpacing: -0.75 }}
                >
                  {money(nw)}
                </Copy>
                <Copy size={12} style={{ color: delta >= 0 ? t.good : t.bad }}>
                  {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
                  <Text style={{ color: t.muted }}> vs 30 days ago</Text>
                </Copy>
              </View>
              <View style={{ marginTop: 8 }}>
                <Sparkline
                  values={series}
                  height={48}
                  color={t.fin}
                  label="Net worth over 90 days"
                />
              </View>
              <Line
                style={{
                  gap: 0,
                  borderTopWidth: 1,
                  borderColor: t.line,
                }}
              >
                {[
                  { label: "Available", value: money(available) },
                  { label: "Owed on cards", value: money(owed) },
                ].map((m, i) => (
                  <View
                    key={m.label}
                    style={{
                      flex: 1,
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                      borderLeftWidth: i ? 1 : 0,
                      borderColor: t.line,
                    }}
                  >
                    <Copy size={12} muted>
                      {m.label}
                    </Copy>
                    <Copy size={18} weight="semibold" fit>
                      {m.value}
                    </Copy>
                  </View>
                ))}
              </Line>
            </Tap>
          </Frame>
          <Line style={{ marginTop: 12, gap: 8 }}>
            {[
              { label: "Add", icon: Plus, href: "" },
              { label: "Import", icon: FileUp, href: "/finance/import" },
              {
                label: "What if?",
                icon: Sparkles,
                href: "/finance/projection?whatif=1",
              },
            ].map((a) => (
              <Tap
                key={a.label}
                onPress={() => (a.href ? go(a.href) : setAdding(true))}
                style={{
                  flex: 1,
                  alignItems: "center",
                  gap: 6,
                  paddingVertical: 8,
                  borderRadius: 16,
                }}
              >
                <View
                  style={{
                    height: 44,
                    width: 44,
                    borderRadius: 16,
                    backgroundColor: `${t.fin}26`,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <a.icon size={20} color={t.fin} />
                </View>
                <Copy size={12}>{a.label}</Copy>
              </Tap>
            ))}
          </Line>
          {(stale.length > 0 || pending.length > 0) && (
            <View style={{ marginTop: 12, gap: 8 }}>
              {stale.slice(0, 2).map((a) => (
                <Tap
                  key={a.id}
                  onPress={() => go(`/finance/import?account=${a.id}`)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderRadius: 16,
                    backgroundColor: `${t.warn}1a`,
                  }}
                >
                  <Line>
                    <History size={16} color={t.warn} />
                    <Copy size={14} style={{ flex: 1 }}>
                      {a.name} not matched with a statement
                      {a.lastReconciled
                        ? ` for ${N.lastReconciledDays(a)} days`
                        : " yet"}
                    </Copy>
                    <Copy size={14} weight="semibold" style={{ color: t.warn }}>
                      Import
                    </Copy>
                  </Line>
                </Tap>
              ))}
              {pending.length > 0 && (
                <Frame style={{ padding: 12 }}>
                  <Line style={{ gap: 8, marginBottom: 4 }}>
                    <FinPill tone="warn">{pending.length} to check</FinPill>
                    <Copy size={14} muted>
                      Drafts to double-check
                    </Copy>
                  </Line>
                  {pending.map((r) => (
                    <Line key={r.id} style={{ gap: 8 }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <FinanceRecord record={r} />
                      </View>
                      <SmallButton
                        accent="fin"
                        quiet
                        onPress={() => confirmRecord(r.id)}
                      >
                        OK
                      </SmallButton>
                    </Line>
                  ))}
                </Frame>
              )}
            </View>
          )}
          <BudgetsSection s={s} />
          <CashFlowSection s={s} />
          <SavingsSection s={s} />
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 24,
            }}
          >
            {shortcuts.map((l) => (
              <Tap
                key={l.href}
                onPress={() => go(l.href)}
                style={{ width: "23.2%" }}
              >
                <Frame
                  style={{
                    alignItems: "center",
                    paddingVertical: 12,
                    gap: 6,
                  }}
                >
                  <l.icon size={20} color={t.muted} />
                  <Copy size={12} lines={1}>
                    {l.label}
                  </Copy>
                </Frame>
              </Tap>
            ))}
          </View>
          <View style={{ marginTop: 24, gap: 12 }}>
            <SavingsRateCard d={report} period="this" />
            <CategoryCard d={report} period="this" />
            <ExpectedNetWorthCard d={report} period="this" s={s} />
            <BudgetHistoryCard d={report} period="this" s={s} />
            <TopPayeesCard d={report} period="this" />
            <WeekdayCard d={report} period="this" />
          </View>
          <SectionHeading
            action={
              <Tap onPress={() => go("/finance/records")}>
                <Copy size={12} style={{ color: t.fin }}>
                  All transactions
                </Copy>
              </Tap>
            }
          >
            Recent
          </SectionHeading>
          <Frame style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
            {s.records
              .slice()
              .sort((a, b) => b.at.localeCompare(a.at))
              .slice(0, 5)
              .map((r) => (
                <FinanceRecord key={r.id} record={r} />
              ))}
          </Frame>
        </LockedPreview>
      </View>
      <RecordEditor
        prefill={
          prefill ?? { type: params.add === "income" ? "income" : "expense" }
        }
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={onSaved}
      />
    </Screen>
  )
}
