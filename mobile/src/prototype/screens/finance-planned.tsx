import * as A from "@domain/finance/actions"
import * as C from "@domain/finance/calc"
import type { PlannedItem } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { useLocalSearchParams } from "expo-router"
import { ArrowLeftRight, Pencil, Plus, Tag } from "lucide-react-native"
import { useState } from "react"
import { ScrollView, Text, useWindowDimensions, View } from "react-native"
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
import { fonts, radius, useTheme } from "../theme"
import { Button, Empty, Screen, Sheet, undo } from "../ui"
import { PlannedEditor, RecordEditor, useMoney } from "./finance"
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
  if (!p) return null
  const where = plannedWhere(p, s.accounts, s.categories)
  return (
    <>
      {phase !== "editor" && (
        <Sheet
          title={p.name}
          open={phase === "due"}
          onClose={onClose}
          onClosed={() => setPhase((v) => (v === "leaving" ? "editor" : v))}
        >
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
                label: "Review & record",
                press: () => setPhase("leaving"),
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
      )}
      <RecordEditor
        open={phase === "editor"}
        onClose={onClose}
        settles={{ plannedId: id, day }}
        prefill={{
          type: p.type,
          amount: p.amount,
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
    narrow = useWindowDimensions().width < 380,
    [tab, setTab] = useState("recurring"),
    [edit, setEdit] = useState(!!params.amount),
    [due, setDue] = useState<{
      id: string
      day: string
      record?: boolean
    } | null>(null),
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
    { income, out } = C.recurringMonth(s, today),
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
              fit
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
                  onPress={() =>
                    setDue({ id: p.id, day: next[0].orig, record: true })
                  }
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
                    <Line style={{ gap: 6 }}>
                      <Copy weight="medium" lines={1} style={{ flexShrink: 1 }}>
                        {p.name}
                      </Copy>
                      {p.isInstallment && <FinPill>installment</FinPill>}
                      {p.autoLog && <FinPill tone="fin">auto</FinPill>}
                    </Line>
                    <Copy size={14} muted lines={1}>
                      {C.scheduleLabel(p)} ·{" "}
                      {plannedWhere(p, s.accounts, s.categories)}
                    </Copy>
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
