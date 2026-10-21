import { updateSettings } from "@domain/finance/actions"
import {
  addDays,
  addMonths,
  avgUnplanned,
  compact,
  flowIn,
  monthLabel,
  monthOf,
  monthRange,
  pct,
  project,
  recDay,
  savingsRate,
} from "@domain/finance/calc"
import type { Budget, FinState, PlannedItem } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { dayKey as today } from "@domain/lib/day"
import { privacyStore } from "@domain/lib/privacy"
import { ChevronDown } from "lucide-react-native"
import { type ReactNode, useMemo, useState } from "react"
import { View } from "react-native"
import { Copy, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Button } from "../ui"
import { type AdvisorQuestion, useMoney } from "./finance"
import { BudgetEditor } from "./finance-budget-editor"
import { PlannedEditor } from "./finance-planned-editor"

type Editor =
  | { kind: "planned"; prefill: Partial<PlannedItem> }
  | { kind: "budget"; prefill: Partial<Budget> }
function Money({ value }: { value: number }) {
  const money = useMoney()
  return (
    <Copy size={14} weight="medium">
      {money(value)}
    </Copy>
  )
}
function AnswerChip({
  children,
  onPress,
  accent,
}: {
  children: ReactNode
  onPress: () => void
  accent?: string
}) {
  const t = useTheme()
  return (
    <Tap
      onPress={onPress}
      style={{
        minHeight: 32,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: accent ? t.fin : t.line,
        backgroundColor: accent ? `${t.fin}26` : t.card,
      }}
    >
      <Copy size={12} style={{ color: accent ? t.fin : t.text }}>
        {children}
      </Copy>
    </Tap>
  )
}
function AnswerLink({ href, children }: { href: string; children: ReactNode }) {
  return <AnswerChip onPress={() => go(href)}>{children}</AnswerChip>
}
function Lesson({ children }: { children: ReactNode }) {
  const t = useTheme()
  return (
    <View
      style={{
        marginTop: 12,
        borderWidth: 1,
        borderColor: `${t.fin}4d`,
        borderRadius: 12,
        padding: 10,
        backgroundColor: `${t.fin}0d`,
      }}
    >
      <Copy size={12}>
        <Copy size={12} weight="semibold" style={{ color: t.fin }}>
          Lesson ·{" "}
        </Copy>
        {children}
      </Copy>
    </View>
  )
}
function Working({ rows }: { rows: [string, ReactNode][] }) {
  const t = useTheme(),
    [open, setOpen] = useState(false)
  return (
    <View
      style={{
        marginTop: 12,
        borderRadius: 12,
        backgroundColor: t.soft,
        padding: 10,
        gap: 8,
      }}
    >
      <Tap onPress={() => setOpen(!open)}>
        <Line style={{ justifyContent: "space-between" }}>
          <Copy size={12} muted>
            Numbers I used
          </Copy>
          <ChevronDown
            size={14}
            color={t.muted}
            style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}
          />
        </Line>
      </Tap>
      {open &&
        rows.map(([k, v]) => (
          <Line key={k} style={{ justifyContent: "space-between" }}>
            <Copy size={12} muted>
              {k}
            </Copy>
            <Copy size={12}>{v}</Copy>
          </Line>
        ))}
    </View>
  )
}
export function AdvisorAnswer({
  question,
  scope,
  onAllow,
}: {
  question: AdvisorQuestion
  scope: "aggregates" | "records"
  onAllow: () => void
}) {
  const [editor, setEditor] = useState<Editor>()
  if (question.key === "leaks" && scope === "aggregates")
    return (
      <>
        <Copy size={14}>
          To find repeat spending I need individual transactions. Your current
          setting shares totals only.
        </Copy>
        <Button onPress={onAllow}>Allow records for this answer</Button>
      </>
    )
  return (
    <View style={{ gap: 8 }}>
      <Answer p={question} openSheet={setEditor} />
      {editor?.kind === "planned" && (
        <PlannedEditor
          open
          prefill={editor.prefill}
          onClose={() => setEditor(undefined)}
        />
      )}{" "}
      {editor?.kind === "budget" && (
        <BudgetEditor
          prefill={editor.prefill}
          onClose={() => setEditor(undefined)}
        />
      )}
    </View>
  )
}
function useCtx(s: FinState) {
  return useMemo(() => {
    const t = today()
    const mk = monthOf(t, 1)
    let spend = 0
    let income = 0
    for (let i = 1; i <= 3; i++) {
      const [f, to] = monthRange(addMonths(mk, -i), 1)
      const fl = flowIn(s, f, to)
      spend += fl.spend
      income += fl.income
    }
    const base = project(s, { horizon: 12, includeUnplanned: true })
    return {
      avgSpend: spend / 3,
      avgIncome: income / 3,
      base,
      avgU: avgUnplanned(s),
      mk,
    }
  }, [s])
}

function Answer({
  p,
  openSheet,
}: {
  p: AdvisorQuestion
  openSheet: (value: Editor) => void
}) {
  const theme = useTheme()
  const s = finStore.use((s) => s)
  const router = { push: go }
  const ctx = useCtx(s)
  const hidden = privacyStore.use((x) => x.hidden)
  const k = (n: number) => (hidden ? "₱•••" : compact(n))
  const floor = s.settings.safetyFloor
  const runway = ctx.avgSpend ? ctx.base.start / ctx.avgSpend : 0

  switch (p.key) {
    case "afford": {
      const amount = p.amount ?? 45000
      const month = p.month ?? `${ctx.mk.slice(0, 4)}-12`
      const n = (p.n ?? 1) > 1 ? (p.n ?? 12) : 1
      const w = project(s, {
        horizon: 12,
        includeUnplanned: true,
        whatIf: { amount, month, installments: n },
      })
      const ok = w.low.value >= floor
      const neg = w.low.value < 0
      const later = addMonths(month, 2)
      return (
        <>
          <Copy size={14}>
            {neg
              ? "Not yet."
              : ok
                ? "Yes — comfortably."
                : "Yes, but it's tight."}{" "}
            Buying a {p.name ?? "purchase"} for <Money value={amount} /> in{" "}
            {monthLabel(month, true)}
            {n > 1 ? ` on ${n}× 0%` : ""} takes your lowest balance to{" "}
            <Money value={w.low.value} /> ({monthLabel(w.low.key)}).{" "}
            {ok
              ? `That stays above your ${k(floor)} minimum balance.`
              : neg
                ? "You'd go negative."
                : `That's under your ${k(floor)} minimum balance.`}
          </Copy>
          <Copy size={14}>
            <Copy size={14} weight="semibold">
              My suggestion:
            </Copy>{" "}
            {ok
              ? `Go ahead, but pay from BPI Savings in one go — you recover in about ${w.recoveryMonths ?? "a few"} months.`
              : neg
                ? `Wait until ${monthLabel(later, true)} or split it over 12× 0%, which keeps you above zero.`
                : `Either push it to ${monthLabel(later)} or use 0% installments so you stay above your minimum.`}
          </Copy>
          <Lesson>
            A purchase is comfortable when your cash never dips below ~3 months
            of expenses. Yours is about {k(ctx.avgSpend * 3)}.
          </Lesson>
          <Working
            rows={[
              ["Available now", <Money key="a" value={ctx.base.start} />],
              ["Avg left over / month", k(ctx.base.avgSurplus)],
              ["Avg everyday spending", k(ctx.avgU)],
              [
                "Lowest without it",
                <Money key="b" value={ctx.base.low.value} />,
              ],
              ["Lowest with it", <Money key="c" value={w.low.value} />],
              ["Minimum balance", <Money key="d" value={floor} />],
            ]}
          />
          <View
            style={{
              marginTop: 12,
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <AnswerChip
              accent="fin"
              onPress={() =>
                router.push(
                  `/finance/projection?amount=${amount}&month=${month}&name=${encodeURIComponent(p.name ?? "Purchase")}`,
                )
              }
            >
              Add as what-if
            </AnswerChip>
            <AnswerChip
              onPress={() =>
                openSheet({
                  kind: "planned",
                  prefill: {
                    name: p.name ?? "Purchase",
                    type: "expense",
                    amount,
                    categoryId: "shopping",
                    accountId: "bpi",
                    schedule: { kind: "once", date: `${month}-15` },
                  },
                })
              }
            >
              Save to plan
            </AnswerChip>
          </View>
        </>
      )
    }
    case "finance": {
      const amount = p.amount ?? 30000
      const n = p.n ?? 12
      const monthly = Math.round(amount / n)
      const interest = Math.round(amount * 0.04 * (n / 12) * 0.5 * 0.8)
      return (
        <>
          <Copy size={14}>
            At a true 0%, installments are{" "}
            <Copy size={14} weight="semibold">
              slightly better
            </Copy>{" "}
            on paper: <Money value={monthly} />
            /mo for {n} months, and the cash you keep can earn ~4% in a digital
            bank — about {k(interest)} after tax over the term.
          </Copy>
          <Copy size={14}>
            The real risk is behaviour: a missed payment costs ~3%/month plus
            fees, and {n} months of <Money value={monthly} /> eats into the
            {k(ctx.base.avgSurplus)}/mo you have left over.
            {runway >= 3
              ? " Your savings cover 3+ months, so 0% is fine if you set it as a scheduled payment with autopay."
              : " Your savings cover under 3 months — paying cash would leave you exposed, so installments make sense here."}
          </Copy>
          <Lesson>
            “0%” often hides a processing fee or a higher price than cash. Ask
            for the cash price first; if it's lower by more than the interest
            you'd earn, pay cash.
          </Lesson>
          <Working
            rows={[
              ["Price", <Money key="a" value={amount} />],
              ["Monthly", <Money key="b" value={monthly} />],
              ["Interest kept (≈4% p.a., 20% tax)", k(interest)],
              ["Months you could cover", `${runway.toFixed(1)} months`],
            ]}
          />
          <View
            style={{
              marginTop: 12,
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <AnswerChip
              accent="fin"
              onPress={() =>
                openSheet({
                  kind: "planned",
                  prefill: {
                    name: "Phone — 0% installment",
                    type: "transfer",
                    amount: monthly,
                    accountId: "bpi",
                    toAccountId: "bpicc",
                    isInstallment: true,
                    schedule: { kind: "monthly", day: 8 },
                    end: { kind: "count", n },
                  },
                })
              }
            >
              Add installment plan
            </AnswerChip>
            <AnswerChip
              onPress={() =>
                router.push(`/finance/projection?amount=${amount}&name=Phone`)
              }
            >
              Compare in projection
            </AnswerChip>
          </View>
        </>
      )
    }
    case "leaks": {
      const from = addDays(today(), -30)
      const m = new Map<string, { n: number; v: number }>()
      for (const r of s.records) {
        if (r.type !== "expense" || recDay(r) < from || !r.payee || r.plannedId)
          continue
        const c = s.categories.find((x) => x.id === r.categoryId)
        if (!c?.discretionary) continue
        const cur = m.get(r.payee) ?? { n: 0, v: 0 }
        m.set(r.payee, { n: cur.n + 1, v: cur.v + r.amount })
      }
      const top = [...m.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 4)
      const subs = s.planned
        .filter((x) => x.categoryId === "subs" && !x.archived)
        .reduce((a, x) => a + x.amount, 0)
      return (
        <>
          <Copy size={14}>
            Looking at the last 30 days of transactions, these small repeats add
            up the most:
          </Copy>
          <View style={{ marginTop: 8, gap: 4 }}>
            {top.map(([name, x]) => (
              <View
                key={name}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  backgroundColor: theme.soft,
                }}
              >
                <Copy size={12}>
                  {name} ×{x.n}
                </Copy>
                <Copy size={12}>
                  <Money value={x.v} /> · {k(x.v * 12)}/yr
                </Copy>
              </View>
            ))}
          </View>
          <Copy size={14}>
            <Copy size={14} weight="semibold">
              Suggestion:
            </Copy>{" "}
            {top[0]
              ? `cap ${top[0][0]} at half its current pace`
              : "keep going"}{" "}
            and review subscriptions (<Money value={subs} />
            /mo) — cancelling one unused service is the easiest win.
          </Copy>
          <Lesson>
            Leaks are frequent, small, and feel free. Budgeting the category
            (not banning it) keeps it enjoyable.
          </Lesson>
          <View
            style={{
              marginTop: 12,
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <AnswerChip
              accent="fin"
              onPress={() =>
                openSheet({
                  kind: "budget",
                  prefill: {
                    name: "Coffee & treats",
                    categoryIds: ["coffee"],
                    limit: 1500,
                  },
                })
              }
            >
              Create budget
            </AnswerChip>
            <AnswerLink href="/finance/review">Open monthly review</AnswerLink>
          </View>
        </>
      )
    }
    case "emergency": {
      const target3 = ctx.avgSpend * 3
      const target6 = ctx.avgSpend * 6
      return (
        <>
          <Copy size={14}>
            You spend about <Money value={ctx.avgSpend} /> a month. Your
            available cash is <Money value={ctx.base.start} /> — enough to cover{" "}
            <Copy size={14} weight="semibold">
              {runway.toFixed(1)} months
            </Copy>
            .
          </Copy>
          <Copy size={14}>
            With two income sources, 3 months ({k(target3)}) is a reasonable
            minimum; 6 months ({k(target6)}) if either job feels shaky.{" "}
            {runway >= 3
              ? "You're there — extra savings can start working harder."
              : `Saving ${k(ctx.base.avgSurplus)}/mo, you'd reach 3 months in about ${Math.max(1, Math.ceil((target3 - ctx.base.start) / Math.max(1, ctx.base.avgSurplus)))} months.`}
          </Copy>
          <Lesson>
            Keep the emergency fund boring and reachable — a high-yield savings
            account, not stocks or MP2.
          </Lesson>
          <Working
            rows={[
              [
                "Avg monthly spend (3 mo)",
                <Money key="a" value={ctx.avgSpend} />,
              ],
              ["Available now", <Money key="b" value={ctx.base.start} />],
              ["3-month target", <Money key="c" value={target3} />],
            ]}
          />
          <View style={{ marginTop: 12 }}>
            <AnswerChip
              accent="fin"
              onPress={() =>
                updateSettings({
                  safetyFloor: Math.round(target3 / 1000) * 1000,
                })
              }
            >
              Set minimum to 3 months
            </AnswerChip>
          </View>
        </>
      )
    }
    case "invest": {
      const surplus = ctx.base.avgSurplus
      return (
        <>
          <Copy size={14}>
            Your plan leaves about {k(surplus)}/mo left over and you already
            send <Money value={3000} /> to COL monthly. Two common options in
            the Philippines:
          </Copy>
          <View style={{ paddingLeft: 20, gap: 4, marginTop: 8 }}>
            <Copy size={12}>
              •
              <Copy size={14} weight="semibold">
                Pag-IBIG MP2
              </Copy>{" "}
              — government-backed, dividends historically ~6–7%, tax-free,
              5-year lock-in. Good for money you won't touch.
            </Copy>
            <Copy size={12}>
              •
              <Copy size={14} weight="semibold">
                Index funds / ETFs (via COL)
              </Copy>{" "}
              — market returns, can drop 20–30% in a bad year. Good for 5+ year
              money, added monthly.
            </Copy>
          </View>
          <Copy size={14}>
            <Copy size={14} weight="semibold">
              Order that usually works:
            </Copy>{" "}
            emergency fund first ({runway >= 3 ? "done ✓" : "not yet"}), then
            split what's left over — e.g. half MP2, half index funds.
          </Copy>
          <Lesson>
            Automate it on payday. Money that sits in GCash tends to get spent.
          </Lesson>
          <View style={{ marginTop: 12 }}>
            <AnswerChip
              accent="fin"
              onPress={() =>
                openSheet({
                  kind: "planned",
                  prefill: {
                    name: "MP2 savings",
                    type: "transfer",
                    amount: 5000,
                    accountId: "bpi",
                    toAccountId: "col",
                    schedule: { kind: "monthly", day: 16 },
                  },
                })
              }
            >
              Plan a monthly transfer
            </AnswerChip>
          </View>
        </>
      )
    }
    case "review": {
      const period = p.period ?? addMonths(ctx.mk, -1)
      const [f, t] = monthRange(period, s.settings.monthStartDay)
      const fl = flowIn(s, f, t)
      const top = [...fl.byCat.entries()].sort((a, b) => b[1] - a[1])[0]
      const cat = s.categories.find((c) => c.id === top?.[0])
      return (
        <>
          <Copy size={14}>
            In {monthLabel(period, true)} you earned <Money value={fl.income} />
            , spent <Money value={fl.spend} /> and kept{" "}
            <Copy size={14} weight="semibold">
              {pct(savingsRate(fl))}
            </Copy>
            . {cat?.name} was the biggest bucket at{" "}
            <Money value={top?.[1] ?? 0} />.
          </Copy>
          <Copy size={14}>
            <Copy size={14} weight="semibold">
              One change:
            </Copy>{" "}
            set a weekly cap on {cat?.name?.toLowerCase()} and check it on
            Sundays. Weekly limits are easier to feel than monthly ones.
          </Copy>
          <Lesson>
            Savings rate beats raw savings as a scorecard — it survives raises
            and bonuses.
          </Lesson>
          <View style={{ marginTop: 12 }}>
            <AnswerLink href={`/finance/review?period=${period}`}>
              Open the full review
            </AnswerLink>
          </View>
        </>
      )
    }
    default:
      return (
        <Copy size={14}>
          I can help with: whether you can afford something, financing vs paying
          cash, where money leaks, emergency funds, and investing basics (MP2,
          index funds). I work from your own numbers and show my working — try
          one of the suggestions below.
        </Copy>
      )
  }
}
