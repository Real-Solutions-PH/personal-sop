// Shared money inside Finance: loans owed to me and loans I owe, each with
// its schedule, what is paid, what is waiting for the lender, and the
// history with proof photos. Reads the synced store, so it works offline;
// every change queues one sync action (live/mappers/shared.ts).
import { shortDate } from "@domain/finance/calc"
import type * as G from "@domain/finance/groups"
import type { SharedAccount } from "@domain/finance/joint"
import * as L from "@domain/finance/loans"
import { dayKey } from "@domain/lib/day"
import { currencyInfo, money } from "@domain/lib/money"
import { getConnectivity } from "@domain/lib/platform"
import { privacyStore } from "@domain/lib/privacy"
import {
  Check,
  HandCoins,
  PiggyBank,
  Plus,
  Target,
  Users,
} from "lucide-react-native"
import { useEffect, useState } from "react"
import { Image, View } from "react-native"
import { useMomentTimer } from "../big-moment"
import { prototypeMode } from "../mode"
import { MomentCard } from "../moment"
import { claimOnce, seen } from "../moments-seen"
import { useCountUp } from "../motion"
import {
  Bar,
  Copy,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  SmallButton,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Button, confirm, Empty, Screen, Sheet } from "../ui"
import { isJoint, JointAccountCard, JointList } from "./finance-joint"
import { DecideSheet, NewLoanSheet, PaySheet } from "./finance-loan-sheets"
import { FinPill } from "./finance-planned"
import { BudgetCard, GoalCard, NewGroupSheet } from "./finance-shared-groups"
import { Dimmed, EmptyFoot } from "./locked-preview"

/** A loan's amount (centavos) in its own currency, hidden with the eye. */
export function useLoanMoney() {
  const hidden = privacyStore.use((s) => s.hidden)
  return (minor: number, code: string) =>
    hidden ? "••••" : money(minor / 100, currencyInfo(code))
}

const other = (l: L.Loan) => (l.role === "lender" ? l.borrower : l.lender)

const SAMPLE: L.Loan = {
  id: "sample",
  loanId: "sample",
  role: "lender",
  status: "active",
  lender: { id: "me", name: "You" },
  borrower: { id: "them", name: "Your partner" },
  principal: 1_200_000,
  interest: 0,
  total: 1_200_000,
  currency: "PHP",
  purpose: "Phone",
  schedule: { kind: "monthly", count: 6, start: "2026-01-15", day: 15 },
  installments: L.monthlyInstallments(1_200_000, 6, "2026-01-15", 15),
  payments: [
    {
      id: "s1",
      kind: "transfer",
      status: "accepted",
      amount: 200_000,
      paidOn: "2026-01-15",
      byId: "them",
      createdAt: "2026-01-15T00:00:00.000Z",
    },
    {
      id: "s2",
      kind: "transfer",
      status: "accepted",
      amount: 200_000,
      paidOn: "2026-02-15",
      byId: "them",
      createdAt: "2026-02-15T00:00:00.000Z",
    },
  ],
  events: [],
  createdAt: "2026-01-01T00:00:00.000Z",
}

/** What a loan needs from this member right now, if anything. */
function needs(l: L.Loan): string | null {
  const waiting = l.payments.filter((p) => p.status === "sent").length
  if (l.status === "invited")
    return l.role === "borrower" ? "Accept or decline" : "Waiting for them"
  if (l.role === "lender" && waiting)
    return waiting === 1 ? "1 payment to confirm" : `${waiting} to confirm`
  if (l.role === "borrower" && waiting) return "Sent, awaiting confirmation"
  return null
}

export function LoanCard({ loan, today }: { loan: L.Loan; today: string }) {
  const t = useTheme(),
    m = useLoanMoney(),
    s = L.loanSummary(loan, today),
    who = other(loan),
    todo = needs(loan),
    done = loan.status === "paid"
  return (
    <Frame style={{ marginBottom: 8 }}>
      <Tap
        label={`Loan with ${who.name}`}
        onPress={() => go(`/finance/shared/${loan.loanId}`)}
        style={{ padding: 16 }}
      >
        <Line
          style={{
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <View style={{ flex: 1 }}>
            <Copy weight="medium">{who.name}</Copy>
            {loan.purpose && (
              <Copy size={12} muted>
                {loan.purpose}
              </Copy>
            )}
          </View>
          {done ? (
            <FinPill tone="good">Paid in full</FinPill>
          ) : s.overdue > 0 ? (
            <FinPill tone="bad">{m(s.overdue, loan.currency)} overdue</FinPill>
          ) : todo ? (
            <FinPill
              tone={
                todo.startsWith("Accept") || todo.includes("confirm")
                  ? "warn"
                  : "muted"
              }
            >
              {todo}
            </FinPill>
          ) : null}
        </Line>
        <Copy size={24} weight="displayMedium" fit style={{ marginTop: 8 }}>
          {m(s.remaining, loan.currency)}
        </Copy>
        <Copy size={12} muted>
          {loan.role === "lender" ? "still owed to you" : "still to pay"} of{" "}
          {m(loan.total, loan.currency)}
        </Copy>
        <View style={{ marginTop: 10 }}>
          <Bar
            value={loan.total ? s.paid / loan.total : 0}
            color={done ? t.good : t.fin}
            target={
              s.pending && loan.total
                ? (s.paid + s.pending) / loan.total
                : undefined
            }
          />
        </View>
        <Line
          style={{
            justifyContent: "space-between",
            marginTop: 8,
            flexWrap: "wrap",
            gap: 4,
          }}
        >
          <Copy size={12} muted>
            {s.done}/{loan.installments.length} paid
          </Copy>
          {s.next && loan.status === "active" && (
            <Copy
              size={12}
              style={{ color: s.next.state === "overdue" ? t.bad : t.muted }}
            >
              Next {m(s.next.amount - s.next.paid, loan.currency)} ·{" "}
              {shortDate(s.next.due)}
            </Copy>
          )}
        </Line>
      </Tap>
    </Frame>
  )
}

/** Finance home's card: what others owe me and what I owe, or a dimmed
 * sample loan with the step that starts one. */
export function SharedSection() {
  const t = useTheme(),
    m = useLoanMoney(),
    loans = L.sharedStore.use((s) => s.loans),
    today = dayKey(),
    open = loans.filter((l) => l.status === "active" || l.status === "invited"),
    sum = (role: L.LoanRole) =>
      open
        .filter((l) => l.role === role && l.status === "active")
        .reduce((a, l) => a + L.loanSummary(l, today).remaining, 0),
    owed = sum("lender"),
    owe = sum("borrower"),
    code = open[0]?.currency ?? "PHP",
    todo = open.filter((l) => needs(l)?.match(/Accept|confirm/)).length,
    goals = L.sharedStore
      .use((s) => s.goals ?? [])
      .filter(
        (g) => g.myStatus === "active" || g.myStatus === "invited",
      ).length,
    budgets = L.sharedStore
      .use((s) => s.budgets ?? [])
      .filter(
        (b) => b.myStatus === "active" || b.myStatus === "invited",
      ).length,
    joints = L.sharedStore
      .use((s) => s.accounts ?? [])
      .filter(
        (a) =>
          (a.myStatus === "active" || a.myStatus === "invited") &&
          (a.role === "member" || isJoint(a)),
      ).length,
    groups = [
      goals ? `${goals} shared goal${goals === 1 ? "" : "s"}` : "",
      budgets ? `${budgets} shared budget${budgets === 1 ? "" : "s"}` : "",
      joints ? `${joints} joint account${joints === 1 ? "" : "s"}` : "",
    ]
      .filter(Boolean)
      .join(" · ")
  return (
    <View testID="finance-shared-section">
      <SectionHeading
        icon={Users}
        action={
          <Tap onPress={() => go("/finance/shared")}>
            <Copy size={12} style={{ color: t.fin }}>
              {open.length || groups ? "All shared" : "Open"}
            </Copy>
          </Tap>
        }
      >
        Shared
      </SectionHeading>
      {open.length || groups ? (
        <Frame>
          <Tap onPress={() => go("/finance/shared")} label="Shared money">
            <Line style={{ gap: 0 }}>
              {[
                { label: "Owed to you", value: owed, color: t.good },
                { label: "You owe", value: owe, color: t.text },
              ].map((x, i) => (
                <View
                  key={x.label}
                  style={{
                    flex: 1,
                    padding: 16,
                    borderLeftWidth: i ? 1 : 0,
                    borderColor: t.line,
                  }}
                >
                  <Copy size={12} muted>
                    {x.label}
                  </Copy>
                  <Copy
                    size={20}
                    weight="semibold"
                    fit
                    style={{ color: x.color }}
                  >
                    {m(x.value, code)}
                  </Copy>
                </View>
              ))}
            </Line>
            {groups !== "" && (
              <Copy
                size={12}
                muted
                style={{ paddingHorizontal: 16, paddingBottom: 12 }}
              >
                {groups}
              </Copy>
            )}
            {todo > 0 && (
              <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                <FinPill tone="warn">
                  {todo === 1 ? "1 loan needs you" : `${todo} loans need you`}
                </FinPill>
              </View>
            )}
          </Tap>
        </Frame>
      ) : (
        <Frame testID="shared-empty" style={{ padding: 16 }}>
          <Dimmed>
            <LoanCard loan={SAMPLE} today="2026-03-01" />
          </Dimmed>
          <EmptyFoot
            hint="Lent someone money, or paying a friend back? Track every installment together."
            action={{ label: "New loan", href: "/finance/shared?new=1" }}
          />
        </Frame>
      )}
    </View>
  )
}

const SAMPLE_GOAL: G.SharedGoal = {
  id: "sample-goal",
  goalId: "sample-goal",
  role: "owner",
  myStatus: "active",
  status: "active",
  name: "Japan trip",
  currency: "PHP",
  target: 10_000_000,
  members: [
    {
      person: { id: "me", name: "You" },
      role: "owner",
      status: "active",
      amount: 0,
    },
    {
      person: { id: "them", name: "Your partner" },
      role: "member",
      status: "active",
      amount: 0,
    },
  ],
  entries: [
    {
      id: "e1",
      kind: "deposit",
      status: "accepted",
      amount: 2_500_000,
      onDate: "2026-01-01",
      byId: "me",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "e2",
      kind: "deposit",
      status: "accepted",
      amount: 1_800_000,
      onDate: "2026-01-02",
      byId: "them",
      createdAt: "2026-01-02T00:00:00.000Z",
    },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
}

const SAMPLE_BUDGET: G.SharedBudget = {
  id: "sample-budget",
  budgetId: "sample-budget",
  role: "owner",
  myStatus: "active",
  status: "active",
  name: "Groceries",
  currency: "PHP",
  limit: 1_500_000,
  month: "2026-01",
  spent: 960_000,
  myCategoryIds: [],
  members: [],
  createdAt: "2026-01-01T00:00:00.000Z",
}

const SAMPLE_JOINT: SharedAccount = {
  id: "sample-joint",
  accountId: "sample-joint",
  role: "member",
  myStatus: "active",
  name: "House money",
  type: "bank",
  color: "fin",
  currency: "PHP",
  archived: false,
  inNetWorth: true,
  balance: 4_250_000,
  owner: { id: "them", name: "Your partner" },
  members: [
    {
      person: { id: "them", name: "Your partner" },
      role: "owner",
      status: "active",
    },
    { person: { id: "me", name: "You" }, role: "member", status: "active" },
  ],
  records: [],
  recordsTotal: 0,
  categories: [],
  sharedAt: "2026-01-01T00:00:00.000Z",
}

type Making = "choose" | "loan" | "goal" | "budget" | null

export function SharedHome({ startNew = false }: { startNew?: boolean }) {
  const t = useTheme(),
    m = useLoanMoney(),
    loans = L.sharedStore.use((s) => s.loans),
    goals = L.sharedStore.use((s) => s.goals ?? []),
    budgets = L.sharedStore.use((s) => s.budgets ?? []),
    hasJoint = L.sharedStore
      .use((s) => s.accounts ?? [])
      .some(
        (a) =>
          (a.myStatus === "active" || a.myStatus === "invited") &&
          (a.role === "member" || isJoint(a)),
      ),
    today = dayKey(),
    [making, setMaking] = useState<Making>(startNew ? "loan" : null)
  const invites = loans.filter(
      (l) => l.status === "invited" && l.role === "borrower",
    ),
    owed = loans.filter(
      (l) =>
        l.role === "lender" &&
        (l.status === "active" || l.status === "invited"),
    ),
    owe = loans.filter((l) => l.role === "borrower" && l.status === "active"),
    closed = loans.filter((l) => !["active", "invited"].includes(l.status)),
    liveGoals = goals.filter((g) => ["invited", "active"].includes(g.myStatus)),
    liveBudgets = budgets.filter((b) =>
      ["invited", "active"].includes(b.myStatus),
    ),
    total = (list: L.Loan[]) =>
      list
        .filter((l) => l.status === "active")
        .reduce((a, l) => a + L.loanSummary(l, today).remaining, 0)
  const section = (title: string, list: L.Loan[], sum?: number) =>
    list.length > 0 && (
      <View key={title}>
        <SectionHeading
          action={
            sum !== undefined && sum > 0 ? (
              <Copy size={12} muted>
                {m(sum, list[0].currency)}
              </Copy>
            ) : undefined
          }
        >
          {title}
        </SectionHeading>
        {list.map((l) => (
          <LoanCard key={l.id} loan={l} today={today} />
        ))}
      </View>
    )
  const made = (href: string) => {
    setMaking(null)
    go(href)
  }
  return (
    <Screen
      prototypeLayout
      title="Shared"
      actions={
        <IconTap
          size={40}
          icon={Plus}
          label="New loan, shared goal or shared budget"
          color={t.text}
          onPress={() => setMaking("choose")}
        />
      }
    >
      <SectionHeading>Loans</SectionHeading>
      {loans.length ? (
        <>
          {section("Invites for you", invites)}
          {section("Owed to you", owed, total(owed))}
          {section("You owe", owe, total(owe))}
          {section("Closed", closed)}
        </>
      ) : (
        <>
          <Dimmed>
            <LoanCard loan={SAMPLE} today="2026-03-01" />
          </Dimmed>
          <EmptyFoot
            hint="Lend to someone you follow and split it into monthly payments. They send proof, you confirm each one."
            action={{ label: "New loan", onPress: () => setMaking("loan") }}
          />
        </>
      )}
      <SectionHeading>Shared goals</SectionHeading>
      {liveGoals.length ? (
        liveGoals.map((g) => <GoalCard key={g.id} goal={g} />)
      ) : (
        <>
          <Dimmed>
            <GoalCard goal={SAMPLE_GOAL} />
          </Dimmed>
          <EmptyFoot
            hint="Save toward something together. Everyone sees who put in what; taking money out needs another member's okay."
            action={{ label: "New goal", onPress: () => setMaking("goal") }}
          />
        </>
      )}
      <SectionHeading>Shared budgets</SectionHeading>
      {liveBudgets.length ? (
        liveBudgets.map((b) => <BudgetCard key={b.id} budget={b} />)
      ) : (
        <>
          <Dimmed>
            <BudgetCard budget={SAMPLE_BUDGET} />
          </Dimmed>
          <EmptyFoot
            hint="One monthly limit you both spend against. Everyone is told at 80% and 100%."
            action={{ label: "New budget", onPress: () => setMaking("budget") }}
          />
        </>
      )}
      <SectionHeading>Joint accounts</SectionHeading>
      {hasJoint ? (
        <JointList />
      ) : (
        <>
          <Dimmed>
            <JointAccountCard joint={SAMPLE_JOINT} />
          </Dimmed>
          <EmptyFoot
            hint="Run an account together: everyone sees the balance and every transaction and adds their own. Open one of your accounts to share it."
            action={{ label: "Open accounts", href: "/finance/accounts" }}
          />
        </>
      )}
      <Sheet
        title="Share money"
        open={making === "choose"}
        onClose={() => setMaking(null)}
      >
        <Button icon={HandCoins} onPress={() => setMaking("loan")}>
          Loan
        </Button>
        <Button tone="quiet" icon={PiggyBank} onPress={() => setMaking("goal")}>
          Shared goal
        </Button>
        <Button tone="quiet" icon={Target} onPress={() => setMaking("budget")}>
          Shared budget
        </Button>
      </Sheet>
      <NewLoanSheet
        open={making === "loan"}
        onClose={() => setMaking(null)}
        onMade={(id) => made(`/finance/shared/${id}`)}
      />
      {(making === "goal" || making === "budget") && (
        <NewGroupSheet
          kind={making}
          open
          onClose={() => setMaking(null)}
          onMade={made}
        />
      )}
    </Screen>
  )
}

// ---------------------------------------------------------------- detail

const STATE_LABEL: Record<L.InstallmentState, string> = {
  paid: "Paid",
  partial: "Part paid",
  overdue: "Overdue",
  due: "Due today",
  upcoming: "Upcoming",
}

const PAY_LABEL: Record<L.PaymentStatus, string> = {
  sent: "Sent, awaiting confirmation",
  accepted: "Confirmed",
  rejected: "Not confirmed",
  withdrawn: "Withdrawn",
}

/** Short-lived proof URLs, fetched when the loan opens online. */
function useProofs(loanId: string, key: string) {
  const [urls, setUrls] = useState<
    Record<string, { url: string; previewUrl?: string }>
  >({})
  useEffect(() => {
    if (prototypeMode || !key || !getConnectivity()) return
    let gone = false
    ;(
      require("@/live/shared-finance") as typeof import("@/live/shared-finance")
    )
      .proofUrls(loanId)
      .then((u) => !gone && setUrls(u))
      .catch(() => {})
    return () => {
      gone = true
    }
  }, [loanId, key])
  return urls
}

export function LoanDetail({ loanId }: { loanId: string }) {
  const t = useTheme(),
    m = useLoanMoney(),
    loan = L.sharedStore.use((s) => s.loans.find((l) => l.loanId === loanId)),
    today = dayKey(),
    proofs = useProofs(
      loanId,
      (loan?.payments ?? [])
        .map((p) => p.proofMediaId)
        .filter(Boolean)
        .join(","),
    ),
    [paying, setPaying] = useState<"pay" | "cash" | null>(null),
    [deciding, setDeciding] = useState<string | null>(null),
    [viewing, setViewing] = useState<string | null>(null),
    paidKey = `loan-paid:${loanId}`,
    [cheer] = useState(() => loan?.status === "paid" && !seen(paidKey)),
    [moment, closeMoment] = useMomentTimer(cheer, 4200),
    left = loan ? L.loanSummary(loan, today).remaining : 0,
    // What is left counts down in place when a payment is confirmed.
    leftNow = useCountUp(left, undefined, left)
  useEffect(() => {
    if (cheer) claimOnce(paidKey)
  }, [cheer, paidKey])
  if (!loan)
    return (
      <Screen prototypeLayout title="Loan">
        <Empty
          title="Loan not found"
          detail="It may still be on its way from the other phone. Pull to refresh in a moment."
        />
      </Screen>
    )
  const s = L.loanSummary(loan, today),
    who = other(loan),
    lender = loan.role === "lender",
    cur = loan.currency,
    deciding_ = loan.payments.find((p) => p.id === deciding),
    viewed = viewing
      ? (proofs[viewing]?.url ??
        loan.payments.find((p) => p.id === viewing)?.proofUri)
      : undefined,
    payments = [...loan.payments].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )
  return (
    <Screen
      prototypeLayout
      title={lender ? `Lent to ${who.name}` : `Borrowed from ${who.name}`}
    >
      {loan.purpose && (
        <Copy size={12} muted>
          {loan.purpose}
        </Copy>
      )}
      <Frame style={{ padding: 16 }}>
        <Line
          style={{
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <Copy size={12} muted style={{ flex: 1 }}>
            {loan.status === "paid"
              ? "Paid in full"
              : lender
                ? `${who.name} still owes you`
                : `You still owe ${who.name}`}
          </Copy>
          {loan.status === "invited" && (
            <FinPill tone="warn">Invite pending</FinPill>
          )}
          {loan.status === "declined" && (
            <FinPill tone="muted">Declined</FinPill>
          )}
          {loan.status === "cancelled" && (
            <FinPill tone="muted">Cancelled</FinPill>
          )}
          {s.overdue > 0 && loan.status === "active" && (
            <FinPill tone="bad">{m(s.overdue, cur)} overdue</FinPill>
          )}
        </Line>
        {loan.status === "paid" ? (
          <Line style={{ gap: 8, marginTop: 4 }}>
            <Check size={28} color={t.good} accessibilityLabel="Paid" />
            <Copy
              size={30}
              weight="displayMedium"
              fit
              style={{ color: t.good }}
            >
              {m(loan.total, cur)}
            </Copy>
          </Line>
        ) : (
          <Copy size={30} weight="displayMedium" fit>
            {m(Math.round(leftNow), cur)}
          </Copy>
        )}
        <Copy size={12} muted>
          of {m(loan.total, cur)}
          {loan.interest > 0 ? ` (${m(loan.interest, cur)} interest)` : ""}
        </Copy>
        <View style={{ marginTop: 12 }}>
          <Bar
            value={loan.total ? s.paid / loan.total : 0}
            color={loan.status === "paid" ? t.good : t.fin}
            target={
              s.pending && loan.total
                ? (s.paid + s.pending) / loan.total
                : undefined
            }
          />
        </View>
        <Line style={{ gap: 12, marginTop: 12, alignItems: "flex-start" }}>
          {[
            ["Paid", m(s.paid, cur), t.good],
            ["Awaiting", m(s.pending, cur), s.pending ? t.warn : t.muted],
            [
              "Next",
              s.next && loan.status === "active"
                ? `${m(s.next.amount - s.next.paid, cur)} · ${shortDate(s.next.due)}`
                : "—",
              s.next?.state === "overdue" ? t.bad : t.text,
            ],
          ].map(([label, value, color]) => (
            <View key={label} style={{ flex: 1 }}>
              <Copy size={16} weight="semibold" fit style={{ color }}>
                {value}
              </Copy>
              <Copy size={12} muted>
                {label}
              </Copy>
            </View>
          ))}
        </Line>
      </Frame>

      {loan.status === "invited" && !lender && (
        <Frame style={{ padding: 16, gap: 8 }}>
          <Copy size={14}>
            {who.name} added this loan: {m(loan.total, cur)} in{" "}
            {loan.installments.length} monthly payment
            {loan.installments.length === 1 ? "" : "s"}. Accept it to track
            every payment together.
          </Copy>
          <Line style={{ gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button onPress={() => L.respondLoan(loan.loanId, true)}>
                Accept
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button
                tone="quiet"
                onPress={() => L.respondLoan(loan.loanId, false)}
              >
                Decline
              </Button>
            </View>
          </Line>
        </Frame>
      )}
      {loan.status === "active" && (
        <Line style={{ gap: 8, marginTop: 4 }}>
          {lender ? (
            <View style={{ flex: 1 }}>
              <Button
                icon={HandCoins}
                tone="quiet"
                onPress={() => setPaying("cash")}
              >
                Record cash
              </Button>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <Button
                icon={HandCoins}
                onPress={() => setPaying("pay")}
                disabled={L.room(loan) === 0}
              >
                Pay
              </Button>
            </View>
          )}
        </Line>
      )}
      {lender &&
        (loan.status === "invited" ||
          (loan.status === "active" &&
            !loan.payments.some(
              (p) => p.status === "sent" || p.status === "accepted",
            ))) && (
          <Tap
            onPress={() =>
              confirm(
                "Cancel this loan?",
                `${who.name} will see it as cancelled.`,
                () => L.cancelLoan(loan.loanId),
              )
            }
          >
            <Copy
              size={13}
              style={{ color: t.bad, textAlign: "center", marginTop: 8 }}
            >
              Cancel loan
            </Copy>
          </Tap>
        )}

      <SectionHeading>Schedule</SectionHeading>
      <Frame style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
        {s.installments.map((i) => {
          const color =
            i.state === "paid"
              ? t.good
              : i.state === "overdue"
                ? t.bad
                : i.state === "due"
                  ? t.warn
                  : t.muted
          return (
            <Line
              key={i.n}
              style={{
                justifyContent: "space-between",
                paddingVertical: 10,
                gap: 8,
              }}
            >
              <Line style={{ gap: 8, flex: 1 }}>
                {i.state === "paid" ? (
                  <Check size={16} color={t.good} accessibilityLabel="Paid" />
                ) : (
                  <Copy
                    size={12}
                    muted
                    style={{ width: 16, textAlign: "center" }}
                  >
                    {i.n}
                  </Copy>
                )}
                <View style={{ flex: 1 }}>
                  <Copy size={14}>{shortDate(i.due)}</Copy>
                  <Copy size={12} style={{ color }}>
                    {STATE_LABEL[i.state]}
                    {i.state === "partial" ||
                    (i.state === "overdue" && i.paid > 0)
                      ? ` · ${m(i.paid, cur)} in`
                      : ""}
                  </Copy>
                </View>
              </Line>
              <Copy size={14} weight="medium">
                {m(i.amount, cur)}
              </Copy>
            </Line>
          )
        })}
      </Frame>

      <SectionHeading>History</SectionHeading>
      {payments.length ? (
        <Frame style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
          {payments.map((p) => {
            const thumb =
              proofs[p.id]?.previewUrl ?? proofs[p.id]?.url ?? p.proofUri
            const tone =
              p.status === "accepted"
                ? t.good
                : p.status === "rejected"
                  ? t.bad
                  : p.status === "sent"
                    ? t.warn
                    : t.muted
            return (
              <View key={p.id} style={{ paddingVertical: 12, gap: 6 }}>
                <Line style={{ gap: 12, alignItems: "flex-start" }}>
                  {thumb ? (
                    <Tap
                      label="Open the proof photo"
                      onPress={() => setViewing(p.id)}
                    >
                      <Image
                        source={{ uri: thumb }}
                        accessibilityLabel="Proof of payment"
                        style={{
                          width: 44,
                          height: 56,
                          borderRadius: 8,
                          backgroundColor: t.soft,
                        }}
                      />
                    </Tap>
                  ) : p.proofMediaId ? (
                    <View
                      accessibilityLabel="Proof photo, loads when online"
                      style={{
                        width: 44,
                        height: 56,
                        borderRadius: 8,
                        backgroundColor: t.soft,
                      }}
                    />
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <Line style={{ justifyContent: "space-between", gap: 8 }}>
                      <Copy size={14} weight="medium">
                        {m(p.amount, cur)}
                        {p.kind === "cash" ? " cash" : ""}
                      </Copy>
                      <Copy size={12} muted>
                        {shortDate(p.paidOn)}
                      </Copy>
                    </Line>
                    <Copy size={12} style={{ color: tone }}>
                      {PAY_LABEL[p.status]}
                    </Copy>
                    {p.note && (
                      <Copy size={12} muted>
                        {p.note}
                      </Copy>
                    )}
                    {p.reason && (
                      <Copy size={12} style={{ color: t.bad }}>
                        {p.reason}
                      </Copy>
                    )}
                  </View>
                </Line>
                {p.status === "sent" && lender && (
                  <Line style={{ gap: 8, justifyContent: "flex-end" }}>
                    <SmallButton accent="fin" onPress={() => setDeciding(p.id)}>
                      Review
                    </SmallButton>
                  </Line>
                )}
                {p.status === "sent" && !lender && (
                  <Line style={{ justifyContent: "flex-end" }}>
                    <SmallButton
                      accent="fin"
                      quiet
                      onPress={() =>
                        confirm(
                          "Withdraw this payment?",
                          `${who.name} won't be asked to confirm it.`,
                          () => L.withdrawPayment(loan.loanId, p.id),
                        )
                      }
                    >
                      Withdraw
                    </SmallButton>
                  </Line>
                )}
              </View>
            )
          })}
        </Frame>
      ) : (
        <Frame style={{ padding: 16 }}>
          <Copy size={13} muted>
            {loan.status === "active"
              ? lender
                ? `When ${who.name} pays, it shows here for you to confirm.`
                : `Each payment you send shows here until ${who.name} confirms it.`
              : "Payments show here once the loan is accepted."}
          </Copy>
        </Frame>
      )}

      {paying && (
        <PaySheet
          loan={loan}
          cash={paying === "cash"}
          open
          onClose={() => setPaying(null)}
        />
      )}
      {deciding_ && (
        <DecideSheet
          loan={loan}
          payment={deciding_}
          open
          onClose={() => setDeciding(null)}
        />
      )}
      <Sheet title="Proof" open={!!viewing} onClose={() => setViewing(null)}>
        {viewed ? (
          <Image
            source={{ uri: viewed }}
            accessibilityLabel="Proof of payment"
            resizeMode="contain"
            style={{ width: "100%", aspectRatio: 0.75, borderRadius: 12 }}
          />
        ) : (
          <Copy size={13} muted>
            The photo loads when you're online.
          </Copy>
        )}
      </Sheet>
      {moment && (
        <MomentCard
          kind="loan"
          testID="loan-paid"
          label="Paid in full"
          title={
            lender
              ? `${who.name} paid you back in full`
              : `You paid ${who.name} back in full`
          }
          detail={
            <Copy size={13} muted>
              {m(loan.total, cur)} over{" "}
              {loan.payments.filter((p) => p.status === "accepted").length}{" "}
              payments
            </Copy>
          }
          badge={<Check size={24} color="#fff" strokeWidth={3} />}
          tint={t.good}
          say={`Loan paid in full: ${m(loan.total, cur)}.`}
          hint="Dismisses"
          onOpen={closeMoment}
          onClose={closeMoment}
        />
      )}
    </Screen>
  )
}
