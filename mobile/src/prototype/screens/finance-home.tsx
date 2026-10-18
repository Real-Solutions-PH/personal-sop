import { confirmRecord } from "@domain/finance/actions"
import * as N from "@domain/finance/calc"
import type { FinRecord } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { privacyStore, togglePrivacy } from "@domain/lib/privacy"
import { useLocalSearchParams } from "expo-router"
import {
  Banknote,
  Bot,
  CalendarClock,
  ChartLine,
  CreditCard,
  Eye,
  EyeOff,
  FileUp,
  FolderTree,
  History,
  Landmark,
  ListOrdered,
  PiggyBank,
  Plus,
  Settings,
  Smartphone,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react-native"
import { useState } from "react"
import { ScrollView, Text, useWindowDimensions, View } from "react-native"
import { Sparkline } from "../chart"
import {
  Bar,
  Copy,
  Frame,
  IconTap,
  Line,
  LinkRow,
  SectionHeading,
  SmallButton,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Screen } from "../ui"
import { Ring } from "../visual"
import { RecordEditor, useMoney } from "./finance"
import { FinPill } from "./finance-planned"

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
            <Copy weight="medium" lines={1} style={{ flexShrink: 1 }}>
              {record.payee ??
                (record.type === "transfer"
                  ? `${account?.name} → ${s.accounts.find((a) => a.id === record.toAccountId)?.name}`
                  : (category?.name ?? "Untitled"))}
            </Copy>
            {record.status === "pending" && (
              <FinPill tone="warn">review</FinPill>
            )}
          </Line>
          <Copy size={12} muted lines={1}>
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
      </Line>
    </Tap>
  )
}
export function FinanceHome() {
  const params = useLocalSearchParams<{ add?: string }>()
  const t = useTheme(),
    s = finStore.use((s) => s),
    money = useMoney(),
    narrow = useWindowDimensions().width < 380,
    hidden = privacyStore.use((s) => s.hidden),
    [adding, setAdding] = useState(
      params.add === "expense" || params.add === "income",
    ),
    today = dayKey(),
    mk = N.monthOf(today, s.settings.monthStartDay),
    bal = N.balances(s),
    nw = N.netWorth(s, bal),
    series = N.netWorthSeries(s, 90),
    prior = series[series.length - 31] ?? nw,
    delta = prior ? ((nw - prior) / Math.abs(prior)) * 100 : 0,
    flow = N.flowIn(s, ...N.monthRange(mk, s.settings.monthStartDay)),
    views = s.budgets.filter((b) => !b.archived).map((b) => N.budgetView(s, b)),
    overall = views.find((v) => v.b.categoryIds === null),
    top = views
      .filter((v) => v.b.categoryIds !== null)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 3),
    proj = N.project(s, {
      horizon: s.settings.horizon,
      includeUnplanned: s.settings.includeUnplanned,
      excludedPlanned: s.settings.projExcludedPlanned,
    }),
    last = proj.months.at(-1),
    accounts = s.accounts
      .filter((a) => !a.archived)
      .sort((a, b) => a.order - b.order),
    stale = accounts.filter(
      (a) =>
        (a.type === "bank" || a.type === "ewallet") &&
        (N.lastReconciledDays(a) ?? 999) > s.settings.nudgeDays,
    ),
    pending = s.records.filter((r) => r.status === "pending"),
    lastMonth = N.addMonths(mk, -1),
    upcoming = N.occurrencesIn(
      s,
      N.addDays(today, -14),
      N.addDays(today, 7),
    ).filter((o) => o.status !== "paid" && o.status !== "skipped"),
    trio = [-2, -1, 0].map((i) => ({
      key: N.addMonths(mk, i),
      flow: N.flowIn(
        s,
        ...N.monthRange(N.addMonths(mk, i), s.settings.monthStartDay),
      ),
    })),
    maxFlow = Math.max(1, ...trio.flatMap((x) => [x.flow.income, x.flow.spend]))
  const acctIcons = {
    cash: Banknote,
    bank: Landmark,
    ewallet: Smartphone,
    credit: CreditCard,
    investment: TrendingUp,
  }
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
          <IconTap
            size={40}
            icon={hidden ? EyeOff : Eye}
            label={hidden ? "Show amounts" : "Hide amounts"}
            color={t.text}
            onPress={togglePrivacy}
          />
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
        {!accounts.length ? (
          <Frame style={{ padding: 24 }}>
            <Copy size={24} weight="display">
              Add your accounts
            </Copy>
            <Copy size={14} muted>
              Cash, GCash, Maya, your bank and credit card — with today's
              balances.
            </Copy>
            <SmallButton accent="fin" onPress={() => go("/finance/setup")}>
              Set up Finance
            </SmallButton>
          </Frame>
        ) : (
          <>
            <Frame>
              <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                <Line
                  style={{
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                  }}
                >
                  <View>
                    <Copy size={12} muted>
                      Net worth
                    </Copy>
                    <Copy
                      size={30}
                      weight="semibold"
                      style={{ letterSpacing: -0.75 }}
                    >
                      {money(nw)}
                    </Copy>
                    <Copy
                      size={12}
                      style={{ color: delta >= 0 ? t.good : t.bad }}
                    >
                      {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
                      <Text style={{ color: t.muted }}> vs 30 days ago</Text>
                    </Copy>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Copy size={12} muted>
                      Available
                    </Copy>
                    <Copy size={12} weight="medium">
                      {money(
                        accounts
                          .filter((a) => a.inProjection)
                          .reduce((v, a) => v + bal[a.id], 0),
                      )}
                    </Copy>
                    <Copy size={12} muted style={{ marginTop: 4 }}>
                      Card owed
                    </Copy>
                    <Copy size={12} weight="medium" style={{ color: t.bad }}>
                      {money(
                        Math.abs(
                          accounts
                            .filter((a) => a.type === "credit")
                            .reduce((v, a) => v + bal[a.id], 0),
                        ),
                      )}
                    </Copy>
                  </View>
                </Line>
              </View>
              <View style={{ marginTop: 8 }}>
                <Sparkline
                  values={series}
                  height={56}
                  color={t.fin}
                  label="Net worth over 90 days"
                />
              </View>
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
                { label: "Advisor", icon: Bot, href: "/finance/advisor" },
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
            <SectionHeading
              action={
                <Tap onPress={() => go("/finance/accounts")}>
                  <Copy size={12} style={{ color: t.fin }}>
                    All accounts
                  </Copy>
                </Tap>
              }
            >
              Accounts
            </SectionHeading>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -16 }}
              contentContainerStyle={{
                gap: 8,
                paddingHorizontal: 16,
                paddingBottom: 4,
              }}
            >
              {accounts.map((a) => {
                const Icon = acctIcons[a.type],
                  color = a.color?.startsWith("var(")
                    ? String(
                        t[a.color.slice(6, -1) as keyof typeof t] ??
                          t["acct-slate"],
                      )
                    : a.color
                return (
                  <Tap
                    key={a.id}
                    onPress={() => go(`/finance/accounts/${a.id}`)}
                    style={{ width: 144 }}
                  >
                    <Frame style={{ padding: 12 }}>
                      <Line style={{ gap: 8 }}>
                        <View
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 12,
                            backgroundColor: color ?? t["acct-slate"],
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Icon size={14} color="white" />
                        </View>
                        <Copy size={12} muted lines={1}>
                          {a.name}
                        </Copy>
                      </Line>
                      <Copy
                        weight="semibold"
                        style={{
                          marginTop: 8,
                          color: bal[a.id] < 0 ? t.bad : t.text,
                        }}
                      >
                        {money(bal[a.id])}
                      </Copy>
                      {a.type === "credit" && a.limit ? (
                        <View style={{ marginTop: 8 }}>
                          <Bar
                            value={Math.abs(bal[a.id]) / a.limit}
                            color={t.fin}
                          />
                        </View>
                      ) : (
                        <Copy size={10} muted style={{ marginTop: 8 }}>
                          {a.manual
                            ? "manual value"
                            : a.lastReconciled
                              ? `matched ${N.lastReconciledDays(a)}d ago`
                              : "never matched"}
                        </Copy>
                      )}
                    </Frame>
                  </Tap>
                )
              })}
            </ScrollView>
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
                      <Copy
                        size={14}
                        weight="semibold"
                        style={{ color: t.warn }}
                      >
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
                        AI drafts to double-check
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
            <SectionHeading
              action={
                <Tap onPress={() => go("/finance/budgets")}>
                  <Copy size={12} style={{ color: t.fin }}>
                    Budgets
                  </Copy>
                </Tap>
              }
            >
              {N.monthLabel(mk, true)}
            </SectionHeading>
            <Frame style={{ padding: 16 }}>
              <Tap onPress={() => go("/finance/budgets")}>
                <Line style={{ gap: 16 }}>
                  <Ring
                    value={overall?.pct ?? 0}
                    size={84}
                    strokeWidth={9}
                    color={
                      overall && overall.pct > overall.pace ? t.fit : t.fin
                    }
                  >
                    <Copy size={18} weight="semibold">
                      {Math.round((overall?.pct ?? 0) * 100)}%
                    </Copy>
                    <Copy size={10} muted>
                      of budget
                    </Copy>
                  </Ring>
                  <View
                    style={{
                      flex: 1,
                      flexDirection: "row",
                      flexWrap: "wrap",
                      rowGap: 12,
                    }}
                  >
                    {[
                      { label: "Spent", value: money(flow.spend) },
                      { label: "Budget", value: money(overall?.limit ?? 0) },
                      {
                        label: "Safe to spend / day",
                        value: money(overall?.safePerDay ?? 0),
                      },
                      { label: "Days left", value: overall?.daysLeft ?? "—" },
                    ].map((m, i) => (
                      <View
                        key={m.label}
                        style={{ width: "50%", paddingRight: 4 }}
                      >
                        <Copy
                          size={narrow ? 20 : 24}
                          weight="display"
                          lines={1}
                          style={{ color: i === 2 ? t.fin : t.text }}
                        >
                          {m.value}
                        </Copy>
                        <Copy size={12} muted lines={narrow ? 2 : 1}>
                          {m.label}
                        </Copy>
                      </View>
                    ))}
                  </View>
                </Line>
                <View style={{ marginTop: 16, gap: 10 }}>
                  {top.map((v) => (
                    <View key={v.b.id}>
                      <Line
                        style={{
                          justifyContent: "space-between",
                          marginBottom: 4,
                        }}
                      >
                        <Copy size={12}>{v.b.name}</Copy>
                        <Copy
                          size={12}
                          style={{
                            color:
                              v.pct > 1
                                ? t.bad
                                : v.pct > v.pace
                                  ? t.warn
                                  : t.muted,
                          }}
                        >
                          {Math.round(v.pct * 100)}%
                        </Copy>
                      </Line>
                      <Bar
                        value={v.pct}
                        color={v.pct > 1 ? t.bad : t.fin}
                        target={v.pace}
                      />
                    </View>
                  ))}
                </View>
              </Tap>
            </Frame>
            <Frame style={{ padding: 16, marginTop: 12 }}>
              <Tap onPress={() => go("/finance/reports/cashflow")}>
                <Line
                  style={{ justifyContent: "space-between", marginBottom: 12 }}
                >
                  <Copy size={14} weight="medium">
                    Cash flow
                  </Copy>
                  <Line style={{ gap: 12 }}>
                    {[
                      { label: "In", color: `${t.good}cc` },
                      { label: "Out", color: `${t.bad}b3` },
                    ].map((x) => (
                      <Line key={x.label} style={{ gap: 4 }}>
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: x.color,
                          }}
                        />
                        <Copy size={11} muted>
                          {x.label}
                        </Copy>
                      </Line>
                    ))}
                  </Line>
                </Line>
                <Line style={{ alignItems: "flex-end", gap: 16 }}>
                  <View style={{ width: 112, gap: 8 }}>
                    <Copy size={24} weight="display">
                      {flow.income - flow.spend >= 0 ? "+" : "−"}
                      {money(Math.abs(flow.income - flow.spend))}
                    </Copy>
                    <Copy size={12} muted>
                      Net this month
                    </Copy>
                    <View>
                      <Copy size={12} muted lines={1}>
                        In {money(flow.income)}
                      </Copy>
                      <Copy size={12} muted lines={1}>
                        Out {money(flow.spend)}
                      </Copy>
                    </View>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Line
                      style={{ height: 72, alignItems: "flex-end", gap: 12 }}
                    >
                      {trio.map((x) => (
                        <Line
                          key={x.key}
                          style={{
                            height: 72,
                            flex: 1,
                            alignItems: "flex-end",
                            gap: 3,
                          }}
                        >
                          <View
                            style={{
                              flex: 1,
                              height: `${(x.flow.income / maxFlow) * 100}%`,
                              backgroundColor: `${t.good}cc`,
                              borderTopLeftRadius: 4,
                              borderTopRightRadius: 4,
                            }}
                          />
                          <View
                            style={{
                              flex: 1,
                              height: `${(x.flow.spend / maxFlow) * 100}%`,
                              backgroundColor: `${t.bad}b3`,
                              borderTopLeftRadius: 4,
                              borderTopRightRadius: 4,
                            }}
                          />
                        </Line>
                      ))}
                    </Line>
                    <Line style={{ marginTop: 4, gap: 12 }}>
                      {trio.map((x) => (
                        <Copy
                          key={x.key}
                          size={10}
                          muted
                          style={{ flex: 1, textAlign: "center" }}
                        >
                          {N.monthLabel(x.key)}
                        </Copy>
                      ))}
                    </Line>
                  </View>
                </Line>
              </Tap>
            </Frame>
            <Frame
              style={{
                padding: 16,
                marginTop: 12,
                borderColor: `${t.fin}4d`,
                backgroundColor: `${t.fin}0d`,
              }}
            >
              <Tap onPress={() => go("/finance/projection")}>
                <Line style={{ gap: 8 }}>
                  <PiggyBank size={16} color={t.fin} />
                  <Copy size={12} style={{ color: t.fin }}>
                    Savings projection
                  </Copy>
                </Line>
                {proj.hasIncome ? (
                  <>
                    <Line
                      style={{
                        justifyContent: "space-between",
                        alignItems: "flex-end",
                        gap: 8,
                        marginTop: 4,
                      }}
                    >
                      <View>
                        <Copy size={24} weight="semibold">
                          {money(last?.end ?? proj.start)}
                        </Copy>
                        <Copy size={12} muted>
                          by {last ? N.monthLabel(last.key, true) : ""} ·{" "}
                          <Text style={{ color: t.good }}>
                            +{hidden ? "₱•••" : N.compact(proj.avgSurplus)}/mo
                          </Text>
                        </Copy>
                      </View>
                      <Copy
                        size={14}
                        weight="semibold"
                        style={{ color: t.fin }}
                      >
                        Plan a purchase →
                      </Copy>
                    </Line>
                    <View style={{ marginTop: 8 }}>
                      <Sparkline
                        values={[proj.start, ...proj.months.map((m) => m.end)]}
                        color={t.fin}
                        height={44}
                        label="Savings projection"
                      />
                    </View>
                  </>
                ) : (
                  <Copy size={14} style={{ marginTop: 4 }}>
                    Add your salary as a scheduled payment to unlock the
                    forecast.
                  </Copy>
                )}
              </Tap>
            </Frame>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 16,
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
                    <Copy size={12}>{l.label}</Copy>
                  </Frame>
                </Tap>
              ))}
            </View>
            <SectionHeading
              action={
                <Tap onPress={() => go("/finance/planned")}>
                  <Copy size={12} style={{ color: t.fin }}>
                    Scheduled
                  </Copy>
                </Tap>
              }
            >
              Next 7 days
            </SectionHeading>
            <Frame style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
              {upcoming.slice(0, 6).map((o) => (
                <Tap
                  key={`${o.item.id}-${o.orig}`}
                  onPress={() => go(`/finance/planned/${o.item.id}`)}
                  style={{ minHeight: 56, justifyContent: "center" }}
                >
                  <Line>
                    <View
                      style={{
                        height: 40,
                        width: 40,
                        borderRadius: 20,
                        backgroundColor: t.soft,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Copy>
                        {s.categories.find((c) => c.id === o.item.categoryId)
                          ?.icon ?? "⇄"}
                      </Copy>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Copy weight="medium" lines={1}>
                        {o.item.name}
                      </Copy>
                      <Line style={{ gap: 6 }}>
                        <Copy size={12} muted>
                          {N.dayLabel(o.day)}
                        </Copy>
                        {o.status === "overdue" && (
                          <FinPill tone="bad">overdue</FinPill>
                        )}
                        {o.status === "due" && (
                          <FinPill tone="warn">due</FinPill>
                        )}
                      </Line>
                    </View>
                    <Copy
                      weight="medium"
                      style={{
                        color: o.item.type === "income" ? t.good : t.text,
                      }}
                    >
                      {o.item.type === "income"
                        ? "+"
                        : o.item.type === "expense"
                          ? "−"
                          : ""}
                      {money(o.item.amount)}
                    </Copy>
                  </Line>
                </Tap>
              ))}
              {!upcoming.length && (
                <Copy
                  size={14}
                  muted
                  style={{ paddingVertical: 16, textAlign: "center" }}
                >
                  Nothing scheduled this week.
                </Copy>
              )}
            </Frame>
            <Frame style={{ marginTop: 12, padding: 8 }}>
              <LinkRow
                title={`${N.monthLabel(lastMonth, true)} review ${s.lookbacks.some((l) => l.period === lastMonth) ? "" : "ready"}`}
                detail="Where it went, leaks, wins & misses"
                icon={CalendarClock}
                accent="life"
                href={`/finance/review?period=${lastMonth}`}
              />
            </Frame>
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
          </>
        )}
      </View>
      <RecordEditor
        prefill={{ type: params.add === "income" ? "income" : "expense" }}
        open={adding}
        onClose={() => setAdding(false)}
      />
    </Screen>
  )
}
