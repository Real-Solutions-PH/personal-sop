import * as A from "@domain/finance/actions"
import * as C from "@domain/finance/calc"
import type { Budget, PlannedItem } from "@domain/finance/data"
import { lookback } from "@domain/finance/review"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { currencySymbol } from "@domain/lib/money"
import { privacyStore } from "@domain/lib/privacy"
import { LinearGradient } from "expo-linear-gradient"
import { useLocalSearchParams } from "expo-router"
import {
  Award,
  Bot,
  Droplets,
  type LucideIcon,
  Share2,
  Sparkles,
  ThumbsDown,
  Trophy,
} from "lucide-react-native"
import { useEffect, useState } from "react"
import { ScrollView, View } from "react-native"
import { toast } from "sonner-native"
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
import { Button, Empty, Field, Screen, Sheet, shareText } from "../ui"
import { PlannedEditor, useMoney } from "./finance"
import { BudgetEditor } from "./finance-budget-editor"
import { FinPill } from "./finance-planned"
import { FinChip } from "./finance-projection"

function IconHeading({
  icon: Icon,
  children,
}: {
  icon: LucideIcon
  children: string
}) {
  const t = useTheme()
  return (
    <Line
      style={{ gap: 6, marginTop: 24, marginBottom: 8, paddingHorizontal: 4 }}
    >
      <Icon size={14} color={t.muted} />
      <Copy
        size={12}
        weight="medium"
        muted
        style={{ letterSpacing: 0.6, textTransform: "uppercase" }}
      >
        {children}
      </Copy>
    </Line>
  )
}
export function FinanceReview() {
  const s = finStore.use((s) => s),
    t = useTheme(),
    money = useMoney(),
    hidden = privacyStore.use((v) => v.hidden),
    p = useLocalSearchParams<Record<string, string>>(),
    cur = C.monthOf(dayKey(), s.settings.monthStartDay),
    [period, setPeriod] = useState(p.period ?? C.addMonths(cur, -1)),
    custom = !!p.from && !!p.to,
    [from, to] = custom
      ? [p.from, p.to]
      : C.monthRange(period, s.settings.monthStartDay),
    len = C.diffDays(to, from) + 1,
    [prevFrom, prevTo] = custom
      ? [C.addDays(from, -len), C.addDays(from, -1)]
      : C.monthRange(C.addMonths(period, -1), s.settings.monthStartDay),
    d = lookback(s, from, to, prevFrom, prevTo),
    saved = s.lookbacks.find(
      (l) => l.period === (custom ? `${from}_${to}` : period),
    ),
    [note, setNote] = useState(saved?.note ?? ""),
    [share, setShare] = useState(false),
    [budget, setBudget] = useState<{
      id?: string
      prefill: Partial<Budget>
    } | null>(null),
    [planned, setPlanned] = useState<Partial<PlannedItem> | null>(null),
    title = custom
      ? `${C.shortDate(from)} – ${C.shortDate(to)}`
      : C.monthLabel(period, true),
    first = s.records[0] ? C.recDay(s.records[0]) : dayKey(),
    tooEarly =
      Math.min(len, C.diffDays(dayKey(), from) + 1) < 14 ||
      C.diffDays(to, first) < 14,
    changed =
      saved && Math.round(saved.snapshot.spend) !== Math.round(d.flow.spend),
    food = d.where.find((w) => w.id === "food"),
    heat = [
      ...Array.from(
        { length: new Date(`${from}T12:00:00`).getDay() },
        () => null,
      ),
      ...d.ns.days.map((x) => (x.free ? 1 : 0)),
    ]
  useEffect(() => setNote(saved?.note ?? ""), [saved?.note])
  const win = (Icon: LucideIcon, title: string, body: string) => (
    <Frame key={title} style={{ padding: 16 }}>
      <Line>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: `${t.good}26`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon size={20} color={t.good} />
        </View>
        <View style={{ flex: 1 }}>
          <Copy size={14} weight="medium">
            {title}
          </Copy>
          <Copy size={12} muted>
            {body}
          </Copy>
        </View>
      </Line>
    </Frame>
  )
  const suggestions = [
    ...(food && food.v > 0
      ? [
          {
            key: "food",
            text: `Food was your biggest bucket at ${money(food.v)}. Cap it at ${money(Math.round((food.v * 0.9) / 500) * 500)} next month?`,
            action: "Create budget",
            run: () =>
              setBudget({
                id: s.budgets.find((b) => b.categoryIds?.includes("food"))?.id,
                prefill: {
                  name: "Food",
                  categoryIds: ["food"],
                  limit: Math.round((food.v * 0.9) / 500) * 500,
                },
              }),
          },
        ]
      : []),
    ...(d.leaks[0]
      ? [
          {
            key: "leak",
            text: `${d.leaks[0][0]} ×${d.leaks[0][1].n} added up to ${money(d.leaks[0][1].v)} — about ${money(d.leaks[0][1].v * 12)} a year.`,
            action: "Budget it",
            run: () =>
              setBudget({
                prefill: {
                  name: d.leaks[0][0],
                  categoryIds: [d.leaks[0][1].cat ?? "coffee"],
                  limit: Math.round((d.leaks[0][1].v * 0.6) / 100) * 100,
                },
              }),
          },
        ]
      : []),
    ...(d.rate > 0.2
      ? [
          {
            key: "invest",
            text: `You saved ${C.pct(d.rate)}. Auto-move part of what's left over to COL on payday so it doesn't leak.`,
            action: "Schedule it",
            run: () =>
              setPlanned({
                name: "Payday top-up to COL",
                type: "transfer",
                amount: 2000,
                accountId: "bpi",
                toAccountId: "col",
                schedule: { kind: "semimonthly", days: [15, 30] },
              }),
          },
        ]
      : []),
  ]
  if (tooEarly)
    return (
      <Screen title="Monthly review">
        <Empty
          title="Not enough data yet"
          detail={`Less than 2 weeks of transactions for ${title}. Your review will be ready on ${C.shortDate(C.addDays(from, 14))}.`}
          action={<Button href="/finance">Back to Finance</Button>}
        />
      </Screen>
    )
  return (
    <Screen
      title={`${title} review`}
      actions={
        <IconTap
          icon={Share2}
          label="Share card"
          size={40}
          color={t.text}
          onPress={() => setShare(true)}
        />
      }
    >
      {!custom && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Line style={{ gap: 8 }}>
            {[-3, -2, -1, 0].map((i) => {
              const m = C.addMonths(cur, i)
              return (
                <FinChip
                  key={m}
                  label={`${C.monthLabel(m)}${i === 0 ? " so far" : s.lookbacks.some((l) => l.period === m) ? " ✓" : ""}`}
                  active={period === m}
                  onPress={() => setPeriod(m)}
                />
              )
            })}
          </Line>
        </ScrollView>
      )}
      {to >= dayKey() && (
        <Copy
          size={12}
          muted
          style={{ padding: 12, borderRadius: 12, backgroundColor: t.soft }}
        >
          Period still running — numbers will move.
        </Copy>
      )}
      {changed && (
        <Copy
          size={12}
          style={{
            padding: 12,
            borderRadius: 12,
            backgroundColor: `${t.warn}1a`,
            color: t.warn,
          }}
        >
          Data changed since you saved this review (a backdated transaction or
          import).
        </Copy>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {[
          {
            label: "Savings rate",
            value: C.pct(d.rate),
            delta: Math.round((d.rate - d.prevRate) * 100),
            color: d.rate >= 0 ? t.fin : t.text,
            hint: d.rate < 0 ? "Spent more than you earned" : "",
          },
          {
            label: "No-spend days",
            value: String(d.ns.count),
            color: t.fin,
            hint: "wants only",
          },
          {
            label: "Income",
            value: money(d.flow.income),
            delta: d.prev.income
              ? Math.round((d.flow.income / d.prev.income - 1) * 100)
              : undefined,
          },
          {
            label: "Spent",
            value: money(d.flow.spend),
            delta: d.prev.spend
              ? Math.round((d.flow.spend / d.prev.spend - 1) * 100)
              : undefined,
            hint:
              d.base > 0
                ? `${d.flow.spend > d.base ? "+" : ""}${Math.round((d.flow.spend / d.base - 1) * 100)}% vs 3-period avg`
                : "",
            hintColor:
              d.base > 0 ? (d.flow.spend > d.base ? t.bad : t.good) : undefined,
          },
        ].map((x) => (
          <Frame
            key={x.label}
            style={{ flexBasis: "45%", flexGrow: 1, padding: 12 }}
          >
            <Copy
              size={30}
              weight="displayMedium"
              lines={1}
              style={{ color: x.color ?? t.text }}
            >
              {x.value}
            </Copy>
            <Copy size={12} muted>
              {x.label}
              {x.delta !== undefined && x.delta !== 0 && (
                <Copy
                  size={12}
                  style={{
                    color:
                      x.delta > 0 !== (x.label === "Spent") ? t.good : t.bad,
                  }}
                >
                  {" "}
                  {x.delta > 0 ? "▲" : "▼"}
                  {Math.abs(x.delta)}
                </Copy>
              )}
            </Copy>
            {!!x.hint && (
              <Copy
                size={11}
                muted={!x.hintColor}
                style={x.hintColor ? { color: x.hintColor } : undefined}
              >
                {x.hint}
              </Copy>
            )}
          </Frame>
        ))}
      </View>
      <Frame
        style={{
          padding: 16,
          borderColor: `${t.fin}4d`,
          backgroundColor: `${t.fin}0d`,
        }}
      >
        <Line style={{ gap: 8, marginBottom: 8 }}>
          <Sparkles size={16} color={t.fin} />
          <Copy size={14} weight="medium" style={{ color: t.fin }}>
            The short version
          </Copy>
        </Line>
        <Copy size={14} style={{ lineHeight: 23 }}>
          {d.rate >= 0.25
            ? `A solid ${title}: you kept ${C.pct(d.rate)} of what you earned. `
            : d.rate >= 0
              ? `A thin month — only ${C.pct(d.rate)} saved. `
              : "You spent more than you earned this period. "}
          {d.big[0]
            ? `One unplanned big purchase (${d.big[0].payee}, ${money(d.big[0].amount)}) did most of the damage. `
            : "No surprise big purchases. "}
          {d.where[0]
            ? `${d.where[0].cat?.name} took ${C.pct(d.topShare)} of spending`
            : ""}
          {d.spikes[0]
            ? `, and ${d.spikes[0].cat?.name} jumped ${Math.round((d.spikes[0].v / d.spikes[0].prev - 1) * 100)}% vs last month.`
            : "."}
        </Copy>
        <Copy size={11} muted style={{ marginTop: 8 }}>
          AI commentary from your own data — not licensed financial advice.
        </Copy>
      </Frame>
      <View style={{ marginTop: -12 }}>
        <SectionHeading>Where it went</SectionHeading>
        <Frame style={{ padding: 16, gap: 12 }}>
          {d.where.slice(0, 7).map((w) => (
            <Tap
              key={w.id}
              onPress={() =>
                go(`/finance/records?cat=${w.id}&from=${from}&to=${to}`)
              }
            >
              <Line
                style={{ justifyContent: "space-between", marginBottom: 4 }}
              >
                <Copy size={14}>
                  {w.cat?.icon} {w.cat?.name ?? "Other"}
                </Copy>
                <Line style={{ gap: 8 }}>
                  {w.prev > 0 && (
                    <Copy
                      size={11}
                      style={{ color: w.v > w.prev ? t.bad : t.good }}
                    >
                      {w.v > w.prev ? "▲" : "▼"}
                      {Math.abs(Math.round((w.v / w.prev - 1) * 100))}%
                    </Copy>
                  )}
                  <Copy size={14} weight="medium">
                    {money(w.v)}
                  </Copy>
                </Line>
              </Line>
              <Bar value={w.v / Math.max(1, d.where[0].v)} color={t.fin} />
            </Tap>
          ))}
        </Frame>
        <IconHeading icon={Trophy}>Wins</IconHeading>
        <View style={{ gap: 8 }}>
          {d.kept.length > 0 &&
            win(
              Award,
              `Kept ${d.kept.length}/${d.budgets.length} budgets`,
              d.kept.map((v) => v.b.name).join(", "),
            )}
          {d.ns.count >= 4 &&
            win(
              Droplets,
              `${d.ns.count} no-spend days`,
              "Days with no spending on wants. Bills and needs don't count.",
            )}
          {d.rate > d.prevRate &&
            win(
              Sparkles,
              `Savings rate up ${Math.round((d.rate - d.prevRate) * 100)} pts`,
              `From ${C.pct(d.prevRate)} to ${C.pct(d.rate)}.`,
            )}
          {win(
            Award,
            `Logged ${C.pct(d.completeness)} yourself`,
            "Everything else came from statement import. Logging habit is working.",
          )}
        </View>
        <IconHeading icon={ThumbsDown}>Misses</IconHeading>
        <Frame style={{ padding: 16, gap: 10 }}>
          {d.blown.map((v) => (
            <Line key={v.b.id} style={{ justifyContent: "space-between" }}>
              <Copy size={14}>Over {v.b.name} budget</Copy>
              <Copy size={14} style={{ color: t.bad }}>
                +{Math.round((v.pct - 1) * 100)}% ({money(v.spent - v.limit)})
              </Copy>
            </Line>
          ))}
          {d.spikes.map((w) => (
            <Line key={w.id} style={{ justifyContent: "space-between" }}>
              <Copy size={14}>{w.cat?.name} spiked</Copy>
              <Copy size={14} style={{ color: t.bad }}>
                +{Math.round((w.v / w.prev - 1) * 100)}% vs last month
              </Copy>
            </Line>
          ))}
          {d.big.map((r) => (
            <Tap key={r.id} onPress={() => go(`/finance/records/${r.id}`)}>
              <Line style={{ justifyContent: "space-between" }}>
                <Copy size={14}>Unplanned: {r.payee}</Copy>
                <Copy size={14} style={{ color: t.bad }}>
                  {money(r.amount)}
                </Copy>
              </Line>
            </Tap>
          ))}
          {!d.blown.length && !d.spikes.length && !d.big.length && (
            <Copy size={14} muted>
              No misses. Genuinely clean month.
            </Copy>
          )}
        </Frame>
        <SectionHeading>Leaks</SectionHeading>
        <Frame style={{ padding: 16, gap: 8 }}>
          {d.leaks.map(([name, x]) => (
            <Line key={name} style={{ justifyContent: "space-between" }}>
              <Copy size={14}>
                {name}{" "}
                <Copy size={14} muted>
                  ×{x.n}
                </Copy>
              </Copy>
              <View style={{ alignItems: "flex-end" }}>
                <Copy size={14}>{money(x.v)}</Copy>
                <Copy size={11} muted>
                  ≈ {hidden ? `${currencySymbol()}•••` : C.compact(x.v * 12)}/yr
                </Copy>
              </View>
            </Line>
          ))}
          {d.subs > 0 && (
            <Line
              style={{
                justifyContent: "space-between",
                paddingTop: 8,
                borderTopWidth: 1,
                borderColor: t.line,
              }}
            >
              <Copy size={14}>Subscriptions</Copy>
              <Copy size={14}>{money(d.subs)}</Copy>
            </Line>
          )}
        </Frame>
        <SectionHeading>No-spend calendar</SectionHeading>
        <Frame style={{ padding: 16 }}>
          <Line style={{ alignItems: "stretch", gap: 4 }}>
            <View style={{ width: 10, justifyContent: "space-around" }}>
              {["S", "M", "T", "W", "T", "F", "S"].map((v, i) => (
                <Copy key={`label-${i}`} size={10} muted>
                  {v}
                </Copy>
              ))}
            </View>
            {Array.from({ length: Math.ceil(heat.length / 7) }, (_, col) => (
              <View key={`col-${col}`} style={{ flex: 1, gap: 3 }}>
                {Array.from({ length: 7 }, (_, row) => (
                  <View
                    key={`row-${row}`}
                    style={{
                      aspectRatio: 1,
                      borderRadius: 3,
                      backgroundColor:
                        heat[col * 7 + row] == null
                          ? "transparent"
                          : heat[col * 7 + row]
                            ? t.fin
                            : t.soft,
                    }}
                  />
                ))}
              </View>
            ))}
          </Line>
          <Copy size={12} muted style={{ marginTop: 8 }}>
            Green = no spending on wants. Current streak: {d.ns.streak}{" "}
            {d.ns.streak === 1 ? "day" : "days"}.
          </Copy>
        </Frame>
        <SectionHeading>What to improve</SectionHeading>
        <View style={{ gap: 8 }}>
          {suggestions.slice(0, 3).map((x, i) => (
            <Frame key={x.key} style={{ padding: 16 }}>
              <Line style={{ alignItems: "flex-start" }}>
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: `${t.fin}26`,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Copy size={12} weight="semibold" style={{ color: t.fin }}>
                    {i + 1}
                  </Copy>
                </View>
                <View style={{ flex: 1, gap: 8 }}>
                  <Copy size={14}>{x.text}</Copy>
                  <View style={{ alignSelf: "flex-start" }}>
                    <Button small tone="quiet" onPress={x.run}>
                      {x.action}
                    </Button>
                  </View>
                </View>
              </Line>
            </Frame>
          ))}
        </View>
        <Copy size={11} muted style={{ padding: 4 }}>
          AI commentary from your own data — not licensed financial advice.
        </Copy>
        <SectionHeading>Your note</SectionHeading>
        <Field
          label=""
          placeholder="What will you do differently?"
          multiline
          value={note}
          onChangeText={setNote}
          style={{ height: 96, textAlignVertical: "top" }}
        />
        <Line style={{ gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              onPress={() => {
                A.saveLookBack(custom ? `${from}_${to}` : period, note, {
                  savingsRate: d.rate,
                  income: d.flow.income,
                  spend: d.flow.spend,
                })
                toast("Review saved")
              }}
            >
              {saved ? "Update review" : "Save review"}
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button
              tone="quiet"
              icon={Bot}
              href={`/finance/advisor?ask=review&period=${period}`}
            >
              Ask advisor
            </Button>
          </View>
        </Line>
      </View>
      <Sheet title="Share card" open={share} onClose={() => setShare(false)}>
        <Copy size={14} muted>
          Percentages and streaks only — never money amounts.
        </Copy>
        <LinearGradient
          colors={[t.fin, t.tsk]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 24, padding: 20 }}
        >
          <Copy size={12} style={{ color: "#ffffffcc" }}>
            {title} · Money
          </Copy>
          <Copy
            size={36}
            weight="display"
            style={{ color: "#fff", marginTop: 8 }}
          >
            {C.pct(d.rate)}
          </Copy>
          <Copy size={14} style={{ color: "#ffffffe6" }}>
            savings rate
          </Copy>
          <Line style={{ marginTop: 16, gap: 8 }}>
            {[
              {
                value: `${d.kept.length}/${d.budgets.length}`,
                label: "budgets kept",
              },
              { value: String(d.ns.count), label: "no-spend days" },
              { value: C.pct(d.completeness), label: "self-logged" },
            ].map((x) => (
              <View key={x.label} style={{ flex: 1, alignItems: "center" }}>
                <Copy size={18} weight="semibold" style={{ color: "#fff" }}>
                  {x.value}
                </Copy>
                <Copy size={12} style={{ color: "#fff" }}>
                  {x.label}
                </Copy>
              </View>
            ))}
          </Line>
        </LinearGradient>
        <Button
          onPress={() =>
            shareText(
              `${title} · Savings rate ${C.pct(d.rate)} · ${d.ns.count} no-spend days · Personal SOP`,
            )
          }
        >
          Share
        </Button>
        <FinPill>Amounts never shown on cards</FinPill>
      </Sheet>
      {budget && <BudgetEditor {...budget} onClose={() => setBudget(null)} />}
      {planned && (
        <PlannedEditor
          prefill={planned}
          open
          onClose={() => setPlanned(null)}
        />
      )}
    </Screen>
  )
}
