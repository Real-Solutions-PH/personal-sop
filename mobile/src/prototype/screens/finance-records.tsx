import * as A from "@domain/finance/actions"
import * as C from "@domain/finance/calc"
import type { FinRecord } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import { createStore } from "@domain/lib/store"
import { useLocalSearchParams } from "expo-router"
import {
  CheckSquare,
  Pencil,
  Plus,
  Receipt,
  Search,
  SlidersHorizontal,
} from "lucide-react-native"
import { useState } from "react"
import { ScrollView, TextInput, View } from "react-native"
import { toast } from "sonner-native"
import { MoneyInput } from "../money-input"
import {
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  Segmented,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import {
  Button,
  Choices,
  confirm,
  DateField,
  Empty,
  Screen,
  Sheet,
  SwipeRow,
  Toggle,
  undo,
} from "../ui"
import { RecordEditor, useMoney } from "./finance"
import { FinanceRecord, foreignAmount, sourceLabel } from "./finance-home"

type Filter = {
  type: string
  accounts: string[]
  cats: string[]
  from: string
  to: string
  min: string
  max: string
  sources: string[]
  pendingOnly: boolean
  sort: string
}
const blank: Filter = {
  type: "all",
  accounts: [],
  cats: [],
  from: "",
  to: "",
  min: "",
  max: "",
  sources: [],
  pendingOnly: false,
  sort: "date",
}
const viewStore = createStore("finance-records-view", () => blank)
export function Records({ accountId }: { accountId?: string }) {
  const t = useTheme(),
    s = finStore.use((s) => s),
    money = useMoney(),
    p = useLocalSearchParams<Record<string, string>>(),
    [query, setQuery] = useState(p.q ?? ""),
    [filter, setFilter] = useState<Filter>(() =>
      accountId || p.cat || p.from || p.pending
        ? {
            ...blank,
            accounts: accountId ? [accountId] : [],
            cats: p.cat ? [p.cat] : [],
            from: p.from ?? "",
            to: p.to ?? "",
            pendingOnly: p.pending === "1",
          }
        : viewStore.get(),
    ),
    [draft, setDraft] = useState(filter),
    [filterOpen, setFilterOpen] = useState(false),
    [edit, setEdit] = useState(false),
    [selecting, setSelecting] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [recat, setRecat] = useState(false),
    [limit, setLimit] = useState(120),
    cats = C.catMap(s)
  const rows = s.records.filter((r) => {
    const c = cats.get(r.categoryId ?? ""),
      d = C.recDay(r)
    return (
      (filter.type === "all" || r.type === filter.type) &&
      (!filter.accounts.length ||
        filter.accounts.includes(r.accountId) ||
        (!!r.toAccountId && filter.accounts.includes(r.toAccountId))) &&
      (!filter.cats.length ||
        (!!c &&
          (filter.cats.includes(c.id) ||
            (!!c.parentId && filter.cats.includes(c.parentId))))) &&
      (!filter.from || d >= filter.from) &&
      (!filter.to || d <= filter.to) &&
      (!filter.min || r.amount >= Number(filter.min)) &&
      (!filter.max || r.amount <= Number(filter.max)) &&
      (!filter.sources.length || filter.sources.includes(r.source)) &&
      (!filter.pendingOnly || r.status === "pending") &&
      `${r.payee ?? ""} ${r.note ?? ""} ${r.amount} ${c?.name ?? ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase())
    )
  })
  if (filter.sort === "amount") rows.sort((a, b) => b.amount - a.amount)
  else if (filter.sort === "payee")
    rows.sort((a, b) => (a.payee ?? "").localeCompare(b.payee ?? ""))
  else rows.reverse()
  const net = (rs: FinRecord[]) =>
      rs.reduce(
        (a, r) =>
          a +
          (r.isAdjustment
            ? 0
            : r.type === "income"
              ? r.amount
              : r.type === "expense"
                ? -r.amount
                : 0),
        0,
      ),
    signed = (n: number) =>
      `${n < 0 ? "−" : n > 0 ? "+" : ""}${money(Math.abs(n))}`,
    groups: { day: string; rows: FinRecord[] }[] = []
  for (const r of rows.slice(0, limit)) {
    const day = filter.sort === "date" ? C.recDay(r) : "",
      last = groups.at(-1)
    if (last?.day === day) last.rows.push(r)
    else groups.push({ day, rows: [r] })
  }
  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Tap
      key={label}
      onPress={onPress}
      style={{
        height: 32,
        paddingHorizontal: 12,
        borderRadius: 99,
        backgroundColor: active ? t.fin : t.card,
        borderWidth: 1,
        borderColor: active ? t.fin : t.line,
        justifyContent: "center",
      }}
    >
      <Copy size={14} weight="medium" style={{ color: active ? t.bg : t.text }}>
        {label}
      </Copy>
    </Tap>
  )
  const count =
    Number(filter.type !== "all") +
    Number(!!filter.accounts.length) +
    Number(!!filter.cats.length) +
    Number(!!filter.from || !!filter.to) +
    Number(!!filter.min || !!filter.max) +
    Number(!!filter.sources.length) +
    Number(filter.pendingOnly)
  const deleteSelected = () =>
    confirm(
      "Delete selected transactions?",
      `${selected.length} records will be removed.`,
      () => {
        const removed = A.deleteRecords(selected)
        undo("Records deleted", () => A.restoreRecords(removed))
        setSelected([])
        setSelecting(false)
      },
    )
  return (
    <Screen
      prototypeLayout
      title="Transactions"
      actions={
        <Line style={{ gap: 0 }}>
          <IconTap
            size={40}
            icon={CheckSquare}
            label="Select"
            color={selecting ? t.fin : t.text}
            onPress={() => {
              setSelecting(!selecting)
              setSelected([])
            }}
          />
          <IconTap
            size={40}
            icon={Plus}
            label="Add transaction"
            color={t.text}
            onPress={() => setEdit(true)}
          />
        </Line>
      }
      footer={
        selecting ? (
          <Frame style={{ padding: 8, marginHorizontal: 16, marginBottom: 12 }}>
            <Line>
              <Copy size={14} style={{ flex: 1 }}>
                {selected.length} selected
              </Copy>
              <Button
                small
                tone="quiet"
                disabled={!selected.length}
                onPress={() => setRecat(true)}
              >
                Category
              </Button>
              <Button
                small
                tone="danger"
                disabled={!selected.length}
                onPress={deleteSelected}
              >
                Delete
              </Button>
            </Line>
          </Frame>
        ) : undefined
      }
    >
      <View style={{ gap: 8, paddingBottom: 8 }}>
        <Line style={{ gap: 8 }}>
          <Line
            style={{
              flex: 1,
              height: 44,
              paddingHorizontal: 12,
              gap: 8,
              borderWidth: 1,
              borderColor: t.line,
              borderRadius: 12,
              backgroundColor: t.card,
            }}
          >
            <Search size={16} color={t.muted} />
            <TextInput
              accessibilityLabel="Search records"
              placeholder="Payee, note or amount"
              placeholderTextColor={t.muted}
              value={query}
              onChangeText={setQuery}
              style={{
                flex: 1,
                color: t.text,
                fontFamily: fonts.body,
                fontSize: 14,
              }}
            />
          </Line>
          <Tap
            label="Filter and sort"
            onPress={() => {
              setDraft(filter)
              setFilterOpen(true)
            }}
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: count ? t.fin : t.line,
              backgroundColor: t.card,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <SlidersHorizontal size={16} color={count ? t.fin : t.text} />
            {count > 0 && (
              <Copy
                size={10}
                style={{
                  position: "absolute",
                  right: -4,
                  top: -4,
                  backgroundColor: t.fin,
                  color: t.bg,
                  borderRadius: 8,
                  width: 16,
                  textAlign: "center",
                }}
              >
                {count}
              </Copy>
            )}
          </Tap>
        </Line>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {["all", "expense", "income", "transfer"].map((type) =>
            chip(
              type[0].toUpperCase() + type.slice(1),
              filter.type === type,
              () => setFilter({ ...filter, type }),
            ),
          )}
          {chip("Needs review", filter.pendingOnly, () =>
            setFilter({ ...filter, pendingOnly: !filter.pendingOnly }),
          )}
        </ScrollView>
        <Line style={{ justifyContent: "space-between", paddingHorizontal: 4 }}>
          <Copy size={12} muted>
            {rows.length} record{rows.length === 1 ? "" : "s"}
          </Copy>
          <Copy size={12} muted>
            Net{" "}
            <Copy
              size={12}
              muted={net(rows) <= 0}
              style={net(rows) > 0 ? { color: t.good } : undefined}
            >
              {signed(net(rows))}
            </Copy>
          </Copy>
        </Line>
      </View>
      {!rows.length ? (
        <>
          <Empty
            title={s.records.length ? "Nothing matches" : "No transactions yet"}
          />
          <Button
            tone="quiet"
            onPress={() => {
              setQuery("")
              setFilter(blank)
            }}
          >
            Clear all
          </Button>
        </>
      ) : (
        groups.map((g, i) => (
          <View key={`${g.day}-${i}`} style={{ marginTop: -12 }}>
            {!!g.day && (
              <Line
                style={{
                  justifyContent: "space-between",
                  marginTop: 12,
                  paddingHorizontal: 4,
                  paddingBottom: 4,
                }}
              >
                <Copy size={12} weight="medium" muted>
                  {C.dayLabel(g.day)}
                </Copy>
                <Copy
                  size={12}
                  muted={net(g.rows) <= 0}
                  style={net(g.rows) > 0 ? { color: t.good } : undefined}
                >
                  {signed(net(g.rows))}
                </Copy>
              </Line>
            )}
            <Frame style={{ paddingHorizontal: 8, paddingVertical: 2 }}>
              {g.rows.map((r) => (
                <SwipeRow
                  key={r.id}
                  moreLabel="Delete"
                  onMore={
                    selecting
                      ? undefined
                      : () => {
                          const gone = A.deleteRecords([r.id])
                          undo("Record deleted", () => A.restoreRecords(gone))
                        }
                  }
                >
                  <FinanceRecord
                    record={r}
                    selected={selecting && selected.includes(r.id)}
                    onPress={
                      selecting
                        ? () =>
                            setSelected(
                              selected.includes(r.id)
                                ? selected.filter((id) => id !== r.id)
                                : [...selected, r.id],
                            )
                        : undefined
                    }
                  />
                </SwipeRow>
              ))}
            </Frame>
          </View>
        ))
      )}
      {rows.length > limit && (
        <Button
          tone="quiet"
          onPress={() => setLimit(limit + 120)}
        >{`Show more (${rows.length - limit} older)`}</Button>
      )}
      <RecordEditor open={edit} onClose={() => setEdit(false)} />
      <Sheet
        title="Filter & sort"
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
      >
        <View style={{ gap: 16 }}>
          <Copy size={12} muted>
            Sort by
          </Copy>
          <Segmented
            value={draft.sort}
            onChange={(sort) => setDraft({ ...draft, sort })}
            options={[
              { value: "date", label: "Date" },
              { value: "amount", label: "Amount" },
              { value: "payee", label: "Payee" },
            ]}
          />
          <Copy size={12} muted>
            Date range
          </Copy>
          <Line>
            {[7, 30, 90].map((n) =>
              chip(`${n} days`, false, () =>
                setDraft({ ...draft, from: dayOffset(1 - n), to: dayKey() }),
              ),
            )}
            {chip("Any", !draft.from && !draft.to, () =>
              setDraft({ ...draft, from: "", to: "" }),
            )}
          </Line>
          <Line>
            <View style={{ flex: 1 }}>
              <DateField
                label="From"
                value={draft.from}
                onChangeText={(from) => setDraft({ ...draft, from })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <DateField
                label="To"
                value={draft.to}
                onChangeText={(to) => setDraft({ ...draft, to })}
              />
            </View>
          </Line>
          {[
            {
              key: "accounts" as const,
              label: "Accounts",
              options: s.accounts.map((a) => ({ id: a.id, name: a.name })),
            },
            {
              key: "cats" as const,
              label: "Categories",
              options: s.categories
                .filter((c) => !c.archived)
                .map((c) => ({ id: c.id, name: c.name })),
            },
            {
              key: "sources" as const,
              label: "Source",
              options: (
                [
                  "chat",
                  "quick-add",
                  "photo",
                  "import",
                  "planned",
                  "manual",
                  "adjustment",
                ] as const
              ).map((id) => ({ id, name: sourceLabel(id) })),
            },
          ].map((g) => (
            <View key={g.key} style={{ gap: 8 }}>
              <Copy size={12} muted>
                {g.label}
              </Copy>
              <Line style={{ flexWrap: "wrap", gap: 8 }}>
                {g.options.map((o) =>
                  chip(o.name, draft[g.key].includes(o.id), () =>
                    setDraft({
                      ...draft,
                      [g.key]: draft[g.key].includes(o.id)
                        ? draft[g.key].filter((x) => x !== o.id)
                        : [...draft[g.key], o.id],
                    }),
                  ),
                )}
              </Line>
            </View>
          ))}
          <Line>
            <View style={{ flex: 1 }}>
              <MoneyInput
                label="Min amount"
                value={draft.min}
                onChange={(min) => setDraft({ ...draft, min })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <MoneyInput
                label="Max amount"
                value={draft.max}
                onChange={(max) => setDraft({ ...draft, max })}
              />
            </View>
          </Line>
          <Toggle
            label="Needs review only"
            value={draft.pendingOnly}
            onChange={(pendingOnly) => setDraft({ ...draft, pendingOnly })}
          />
          <Line>
            <Button tone="quiet" onPress={() => setDraft(blank)}>
              Reset
            </Button>
            <Button
              tone="quiet"
              onPress={() => {
                viewStore.set(draft)
                toast("Saved as your default view")
              }}
            >
              Save default
            </Button>
            <View style={{ flex: 1 }}>
              <Button
                onPress={() => {
                  setFilter(draft)
                  setFilterOpen(false)
                }}
              >
                Apply
              </Button>
            </View>
          </Line>
        </View>
      </Sheet>
      <Sheet title="Category" open={recat} onClose={() => setRecat(false)}>
        <Choices
          value=""
          onChange={(id) => {
            A.recategorise(selected, id)
            setSelected([])
            setSelecting(false)
            setRecat(false)
          }}
          options={s.categories
            .filter((c) => c.kind === "expense" && !c.archived)
            .map((c) => ({ value: c.id, label: `${c.icon} ${c.name}` }))}
        />
      </Sheet>
    </Screen>
  )
}

export function RecordDetail({ id }: { id: string }) {
  const t = useTheme(),
    s = finStore.use((s) => s),
    r = s.records.find((r) => r.id === id),
    money = useMoney(),
    [edit, setEdit] = useState(false)
  if (!r)
    return (
      <Screen prototypeLayout title="Transaction">
        <Empty title="Transaction not found" />
        <Button href="/finance/records">All transactions</Button>
      </Screen>
    )
  const cat = s.categories.find((c) => c.id === r.categoryId),
    parent = s.categories.find((c) => c.id === cat?.parentId),
    account = s.accounts.find((a) => a.id === r.accountId),
    to = s.accounts.find((a) => a.id === r.toAccountId),
    planned = s.planned.find((p) => p.id === r.plannedId),
    imp = s.imports.find((i) => i.id === r.importId),
    fee = s.records.find((x) => x.feeOf === r.id)
  const rows = [
    {
      label: "Type",
      value: r.isRefund
        ? "Refund (income)"
        : r.type[0].toUpperCase() + r.type.slice(1),
    },
    {
      label: r.type === "transfer" ? "From" : "Account",
      value: account?.name ?? "—",
    },
    ...(to ? [{ label: "To", value: to.name }] : []),
    ...(r.type !== "transfer"
      ? [
          {
            label: "Category",
            value: `${parent ? `${parent.name} › ` : ""}${cat?.name ?? "Uncategorised"}`,
          },
        ]
      : []),
    { label: "When", value: `${C.dayLabel(C.recDay(r))} · ${C.timeOf(r.at)}` },
    { label: "Payee", value: r.payee ?? "—" },
    { label: "Note", value: r.note ?? "—" },
    { label: "Logged via", value: sourceLabel(r.source) },
  ]
  return (
    <Screen
      prototypeLayout
      title="Transaction"
      actions={
        <IconTap
          size={40}
          icon={Pencil}
          label="Edit"
          color={t.text}
          onPress={() => setEdit(true)}
        />
      }
    >
      <View style={{ alignItems: "center", paddingVertical: 16 }}>
        <View
          style={{
            width: r.type === "transfer" ? 56 : 50,
            height: r.type === "transfer" ? 56 : 50,
            borderRadius: 28,
            backgroundColor: t.soft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Copy size={24}>
            {r.type === "transfer" ? "⇄" : (cat?.icon ?? "💸")}
          </Copy>
        </View>
        <Copy weight="medium" style={{ marginTop: 12 }}>
          {r.payee ?? cat?.name ?? "Transfer"}
        </Copy>
        <Copy
          size={36}
          weight="semibold"
          style={{
            letterSpacing: -0.9,
            color: r.type === "income" ? t.good : t.text,
          }}
        >
          {r.type === "expense" ? "−" : r.type === "income" ? "+" : ""}
          {money(r.amount)}
        </Copy>
        {r.origCurrency && r.origAmount ? (
          <Copy size={14} muted>
            {foreignAmount(r.origAmount, r.origCurrency)} at{" "}
            {r.fxRate?.toLocaleString("en-US", { maximumFractionDigits: 4 })}{" "}
            per {r.origCurrency}
          </Copy>
        ) : null}
        <Line style={{ gap: 6, marginTop: 8 }}>
          {[
            {
              label: "needs review",
              on: r.status === "pending",
              color: t.warn,
            },
            { label: "refund", on: r.isRefund, color: t.good },
            {
              label: "excluded from spend",
              on: r.isAdjustment,
              color: t.muted,
            },
            {
              label: "not spending",
              on: r.type === "transfer",
              color: t.muted,
            },
          ]
            .filter((x) => x.on)
            .map((x) => (
              <Copy
                key={x.label}
                size={11}
                style={{
                  color: x.color,
                  backgroundColor: `${x.color}26`,
                  borderRadius: 99,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                }}
              >
                {x.label}
              </Copy>
            ))}
        </Line>
      </View>
      {r.status === "pending" && (
        <Frame
          style={{
            padding: 16,
            borderColor: `${t.warn}66`,
            backgroundColor: `${t.warn}0d`,
          }}
        >
          <Copy size={14}>AI wasn't sure about this one. {r.note}</Copy>
          <Line style={{ marginTop: 12, gap: 8 }}>
            <Button onPress={() => A.confirmRecord(id)}>Looks right</Button>
            <Button tone="quiet" onPress={() => setEdit(true)}>
              Fix it
            </Button>
          </Line>
        </Frame>
      )}
      <Frame style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
        {rows.map((x, i) => (
          <Line
            key={x.label}
            style={{
              justifyContent: "space-between",
              gap: 16,
              paddingVertical: 10,
              borderTopWidth: i ? 1 : 0,
              borderTopColor: border(t.line, 0.6),
            }}
          >
            <Copy size={14} muted>
              {x.label}
            </Copy>
            <Copy size={14} style={{ flexShrink: 1, textAlign: "right" }}>
              {x.value}
            </Copy>
          </Line>
        ))}
      </Frame>
      {(r.receipt || planned || imp || fee || r.editedAt) && (
        <Frame style={{ padding: 16, gap: 8 }}>
          {r.receipt && (
            <Line>
              <View
                style={{
                  width: 48,
                  height: 64,
                  borderRadius: 6,
                  backgroundColor: t.paper,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Receipt size={20} color={t["paper-foreground"]} />
              </View>
              <View style={{ flex: 1 }}>
                <Copy size={14} weight="medium">
                  Receipt
                </Copy>
                <Tap onPress={() => toast("Opening receipt image (mock)")}>
                  <Copy size={12} style={{ color: t.fin }}>
                    View image
                  </Copy>
                </Tap>
              </View>
            </Line>
          )}
          {[
            {
              on: !!planned,
              label: "Planned item",
              value: `${planned?.name} ›`,
              href: `/finance/planned/${planned?.id}`,
            },
            {
              on: !!imp,
              label: "Matched from statement import",
              value: `${imp?.fileName.slice(0, 22)}… ›`,
              href: "/finance/imports",
            },
            {
              on: !!fee,
              label: "Transfer fee",
              value: money(fee?.amount ?? 0),
              href: `/finance/records/${fee?.id}`,
            },
          ]
            .filter((x) => x.on)
            .map((x) => (
              <Tap key={x.label} onPress={() => go(x.href)}>
                <Line style={{ justifyContent: "space-between" }}>
                  <Copy size={14} muted>
                    {x.label}
                  </Copy>
                  <Copy size={14} style={{ color: t.fin }}>
                    {x.value}
                  </Copy>
                </Line>
              </Tap>
            ))}
          {r.editedAt && (
            <Line style={{ justifyContent: "space-between" }}>
              <Copy size={12} muted>
                Last change
              </Copy>
              <Copy size={12}>
                {new Date(r.editedAt).toLocaleString("en-PH", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </Copy>
            </Line>
          )}
        </Frame>
      )}
      <View
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}
      >
        {[
          { label: "Edit", action: () => setEdit(true), danger: false },
          {
            label: "Duplicate",
            action: () => {
              const next = A.duplicateRecord(id)
              if (next) go(`/finance/records/${next.id}`)
            },
            danger: false,
          },
          ...(r.type === "income"
            ? [
                {
                  label: r.isRefund ? "Not a refund" : "Mark refund",
                  action: () =>
                    A.updateRecord(id, {
                      isRefund: !r.isRefund,
                      categoryId: r.isRefund ? "other-in" : "shopping",
                    }),
                  danger: false,
                },
              ]
            : []),
          {
            label: "Delete",
            action: () =>
              confirm(
                "Delete transaction?",
                "This removes the transaction from your records.",
                () => {
                  const gone = A.deleteRecords([id])
                  undo("Transaction deleted", () => A.restoreRecords(gone))
                  go("/finance/records")
                },
              ),
            danger: true,
          },
        ].map((x) => (
          <View key={x.label} style={{ width: "48.8%" }}>
            <Button tone={x.danger ? "danger" : "quiet"} onPress={x.action}>
              {x.label}
            </Button>
          </View>
        ))}
      </View>
      <RecordEditor record={r} open={edit} onClose={() => setEdit(false)} />
    </Screen>
  )
}
