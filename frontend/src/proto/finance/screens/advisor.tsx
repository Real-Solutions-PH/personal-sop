"use client"

import {
  Bot,
  ChevronDown,
  History,
  Lock,
  Mic,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { openCapture } from "../../lib/capture"
import { privacyStore } from "../../lib/privacy"
import { Btn, Chip, Empty, Money, Row, Screen } from "../../ui/kit"
import {
  deleteThread,
  newThread,
  pushMessage,
  updateSettings,
} from "../actions"
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
  today,
} from "../calc"
import type { AdvisorMsg, AdvisorScope, FinState } from "../data"
import { openSheet } from "../sheets"
import { finStore, useFin } from "../store"
import { ChipRow, FinSheet, NotAdvice, Pill } from "../ui"

type Key =
  | "afford"
  | "finance"
  | "leaks"
  | "emergency"
  | "invest"
  | "review"
  | "generic"

interface Params {
  key: Key
  amount?: number
  month?: string
  name?: string
  mode?: "lump" | "inst"
  n?: number
  period?: string
}

const NEEDS_RECORDS: Key[] = ["leaks"]

const SUGGESTED: { q: string; p: Params }[] = [
  {
    q: "Can I afford a ₱45k laptop in December?",
    p: { key: "afford", amount: 45000, name: "laptop" },
  },
  {
    q: "Finance a ₱30k phone at 0% for 12 months, or pay cash?",
    p: { key: "finance", amount: 30000, n: 12 },
  },
  { q: "Where am I leaking money?", p: { key: "leaks" } },
  { q: "How big should my emergency fund be?", p: { key: "emergency" } },
  { q: "Should I start investing — MP2 or index funds?", p: { key: "invest" } },
]

function route(text: string): Params {
  const t = text.toLowerCase()
  const m = t.match(/(\d+(?:\.\d+)?)\s*(k)?/)
  const amount = m ? Number(m[1]) * (m[2] ? 1000 : 1) : undefined
  if (/0%|financ|install|or pay cash/.test(t))
    return { key: "finance", amount: amount ?? 30000, n: 12 }
  if (/afford|buy|laptop|purchase/.test(t))
    return { key: "afford", amount: amount ?? 45000, name: "purchase" }
  if (/leak|where.*money|coffee|wasting/.test(t)) return { key: "leaks" }
  if (/emergency|runway|safety/.test(t)) return { key: "emergency" }
  if (/invest|mp2|index|stock|col/.test(t)) return { key: "invest" }
  if (/review|last month|how did i/.test(t)) return { key: "review" }
  return { key: "generic" }
}

export function AdvisorScreen() {
  const s = useFin()
  const sp = useSearchParams()
  const router = useRouter()
  const [threadId, setThreadId] = useState<string | null>(null)
  const [text, setText] = useState("")
  const [typing, setTyping] = useState(false)
  const [threads, setThreads] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const asked = useRef(false)
  const scope = s.settings.aiScope
  const thread = s.threads.find((t) => t.id === threadId)

  const ask = (q: string, p: Params, tid?: string) => {
    let id = tid ?? threadId
    if (!id) {
      id = newThread(q.length > 40 ? `${q.slice(0, 40)}…` : q)
      setThreadId(id)
    }
    const scope = finStore.get().settings.aiScope
    pushMessage(id, { role: "user", text: q, scope })
    setTyping(true)
    const target = id
    setTimeout(() => {
      setTyping(false)
      const needs = NEEDS_RECORDS.includes(p.key) && scope === "aggregates"
      pushMessage(target, {
        role: "ai",
        text: JSON.stringify(p),
        answer: needs ? "needs-scope" : p.key,
        scope,
      })
    }, 900)
  }

  // first-use disclaimer (FIN-34)
  useEffect(() => {
    if (!s.settings.disclaimerAck) openSheet({ kind: "disclaimer" })
  }, [s.settings.disclaimerAck])

  // deep-linked question (from projection / look-back)
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire once when allowed
  useEffect(() => {
    if (asked.current || !s.settings.disclaimerAck) return
    const a = sp.get("ask")
    if (!a) return
    asked.current = true
    const amount = Number(sp.get("amount") || 0) || undefined
    const month = sp.get("month") ?? undefined
    if (a === "afford") {
      const name = sp.get("name") ?? "purchase"
      const mode = (sp.get("mode") as "lump" | "inst") ?? "lump"
      const n = Number(sp.get("n") || 12)
      ask(
        `Can I afford ${name} for ₱${(amount ?? 0).toLocaleString()} in ${month ? monthLabel(month, true) : "a few months"}${mode === "inst" ? ` on ${n}× 0%` : ""}?`,
        { key: "afford", amount, month, name, mode, n },
      )
    } else if (a === "review")
      ask("How did I do last month, and what should I change?", {
        key: "review",
        period: sp.get("period") ?? undefined,
      })
    else if (a === "runway")
      ask("How many months could my savings cover?", { key: "emergency" })
    else if (a === "leaks") ask("Where am I leaking money?", { key: "leaks" })
  }, [s.settings.disclaimerAck])

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new messages
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [thread?.messages.length, typing])

  if (!s.settings.disclaimerAck)
    return (
      <Screen title="Advisor" back>
        <Empty
          icon={<Lock className="size-10" />}
          title="Accept the advisor terms first"
          body="The advisor explains your own numbers. It's not licensed financial advice and never moves money."
          action={
            <Btn accent="fin" onClick={() => openSheet({ kind: "disclaimer" })}>
              Read & accept
            </Btn>
          }
        />
      </Screen>
    )

  const send = () => {
    const q = text.trim()
    if (!q) return
    setText("")
    ask(q, route(q))
  }

  return (
    <Screen
      title="Advisor"
      back
      actions={
        <button
          type="button"
          aria-label="Past threads"
          onClick={() => setThreads(true)}
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <History className="size-5" />
        </button>
      }
      className="flex flex-col"
    >
      <div className="sticky top-14 z-10 -mx-4 flex items-center gap-2 border-border/60 border-b bg-background/90 px-4 py-2 backdrop-blur-md">
        <Bot className="size-4 text-fin" />
        <span className="flex-1 text-muted-foreground text-xs">
          AI accountant · uses your finance data
        </span>
        <button
          type="button"
          onClick={() => {
            const next: AdvisorScope =
              scope === "aggregates" ? "records" : "aggregates"
            updateSettings({ aiScope: next })
            toast(
              next === "records"
                ? "Individual transactions allowed when a question needs it"
                : "Totals only — no payees or notes leave the app",
            )
          }}
          className={cn(
            "flex items-center gap-1 rounded-full px-2.5 py-1 font-medium text-[11px]",
            scope === "records" ? "bg-warn/15 text-warn" : "bg-fin/15 text-fin",
          )}
        >
          <ShieldCheck className="size-3.5" />
          {scope === "records" ? "Individual transactions" : "Totals only"}
          <ChevronDown className="size-3" />
        </button>
      </div>

      <div className="flex-1 space-y-3 py-3">
        {!thread || thread.messages.length === 0 ? (
          <div className="pt-6">
            <div className="text-center">
              <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-fin/15 text-fin">
                <Bot className="size-7" />
              </div>
              <div className="mt-3 font-semibold">Ask about your money</div>
              <p className="mt-1 text-muted-foreground text-sm">
                Lessons, feedback and options — worked from your numbers.
              </p>
            </div>
            <div className="mt-5 space-y-2">
              {SUGGESTED.map((x) => (
                <button
                  key={x.q}
                  type="button"
                  onClick={() => ask(x.q, x.p)}
                  className="w-full rounded-2xl border border-border/60 bg-card px-4 py-3 text-left text-sm active:bg-muted"
                >
                  {x.q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          thread.messages.map((m) => (
            <Bubble
              key={m.id}
              m={m}
              onRetry={(p) =>
                ask(
                  "Go ahead and use individual transactions for this one.",
                  p,
                  thread.id,
                )
              }
            />
          ))
        )}
        {typing && (
          <div className="flex w-16 gap-1 rounded-2xl bg-card px-3 py-3">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-2 animate-bounce rounded-full bg-muted-foreground"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 -mx-4 border-border/60 border-t bg-background/95 px-4 pt-2 pb-3 backdrop-blur-md">
        {thread && thread.messages.length > 0 && (
          <ChipRow>
            {SUGGESTED.slice(0, 4).map((x) => (
              <Chip
                key={x.q}
                className="h-8 text-xs"
                onClick={() => ask(x.q, x.p)}
              >
                {x.q.length > 30 ? `${x.q.slice(0, 30)}…` : x.q}
              </Chip>
            ))}
          </ChipRow>
        )}
        <div className="mt-2 flex items-center gap-2">
          <input
            className="h-11 flex-1 rounded-full border border-border bg-card px-4 text-base outline-none focus:border-fin"
            placeholder="Ask the advisor…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button
            type="button"
            aria-label="Voice"
            onClick={() => openCapture({ mode: "voice", hint: "advisor" })}
            className="grid size-11 place-items-center rounded-full bg-muted"
          >
            <Mic className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Send"
            onClick={send}
            className="grid size-11 place-items-center rounded-full bg-fin text-background"
          >
            <Send className="size-5" />
          </button>
        </div>
        <NotAdvice className="mt-1.5 text-center" />
      </div>

      <FinSheet open={threads} onOpenChange={setThreads} title="Past threads">
        {s.threads.length === 0 && (
          <div className="py-6 text-center text-muted-foreground text-sm">
            No threads yet.
          </div>
        )}
        {s.threads.map((t) => (
          <div key={t.id} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Row
                onClick={() => {
                  setThreadId(t.id)
                  setThreads(false)
                }}
                title={t.title}
                subtitle={`${t.messages.length} messages · ${new Date(t.createdAt).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}`}
              />
            </div>
            <button
              type="button"
              aria-label="Delete thread"
              onClick={() => {
                deleteThread(t.id)
                if (t.id === threadId) setThreadId(null)
              }}
              className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        <Btn
          variant="secondary"
          className="mt-3 w-full"
          onClick={() => {
            setThreadId(null)
            setThreads(false)
            router.replace("/finance/advisor")
          }}
        >
          New thread
        </Btn>
      </FinSheet>
    </Screen>
  )
}

function Bubble({
  m,
  onRetry,
}: {
  m: AdvisorMsg
  onRetry: (p: Params) => void
}) {
  if (m.role === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-fin px-4 py-2.5 text-sm text-background">
          {m.text}
        </div>
      </div>
    )
  const p = JSON.parse(m.text) as Params
  if (m.answer === "needs-scope")
    return (
      <AiCard scope={m.scope}>
        <p>
          To find leaks I need to look at individual transactions (payees and
          amounts), not just monthly totals. Your current setting is totals
          only.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn
            accent="fin"
            className="h-9"
            onClick={() => {
              updateSettings({ aiScope: "records" })
              setTimeout(() => onRetry(p), 50)
            }}
          >
            Allow for this question
          </Btn>
        </div>
      </AiCard>
    )
  return (
    <AiCard scope={m.scope}>
      <Answer p={p} />
    </AiCard>
  )
}

function AiCard({
  children,
  scope,
}: {
  children: ReactNode
  scope: AdvisorScope
}) {
  return (
    <div className="max-w-[95%] rounded-2xl rounded-bl-md border border-border/60 bg-card p-4 text-sm leading-relaxed">
      <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Bot className="size-3.5 text-fin" /> Advisor
        <Pill className="ml-auto">
          {scope === "records"
            ? "used: individual transactions"
            : "used: totals only"}
        </Pill>
      </div>
      {children}
      <NotAdvice className="mt-3 border-border/50 border-t pt-2" />
    </div>
  )
}

function Working({ rows }: { rows: [string, ReactNode][] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3 rounded-xl bg-muted/50 p-2.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-muted-foreground text-xs"
      >
        Numbers I used{" "}
        <ChevronDown
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="mt-2 space-y-1 text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <span className="text-muted-foreground">{k}</span>
              <span className="num text-right">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
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

function Lesson({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 rounded-xl border border-fin/30 bg-fin/5 p-2.5 text-xs">
      <b className="text-fin">Lesson · </b>
      {children}
    </div>
  )
}

function Answer({ p }: { p: Params }) {
  const s = useFin()
  const router = useRouter()
  const ctx = useCtx(s)
  const hidden = privacyStore.use((x) => x.hidden)
  const k = (n: number) => (hidden ? "₱•••" : compact(n))
  const floor = s.settings.safetyFloor
  const runway = ctx.avgSpend ? ctx.base.start / ctx.avgSpend : 0

  switch (p.key) {
    case "afford": {
      const amount = p.amount ?? 45000
      const month = p.month ?? `${ctx.mk.slice(0, 4)}-12`
      const n = p.mode === "inst" ? (p.n ?? 12) : 1
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
          <p>
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
          </p>
          <p className="mt-2">
            <b>My suggestion:</b>{" "}
            {ok
              ? `Go ahead, but pay from BPI Savings in one go — you recover in about ${w.recoveryMonths ?? "a few"} months.`
              : neg
                ? `Wait until ${monthLabel(later, true)} or split it over 12× 0%, which keeps you above zero.`
                : `Either push it to ${monthLabel(later)} or use 0% installments so you stay above your minimum.`}
          </p>
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
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip
              accent="fin"
              className="h-8 text-xs"
              onClick={() =>
                router.push(
                  `/finance/projection?amount=${amount}&month=${month}&name=${encodeURIComponent(p.name ?? "Purchase")}`,
                )
              }
            >
              Add as what-if
            </Chip>
            <Chip
              className="h-8 text-xs"
              onClick={() =>
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
            </Chip>
          </div>
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
          <p>
            At a true 0%, installments are <b>slightly better</b> on paper:{" "}
            <Money value={monthly} />
            /mo for {n} months, and the cash you keep can earn ~4% in a digital
            bank — about {k(interest)} after tax over the term.
          </p>
          <p className="mt-2">
            The real risk is behaviour: a missed payment costs ~3%/month plus
            fees, and {n} months of <Money value={monthly} /> eats into the
            {k(ctx.base.avgSurplus)}/mo you have left over.
            {runway >= 3
              ? " Your savings cover 3+ months, so 0% is fine if you set it as a scheduled payment with autopay."
              : " Your savings cover under 3 months — paying cash would leave you exposed, so installments make sense here."}
          </p>
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
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip
              accent="fin"
              className="h-8 text-xs"
              onClick={() =>
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
            </Chip>
            <Chip
              className="h-8 text-xs"
              onClick={() =>
                router.push(`/finance/projection?amount=${amount}&name=Phone`)
              }
            >
              Compare in projection
            </Chip>
          </div>
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
          <p>
            Looking at the last 30 days of transactions, these small repeats add
            up the most:
          </p>
          <div className="mt-2 space-y-1">
            {top.map(([name, x]) => (
              <div
                key={name}
                className="flex justify-between rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs"
              >
                <span>
                  {name} ×{x.n}
                </span>
                <span>
                  <Money value={x.v} /> · {k(x.v * 12)}/yr
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2">
            <b>Suggestion:</b>{" "}
            {top[0]
              ? `cap ${top[0][0]} at half its current pace`
              : "keep going"}{" "}
            and review subscriptions (<Money value={subs} />
            /mo) — cancelling one unused service is the easiest win.
          </p>
          <Lesson>
            Leaks are frequent, small, and feel free. Budgeting the category
            (not banning it) keeps it enjoyable.
          </Lesson>
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip
              accent="fin"
              className="h-8 text-xs"
              onClick={() =>
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
            </Chip>
            <Link
              href="/finance/review"
              className="inline-flex h-8 items-center rounded-full border border-border px-3 text-xs"
            >
              Open monthly review
            </Link>
          </div>
        </>
      )
    }
    case "emergency": {
      const target3 = ctx.avgSpend * 3
      const target6 = ctx.avgSpend * 6
      return (
        <>
          <p>
            You spend about <Money value={ctx.avgSpend} /> a month. Your
            available cash is <Money value={ctx.base.start} /> — enough to cover{" "}
            <b>{runway.toFixed(1)} months</b>.
          </p>
          <p className="mt-2">
            With two income sources, 3 months ({k(target3)}) is a reasonable
            minimum; 6 months ({k(target6)}) if either job feels shaky.{" "}
            {runway >= 3
              ? "You're there — extra savings can start working harder."
              : `Saving ${k(ctx.base.avgSurplus)}/mo, you'd reach 3 months in about ${Math.max(1, Math.ceil((target3 - ctx.base.start) / Math.max(1, ctx.base.avgSurplus)))} months.`}
          </p>
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
          <div className="mt-3">
            <Chip
              accent="fin"
              className="h-8 text-xs"
              onClick={() =>
                updateSettings({
                  safetyFloor: Math.round(target3 / 1000) * 1000,
                })
              }
            >
              Set minimum to 3 months
            </Chip>
          </div>
        </>
      )
    }
    case "invest": {
      const surplus = ctx.base.avgSurplus
      return (
        <>
          <p>
            Your plan leaves about {k(surplus)}/mo left over and you already
            send <Money value={3000} /> to COL monthly. Two common options in
            the Philippines:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            <li>
              <b>Pag-IBIG MP2</b> — government-backed, dividends historically
              ~6–7%, tax-free, 5-year lock-in. Good for money you won't touch.
            </li>
            <li>
              <b>Index funds / ETFs (via COL)</b> — market returns, can drop
              20–30% in a bad year. Good for 5+ year money, added monthly.
            </li>
          </ul>
          <p className="mt-2">
            <b>Order that usually works:</b> emergency fund first (
            {runway >= 3 ? "done ✓" : "not yet"}), then split what's left over —
            e.g. half MP2, half index funds.
          </p>
          <Lesson>
            Automate it on payday. Money that sits in GCash tends to get spent.
          </Lesson>
          <div className="mt-3">
            <Chip
              accent="fin"
              className="h-8 text-xs"
              onClick={() =>
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
            </Chip>
          </div>
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
          <p>
            In {monthLabel(period, true)} you earned <Money value={fl.income} />
            , spent <Money value={fl.spend} /> and kept{" "}
            <b>{pct(savingsRate(fl))}</b>. {cat?.name} was the biggest bucket at{" "}
            <Money value={top?.[1] ?? 0} />.
          </p>
          <p className="mt-2">
            <b>One change:</b> set a weekly cap on {cat?.name?.toLowerCase()}{" "}
            and check it on Sundays. Weekly limits are easier to feel than
            monthly ones.
          </p>
          <Lesson>
            Savings rate beats raw savings as a scorecard — it survives raises
            and bonuses.
          </Lesson>
          <div className="mt-3">
            <Link
              href={`/finance/review?period=${period}`}
              className="inline-flex h-8 items-center rounded-full bg-fin px-3 text-background text-xs"
            >
              Open the full review
            </Link>
          </div>
        </>
      )
    }
    default:
      return (
        <p>
          I can help with: whether you can afford something, financing vs paying
          cash, where money leaks, emergency funds, and investing basics (MP2,
          index funds). I work from your own numbers and show my working — try
          one of the suggestions below.
        </p>
      )
  }
}
