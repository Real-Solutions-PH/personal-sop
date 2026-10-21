import * as A from "@domain/finance/actions"
import * as C from "@domain/finance/calc"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { currencySymbol } from "@domain/lib/money"
import { privacyStore } from "@domain/lib/privacy"
import { useLocalSearchParams } from "expo-router"
import { Bot, ChevronDown, Sparkles, X } from "lucide-react-native"
import { useState } from "react"
import { ScrollView, View } from "react-native"
import { toast } from "sonner-native"
import { FinanceLineChart } from "../chart"
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
import { Switch } from "../switch"
import { radius, useTheme } from "../theme"
import { Button, Empty, Field, Screen } from "../ui"
import { useMoney } from "./finance"
export function FinChip({
  label,
  active = false,
  onPress,
  leading,
}: {
  label: string
  active?: boolean
  onPress: () => void
  leading?: React.ReactNode
}) {
  const t = useTheme()
  return (
    <Tap
      onPress={onPress}
      style={{
        borderRadius: radius.pill,
        paddingLeft: leading ? 6 : 14,
        paddingRight: 14,
        height: 36,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderWidth: 1,
        borderColor: active ? "transparent" : t.line,
        backgroundColor: active ? t.fin : t.card,
      }}
    >
      {leading}
      <Copy
        size={14}
        weight="medium"
        style={{ color: active ? t.onPrimary : t.text }}
      >
        {label}
      </Copy>
    </Tap>
  )
}
export function Projection() {
  const s = finStore.use((s) => s),
    t = useTheme(),
    money = useMoney(),
    hidden = privacyStore.use((s) => s.hidden),
    p = useLocalSearchParams<Record<string, string>>(),
    cur = C.monthOf(dayKey(), 1),
    [whatOpen, setWhat] = useState(!!p.whatif || !!p.amount),
    [name, setName] = useState(p.name ?? "New laptop"),
    [amount, setAmount] = useState(p.amount ?? "45000"),
    [month, setMonth] = useState(p.month ?? C.addMonths(cur, 3)),
    [mode, setMode] = useState("lump"),
    [n, setN] = useState(12),
    [picked, setAcct] = useState<string>(),
    [excluded, setExcluded] = useState<string[]>([]),
    [assump, setAssump] = useState(false),
    horizon = s.settings.horizon,
    whatIf =
      whatOpen && Number(amount) > 0
        ? {
            amount: Number(amount),
            month,
            installments: mode === "inst" ? n : 1,
          }
        : null,
    proj = C.project(s, {
      horizon,
      includeUnplanned: s.settings.includeUnplanned,
      excludedPlanned: s.settings.projExcludedPlanned,
      excludedAccounts: excluded,
      whatIf,
    }),
    bal = C.balances(s),
    floor = s.settings.safetyFloor,
    last = proj.months.at(-1),
    verdict =
      proj.low.value < 0 ? "no" : proj.low.value < floor ? "tight" : "ok",
    color = verdict === "ok" ? t.good : verdict === "tight" ? t.warn : t.bad,
    drafts = s.planned.filter((p) => p.isWhatIf && !p.archived)
  let expense = 0
  for (let i = 1; i <= 3; i++) {
    const [from, to] = C.monthRange(C.addMonths(cur, -i), 1)
    expense += s.records
      .filter(
        (r) =>
          r.type === "expense" &&
          !r.isAdjustment &&
          C.recDay(r) >= from &&
          C.recDay(r) <= to,
      )
      .reduce((a, r) => a + r.amount, 0)
  }
  const runway = expense ? proj.start / (expense / 3) : 0
  // The accounts a purchase can come from, and the card an installment plan
  // runs on: the user's own (live accounts are UUIDs, not the demo's
  // "bpi" / "bpicc", which the server refused).
  const payable = s.accounts.filter((a) => a.inProjection && !a.archived),
    acct = (
      payable.find((a) => a.id === picked) ??
      payable.find((a) => a.id === s.settings.defaultAccountId) ??
      payable[0]
    )?.id,
    card = s.accounts.find((a) => a.type === "credit" && !a.archived),
    instFrom = (payable.find((a) => a.type === "bank") ?? payable[0])?.id
  const save = (draft: boolean) => {
    if (!whatIf) return
    const from = mode === "inst" ? instFrom : acct
    if (!from || (mode === "inst" && !card)) {
      toast.error(
        mode === "inst"
          ? "Add a credit card to plan installments"
          : "Add an account first",
      )
      return
    }
    const date = `${month}-15`
    A.addPlanned({
      name: name || "Planned purchase",
      type: mode === "inst" ? "transfer" : "expense",
      amount: mode === "inst" ? Math.round(Number(amount) / n) : Number(amount),
      estimated: false,
      accountId: from,
      toAccountId: mode === "inst" ? card?.id : undefined,
      categoryId: mode === "inst" ? undefined : "shopping",
      schedule:
        mode === "inst" ? { kind: "monthly", day: 8 } : { kind: "once", date },
      start: date,
      end: mode === "inst" ? { kind: "count", n } : { kind: "never" },
      autoLog: false,
      isWhatIf: draft,
      isInstallment: mode === "inst",
      inProjection: !draft,
    })
    toast(
      draft
        ? `Saved “${name}” as a what-if draft`
        : `“${name}” added to your plan`,
    )
    setWhat(false)
  }
  const chiprow = (items: React.ReactNode) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <Line style={{ gap: 8 }}>{items}</Line>
    </ScrollView>
  )
  const toggle = (
    label: string,
    hint: string,
    value: boolean,
    onChange: (v: boolean) => void,
  ) => (
    <Line style={{ paddingVertical: 12 }}>
      <View style={{ flex: 1 }}>
        <Copy size={14} weight="medium">
          {label}
        </Copy>
        <Copy size={12} muted>
          {hint}
        </Copy>
      </View>
      <Switch accent="fin" label={label} value={value} onChange={onChange} />
    </Line>
  )
  const compact = (v: number) => (hidden ? "•••" : C.compact(v))
  if (!proj.hasIncome)
    return (
      <Screen title="Projection">
        <Empty
          title="Add your income to see the future"
          detail="The projection needs at least one scheduled income — like your 15th & 30th salary. No fake forecasts."
          action={
            <Button href="/finance/planned?state=empty">Add salary</Button>
          }
        />
      </Screen>
    )
  return (
    <Screen
      title="Projection"
      actions={
        <IconTap
          icon={Bot}
          label="Ask advisor"
          size={40}
          color={t.text}
          onPress={() => go("/finance/advisor?ask=runway")}
        />
      }
    >
      <Segmented
        value={String(horizon)}
        onChange={(v) =>
          A.updateSettings({ horizon: Number(v) as 6 | 12 | 24 })
        }
        options={[6, 12, 24].map((v) => ({
          value: String(v),
          label: `${v} mo`,
        }))}
      />
      <Frame
        style={{ paddingHorizontal: 12, paddingTop: 16, paddingBottom: 8 }}
      >
        <Line
          style={{
            alignItems: "flex-start",
            paddingHorizontal: 4,
            justifyContent: "space-between",
          }}
        >
          <View style={{ flex: 1 }}>
            <Copy size={12} muted>
              Available money by {last ? C.monthLabel(last.key, true) : ""}
            </Copy>
            <Copy size={30} weight="displayMedium">
              {money(last?.end ?? proj.start)}
            </Copy>
            {whatIf && last && (
              <Copy size={12} muted>
                vs {money(last.endBase)} without it
              </Copy>
            )}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Copy size={12} muted>
              Avg left over
            </Copy>
            <Copy
              size={12}
              weight="semibold"
              style={{ color: proj.avgSurplus >= 0 ? t.good : t.bad }}
            >
              {proj.avgSurplus >= 0 ? "+" : ""}
              {compact(proj.avgSurplus)}/mo
            </Copy>
            <Copy size={12} muted style={{ marginTop: 4 }}>
              Lowest point
            </Copy>
            <Copy
              size={12}
              weight="semibold"
              style={{ color: proj.low.value < floor ? t.warn : t.text }}
            >
              {money(proj.low.value)} · {C.monthLabel(proj.low.key)}
            </Copy>
          </View>
        </Line>
        <FinanceLineChart
          height={190}
          floor={floor}
          labels={["Now", ...proj.months.map((m) => C.monthLabel(m.key))]}
          series={[
            {
              values: [proj.start, ...proj.months.map((m) => m.endBase)],
              color: whatIf ? t.muted : t.fin,
              area: !whatIf,
            },
            ...(whatIf
              ? [
                  {
                    values: [proj.start, ...proj.months.map((m) => m.end)],
                    color: verdict === "ok" ? t.fin : color,
                    area: true,
                  },
                ]
              : []),
          ]}
        />
        <Line style={{ gap: 16, paddingHorizontal: 4 }}>
          <Copy size={11} muted>
            ━ Baseline
          </Copy>
          {whatIf && (
            <Copy size={11} muted>
              ━ With {name || "purchase"}
            </Copy>
          )}
          <Copy size={11} muted>
            ┄ Minimum balance
          </Copy>
        </Line>
      </Frame>
      <Frame style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
        {toggle(
          "Include average everyday spending",
          `Food, Grab, shopping… 3-month average of ${money(proj.avgUnplanned)}/mo. Off = planned items only (optimistic).`,
          s.settings.includeUnplanned,
          (includeUnplanned) => A.updateSettings({ includeUnplanned }),
        )}
      </Frame>
      {!whatOpen ? (
        <Button icon={Sparkles} onPress={() => setWhat(true)}>
          What if I buy…
        </Button>
      ) : (
        <Frame style={{ padding: 16, borderColor: `${t.fin}66`, gap: 12 }}>
          <Line style={{ justifyContent: "space-between" }}>
            <Line style={{ gap: 8 }}>
              <Sparkles size={16} color={t.fin} />
              <Copy weight="semibold">Plan a purchase</Copy>
            </Line>
            <IconTap
              icon={X}
              label="Close what-if"
              onPress={() => setWhat(false)}
            />
          </Line>
          <Line>
            <View style={{ flex: 1 }}>
              <Field label="Item" value={name} onChangeText={setName} />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label={`Price ${currencySymbol()}`}
                keyboardType="number-pad"
                value={amount}
                onChangeText={(v) => setAmount(v.replace(/[^\d]/g, ""))}
              />
            </View>
          </Line>
          {chiprow(
            [10000, 25000, 45000, 100000].map((v) => (
              <FinChip
                key={v}
                label={C.compact(v)}
                active={Number(amount) === v}
                onPress={() => setAmount(String(v))}
              />
            )),
          )}
          <Copy size={12} muted>
            When
          </Copy>
          {chiprow(
            Array.from({ length: 12 }, (_, i) => C.addMonths(cur, i)).map(
              (m) => (
                <FinChip
                  key={m}
                  label={`${C.monthLabel(m)}${m.slice(0, 4) !== cur.slice(0, 4) ? ` '${m.slice(2, 4)}` : ""}`}
                  active={month === m}
                  onPress={() => setMonth(m)}
                />
              ),
            ),
          )}
          <Copy size={12} muted>
            How
          </Copy>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "lump", label: "Pay in full" },
              { value: "inst", label: "0% installments" },
            ]}
          />
          {mode === "inst" ? (
            <>
              <Line style={{ gap: 8 }}>
                {[3, 6, 12, 24].map((v) => (
                  <FinChip
                    key={v}
                    label={`${v}×`}
                    active={n === v}
                    onPress={() => setN(v)}
                  />
                ))}
              </Line>
              <Copy size={12} muted>
                {money(Math.round(Number(amount || 0) / n))}/mo on{" "}
                {card?.name ?? "a credit card"}
              </Copy>
            </>
          ) : (
            chiprow(
              payable.map((a) => (
                <FinChip
                  key={a.id}
                  label={a.name}
                  active={acct === a.id}
                  onPress={() => setAcct(a.id)}
                />
              )),
            )
          )}
          {whatIf && (
            <View
              style={{
                borderRadius: 16,
                padding: 12,
                backgroundColor: `${color}1a`,
                gap: 8,
              }}
            >
              <Copy weight="semibold" style={{ color }}>
                {verdict === "ok"
                  ? "✓ Affordable"
                  : verdict === "tight"
                    ? "Affordable, but dips below your minimum balance"
                    : "Not affordable — you'd go negative"}
              </Copy>
              <Line style={{ gap: 8, alignItems: "flex-start" }}>
                {[
                  {
                    label: "New low",
                    value: money(proj.low.value),
                    detail: C.monthLabel(proj.low.key),
                  },
                  {
                    label: "Recovers in",
                    value:
                      mode === "inst"
                        ? "—"
                        : proj.recoveryMonths === null
                          ? `>${horizon} mo`
                          : `${proj.recoveryMonths} mo`,
                    detail: mode === "inst" ? "spread out" : "to pre-buy level",
                  },
                  {
                    label: "End balance",
                    value: money(last?.end ?? 0),
                    detail: `−${compact((last?.endBase ?? 0) - (last?.end ?? 0))}`,
                  },
                ].map((x) => (
                  <View key={x.label} style={{ flex: 1 }}>
                    <Copy size={12} muted>
                      {x.label}
                    </Copy>
                    <Copy size={12} weight="semibold">
                      {x.value}
                    </Copy>
                    <Copy size={12} muted>
                      {x.detail}
                    </Copy>
                  </View>
                ))}
              </Line>
              {proj.low.value < floor && (
                <Copy size={12}>
                  Your safety floor is {money(floor)}.{" "}
                  {verdict === "tight"
                    ? "Try a later month or installments."
                    : "Consider installments or saving first."}
                </Copy>
              )}
            </View>
          )}
          <Line style={{ gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button disabled={!whatIf} onPress={() => save(false)}>
                Save as scheduled
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button
                tone="quiet"
                disabled={!whatIf}
                onPress={() => save(true)}
              >
                Save as draft
              </Button>
            </View>
          </Line>
          <Line style={{ gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button tone="quiet" onPress={() => setWhat(false)}>
                Discard
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button
                tone="quiet"
                icon={Bot}
                disabled={!whatIf}
                href={`/finance/advisor?ask=afford&amount=${amount}&month=${month}&name=${encodeURIComponent(name)}&mode=${mode}&n=${n}`}
              >
                Ask advisor
              </Button>
            </View>
          </Line>
        </Frame>
      )}
      {drafts.length > 0 && (
        <View style={{ marginTop: -12 }}>
          <SectionHeading>What-if drafts</SectionHeading>
          {chiprow(
            drafts.map((p) => (
              <FinChip
                key={p.id}
                label={`${p.name} · ${compact(p.amount)}`}
                onPress={() => {
                  setName(p.name.replace(" (draft)", ""))
                  setAmount(String(p.amount))
                  if (p.schedule.kind === "once")
                    setMonth(p.schedule.date.slice(0, 7))
                  setMode("lump")
                  setWhat(true)
                }}
              />
            )),
          )}
        </View>
      )}
      <Line style={{ alignItems: "stretch" }}>
        <Frame style={{ flex: 1, padding: 16 }}>
          <Copy size={30} weight="displayMedium">
            {money(proj.start)}
          </Copy>
          <Copy size={12} muted>
            Available now
          </Copy>
        </Frame>
        <Frame style={{ flex: 1, padding: 16 }}>
          <Copy
            size={30}
            weight="displayMedium"
            style={{ color: runway >= 3 ? t.fin : t.text }}
          >
            {runway.toFixed(1)} mo
          </Copy>
          <Copy size={12} muted>
            Months you could cover
          </Copy>
          <Copy
            size={11}
            style={{
              color: runway >= 3 ? t.good : runway >= 1 ? t.warn : t.bad,
            }}
          >
            {runway >= 3
              ? "≥ 3 months — healthy"
              : runway >= 1
                ? "Aim for 3 months"
                : "Under 1 month"}
          </Copy>
        </Frame>
      </Line>
      <View style={{ marginTop: -12 }}>
        <SectionHeading>Left over each month</SectionHeading>
        <Frame>
          <Line
            style={{
              gap: 0,
              paddingVertical: 8,
              borderBottomWidth: 1,
              borderColor: border(t.line, 0.6),
            }}
          >
            {["Month", "In", "Out", "Net", "Balance"].map((x, i) => (
              <Copy
                key={x}
                size={12}
                muted
                weight="medium"
                style={{
                  flex: 1,
                  paddingHorizontal: 8,
                  textAlign: i ? "right" : "left",
                }}
              >
                {x}
              </Copy>
            ))}
          </Line>
          {proj.months.map((m, i) => (
            <Line
              key={m.key}
              style={{
                gap: 0,
                paddingVertical: 8,
                borderBottomWidth: 1,
                borderColor: border(t.line, 0.4),
                backgroundColor: m.whatIf > 0 ? `${t.fin}0d` : undefined,
              }}
            >
              {[
                `${C.monthLabel(m.key)}${i === 0 ? " (rest)" : ""}${m.whatIf > 0 ? " •" : ""}`,
                compact(m.inflow),
                compact(m.planned + m.unplanned + m.whatIf),
                `${m.net >= 0 ? "+" : ""}${compact(m.net)}`,
                compact(m.end),
              ].map((v, j) => (
                <Copy
                  key={`cell-${j}`}
                  size={12}
                  style={{
                    flex: 1,
                    paddingHorizontal: 8,
                    textAlign: j ? "right" : "left",
                    color:
                      j === 1
                        ? t.good
                        : j === 3
                          ? m.net < 0
                            ? t.bad
                            : t.good
                          : j === 4 && m.end < floor
                            ? m.end < 0
                              ? t.bad
                              : t.warn
                            : t.text,
                  }}
                >
                  {v}
                </Copy>
              ))}
            </Line>
          ))}
        </Frame>
      </View>
      <Tap onPress={() => setAssump(!assump)}>
        <Line style={{ justifyContent: "space-between", padding: 4 }}>
          <Copy size={12} weight="medium" muted style={{ letterSpacing: 1 }}>
            ASSUMPTIONS
          </Copy>
          <ChevronDown
            size={16}
            color={t.muted}
            style={{ transform: [{ rotate: assump ? "180deg" : "0deg" }] }}
          />
        </Line>
      </Tap>
      {assump && (
        <Frame style={{ padding: 16 }}>
          <Copy size={14} weight="medium">
            Starting from (cash & bank accounts)
          </Copy>
          {s.accounts
            .filter((a) => a.inProjection && !a.archived)
            .map((a) => (
              <View key={a.id}>
                {toggle(
                  a.name,
                  money(bal[a.id]),
                  !excluded.includes(a.id),
                  (v) =>
                    setExcluded(
                      v
                        ? excluded.filter((id) => id !== a.id)
                        : [...excluded, a.id],
                    ),
                )}
              </View>
            ))}
          <Copy size={14} weight="medium">
            Planned items
          </Copy>
          {s.planned
            .filter((p) => !p.archived && !p.isWhatIf && p.inProjection)
            .map((p) => (
              <View key={p.id}>
                {toggle(
                  p.name,
                  `${money(p.amount)} · ${C.scheduleLabel(p)}`,
                  !s.settings.projExcludedPlanned.includes(p.id),
                  (v) =>
                    A.updateSettings({
                      projExcludedPlanned: v
                        ? s.settings.projExcludedPlanned.filter(
                            (id) => id !== p.id,
                          )
                        : [...s.settings.projExcludedPlanned, p.id],
                    }),
                )}
              </View>
            ))}
          <Field
            label={`Minimum balance ${currencySymbol()}`}
            value={String(floor)}
            onChangeText={(v) => {
              if (Number.isFinite(Number(v)) && Number(v) >= 0)
                A.updateSettings({ safetyFloor: Number(v) })
            }}
            keyboardType="decimal-pad"
          />
          <Copy size={12} muted>
            Projection uses scheduled income and expenses, starting balances,
            and your selected everyday spending average. Actual results will
            vary.
          </Copy>
        </Frame>
      )}
    </Screen>
  )
}
