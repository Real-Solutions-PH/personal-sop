"use client"

import {
  Award,
  Bot,
  CalendarClock,
  Droplets,
  Share2,
  Sparkles,
  ThumbsDown,
  Trophy,
} from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { privacyStore } from "../../lib/privacy"
import {
  Bar,
  Btn,
  Card,
  Chip,
  Empty,
  Heatmap,
  Money,
  Screen,
  SectionTitle,
  Stat,
} from "../../ui/kit"
import { saveLookBack } from "../actions"
import {
  addDays,
  addMonths,
  budgetView,
  catMap,
  compact,
  diffDays,
  flowIn,
  monthLabel,
  monthOf,
  monthRange,
  noSpendDays,
  pct,
  recDay,
  savingsRate,
  shortDate,
  today,
} from "../calc"
import type { FinState } from "../data"
import { openSheet } from "../sheets"
import { useFin } from "../store"
import {
  ChipRow,
  FinSheet,
  inputCls,
  NotAdvice,
  Pill,
  useDemoState,
} from "../ui"

function lookback(
  s: FinState,
  from: string,
  to: string,
  prevFrom: string,
  prevTo: string,
) {
  const cats = catMap(s)
  const flow = flowIn(s, from, to)
  const prev = flowIn(s, prevFrom, prevTo)
  // trailing 3-period average spend
  const len = diffDays(to, from) + 1
  let base = 0
  for (let i = 1; i <= 3; i++)
    base += flowIn(
      s,
      addDays(from, -len * i),
      addDays(from, -len * (i - 1) - 1),
    ).spend
  base /= 3
  const rate = savingsRate(flow)
  const prevRate = savingsRate(prev)
  const ns = noSpendDays(s, from, to)
  const sd = s.settings.monthStartDay
  const mk = monthOf(from, sd)
  const isMonth = monthRange(mk, sd)[0] === from
  const budgets = s.budgets
    .filter((b) => !b.archived)
    .map((b) => (isMonth ? budgetView(s, b, mk) : null))
    .filter((x) => x !== null)
  const kept = budgets.filter((v) => v.pct <= 1)
  const blown = budgets.filter((v) => v.pct > 1)
  const where = [...flow.byCat.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, v]) => ({
      id,
      v,
      prev: prev.byCat.get(id) ?? 0,
      cat: cats.get(id),
    }))
  const spikes = where.filter((w) => w.prev > 500 && w.v > w.prev * 1.25)
  const inRange = s.records.filter((r) => {
    const k = recDay(r)
    return k >= from && k <= to
  })
  const big = inRange.filter(
    (r) => r.type === "expense" && !r.plannedId && r.amount >= 5000,
  )
  // leaks: frequent small discretionary spends by payee
  const byPayee = new Map<string, { n: number; v: number; cat?: string }>()
  for (const r of inRange) {
    if (r.type !== "expense" || !r.payee || r.amount > 1000) continue
    if (!cats.get(r.categoryId ?? "")?.discretionary) continue
    const cur = byPayee.get(r.payee) ?? { n: 0, v: 0, cat: r.categoryId }
    byPayee.set(r.payee, { n: cur.n + 1, v: cur.v + r.amount, cat: cur.cat })
  }
  const leaks = [...byPayee.entries()]
    .filter(([, x]) => x.n >= 4)
    .sort((a, b) => b[1].v - a[1].v)
    .slice(0, 4)
  const subs = inRange
    .filter((r) => r.categoryId === "subs")
    .reduce((x, r) => x + r.amount, 0)
  const imported = inRange.filter((r) => r.source === "import").length
  const completeness = inRange.length ? 1 - imported / inRange.length : 1
  const topShare = where[0] ? where[0].v / Math.max(1, flow.spend) : 0
  return {
    flow,
    prev,
    base,
    rate,
    prevRate,
    ns,
    budgets,
    kept,
    blown,
    where,
    spikes,
    big,
    leaks,
    subs,
    completeness,
    topShare,
    cats,
    len,
  }
}

export function ReviewScreen() {
  const s = useFin()
  const sp = useSearchParams()
  const router = useRouter()
  const demo = useDemoState()
  const hidden = privacyStore.use((x) => x.hidden)
  const sd = s.settings.monthStartDay
  const curMonth = monthOf(today(), sd)
  const custom = sp.get("from") && sp.get("to")
  const period = sp.get("period") ?? addMonths(curMonth, -1)
  const [from, to] = custom
    ? [sp.get("from") as string, sp.get("to") as string]
    : monthRange(period, sd)
  const len = diffDays(to, from) + 1
  const [prevFrom, prevTo] = custom
    ? [addDays(from, -len), addDays(from, -1)]
    : monthRange(addMonths(period, -1), sd)
  const d = useMemo(
    () => lookback(s, from, to, prevFrom, prevTo),
    [s, from, to, prevFrom, prevTo],
  )
  const saved = custom
    ? undefined
    : s.lookbacks.find((l) => l.period === period)
  const [note, setNote] = useState(saved?.note ?? "")
  const [share, setShare] = useState(false)
  useEffect(() => setNote(saved?.note ?? ""), [saved?.note])
  const title = custom
    ? `${shortDate(from)} – ${shortDate(to)}`
    : `${monthLabel(period, true)}`
  const inProgress = to >= today()
  const dataDays = Math.min(len, diffDays(today(), from) + 1)
  const firstRecord = s.records[0] ? recDay(s.records[0]) : today()
  const tooEarly =
    demo === "empty" || dataDays < 14 || diffDays(to, firstRecord) < 14
  const changed =
    saved && Math.round(saved.snapshot.spend) !== Math.round(d.flow.spend)
  const food = d.where.find((w) => w.id === "food")
  const k = (n: number) => (hidden ? "₱•••" : compact(n))

  if (tooEarly)
    return (
      <Screen title="Monthly review" back>
        <Empty
          icon={<CalendarClock className="size-10" />}
          title="Not enough data yet"
          body={`Less than 2 weeks of transactions for ${title}. Your review will be ready on ${shortDate(addDays(from, 14))}.`}
          action={<Btn href="/finance">Back to Finance</Btn>}
        />
      </Screen>
    )

  const suggestions = [
    food &&
      food.v > 0 && {
        key: "food",
        text: `Food was your biggest bucket at ${k(food.v)}. Cap it at ${k(Math.round((food.v * 0.9) / 500) * 500)} next month?`,
        action: "Create budget",
        run: () =>
          openSheet({
            kind: "budget",
            id: s.budgets.find((b) => b.categoryIds?.includes("food"))?.id,
            prefill: {
              name: "Food",
              categoryIds: ["food"],
              limit: Math.round((food.v * 0.9) / 500) * 500,
            },
          }),
      },
    d.leaks[0] && {
      key: "leak",
      text: `${d.leaks[0][0]} ×${d.leaks[0][1].n} added up to ${k(d.leaks[0][1].v)} — about ${k(d.leaks[0][1].v * 12)} a year.`,
      action: "Budget it",
      run: () =>
        openSheet({
          kind: "budget",
          prefill: {
            name: d.leaks[0][0],
            categoryIds: [d.leaks[0][1].cat ?? "coffee"],
            limit: Math.round((d.leaks[0][1].v * 0.6) / 100) * 100,
          },
        }),
    },
    d.rate > 0.2 && {
      key: "invest",
      text: `You saved ${pct(d.rate)}. Auto-move part of what's left over to COL on payday so it doesn't leak.`,
      action: "Schedule it",
      run: () =>
        openSheet({
          kind: "planned",
          prefill: {
            name: "Payday top-up to COL",
            type: "transfer",
            amount: 2000,
            accountId: "bpi",
            toAccountId: "col",
            schedule: { kind: "semimonthly", days: [15, 30] },
          },
        }),
    },
  ].filter(Boolean) as {
    key: string
    text: string
    action: string
    run: () => void
  }[]

  const months = [-3, -2, -1].map((i) => addMonths(curMonth, i))
  const startPad = new Date(`${from}T12:00:00`).getDay()
  const heat = [
    ...Array(startPad).fill(null),
    ...d.ns.days.map((x) => (x.free ? 1 : 0)),
  ]

  return (
    <Screen
      title={`${title} review`}
      back
      actions={
        <button
          type="button"
          aria-label="Share card"
          onClick={() => setShare(true)}
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <Share2 className="size-5" />
        </button>
      }
    >
      {!custom && (
        <ChipRow>
          {months.map((m) => (
            <Chip
              key={m}
              accent="fin"
              active={m === period}
              onClick={() => router.replace(`/finance/review?period=${m}`)}
              className="h-8"
            >
              {monthLabel(m)}
              {s.lookbacks.some((l) => l.period === m) && " ✓"}
            </Chip>
          ))}
          <Chip
            accent="fin"
            active={period === curMonth}
            onClick={() => router.replace(`/finance/review?period=${curMonth}`)}
            className="h-8"
          >
            {monthLabel(curMonth)} so far
          </Chip>
        </ChipRow>
      )}
      {inProgress && (
        <div className="mt-2 rounded-xl bg-muted/60 px-3 py-2 text-muted-foreground text-xs">
          Period still running — numbers will move.
        </div>
      )}
      {changed && (
        <div className="mt-2 rounded-xl bg-warn/10 px-3 py-2 text-warn text-xs">
          Data changed since you saved this review (a backdated transaction or
          import).
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Card className="p-3">
          <Stat
            label="Savings rate"
            value={pct(d.rate)}
            delta={Math.round((d.rate - d.prevRate) * 100)}
            accent={d.rate >= 0 ? "fin" : undefined}
          />
          {d.rate < 0 && (
            <div className="text-[11px] text-bad">
              Spent more than you earned
            </div>
          )}
        </Card>
        <Card className="p-3">
          <Stat label="No-spend days" value={`${d.ns.count}`} accent="fin" />
          <div className="text-[11px] text-muted-foreground">wants only</div>
        </Card>
        <Card className="p-3">
          <Stat
            label="Income"
            value={<Money value={d.flow.income} />}
            delta={
              d.prev.income
                ? Math.round(
                    ((d.flow.income - d.prev.income) / d.prev.income) * 100,
                  )
                : undefined
            }
          />
        </Card>
        <Card className="p-3">
          <Stat
            label="Spent"
            value={<Money value={d.flow.spend} />}
            delta={
              d.prev.spend
                ? Math.round(
                    ((d.flow.spend - d.prev.spend) / d.prev.spend) * 100,
                  )
                : undefined
            }
            goodWhen="down"
          />
          {d.base > 0 && (
            <div
              className={cn(
                "text-[11px]",
                d.flow.spend > d.base ? "text-bad" : "text-good",
              )}
            >
              {d.flow.spend > d.base ? "+" : ""}
              {Math.round((d.flow.spend / d.base - 1) * 100)}% vs 3-period avg
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-3 border-fin/30 bg-fin/5">
        <div className="mb-2 flex items-center gap-2 font-medium text-fin text-sm">
          <Sparkles className="size-4" /> The short version
        </div>
        <p className="text-sm leading-relaxed">
          {d.rate >= 0.25
            ? `A solid ${title}: you kept ${pct(d.rate)} of what you earned. `
            : d.rate >= 0
              ? `A thin month — only ${pct(d.rate)} saved. `
              : `You spent more than you earned this period. `}
          {d.big[0]
            ? `One unplanned big purchase (${d.big[0].payee}, ${k(d.big[0].amount)}) did most of the damage. `
            : "No surprise big purchases. "}
          {d.where[0] &&
            `${d.where[0].cat?.name} took ${pct(d.topShare)} of spending`}
          {d.spikes[0]
            ? `, and ${d.spikes[0].cat?.name} jumped ${Math.round((d.spikes[0].v / d.spikes[0].prev - 1) * 100)}% vs last month.`
            : "."}
        </p>
        <NotAdvice className="mt-2" />
      </Card>

      <SectionTitle>Where it went</SectionTitle>
      <Card className="space-y-3">
        {d.where.slice(0, 7).map((w) => {
          const dl = w.prev ? Math.round((w.v / w.prev - 1) * 100) : null
          return (
            <Link
              key={w.id}
              href={`/finance/records?cat=${w.id}&from=${from}&to=${to}`}
              className="block"
            >
              <div className="mb-1 flex items-center justify-between text-sm">
                <span>
                  {w.cat?.icon} {w.cat?.name ?? "Other"}
                </span>
                <span className="flex items-center gap-2">
                  {dl !== null && (
                    <span
                      className={cn(
                        "num text-[11px]",
                        dl > 0 ? "text-bad" : "text-good",
                      )}
                    >
                      {dl > 0 ? "▲" : "▼"}
                      {Math.abs(dl)}%
                    </span>
                  )}
                  <Money value={w.v} className="font-medium" />
                </span>
              </div>
              <Bar
                value={w.v / Math.max(1, d.where[0].v)}
                accent="fin"
                className="h-1.5"
              />
            </Link>
          )
        })}
      </Card>

      <SectionTitle>
        <span className="flex items-center gap-1.5">
          <Trophy className="size-3.5" /> Wins
        </span>
      </SectionTitle>
      <div className="space-y-2">
        {d.kept.length > 0 && (
          <Win
            icon={<Award className="size-5" />}
            title={`Kept ${d.kept.length}/${d.budgets.length} budgets`}
            body={d.kept.map((v) => v.b.name).join(", ")}
          />
        )}
        {d.ns.count >= 4 && (
          <Win
            icon={<Droplets className="size-5" />}
            title={`${d.ns.count} no-spend days`}
            body="Days with no spending on wants. Bills and needs don't count."
          />
        )}
        {d.rate > d.prevRate && (
          <Win
            icon={<Sparkles className="size-5" />}
            title={`Savings rate up ${Math.round((d.rate - d.prevRate) * 100)} pts`}
            body={`From ${pct(d.prevRate)} to ${pct(d.rate)}.`}
          />
        )}
        <Win
          icon={<Award className="size-5" />}
          title={`Logged ${pct(d.completeness)} yourself`}
          body="Everything else came from statement import. Logging habit is working."
        />
      </div>

      <SectionTitle>
        <span className="flex items-center gap-1.5">
          <ThumbsDown className="size-3.5" /> Misses
        </span>
      </SectionTitle>
      <Card className="space-y-2.5 text-sm">
        {d.blown.map((v) => (
          <div key={v.b.id} className="flex justify-between">
            <span>Over {v.b.name} budget</span>
            <span className="text-bad">
              +{Math.round((v.pct - 1) * 100)}% (
              <Money value={v.spent - v.limit} />)
            </span>
          </div>
        ))}
        {d.spikes.map((w) => (
          <div key={w.id} className="flex justify-between">
            <span>{w.cat?.name} spiked</span>
            <span className="text-bad">
              +{Math.round((w.v / w.prev - 1) * 100)}% vs last month
            </span>
          </div>
        ))}
        {d.big.map((r) => (
          <Link
            key={r.id}
            href={`/finance/records/${r.id}`}
            className="flex justify-between"
          >
            <span>Unplanned: {r.payee}</span>
            <Money value={r.amount} className="text-bad" />
          </Link>
        ))}
        {d.blown.length + d.spikes.length + d.big.length === 0 && (
          <div className="text-muted-foreground">
            No misses. Genuinely clean month.
          </div>
        )}
      </Card>

      <SectionTitle>Leaks</SectionTitle>
      <Card className="space-y-2 text-sm">
        {d.leaks.map(([payee, x]) => (
          <div key={payee} className="flex items-center justify-between">
            <span>
              {payee} <span className="text-muted-foreground">×{x.n}</span>
            </span>
            <span className="text-right">
              <Money value={x.v} />
              <span className="block text-[11px] text-muted-foreground">
                ≈ {k(x.v * 12)}/yr
              </span>
            </span>
          </div>
        ))}
        {d.subs > 0 && (
          <div className="flex justify-between border-border/50 border-t pt-2">
            <span>Subscriptions</span>
            <Money value={d.subs} />
          </div>
        )}
      </Card>

      <SectionTitle>No-spend calendar</SectionTitle>
      <Card>
        <Heatmap
          values={heat}
          accent="fin"
          flow="column"
          rowLabels={["S", "M", "T", "W", "T", "F", "S"]}
        />
        <div className="mt-2 text-muted-foreground text-xs">
          Green = no spending on wants. Current streak: {d.ns.streak}{" "}
          {d.ns.streak === 1 ? "day" : "days"}.
        </div>
      </Card>

      <SectionTitle>What to improve</SectionTitle>
      <div className="space-y-2">
        {suggestions.slice(0, 3).map((x, i) => (
          <Card key={x.key} className="flex items-start gap-3">
            <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-fin/15 font-semibold text-fin text-xs">
              {i + 1}
            </span>
            <div className="flex-1">
              <p className="text-sm">{x.text}</p>
              <Btn
                variant="secondary"
                className="mt-2 h-8 text-xs"
                onClick={x.run}
              >
                {x.action}
              </Btn>
            </div>
          </Card>
        ))}
        <NotAdvice className="px-1" />
      </div>

      <SectionTitle>Your note</SectionTitle>
      <textarea
        className={cn(inputCls, "h-24 py-2")}
        placeholder="What will you do differently?"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Btn
          accent="fin"
          onClick={() => {
            saveLookBack(custom ? `${from}_${to}` : period, note, {
              savingsRate: d.rate,
              income: d.flow.income,
              spend: d.flow.spend,
            })
            toast("Review saved")
          }}
        >
          {saved ? "Update review" : "Save review"}
        </Btn>
        <Btn
          variant="secondary"
          href={`/finance/advisor?ask=review&period=${period}`}
        >
          <Bot className="size-4" /> Ask advisor
        </Btn>
      </div>

      <FinSheet
        open={share}
        onOpenChange={setShare}
        title="Share card"
        description="Percentages and streaks only — never peso amounts."
      >
        <div className="rounded-3xl bg-gradient-to-br from-fin to-tsk p-5 text-white">
          <div className="text-xs opacity-80">{title} · Money</div>
          <div className="mt-2 font-bold text-4xl">{pct(d.rate)}</div>
          <div className="text-sm opacity-90">savings rate</div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            <div>
              <div className="font-semibold text-lg">
                {d.kept.length}/{d.budgets.length}
              </div>
              budgets kept
            </div>
            <div>
              <div className="font-semibold text-lg">{d.ns.count}</div>
              no-spend days
            </div>
            <div>
              <div className="font-semibold text-lg">{pct(d.completeness)}</div>
              self-logged
            </div>
          </div>
        </div>
        <Btn
          accent="fin"
          className="mt-4 w-full"
          onClick={() => {
            setShare(false)
            toast("Card sent to Share")
          }}
        >
          Share
        </Btn>
        <div className="mt-2 flex justify-center">
          <Pill>₱ never shown on cards</Pill>
        </div>
      </FinSheet>
    </Screen>
  )
}

function Win({
  icon,
  title,
  body,
}: {
  icon: ReactNode
  title: string
  body: string
}) {
  return (
    <Card className="flex items-center gap-3">
      <span className="grid size-10 place-items-center rounded-full bg-good/15 text-good">
        {icon}
      </span>
      <div className="flex-1">
        <div className="font-medium text-sm">{title}</div>
        <div className="text-muted-foreground text-xs">{body}</div>
      </div>
    </Card>
  )
}
