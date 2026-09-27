"use client"

import {
  AlertTriangle,
  Bot,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  Sparkles,
  X,
} from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { privacyStore } from "../../lib/privacy"
import {
  Btn,
  Card,
  Chip,
  Empty,
  Money,
  NumberInput,
  Screen,
  SectionTitle,
  Segmented,
  Stat,
} from "../../ui/kit"
import { addPlanned, updateSettings } from "../actions"
import {
  addMonths,
  balances,
  compact,
  monthLabel,
  monthOf,
  monthRange,
  project,
  recDay,
  today,
  type WhatIf,
} from "../calc"
import { useFin } from "../store"
import {
  ChipRow,
  Field,
  inputCls,
  LineChart,
  Pill,
  Toggle,
  useDemoState,
} from "../ui"

const QUICK = [10000, 25000, 45000, 100000]

export function ProjectionScreen() {
  const s = useFin()
  const sp = useSearchParams()
  const router = useRouter()
  const demo = useDemoState()
  const hidden = privacyStore.use((x) => x.hidden)
  const cur = monthOf(today(), 1)
  const [whatOpen, setWhatOpen] = useState(sp.has("whatif") || sp.has("amount"))
  const [name, setName] = useState(sp.get("name") ?? "New laptop")
  const [amount, setAmount] = useState(sp.get("amount") ?? "45000")
  const [month, setMonth] = useState(sp.get("month") ?? addMonths(cur, 3))
  const [mode, setMode] = useState<"lump" | "inst">("lump")
  const [n, setN] = useState(12)
  const [acct, setAcct] = useState("bpi")
  const [exclAccts, setExclAccts] = useState<string[]>([])
  const [assump, setAssump] = useState(false)
  const horizon = s.settings.horizon
  const whatIf: WhatIf | null =
    whatOpen && Number(amount) > 0
      ? { amount: Number(amount), month, installments: mode === "inst" ? n : 1 }
      : null

  const proj = useMemo(
    () =>
      project(s, {
        horizon,
        includeUnplanned:
          demo === "error" ? false : s.settings.includeUnplanned,
        excludedPlanned: s.settings.projExcludedPlanned,
        excludedAccounts: exclAccts,
        whatIf:
          whatOpen && Number(amount) > 0
            ? {
                amount: Number(amount),
                month,
                installments: mode === "inst" ? n : 1,
              }
            : null,
      }),
    [s, horizon, exclAccts, whatOpen, amount, month, mode, n, demo],
  )
  const bal = useMemo(() => balances(s), [s])
  const avgExpense = useMemo(() => {
    let sum = 0
    for (let i = 1; i <= 3; i++) {
      const [f, t] = monthRange(addMonths(cur, -i), 1)
      for (const r of s.records) {
        const k = recDay(r)
        if (r.type === "expense" && !r.isAdjustment && k >= f && k <= t)
          sum += r.amount
      }
    }
    return sum / 3
  }, [s, cur])
  const drafts = s.planned.filter((p) => p.isWhatIf && !p.archived)

  if (demo === "empty" || !proj.hasIncome)
    return (
      <Screen title="Projection" back>
        <Empty
          icon={<CalendarPlus className="size-10" />}
          title="Add your income to see the future"
          body="The projection needs at least one scheduled income — like your 15th & 30th salary. No fake forecasts."
          action={
            <Btn accent="fin" href="/finance/planned?state=empty">
              Add salary
            </Btn>
          }
        />
      </Screen>
    )

  const last = proj.months[proj.months.length - 1]
  const floor = s.settings.safetyFloor
  const labels = ["Now", ...proj.months.map((m) => monthLabel(m.key))]
  const base = [proj.start, ...proj.months.map((m) => m.endBase)]
  const scen = [proj.start, ...proj.months.map((m) => m.end)]
  const verdict = !whatIf
    ? null
    : proj.low.value < 0
      ? "no"
      : proj.low.value < floor
        ? "tight"
        : "ok"
  const liquidNow = proj.start
  const runway = avgExpense ? liquidNow / avgExpense : 0
  const monthsAhead = Array.from({ length: 12 }, (_, i) => addMonths(cur, i))

  const savePlanned = (draft: boolean) => {
    const amt = Number(amount)
    const [y, m] = month.split("-")
    const date = `${y}-${m}-15`
    addPlanned({
      name: name || "Planned purchase",
      type: mode === "inst" ? "transfer" : "expense",
      amount: mode === "inst" ? Math.round(amt / n) : amt,
      estimated: false,
      accountId: mode === "inst" ? "bpi" : acct,
      toAccountId: mode === "inst" ? "bpicc" : undefined,
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
    setWhatOpen(false)
  }

  return (
    <Screen
      title="Projection"
      back
      actions={
        <Link
          href="/finance/advisor?ask=runway"
          aria-label="Ask advisor"
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <Bot className="size-5" />
        </Link>
      }
    >
      {demo === "error" && (
        <div className="mb-3 flex gap-2 rounded-xl bg-warn/15 px-3 py-2.5 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Not enough history to average your everyday spending yet — showing
          scheduled payments only, which overstates savings.
        </div>
      )}
      <Segmented
        value={String(horizon) as "6" | "12" | "24"}
        onChange={(v) => updateSettings({ horizon: Number(v) as 6 | 12 | 24 })}
        options={[
          { value: "6", label: "6 mo" },
          { value: "12", label: "12 mo" },
          { value: "24", label: "24 mo" },
        ]}
      />

      <Card className="mt-3 px-3 pb-2">
        <div className="flex items-start justify-between px-1">
          <div>
            <div className="text-muted-foreground text-xs">
              Available money by {last ? monthLabel(last.key, true) : ""}
            </div>
            <Money
              value={last?.end ?? proj.start}
              className="font-semibold text-3xl tracking-tight"
            />
            {whatIf && last && (
              <div className="text-muted-foreground text-xs">
                vs <Money value={last.endBase} /> without it
              </div>
            )}
          </div>
          <div className="text-right text-xs">
            <div className="text-muted-foreground">Avg left over</div>
            <div
              className={cn(
                "num font-semibold",
                proj.avgSurplus >= 0 ? "text-good" : "text-bad",
              )}
            >
              {hidden
                ? "₱•••"
                : `${proj.avgSurplus >= 0 ? "+" : ""}${compact(proj.avgSurplus)}`}
              /mo
            </div>
            <div className="mt-1 text-muted-foreground">Lowest point</div>
            <div
              className={cn(
                "font-semibold",
                proj.low.value < floor && "text-warn",
              )}
            >
              <Money value={proj.low.value} /> · {monthLabel(proj.low.key)}
            </div>
          </div>
        </div>
        <LineChart
          series={[
            { values: base, tone: whatIf ? "muted" : "fin", area: !whatIf },
            ...(whatIf
              ? [
                  {
                    values: scen,
                    tone: (verdict === "ok"
                      ? "fin"
                      : verdict === "tight"
                        ? "warn"
                        : "bad") as "fin" | "warn" | "bad",
                    area: true,
                  },
                ]
              : []),
          ]}
          labels={labels}
          floor={floor}
          height={190}
        />
        <div className="flex gap-4 px-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span
              className={cn(
                "h-0.5 w-4",
                whatIf ? "bg-muted-foreground" : "bg-fin",
              )}
            />{" "}
            Baseline
          </span>
          {whatIf && (
            <span className="flex items-center gap-1">
              <span className="h-0.5 w-4 bg-fin" /> With {name || "purchase"}
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-4 border-warn border-t border-dashed" />{" "}
            Minimum balance
          </span>
        </div>
      </Card>

      <Card className="mt-3 py-1">
        <Toggle
          checked={s.settings.includeUnplanned && demo !== "error"}
          onChange={(v) => updateSettings({ includeUnplanned: v })}
          label="Include average everyday spending"
          hint={
            <>
              Food, Grab, shopping… 3-month average of{" "}
              <Money value={proj.avgUnplanned} />
              /mo. Off = planned items only (optimistic).
            </>
          }
        />
      </Card>

      {/* FIN-24 what-if */}
      {!whatOpen ? (
        <Btn
          accent="fin"
          className="mt-3 h-12 w-full text-base"
          onClick={() => setWhatOpen(true)}
        >
          <Sparkles className="size-5" /> What if I buy…
        </Btn>
      ) : (
        <Card className="mt-3 border-fin/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold">
              <Sparkles className="size-4 text-fin" /> Plan a purchase
            </div>
            <button
              type="button"
              aria-label="Close what-if"
              onClick={() => setWhatOpen(false)}
              className="grid size-8 place-items-center rounded-full hover:bg-muted"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Item">
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Price ₱">
              <NumberInput
                inputMode="decimal"
                className={inputCls}
                value={amount}
                onChange={(e) =>
                  setAmount(e.target.value.replace(/[^\d]/g, ""))
                }
              />
            </Field>
          </div>
          <ChipRow>
            {QUICK.map((q) => (
              <Chip
                key={q}
                accent="fin"
                active={Number(amount) === q}
                onClick={() => setAmount(String(q))}
                className="h-8"
              >
                {compact(q)}
              </Chip>
            ))}
          </ChipRow>
          <Field label="When">
            <ChipRow>
              {monthsAhead.map((mk) => (
                <Chip
                  key={mk}
                  accent="fin"
                  active={month === mk}
                  onClick={() => setMonth(mk)}
                  className="h-8"
                >
                  {monthLabel(mk)}
                  {mk.slice(0, 4) !== cur.slice(0, 4) && ` '${mk.slice(2, 4)}`}
                </Chip>
              ))}
            </ChipRow>
          </Field>
          <Field label="How">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: "lump", label: "Pay in full" },
                { value: "inst", label: "0% installments" },
              ]}
            />
            {mode === "inst" ? (
              <div className="mt-2 flex items-center gap-2">
                {[3, 6, 12, 24].map((x) => (
                  <Chip
                    key={x}
                    accent="fin"
                    active={n === x}
                    onClick={() => setN(x)}
                    className="h-8"
                  >
                    {x}×
                  </Chip>
                ))}
                <span className="ml-auto text-muted-foreground text-xs">
                  <Money value={Math.round(Number(amount || 0) / n)} />
                  /mo on BPI card
                </span>
              </div>
            ) : (
              <div className="mt-2">
                <ChipRow>
                  {s.accounts
                    .filter((a) => a.inProjection && !a.archived)
                    .map((a) => (
                      <Chip
                        key={a.id}
                        accent="fin"
                        active={acct === a.id}
                        onClick={() => setAcct(a.id)}
                        className="h-8"
                      >
                        {a.name}
                      </Chip>
                    ))}
                </ChipRow>
              </div>
            )}
          </Field>

          {whatIf && (
            <div
              className={cn(
                "mt-2 rounded-2xl p-3",
                verdict === "ok"
                  ? "bg-good/10"
                  : verdict === "tight"
                    ? "bg-warn/10"
                    : "bg-bad/10",
              )}
            >
              <div
                className={cn(
                  "flex items-center gap-2 font-semibold",
                  verdict === "ok"
                    ? "text-good"
                    : verdict === "tight"
                      ? "text-warn"
                      : "text-bad",
                )}
              >
                {verdict === "ok" ? (
                  <CheckCircle2 className="size-5" />
                ) : (
                  <AlertTriangle className="size-5" />
                )}
                {verdict === "ok"
                  ? "Affordable"
                  : verdict === "tight"
                    ? "Affordable, but dips below your minimum balance"
                    : "Not affordable — you'd go negative"}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-muted-foreground">New low</div>
                  <Money value={proj.low.value} className="font-semibold" />
                  <div className="text-muted-foreground">
                    {monthLabel(proj.low.key)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Recovers in</div>
                  <div className="font-semibold">
                    {mode === "inst"
                      ? "—"
                      : proj.recoveryMonths === null
                        ? `>${horizon} mo`
                        : `${proj.recoveryMonths} mo`}
                  </div>
                  <div className="text-muted-foreground">
                    {mode === "inst" ? "spread out" : "to pre-buy level"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">End balance</div>
                  <Money value={last?.end ?? 0} className="font-semibold" />
                  <div className="text-muted-foreground">
                    −
                    {hidden
                      ? "₱•••"
                      : compact((last?.endBase ?? 0) - (last?.end ?? 0))}
                  </div>
                </div>
              </div>
              {proj.low.value < floor && (
                <div className="mt-2 text-xs">
                  Your safety floor is <Money value={floor} />.{" "}
                  {verdict === "tight"
                    ? "Try a later month or installments."
                    : "Consider installments or saving first."}
                </div>
              )}
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Btn
              accent="fin"
              disabled={!whatIf}
              onClick={() => savePlanned(false)}
            >
              Save as scheduled
            </Btn>
            <Btn
              variant="secondary"
              disabled={!whatIf}
              onClick={() => savePlanned(true)}
            >
              Save as draft
            </Btn>
            <Btn variant="ghost" onClick={() => setWhatOpen(false)}>
              Discard
            </Btn>
            <Btn
              variant="secondary"
              disabled={!whatIf}
              onClick={() =>
                router.push(
                  `/finance/advisor?ask=afford&amount=${amount}&month=${month}&name=${encodeURIComponent(name)}&mode=${mode}&n=${n}`,
                )
              }
            >
              <Bot className="size-4" /> Ask advisor
            </Btn>
          </div>
        </Card>
      )}

      {drafts.length > 0 && (
        <>
          <SectionTitle>What-if drafts</SectionTitle>
          <ChipRow>
            {drafts.map((p) => (
              <Chip
                key={p.id}
                onClick={() => {
                  setName(p.name.replace(" (draft)", ""))
                  setAmount(String(p.amount))
                  if (p.schedule.kind === "once")
                    setMonth(p.schedule.date.slice(0, 7))
                  setMode("lump")
                  setWhatOpen(true)
                }}
              >
                {p.name} · {hidden ? "₱•••" : compact(p.amount)}
              </Chip>
            ))}
          </ChipRow>
        </>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Card>
          <Stat label="Available now" value={<Money value={liquidNow} />} />
        </Card>
        <Card>
          <Stat
            label="Months you could cover"
            value={`${runway.toFixed(1)} mo`}
            accent={runway >= 3 ? "fin" : undefined}
          />
          <div
            className={cn(
              "text-[11px]",
              runway >= 3
                ? "text-good"
                : runway >= 1
                  ? "text-warn"
                  : "text-bad",
            )}
          >
            {runway >= 3
              ? "≥ 3 months — healthy"
              : runway >= 1
                ? "Aim for 3 months"
                : "Under 1 month"}
          </div>
        </Card>
      </div>

      <SectionTitle>Left over each month</SectionTitle>
      <Card className="overflow-x-auto p-0">
        <table className="num w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-border/60 border-b">
              <th className="px-3 py-2 text-left font-medium">Month</th>
              <th className="px-2 py-2 text-right font-medium">In</th>
              <th className="px-2 py-2 text-right font-medium">Out</th>
              <th className="px-2 py-2 text-right font-medium">Net</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {proj.months.map((m, i) => (
              <tr
                key={m.key}
                className={cn(
                  "border-border/40 border-b last:border-0",
                  m.whatIf > 0 && "bg-fin/5",
                )}
              >
                <td className="px-3 py-2">
                  {monthLabel(m.key)}
                  {i === 0 && (
                    <span className="text-muted-foreground"> (rest)</span>
                  )}
                  {m.whatIf > 0 && <span className="text-fin"> •</span>}
                </td>
                <td className="px-2 py-2 text-right text-good">
                  {hidden ? "•••" : compact(m.inflow)}
                </td>
                <td className="px-2 py-2 text-right">
                  {hidden ? "•••" : compact(m.planned + m.unplanned + m.whatIf)}
                </td>
                <td
                  className={cn(
                    "px-2 py-2 text-right font-medium",
                    m.net < 0 ? "text-bad" : "text-good",
                  )}
                >
                  {hidden ? "•••" : `${m.net >= 0 ? "+" : ""}${compact(m.net)}`}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right",
                    m.end < floor && "text-warn",
                    m.end < 0 && "text-bad",
                  )}
                >
                  {hidden ? "•••" : compact(m.end)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <button
        type="button"
        onClick={() => setAssump(!assump)}
        className="mt-4 flex w-full items-center justify-between px-1 text-left"
      >
        <span className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
          Assumptions
        </span>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            assump && "rotate-180",
          )}
        />
      </button>
      {assump && (
        <Card className="mt-2">
          <div className="font-medium text-sm">
            Starting from (cash & bank accounts)
          </div>
          {s.accounts
            .filter((a) => a.inProjection && !a.archived)
            .map((a) => (
              <Toggle
                key={a.id}
                checked={!exclAccts.includes(a.id)}
                onChange={(v) =>
                  setExclAccts((x) =>
                    v ? x.filter((y) => y !== a.id) : [...x, a.id],
                  )
                }
                label={a.name}
                hint={<Money value={bal[a.id]} />}
              />
            ))}
          <div className="mt-3 font-medium text-sm">Planned items</div>
          {s.planned
            .filter((p) => !p.archived && !p.isWhatIf && p.inProjection)
            .map((p) => {
              const on = !s.settings.projExcludedPlanned.includes(p.id)
              return (
                <Toggle
                  key={p.id}
                  checked={on}
                  onChange={(v) =>
                    updateSettings({
                      projExcludedPlanned: v
                        ? s.settings.projExcludedPlanned.filter(
                            (x) => x !== p.id,
                          )
                        : [...s.settings.projExcludedPlanned, p.id],
                    })
                  }
                  label={p.name}
                  hint={
                    <>
                      {p.type === "income" ? "+" : "−"}
                      <Money value={p.amount} />
                    </>
                  }
                />
              )
            })}
          <div className="mt-3 space-y-1 text-muted-foreground text-xs">
            <p>
              • Credit card spending is assumed paid in full monthly; 0%
              installments count as they fall due.
            </p>
            <p>
              • Everyday spending: 3-month average of expenses not linked to a
              scheduled payment (<Money value={proj.avgUnplanned} />
              /mo).
            </p>
            <p>
              • Minimum balance <Money value={floor} /> —{" "}
              <Link href="/finance/settings" className="text-fin">
                change
              </Link>
              .
            </p>
          </div>
          <Pill className="mt-2">
            Investments (COL) are excluded — not spendable cash
          </Pill>
        </Card>
      )}
    </Screen>
  )
}
