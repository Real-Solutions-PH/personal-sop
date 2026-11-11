import * as A from "@domain/finance/actions"
import * as C from "@domain/finance/calc"
import type { FinState, PlannedItem } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { useLocalSearchParams } from "expo-router"
import {
  AlarmClock,
  ArrowLeftRight,
  ChevronRight,
  Pause,
  Pencil,
  Play,
  Plus,
  Receipt,
  RotateCcw,
  SkipForward,
  Tag,
  Trash2,
  Undo2,
} from "lucide-react-native"
import { useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { toast } from "sonner-native"
import { MoneyInput } from "../money-input"
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
import { back, go } from "../navigation"
import { fonts, radius, useTheme } from "../theme"
import { Button, DateField, Empty, Screen, Sheet } from "../ui"
import { PlannedEditor, RecordEditor, useMoney } from "./finance"
import { Dimmed, EmptyFoot } from "./locked-preview"
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
      <Copy size={12} weight="medium" lines={1} style={{ color: t[tone] }}>
        {children}
      </Copy>
    </View>
  )
}
// What an empty list draws, dimmed, so the tab shows what it will hold.
const SAMPLE_PLANNED = [
  {
    icon: "💼",
    name: "Salary",
    when: "Monthly on the 15th · BPI",
    amount: 45000,
  },
  {
    icon: "💡",
    name: "Meralco",
    when: "Monthly on the 8th · GCash",
    amount: -3200,
  },
  {
    icon: "📺",
    name: "Netflix",
    when: "Monthly on the 21st · BPI",
    amount: -549,
  },
]
const SAMPLE_ONCE = [
  {
    icon: "🧾",
    name: "Car registration",
    when: "Once on 14 Dec · BPI",
    amount: -2850,
  },
  {
    icon: "🎁",
    name: "13th month pay",
    when: "Once on 15 Dec · BPI",
    amount: 45000,
  },
]
export function PlannedIcon({ p }: { p: PlannedItem }) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    cat = s.categories.find((c) => c.id === p.categoryId),
    // No category (deleted, or never set) reads as unset: a tag outline,
    // not a lone dot. A transfer has no category; it shows its arrows.
    Fallback = p.type === "transfer" ? ArrowLeftRight : Tag
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
      {p.type !== "transfer" && cat?.icon ? (
        <Copy size={20}>{cat.icon}</Copy>
      ) : (
        <Fallback size={18} color={t.muted} />
      )}
    </View>
  )
}
/** What a scheduled payment touches, in words: "Maya · Bills", with a part
 * that is gone (deleted, archived, never set) named as missing: "Maya · No
 * category", "Maya → No account". */
export function plannedWhere(
  p: PlannedItem,
  accounts: readonly { id: string; name: string; archived?: boolean }[],
  categories: readonly { id: string; name: string }[],
) {
  const acct = (id?: string) =>
    accounts.find((a) => a.id === id && !a.archived)?.name ?? "No account"
  if (p.type === "transfer")
    return `${acct(p.accountId)} → ${acct(p.toAccountId)}`
  const cat = categories.find((c) => c.id === p.categoryId)?.name
  return `${acct(p.accountId)} · ${cat ?? "No category"}`
}
export function DueSheet({
  id,
  day,
  onClose,
  record = false,
}: {
  id: string
  day: string
  onClose: () => void
  /** Open straight on the transaction editor (Received now / Pay now). */
  record?: boolean
}) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    p = s.planned.find((p) => p.id === id),
    money = useMoney(),
    // "due" shows the occurrence; "leaving" waits for its sheet to go (iOS
    // refuses a second modal before then); "editor" is the transaction
    // editor, which records nothing until Save.
    [phase, setPhase] = useState<"due" | "leaving" | "editor">(
      record ? "editor" : "due",
    )
  // The amount being typed for this date; written when the field is left.
  const [draft, setDraft] = useState<string | null>(null)
  if (!p) return null
  const where = plannedWhere(p, s.accounts, s.categories),
    when = p.snoozed[day] ?? day,
    amount = C.amountOn(p, day),
    moved = when !== day,
    ownAmount = amount !== p.amount,
    skipped = p.skipped.includes(day),
    // Cents keep both digits: "1,234,567.50", never ".5".
    shown =
      draft ?? (Number.isInteger(amount) ? String(amount) : amount.toFixed(2))
  const commitAmount = () => {
    if (draft === null) return
    const v = Number(draft)
    setDraft(null)
    if (v === amount) return
    if (!A.adjustOccurrence(id, day, { amount: v }))
      toast.error("Enter an amount above zero")
  }
  return (
    <>
      {phase !== "editor" && (
        <Sheet
          title={p.name}
          open={phase === "due"}
          onClose={onClose}
          onClosed={() => setPhase((v) => (v === "leaving" ? "editor" : v))}
        >
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
                {where}
              </Copy>
              <Copy size={12} muted>
                {p.isInstallment ? "0% installment · " : ""}
                {p.estimated
                  ? "Estimated amount — you set the actual next"
                  : "Fixed amount — you can still change it next"}
              </Copy>
            </View>
          </Line>
          {/* This one date, edited where it is shown: its day and its
              amount. The plan's own rule and amount stay as they are. */}
          <View
            testID="occurrence-edit"
            style={{
              paddingHorizontal: 12,
              paddingVertical: 4,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: border(t.line, 0.6),
              opacity: skipped ? 0.5 : 1,
            }}
          >
            <DateField
              label="Date"
              value={when}
              minimumDate={C.addDays(day, -C.MOVE_DAYS)}
              maximumDate={C.addDays(day, C.MOVE_DAYS)}
              onChangeText={(v) => {
                if (v !== when && !A.adjustOccurrence(id, day, { day: v }))
                  toast.error(
                    "Pick a day within two weeks of the scheduled one",
                  )
              }}
            />
            <MoneyInput
              label="Amount for this date"
              value={shown}
              onChange={setDraft}
              onEndEditing={commitAmount}
              onSubmitEditing={commitAmount}
            />
            {(moved || ownAmount) && (
              <Line style={{ gap: 8, paddingBottom: 8 }}>
                <Copy size={12} muted style={{ flex: 1 }}>
                  Plan: {money(p.amount)} on {C.dayLabel(day)}
                </Copy>
                <Button
                  small
                  tone="quiet"
                  icon={RotateCcw}
                  onPress={() => {
                    setDraft(null)
                    A.resetOccurrence(id, day)
                  }}
                >
                  Reset
                </Button>
              </Line>
            )}
          </View>
          <Line>
            {[
              skipped
                ? {
                    label: "Restore",
                    icon: Undo2,
                    press: () => A.unskipOccurrence(id, day),
                  }
                : {
                    label: "Skip",
                    icon: SkipForward,
                    press: () => {
                      A.skipOccurrence(id, day)
                      onClose()
                    },
                  },
              {
                label: "Snooze",
                icon: AlarmClock,
                press: () => {
                  A.snoozeOccurrence(id, day)
                  onClose()
                },
              },
              {
                label: "Record",
                icon: Receipt,
                press: () => setPhase("leaving"),
              },
            ].map((a, i) => (
              <View key={a.label} style={{ flex: 1 }}>
                <Button
                  tone={i === 2 ? "primary" : "quiet"}
                  icon={a.icon}
                  disabled={i > 0 && skipped}
                  onPress={a.press}
                >
                  {a.label}
                </Button>
              </View>
            ))}
          </Line>
        </Sheet>
      )}
      <RecordEditor
        open={phase === "editor"}
        onClose={onClose}
        settles={{ plannedId: id, day }}
        prefill={{
          type: p.type,
          amount: C.amountOn(p, day),
          accountId: p.accountId,
          toAccountId: p.toAccountId,
          categoryId: p.categoryId,
          payee: p.type === "transfer" ? undefined : p.name,
        }}
      />
    </>
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
    [tab, setTab] = useState("recurring"),
    [edit, setEdit] = useState(!!params.amount),
    [due, setDue] = useState<{
      id: string
      day: string
      record?: boolean
    } | null>(null),
    p = s.planned.find((p) => p.id === id),
    today = dayKey(),
    // Paused items (``archived``: the auto-log job and the calendar skip
    // them) stay on the list so they can be resumed.
    live = s.planned.filter((p) => !C.hasEnded(p, today)),
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
    { income, out } = C.recurringMonth(s, today),
    signed = (p: PlannedItem) =>
      `${p.type === "income" ? "+" : p.type === "expense" ? "−" : ""}${money(p.amount)}`
  const history = p
      ? C.occurrencesIn(s, p.start, today, { includeWhatIf: true })
          .filter((o) => o.item.id === id)
          .reverse()
      : [],
    past = history.filter((o) => o.status !== "upcoming" && o.status !== "due"),
    // What the empty History draws, dimmed: the plan's first three dates.
    firstDates = p
      ? C.occurrences(p, p.start, C.addDays(p.start, 1200)).slice(0, 3)
      : [],
    next = p
      ? C.occurrencesIn(s, C.addDays(today, -14), C.addDays(today, 400), {
          includeWhatIf: true,
        })
          // A skipped date ahead stays listed, so it can be restored.
          .filter(
            (o) =>
              o.item.id === id &&
              o.status !== "paid" &&
              (o.status !== "skipped" || o.day >= today),
          )
          .slice(0, 6)
      : [],
    nextLive = next.filter((o) => o.status !== "skipped"),
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
    // One row per figure, so every amount has the card's full width.
    <Frame style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
      {items.map((x, i) => (
        <Line
          key={x.label}
          style={{
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 12,
            paddingVertical: 10,
            borderTopWidth: i ? 1 : 0,
            borderColor: border(t.line, 0.6),
          }}
        >
          <Copy size={14} muted style={{ flex: 1 }}>
            {x.label}
          </Copy>
          <Copy
            size={20}
            weight="displayMedium"
            style={{ color: x.color ?? t.text }}
          >
            {x.value}
          </Copy>
        </Line>
      ))}
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
      titleContent={
        p ? (
          // A long name ("Reimbursement from Real Solutions") wraps to a
          // second line and then shrinks, instead of being cut off.
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={{
              fontFamily: fonts.displayMedium,
              fontSize: 20,
              lineHeight: 26,
              color: t.text,
            }}
          >
            {p.name}
          </Text>
        ) : undefined
      }
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
              <Copy size={30} weight="displayMedium" fit>
                {signed(p)}
              </Copy>
              <Copy size={12} muted>
                {p.estimated ? "Estimated · " : ""}
                {C.scheduleLabel(p)}
              </Copy>
            </View>
          </Line>
          <Line style={{ gap: 6, flexWrap: "wrap" }}>
            <FinPill>{plannedWhere(p, s.accounts, s.categories)}</FinPill>
            {p.archived ? (
              <FinPill>paused</FinPill>
            ) : (
              <FinPill tone={p.autoLog ? "fin" : "muted"}>
                {p.autoLog ? "Auto-logs" : "Asks Paid / Skip"}
              </FinPill>
            )}
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
                  disabled={!nextLive[0] || p.isWhatIf}
                  onPress={() =>
                    setDue({ id: p.id, day: nextLive[0].orig, record: true })
                  }
                >
                  {p.type === "income" ? "Received now" : "Pay now"}
                </Button>
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  tone="quiet"
                  disabled={!nextLive[0]}
                  onPress={() => {
                    if (!nextLive[0]) return
                    A.skipOccurrence(p.id, nextLive[0].orig)
                  }}
                >
                  Skip next
                </Button>
              </View>
            </Line>
            <Line style={{ gap: 8 }}>
              {p.isWhatIf && (
                <View style={{ flex: 1 }}>
                  <Button
                    tone="quiet"
                    onPress={() =>
                      A.updatePlanned(p.id, {
                        isWhatIf: false,
                        inProjection: true,
                      })
                    }
                  >
                    Make it real
                  </Button>
                </View>
              )}
              {!p.isWhatIf && p.schedule.kind !== "once" && (
                <View style={{ flex: 1 }}>
                  <Button
                    tone="quiet"
                    icon={p.archived ? Play : Pause}
                    onPress={() => {
                      const paused = !p.archived
                      A.updatePlanned(p.id, { archived: paused })
                    }}
                  >
                    {p.archived ? "Resume" : "Pause"}
                  </Button>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Button
                  tone="danger"
                  icon={Trash2}
                  onPress={() => {
                    // Gone from every device (a sync tombstone); paid
                    // occurrences stay in transactions.
                    const gone = A.deletePlanned(p.id)
                    if (!gone) return
                    back("/finance/planned")
                  }}
                >
                  Delete
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
              {next.map((o, i) => {
                const skipped = o.status === "skipped",
                  own = o.amount !== p.amount
                return (
                  <Tap
                    key={o.orig}
                    label={`${C.dayLabel(o.day)}, ${skipped ? "skipped" : o.status}, ${money(o.amount)}${own ? ", its own amount" : ""}. Change, skip or record this date`}
                    onPress={() => setDue({ id: p.id, day: o.orig })}
                  >
                    <Line
                      style={{
                        paddingVertical: 10,
                        gap: 8,
                        borderTopWidth: i ? 1 : 0,
                        borderColor: border(t.line, 0.4),
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Copy
                          size={14}
                          muted={skipped}
                          style={
                            skipped
                              ? { textDecorationLine: "line-through" }
                              : undefined
                          }
                        >
                          {C.dayLabel(o.day)}
                        </Copy>
                        {o.day !== o.orig && (
                          <Copy size={12} muted>
                            moved from {C.shortDate(o.orig)}
                          </Copy>
                        )}
                      </View>
                      <Line style={{ gap: 4 }}>
                        {own && !skipped && <Pencil size={12} color={t.fin} />}
                        <Copy
                          size={14}
                          muted={skipped}
                          style={own && !skipped ? { color: t.fin } : undefined}
                        >
                          {money(o.amount)}
                        </Copy>
                      </Line>
                      {o.status === "upcoming" ? null : (
                        <FinPill
                          tone={
                            skipped
                              ? "muted"
                              : o.status === "overdue"
                                ? "bad"
                                : "warn"
                          }
                        >
                          {o.status}
                        </FinPill>
                      )}
                      <ChevronRight size={16} color={t.muted} />
                    </Line>
                  </Tap>
                )
              })}
            </Frame>
            <SectionHeading>History</SectionHeading>
            <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
              {past.map((o) => {
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
              {!past.length && (
                <View
                  testID="planned-history-empty"
                  style={{ paddingBottom: 8 }}
                >
                  <Dimmed>
                    {/* The sample is the plan's own first dates, never days
                        before it starts: a date the plan could not have had,
                        drawn "paid", reads as real history. */}
                    {firstDates.map((d) => (
                      <Line
                        key={d}
                        style={{
                          paddingVertical: 10,
                          justifyContent: "space-between",
                        }}
                      >
                        <Copy size={14}>{C.shortDate(d)}</Copy>
                        {/* Every one of these dates is still ahead, so the
                            sample claims no paid or missed state. */}
                        <Copy size={14}>{money(C.amountOn(p, d))}</Copy>
                      </Line>
                    ))}
                  </Dimmed>
                  <EmptyFoot
                    hint={
                      firstDates[0]
                        ? `${firstDates[0] > today ? "Starts" : "First date"} ${C.dayLabel(firstDates[0])}. Each date lands here once it passes, as paid or missed.`
                        : "Each past date lands here as paid or missed, with how far it was off."
                    }
                  />
                </View>
              )}
            </Frame>
          </View>
        </>
      ) : (
        <>
          {stats([
            { label: "In / month", value: money(income), color: t.good },
            { label: "Out / month", value: money(out) },
            { label: "Net / month", value: money(income - out) },
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
                    <Copy size={12} muted>
                      {C.dayLabel(o.day)}
                    </Copy>
                    <Copy size={14} weight="medium" style={{ marginTop: 4 }}>
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
                    <Line style={{ gap: 6, flexWrap: "wrap" }}>
                      <Copy weight="medium">{p.name}</Copy>
                      {p.isInstallment && <FinPill>installment</FinPill>}
                      {p.archived ? (
                        <FinPill>paused</FinPill>
                      ) : (
                        p.autoLog && <FinPill tone="fin">auto</FinPill>
                      )}
                    </Line>
                    <Copy size={14} muted>
                      {C.scheduleLabel(p)} ·{" "}
                      {plannedWhere(p, s.accounts, s.categories)}
                    </Copy>
                    {!p.archived && p.schedule.kind !== "once" && (
                      <NextLine s={s} p={p} today={today} />
                    )}
                  </View>
                  <View>
                    <Copy
                      weight="semibold"
                      style={{ color: p.type === "income" ? t.good : t.text }}
                    >
                      {signed(p)}
                    </Copy>
                    {p.estimated && (
                      <Copy size={12} muted>
                        estimate
                      </Copy>
                    )}
                  </View>
                </Line>
              </Tap>
            ))}
            {!list.length && (
              <View testID="planned-empty" style={{ paddingVertical: 8 }}>
                <Dimmed>
                  {(tab === "once" ? SAMPLE_ONCE : SAMPLE_PLANNED).map((x) => (
                    <Line
                      key={x.name}
                      style={{ paddingVertical: 8, paddingHorizontal: 4 }}
                    >
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
                        <Copy size={20}>{x.icon}</Copy>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Copy weight="medium">{x.name}</Copy>
                        <Copy size={14} muted>
                          {x.when}
                        </Copy>
                      </View>
                      <Copy
                        weight="semibold"
                        style={{ color: x.amount > 0 ? t.good : t.text }}
                      >
                        {x.amount > 0 ? "+" : "−"}
                        {money(Math.abs(x.amount))}
                      </Copy>
                    </Line>
                  ))}
                </Dimmed>
                <EmptyFoot
                  hint={
                    tab === "whatif"
                      ? "Drafts let you test a purchase against your projection."
                      : tab === "once"
                        ? "A one-off bill or payout you know is coming."
                        : "Salary, rent and bills that repeat, so the month ahead is never a surprise."
                  }
                  action={
                    tab === "whatif"
                      ? {
                          label: "Try one",
                          href: "/finance/projection?whatif=1",
                        }
                      : { label: "Add", onPress: () => setEdit(true) }
                  }
                />
              </View>
            )}
          </Frame>
        </>
      )}
      {edit && <PlannedEditor id={id} open onClose={() => setEdit(false)} />}
      {due && (
        <DueSheet
          id={due.id}
          day={due.day}
          record={due.record}
          onClose={() => setDue(null)}
        />
      )}
    </Screen>
  )
}

/** "Next Fri 15 Nov" under a recurring row: the first date not yet paid or
 * skipped. */
function NextLine({
  s,
  p,
  today,
}: {
  s: FinState
  p: PlannedItem
  today: string
}) {
  const next = C.nextOccurrence(s, p, today)
  return (
    <Copy size={12} muted>
      {next ? `Next ${C.dayLabel(next)}` : "No more dates"}
    </Copy>
  )
}
