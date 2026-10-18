import * as A from "@domain/finance/actions"
import * as C from "@domain/finance/calc"
import type { PlannedItem } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { useLocalSearchParams } from "expo-router"
import { Pencil, Plus } from "lucide-react-native"
import { useState } from "react"
import { ScrollView, useWindowDimensions, View } from "react-native"
import { toast } from "sonner-native"
import {
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  Segmented,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { radius, useTheme } from "../theme"
import {
  Button,
  Choices,
  DateField,
  Empty,
  Field,
  Screen,
  Sheet,
  undo,
} from "../ui"
import { isDay } from "../validation"
import { PlannedEditor, useMoney } from "./finance"
export function FinPill({
  children,
  tone = "muted",
}: {
  children: React.ReactNode
  tone?: "muted" | "good" | "bad" | "warn" | "fin"
}) {
  const t = useTheme()
  return (
    <View
      style={{
        alignSelf: "flex-start",
        borderRadius: radius.pill,
        backgroundColor: tone === "muted" ? t.soft : `${t[tone]}26`,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      <Copy size={11} weight="medium" lines={1} style={{ color: t[tone] }}>
        {children}
      </Copy>
    </View>
  )
}
function PlannedIcon({ p }: { p: PlannedItem }) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    cat = s.categories.find((c) => c.id === p.categoryId)
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: t.soft,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Copy size={20}>{p.type === "transfer" ? "⇄" : (cat?.icon ?? "•")}</Copy>
    </View>
  )
}
export function DueSheet({
  id,
  day,
  onClose,
}: {
  id: string
  day: string
  onClose: () => void
}) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    p = s.planned.find((p) => p.id === id),
    money = useMoney(),
    [amount, setAmount] = useState(String(p?.amount ?? "")),
    [account, setAccount] = useState(
      p?.accountId ?? s.settings.defaultAccountId,
    ),
    [date, setDate] = useState(dayKey())
  if (!p) return null
  return (
    <Sheet title={p.name} open onClose={onClose}>
      <Copy size={14} muted>
        Due {C.shortDate(p.snoozed[day] ?? day)} · expected{" "}
        {p.estimated ? "≈ " : ""}
        {money(p.amount)}
      </Copy>
      <Line
        style={{
          padding: 12,
          backgroundColor: border(t.soft, 0.5),
          borderRadius: 16,
        }}
      >
        <PlannedIcon p={p} />
        <View style={{ flex: 1 }}>
          <Copy size={14} weight="medium">
            {p.type === "transfer"
              ? `${s.accounts.find((a) => a.id === p.accountId)?.name} → ${s.accounts.find((a) => a.id === p.toAccountId)?.name}`
              : s.categories.find((c) => c.id === p.categoryId)?.name}
          </Copy>
          <Copy size={12} muted>
            {p.isInstallment ? "0% installment · " : ""}
            {p.estimated
              ? "Estimated amount — edit to the actual"
              : "Fixed amount"}
          </Copy>
        </View>
      </Line>
      <Field
        label="Actual amount ₱"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
      />
      {p.type !== "transfer" && (
        <Choices
          label="Account"
          value={account}
          onChange={setAccount}
          options={s.accounts
            .filter((a) => !a.archived && a.type !== "investment")
            .map((a) => ({ value: a.id, label: a.name }))}
        />
      )}
      <DateField label="Date" value={date} onChangeText={setDate} />
      <Line>
        {[
          {
            label: "Skip",
            press: () => {
              A.skipOccurrence(id, day)
              undo(`Skipped ${p.name}`, () => A.unskipOccurrence(id, day))
              onClose()
            },
          },
          {
            label: "Snooze",
            press: () => {
              const prev = p.snoozed
              A.snoozeOccurrence(id, day)
              undo(`Snoozed ${p.name} to tomorrow`, () =>
                A.updatePlanned(id, { snoozed: prev }),
              )
              onClose()
            },
          },
          {
            label: p.type === "income" ? "Received" : "Paid",
            press: () => {
              if (!(Number(amount) > 0) || !isDay(date)) {
                toast.error("Enter an amount and a valid date")
                return
              }
              const r = A.settleOccurrence(id, day, {
                amount: Number(amount),
                accountId: account,
                date,
              })
              if (r) undo(`Paid ${p.name}`, () => A.deleteRecords([r.id]))
              onClose()
            },
          },
        ].map((a, i) => (
          <View key={a.label} style={{ flex: 1 }}>
            <Button tone={i === 2 ? "primary" : "quiet"} onPress={a.press}>
              {a.label}
            </Button>
          </View>
        ))}
      </Line>
    </Sheet>
  )
}
export function Planned({ id }: { id?: string }) {
  const params = useLocalSearchParams<{
    amount?: string
    date?: string
    count?: string
  }>()
  const s = finStore.use((s) => s),
    t = useTheme(),
    money = useMoney(),
    narrow = useWindowDimensions().width < 380,
    [tab, setTab] = useState("recurring"),
    [edit, setEdit] = useState(!!params.amount),
    [due, setDue] = useState<{ id: string; day: string } | null>(null),
    p = s.planned.find((p) => p.id === id),
    live = s.planned.filter((p) => !p.archived),
    today = dayKey(),
    upcoming = C.occurrencesIn(s, today, C.addDays(today, 30)).filter(
      (o) => o.status !== "paid" && o.status !== "skipped",
    ),
    list = live.filter((p) =>
      tab === "whatif"
        ? p.isWhatIf
        : tab === "once"
          ? !p.isWhatIf && p.schedule.kind === "once"
          : !p.isWhatIf && p.schedule.kind !== "once",
    ),
    income = live
      .filter((p) => !p.isWhatIf && p.type === "income")
      .reduce((a, p) => a + C.monthlyEq(p), 0),
    out = live
      .filter(
        (p) =>
          !p.isWhatIf &&
          (p.type === "expense" || p.isInstallment || p.toAccountId === "col"),
      )
      .reduce((a, p) => a + C.monthlyEq(p), 0),
    signed = (p: PlannedItem) =>
      `${p.type === "income" ? "+" : p.type === "expense" ? "−" : ""}${money(p.amount)}`
  const history = p
      ? C.occurrencesIn(s, p.start, today, { includeWhatIf: true })
          .filter((o) => o.item.id === id)
          .reverse()
      : [],
    next = p
      ? C.occurrencesIn(s, C.addDays(today, -14), C.addDays(today, 400), {
          includeWhatIf: true,
        })
          .filter(
            (o) =>
              o.item.id === id && o.status !== "paid" && o.status !== "skipped",
          )
          .slice(0, 5)
      : [],
    paid = history
      .filter((o) => o.recordId)
      .map((o) => s.records.find((r) => r.id === o.recordId)?.amount ?? 0),
    avg = paid.length ? paid.reduce((a, b) => a + b, 0) / paid.length : 0,
    accuracy =
      p && paid.length
        ? 1 -
          paid.reduce((a, n) => a + Math.abs(n - p.amount), 0) /
            paid.length /
            p.amount
        : 0
  const stats = (items: { label: string; value: string; color?: string }[]) => (
    <Frame style={{ padding: 16 }}>
      <Line style={{ gap: 8, alignItems: "flex-start" }}>
        {items.map((x) => (
          <View key={x.label} style={{ flex: 1 }}>
            <Copy
              size={narrow ? 22 : 30}
              weight="displayMedium"
              lines={1}
              style={{ color: x.color ?? t.text }}
            >
              {x.value}
            </Copy>
            <Copy size={12} muted>
              {x.label}
            </Copy>
          </View>
        ))}
      </Line>
    </Frame>
  )
  if (id && !p)
    return (
      <Screen title="Scheduled payment">
        <Empty
          title="Not found"
          action={<Button href="/finance/planned">All planned</Button>}
        />
      </Screen>
    )
  return (
    <Screen
      title={p?.name ?? "Scheduled"}
      actions={
        <IconTap
          icon={p ? Pencil : Plus}
          color={t.text}
          size={40}
          label={p ? "Edit" : "Add scheduled payment"}
          onPress={() => setEdit(true)}
        />
      }
    >
      {p ? (
        <>
          <Line style={{ paddingVertical: 8 }}>
            <PlannedIcon p={p} />
            <View style={{ flex: 1 }}>
              <Copy size={30} weight="displayMedium">
                {signed(p)}
              </Copy>
              <Copy size={12} muted>
                {p.estimated ? "Estimated · " : ""}
                {C.scheduleLabel(p)}
              </Copy>
            </View>
          </Line>
          <Line style={{ gap: 6, flexWrap: "wrap" }}>
            <FinPill>
              {p.type === "transfer"
                ? `${s.accounts.find((a) => a.id === p.accountId)?.name} → ${s.accounts.find((a) => a.id === p.toAccountId)?.name}`
                : `${s.accounts.find((a) => a.id === p.accountId)?.name} · ${s.categories.find((c) => c.id === p.categoryId)?.name}`}
            </FinPill>
            <FinPill tone={p.autoLog ? "fin" : "muted"}>
              {p.autoLog ? "Auto-logs" : "Asks Paid / Skip"}
            </FinPill>
            {p.isInstallment && <FinPill tone="warn">0% installment</FinPill>}
            {p.isWhatIf && <FinPill tone="warn">what-if draft</FinPill>}
            {!p.inProjection && !p.isWhatIf && (
              <FinPill>not in projection</FinPill>
            )}
          </Line>
          <View style={{ gap: 8, marginTop: 4 }}>
            <Line style={{ gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button
                  disabled={!next[0] || p.isWhatIf}
                  onPress={() => setDue({ id: p.id, day: next[0].orig })}
                >
                  {p.type === "income" ? "Received now" : "Pay now"}
                </Button>
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  tone="quiet"
                  disabled={!next[0]}
                  onPress={() => {
                    if (!next[0]) return
                    A.skipOccurrence(p.id, next[0].orig)
                    undo(`Skipped ${C.shortDate(next[0].orig)}`, () =>
                      A.unskipOccurrence(p.id, next[0].orig),
                    )
                  }}
                >
                  Skip next
                </Button>
              </View>
            </Line>
            <Line style={{ gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button
                  tone="quiet"
                  onPress={() => {
                    if (p.isWhatIf) {
                      A.updatePlanned(p.id, {
                        isWhatIf: false,
                        inProjection: true,
                      })
                      toast(`${p.name} is now part of your plan`)
                    } else {
                      const end = p.end
                      A.updatePlanned(p.id, {
                        end: { kind: "date", date: today },
                      })
                      undo(`${p.name} ends today`, () =>
                        A.updatePlanned(p.id, { end }),
                      )
                    }
                  }}
                >
                  {p.isWhatIf ? "Make it real" : "End it"}
                </Button>
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  tone="danger"
                  onPress={() => {
                    A.updatePlanned(p.id, { archived: true })
                    undo(`${p.name} archived`, () =>
                      A.updatePlanned(p.id, { archived: false }),
                    )
                  }}
                >
                  Archive
                </Button>
              </View>
            </Line>
          </View>
          {paid.length > 0 &&
            stats([
              { label: "Times paid", value: String(paid.length) },
              { label: "Avg actual", value: money(avg) },
              {
                label: "Plan accuracy",
                value: `${Math.max(0, Math.round(accuracy * 100))}%`,
                color: t.fin,
              },
            ])}
          <View style={{ marginTop: -12, width: "100%" }}>
            <SectionHeading>Next dates</SectionHeading>
            <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
              {!next.length && (
                <Copy
                  size={14}
                  muted
                  style={{ paddingVertical: 16, textAlign: "center" }}
                >
                  No more upcoming dates.
                </Copy>
              )}
              {next.map((o) => (
                <Tap
                  key={o.orig}
                  onPress={() => setDue({ id: p.id, day: o.orig })}
                >
                  <Line
                    style={{
                      paddingVertical: 10,
                      justifyContent: "space-between",
                    }}
                  >
                    <Copy size={14}>
                      {C.dayLabel(o.day)}
                      {o.day !== o.orig
                        ? ` (snoozed from ${C.shortDate(o.orig)})`
                        : ""}
                    </Copy>
                    {o.status === "upcoming" ? (
                      <Copy size={12} muted>
                        upcoming
                      </Copy>
                    ) : (
                      <FinPill tone={o.status === "overdue" ? "bad" : "warn"}>
                        {o.status}
                      </FinPill>
                    )}
                  </Line>
                </Tap>
              ))}
            </Frame>
            <SectionHeading>History</SectionHeading>
            <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
              {history
                .filter((o) => o.status !== "upcoming" && o.status !== "due")
                .map((o) => {
                  const r = s.records.find((r) => r.id === o.recordId),
                    variance = r ? r.amount - p.amount : 0
                  return (
                    <Tap
                      key={o.orig}
                      onPress={() => r && go(`/finance/records/${r.id}`)}
                    >
                      <Line
                        style={{
                          paddingVertical: 10,
                          justifyContent: "space-between",
                        }}
                      >
                        <Copy size={14}>{C.shortDate(o.orig)}</Copy>
                        <Line style={{ gap: 8 }}>
                          {r && (
                            <>
                              <Copy size={14}>{money(r.amount)}</Copy>
                              {variance !== 0 && (
                                <Copy
                                  size={12}
                                  style={{
                                    color:
                                      variance > 0 === (p.type === "income")
                                        ? t.good
                                        : t.bad,
                                  }}
                                >
                                  {variance > 0 ? "+" : "−"}
                                  {Math.abs(
                                    Math.round((variance / p.amount) * 100),
                                  )}
                                  %
                                </Copy>
                              )}
                            </>
                          )}
                          <FinPill
                            tone={
                              r
                                ? "good"
                                : o.status === "skipped"
                                  ? "muted"
                                  : "bad"
                            }
                          >
                            {r
                              ? p.type === "income"
                                ? "received"
                                : "paid"
                              : o.status === "skipped"
                                ? "skipped"
                                : "missed"}
                          </FinPill>
                        </Line>
                      </Line>
                    </Tap>
                  )
                })}
              {history.length === 0 && (
                <Copy
                  size={14}
                  muted
                  style={{ paddingVertical: 16, textAlign: "center" }}
                >
                  No history yet.
                </Copy>
              )}
            </Frame>
          </View>
        </>
      ) : (
        <>
          {stats([
            { label: "In / month", value: money(income), color: t.good },
            { label: "Out / month", value: money(out) },
            { label: "Net / month", value: money(income - out), color: t.fin },
          ])}
          <View style={{ marginTop: -12, width: "100%" }}>
            <SectionHeading
              action={
                <Tap onPress={() => go("/finance/projection")}>
                  <Copy size={12} style={{ color: t.fin }}>
                    Projection
                  </Copy>
                </Tap>
              }
            >
              Next 30 days
            </SectionHeading>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -16, flexGrow: 0 }}
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingBottom: 4,
                gap: 8,
              }}
            >
              {upcoming.slice(0, 14).map((o) => (
                <Tap
                  key={`${o.item.id}-${o.orig}`}
                  onPress={() => setDue({ id: o.item.id, day: o.orig })}
                  style={{ width: 128 }}
                >
                  <Frame
                    style={{
                      padding: 12,
                      borderColor:
                        o.status === "overdue"
                          ? `${t.bad}80`
                          : o.status === "due"
                            ? `${t.warn}80`
                            : border(t.line, 0.6),
                    }}
                  >
                    <Copy size={11} muted>
                      {C.dayLabel(o.day)}
                    </Copy>
                    <Copy
                      size={14}
                      weight="medium"
                      lines={1}
                      style={{ marginTop: 4 }}
                    >
                      {o.item.name}
                    </Copy>
                    <Copy size={14}>{signed(o.item)}</Copy>
                    {o.status === "overdue" && (
                      <FinPill tone="bad">overdue</FinPill>
                    )}
                  </Frame>
                </Tap>
              ))}
            </ScrollView>
          </View>
          <View style={{ marginTop: 8 }}>
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: "recurring", label: "Recurring" },
                { value: "once", label: "One-off" },
                { value: "whatif", label: "What-if drafts" },
              ]}
            />
          </View>
          <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
            {list.map((p) => (
              <Tap key={p.id} onPress={() => go(`/finance/planned/${p.id}`)}>
                <Line style={{ paddingVertical: 8, paddingHorizontal: 4 }}>
                  <PlannedIcon p={p} />
                  <View style={{ flex: 1 }}>
                    <Copy weight="medium" lines={1}>
                      {p.name}
                    </Copy>
                    <Line style={{ gap: 6 }}>
                      {p.isInstallment && <FinPill>installment</FinPill>}
                      {p.autoLog && <FinPill tone="fin">auto</FinPill>}
                      <Copy size={14} muted lines={1} style={{ flexShrink: 1 }}>
                        {C.scheduleLabel(p)}
                        {p.type !== "transfer"
                          ? ` · ${s.categories.find((c) => c.id === p.categoryId)?.name ?? ""}`
                          : ""}
                      </Copy>
                    </Line>
                  </View>
                  <View>
                    <Copy
                      weight="semibold"
                      style={{ color: p.type === "income" ? t.good : t.text }}
                    >
                      {signed(p)}
                    </Copy>
                    {p.estimated && (
                      <Copy size={10} muted>
                        estimate
                      </Copy>
                    )}
                  </View>
                </Line>
              </Tap>
            ))}
            {!list.length && (
              <Copy
                size={14}
                muted
                style={{ paddingVertical: 24, textAlign: "center" }}
              >
                {tab === "whatif"
                  ? "No drafts. Try one from the projection."
                  : "Nothing here yet."}
              </Copy>
            )}
          </Frame>
        </>
      )}
      {edit && <PlannedEditor id={id} open onClose={() => setEdit(false)} />}
      {due && (
        <DueSheet id={due.id} day={due.day} onClose={() => setDue(null)} />
      )}
    </Screen>
  )
}
