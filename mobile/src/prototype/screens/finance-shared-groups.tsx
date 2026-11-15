// Shared savings goals and shared budgets inside Finance: cards for the
// Shared list, a screen for each, and the sheets to make one, join one,
// put money in, ask to take some out, and answer someone's withdrawal.
// Reads the synced store (offline too); every change is one sync action.
import { shortDate } from "@domain/finance/calc"
import * as G from "@domain/finance/groups"
import { type LoanPerson, sharedStore } from "@domain/finance/loans"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { currencyInfo, money, useCurrency } from "@domain/lib/money"
import { Check, PiggyBank } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { useCountUp } from "../motion"
import {
  Bar,
  Copy,
  Frame,
  Line,
  SectionHeading,
  SmallButton,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Button, confirm, DateField, Empty, Field, Screen, Sheet } from "../ui"
import {
  AccountChoice,
  AmountStepper,
  owner,
  toCentavos,
  useConnections,
} from "./finance-loan-sheets"
import { FinPill } from "./finance-planned"
import { useLoanMoney } from "./finance-shared"

// ---------------------------------------------------------------- cards

export function GoalCard({ goal }: { goal: G.SharedGoal }) {
  const t = useTheme(),
    m = useLoanMoney(),
    s = G.goalSummary(goal),
    reached = goal.target !== undefined && s.balance >= goal.target
  return (
    <Frame style={{ marginBottom: 8 }}>
      <Tap
        label={`Shared goal ${goal.name}`}
        onPress={() => go(`/finance/shared/goal/${goal.goalId}`)}
        style={{ padding: 16 }}
      >
        <Line
          style={{
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <Copy weight="medium" style={{ flex: 1 }}>
            {goal.name}
          </Copy>
          {goal.myStatus === "invited" ? (
            <FinPill tone="warn">Invite</FinPill>
          ) : s.pending > 0 ? (
            <FinPill tone="warn">Withdrawal to answer</FinPill>
          ) : reached ? (
            <FinPill tone="good">Target reached</FinPill>
          ) : null}
        </Line>
        <Copy size={24} weight="displayMedium" fit style={{ marginTop: 8 }}>
          {m(s.balance, goal.currency)}
        </Copy>
        <Copy size={12} muted>
          saved together
          {goal.target ? ` of ${m(goal.target, goal.currency)}` : ""}
          {goal.deadline ? ` · by ${shortDate(goal.deadline)}` : ""}
        </Copy>
        {goal.target !== undefined && (
          <View style={{ marginTop: 10 }}>
            <Bar value={s.progress} color={reached ? t.good : t.fin} />
          </View>
        )}
        <Copy size={12} muted style={{ marginTop: 8 }}>
          {goal.members
            .filter((x) => x.status === "active")
            .map((x) => x.person.name)
            .join(", ")}
        </Copy>
      </Tap>
    </Frame>
  )
}

export function BudgetCard({ budget }: { budget: G.SharedBudget }) {
  const t = useTheme(),
    m = useLoanMoney(),
    pct = G.budgetPct(budget),
    color = pct >= 1 ? t.bad : pct >= 0.8 ? t.warn : t.good
  return (
    <Frame style={{ marginBottom: 8 }}>
      <Tap
        label={`Shared budget ${budget.name}`}
        onPress={() => go(`/finance/shared/budget/${budget.budgetId}`)}
        style={{ padding: 16 }}
      >
        <Line
          style={{
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <Copy weight="medium" style={{ flex: 1 }}>
            {budget.name}
          </Copy>
          {budget.myStatus === "invited" ? (
            <FinPill tone="warn">Invite</FinPill>
          ) : (
            <FinPill tone={pct >= 1 ? "bad" : pct >= 0.8 ? "warn" : "good"}>
              {`${Math.round(pct * 100)}% used`}
            </FinPill>
          )}
        </Line>
        <View style={{ marginTop: 12 }}>
          <Bar value={Math.max(0, 1 - pct)} color={color} />
        </View>
        <Copy size={12} muted style={{ marginTop: 8 }}>
          {m(budget.spent, budget.currency)} of{" "}
          {m(budget.limit, budget.currency)} this month
        </Copy>
      </Tap>
    </Frame>
  )
}

// ---------------------------------------------------------------- new goal / budget

function PeoplePicker({
  open,
  picked,
  onChange,
}: {
  open: boolean
  picked: string[]
  onChange: (ids: string[]) => void
}) {
  const t = useTheme(),
    { people, failed } = useConnections(open)
  if (failed)
    return (
      <Copy size={14} style={{ color: t.bad }}>
        Couldn't load the people you follow. Check your connection.
      </Copy>
    )
  if (!people?.length)
    return (
      <Copy size={13} muted>
        {people === null
          ? "Loading…"
          : "Follow someone in Social first — you share with people you follow or who follow you."}
      </Copy>
    )
  return (
    <View style={{ gap: 4 }}>
      {people.slice(0, 12).map((p) => {
        const on = picked.includes(p.id)
        return (
          <Tap
            key={p.id}
            label={`${on ? "Remove" : "Add"} ${p.name}`}
            onPress={() =>
              onChange(
                on ? picked.filter((x) => x !== p.id) : [...picked, p.id],
              )
            }
            style={{
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: on ? t.fin : t.line,
              backgroundColor: on ? `${t.fin}14` : t.card,
            }}
          >
            <Line style={{ gap: 8 }}>
              <Copy size={14} weight="medium" style={{ flex: 1 }}>
                {p.name}
              </Copy>
              {on && <Check size={18} color={t.fin} />}
            </Line>
          </Tap>
        )
      })}
    </View>
  )
}

/** Which of my own expense categories count (none picked: all spending). */
function CategoryChips({
  value,
  onChange,
}: {
  value: string[]
  onChange: (ids: string[]) => void
}) {
  const t = useTheme(),
    cats = finStore
      .use((s) => s.categories)
      .filter(
        (c) => c.kind === "expense" && !c.archived && !c.system && !c.parentId,
      )
  return (
    <View>
      <Copy size={12} muted>
        My spending that counts {value.length ? "" : "(all, until you pick)"}
      </Copy>
      <Line style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }}>
        {cats.map((c) => {
          const on = value.includes(c.id)
          return (
            <Tap
              key={c.id}
              label={`${on ? "Don't count" : "Count"} ${c.name}`}
              onPress={() =>
                onChange(
                  on ? value.filter((x) => x !== c.id) : [...value, c.id],
                )
              }
              style={{
                paddingVertical: 6,
                paddingHorizontal: 10,
                borderRadius: 99,
                borderWidth: 1,
                borderColor: on ? t.fin : t.line,
                backgroundColor: on ? `${t.fin}14` : t.card,
              }}
            >
              <Copy size={13}>
                {c.icon} {c.name}
              </Copy>
            </Tap>
          )
        })}
      </Line>
    </View>
  )
}

export function NewGroupSheet({
  kind,
  open,
  onClose,
  onMade,
}: {
  kind: "goal" | "budget"
  open: boolean
  onClose: () => void
  onMade: (href: string) => void
}) {
  const t = useTheme(),
    c = useCurrency(),
    { people } = useConnections(open),
    [name, setName] = useState(""),
    [amount, setAmount] = useState(0),
    [deadline, setDeadline] = useState(""),
    [who, setWho] = useState<string[]>([]),
    [cats, setCats] = useState<string[]>([]),
    [tried, setTried] = useState(false)
  const goal = kind === "goal",
    minor = toCentavos(amount),
    ok = name.trim() !== "" && who.length > 0 && (goal || minor > 0)
  const save = () => {
    setTried(true)
    if (!ok) return
    const me: LoanPerson = { id: owner(), name: "You" }
    const members = (people ?? []).filter((p) => who.includes(p.id))
    if (goal) {
      const g = G.createGoal({
        me,
        members,
        name,
        currency: c.code,
        target: minor || undefined,
        deadline: deadline || undefined,
      })
      onMade(`/finance/shared/goal/${g.goalId}`)
    } else {
      const b = G.createBudget({
        me,
        members,
        name,
        currency: c.code,
        limit: minor,
        categoryIds: cats,
        month: dayKey().slice(0, 7),
      })
      onMade(`/finance/shared/budget/${b.budgetId}`)
    }
  }
  return (
    <Sheet
      title={goal ? "New shared goal" : "New shared budget"}
      open={open}
      onClose={onClose}
      footer={
        <Button onPress={save}>
          {goal ? "Start saving together" : "Share budget"}
        </Button>
      }
    >
      <Field
        label="Name"
        placeholder={
          goal ? "e.g. Japan trip, New sofa" : "e.g. Groceries, Date nights"
        }
        value={name}
        onChangeText={setName}
        maxLength={80}
        error={tried && !name.trim() ? "Give it a name" : undefined}
      />
      <AmountStepper
        label={goal ? "Target (optional)" : "Monthly limit"}
        value={amount}
        onChange={setAmount}
      />
      {tried && !goal && minor <= 0 && (
        <Copy size={12} style={{ color: t.bad }}>
          Set the monthly limit
        </Copy>
      )}
      {goal && (
        <DateField
          label="By (optional)"
          value={deadline}
          onChangeText={setDeadline}
          minimumDate={dayKey()}
          clearable
          placeholder="No deadline"
        />
      )}
      <Copy size={12} muted>
        With
      </Copy>
      <PeoplePicker open={open} picked={who} onChange={setWho} />
      {tried && !who.length && (
        <Copy size={12} style={{ color: t.bad }}>
          Pick who shares it
        </Copy>
      )}
      {!goal && <CategoryChips value={cats} onChange={setCats} />}
      {goal && amount > 0 && (
        <Copy size={12} muted>
          Everyone sees the balance and who put in what. Taking money out needs
          another member's okay.
        </Copy>
      )}
      {!goal && amount > 0 && (
        <Copy size={12} muted>
          Everyone is told at 80% and 100% of {money(amount, c)}.
        </Copy>
      )}
    </Sheet>
  )
}

// ---------------------------------------------------------------- goal screen

function EntrySheet({
  goal,
  kind,
  onClose,
}: {
  goal: G.SharedGoal
  kind: "deposit" | "withdrawal"
  onClose: () => void
}) {
  const t = useTheme(),
    cur = currencyInfo(goal.currency),
    today = dayKey(),
    room = G.goalRoom(goal),
    [amount, setAmount] = useState(0),
    [onDate, setOnDate] = useState(today),
    [account, setAccount] = useState(
      () => finStore.get().accounts.find((a) => !a.archived)?.id ?? "",
    ),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    minor = toCentavos(amount),
    out = kind === "withdrawal"
  const save = () => {
    if (minor <= 0) return setError("Enter how much")
    if (out && minor > room)
      return setError(`The goal has ${money(room / 100, cur)} to take out`)
    if (!account) return setError("Pick an account")
    G.addEntry(goal.goalId, {
      kind,
      amount: minor,
      onDate,
      accountId: account,
      note,
      me: owner(),
    })
    onClose()
  }
  return (
    <Sheet
      title={out ? `Take out of ${goal.name}` : `Put into ${goal.name}`}
      open
      onClose={onClose}
      footer={
        <Button onPress={save}>
          {out
            ? `Ask for ${money(amount, cur)}`
            : `Put in ${money(amount, cur)}`}
        </Button>
      }
    >
      <AmountStepper
        label="Amount"
        value={amount}
        onChange={setAmount}
        max={out ? room / 100 : undefined}
      />
      <DateField
        label="On"
        value={onDate}
        onChangeText={setOnDate}
        maximumDate={today}
      />
      <AccountChoice
        label={out ? "Into" : "From"}
        value={account}
        onChange={setAccount}
      />
      <Field
        label="Note (optional)"
        placeholder={out ? "e.g. Flight deposit" : "e.g. November share"}
        value={note}
        onChangeText={setNote}
        maxLength={280}
      />
      {out && (
        <Copy size={12} muted>
          Another member okays it before it comes out.
        </Copy>
      )}
      {error !== "" && (
        <Copy size={12} style={{ color: t.bad }}>
          {error}
        </Copy>
      )}
    </Sheet>
  )
}

function RejectSheet({
  goal,
  entry,
  onClose,
}: {
  goal: G.SharedGoal
  entry: G.GoalEntry
  onClose: () => void
}) {
  const [reason, setReason] = useState(""),
    [tried, setTried] = useState(false)
  return (
    <Sheet
      title="Not this time"
      open
      onClose={onClose}
      footer={
        <Button
          tone="danger"
          onPress={() => {
            setTried(true)
            if (!reason.trim()) return
            G.decideEntry(goal.goalId, entry.id, false, owner(), reason)
            onClose()
          }}
        >
          Don't okay it
        </Button>
      }
    >
      <Field
        label="Why not?"
        placeholder="e.g. Let's keep it for the flights"
        value={reason}
        onChangeText={setReason}
        maxLength={280}
        error={tried && !reason.trim() ? "Say why, so they know" : undefined}
      />
    </Sheet>
  )
}

const ENTRY_LABEL: Record<G.GoalEntry["status"], string> = {
  sent: "Waiting for an okay",
  accepted: "Done",
  rejected: "Not okayed",
  withdrawn: "Taken back",
}

export function GoalDetail({ goalId }: { goalId: string }) {
  const t = useTheme(),
    m = useLoanMoney(),
    goal = sharedStore.use((s) =>
      (s.goals ?? []).find((g) => g.goalId === goalId),
    ),
    me = owner(),
    [sheet, setSheet] = useState<"deposit" | "withdrawal" | null>(null),
    [rejecting, setRejecting] = useState<string | null>(null),
    bal = goal ? G.goalSummary(goal).balance : 0,
    shown = useCountUp(bal, undefined, bal)
  if (!goal)
    return (
      <Screen prototypeLayout title="Shared goal">
        <Empty
          title="Goal not found"
          detail="It may still be on its way. Try again in a moment."
        />
      </Screen>
    )
  const s = G.goalSummary(goal),
    active = goal.myStatus === "active",
    reached = goal.target !== undefined && s.balance >= goal.target,
    entries = [...goal.entries].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
    rejectOf = goal.entries.find((e) => e.id === rejecting)
  return (
    <Screen prototypeLayout title={goal.name}>
      <Frame style={{ padding: 16 }}>
        <Line style={{ justifyContent: "space-between", gap: 8 }}>
          <Copy size={12} muted style={{ flex: 1 }}>
            Saved together
          </Copy>
          {reached && <FinPill tone="good">Target reached</FinPill>}
        </Line>
        <Copy
          size={30}
          weight="displayMedium"
          fit
          style={{ color: reached ? t.good : t.text }}
        >
          {m(Math.round(shown), goal.currency)}
        </Copy>
        <Copy size={12} muted>
          {goal.target ? `of ${m(goal.target, goal.currency)}` : "No target"}
          {goal.deadline ? ` · by ${shortDate(goal.deadline)}` : ""}
          {s.pending
            ? ` · ${m(s.pending, goal.currency)} waiting to come out`
            : ""}
        </Copy>
        {goal.target !== undefined && (
          <View style={{ marginTop: 12 }}>
            <Bar value={s.progress} color={reached ? t.good : t.fin} />
          </View>
        )}
      </Frame>
      {goal.myStatus === "invited" ? (
        <Frame style={{ padding: 16, gap: 8 }}>
          <Copy size={14}>
            You're invited to save toward {goal.name} together.
          </Copy>
          <Line style={{ gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button onPress={() => G.respondGoal(goal.goalId, true)}>
                Join
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button
                tone="quiet"
                onPress={() => G.respondGoal(goal.goalId, false)}
              >
                Decline
              </Button>
            </View>
          </Line>
        </Frame>
      ) : (
        active && (
          <Line style={{ gap: 8, marginTop: 4 }}>
            <View style={{ flex: 1 }}>
              <Button icon={PiggyBank} onPress={() => setSheet("deposit")}>
                Put in
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button
                tone="quiet"
                onPress={() => setSheet("withdrawal")}
                disabled={G.goalRoom(goal) === 0}
              >
                Take out
              </Button>
            </View>
          </Line>
        )
      )}

      <SectionHeading>Who put in what</SectionHeading>
      <Frame style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
        {goal.members.map((x) => (
          <Line
            key={x.person.id}
            style={{
              justifyContent: "space-between",
              paddingVertical: 10,
              gap: 8,
            }}
          >
            <View style={{ flex: 1 }}>
              <Copy size={14}>
                {x.person.id === me ? "You" : x.person.name}
              </Copy>
              {x.status === "invited" && (
                <Copy size={12} muted>
                  Invited
                </Copy>
              )}
            </View>
            <Copy size={14} weight="medium">
              {m(s.byMember[x.person.id] ?? 0, goal.currency)}
            </Copy>
          </Line>
        ))}
      </Frame>

      <SectionHeading>History</SectionHeading>
      <Frame style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
        {entries.length === 0 && (
          <Copy size={13} muted style={{ paddingVertical: 12 }}>
            Every amount put in or taken out shows here.
          </Copy>
        )}
        {entries.map((e) => {
          const by =
              goal.members.find((x) => x.person.id === e.byId)?.person.name ??
              "Someone",
            mine = e.byId === me,
            tone =
              e.status === "accepted"
                ? e.kind === "deposit"
                  ? t.good
                  : t.text
                : e.status === "rejected"
                  ? t.bad
                  : e.status === "sent"
                    ? t.warn
                    : t.muted
          return (
            <View key={e.id} style={{ paddingVertical: 10, gap: 4 }}>
              <Line style={{ justifyContent: "space-between", gap: 8 }}>
                <Copy size={14} weight="medium" style={{ flex: 1 }}>
                  {e.kind === "deposit" ? "+" : "−"}
                  {m(e.amount, goal.currency)} · {mine ? "You" : by}
                </Copy>
                <Copy size={12} muted>
                  {shortDate(e.onDate)}
                </Copy>
              </Line>
              {e.kind === "withdrawal" && (
                <Copy size={12} style={{ color: tone }}>
                  {ENTRY_LABEL[e.status]}
                </Copy>
              )}
              {e.note && (
                <Copy size={12} muted>
                  {e.note}
                </Copy>
              )}
              {e.reason && (
                <Copy size={12} style={{ color: t.bad }}>
                  {e.reason}
                </Copy>
              )}
              {e.status === "sent" && !mine && active && (
                <Line style={{ gap: 8, justifyContent: "flex-end" }}>
                  <SmallButton
                    accent="fin"
                    quiet
                    onPress={() => setRejecting(e.id)}
                  >
                    Not now
                  </SmallButton>
                  <SmallButton
                    accent="fin"
                    onPress={() => G.decideEntry(goal.goalId, e.id, true, me)}
                  >
                    Okay it
                  </SmallButton>
                </Line>
              )}
              {e.status === "sent" && mine && (
                <Line style={{ justifyContent: "flex-end" }}>
                  <SmallButton
                    accent="fin"
                    quiet
                    onPress={() =>
                      confirm(
                        "Take this request back?",
                        "Nobody will be asked to okay it.",
                        () => G.withdrawEntry(goal.goalId, e.id, me),
                      )
                    }
                  >
                    Take back
                  </SmallButton>
                </Line>
              )}
            </View>
          )
        })}
      </Frame>
      {sheet && (
        <EntrySheet goal={goal} kind={sheet} onClose={() => setSheet(null)} />
      )}
      {rejectOf && (
        <RejectSheet
          goal={goal}
          entry={rejectOf}
          onClose={() => setRejecting(null)}
        />
      )}
    </Screen>
  )
}

// ---------------------------------------------------------------- budget screen

export function BudgetDetail({ budgetId }: { budgetId: string }) {
  const t = useTheme(),
    m = useLoanMoney(),
    budget = sharedStore.use((s) =>
      (s.budgets ?? []).find((b) => b.budgetId === budgetId),
    ),
    me = owner(),
    [cats, setCats] = useState<string[] | null>(null)
  if (!budget)
    return (
      <Screen prototypeLayout title="Shared budget">
        <Empty
          title="Budget not found"
          detail="It may still be on its way. Try again in a moment."
        />
      </Screen>
    )
  const pct = G.budgetPct(budget),
    left = budget.limit - budget.spent,
    color = pct >= 1 ? t.bad : pct >= 0.8 ? t.warn : t.good
  return (
    <Screen prototypeLayout title={budget.name}>
      <Frame style={{ padding: 16 }}>
        <Copy size={12} muted>
          {left >= 0 ? "Left this month" : "Over this month"}
        </Copy>
        <Copy
          size={30}
          weight="displayMedium"
          fit
          style={{ color: left < 0 ? t.bad : t.text }}
        >
          {left < 0
            ? `−${m(-left, budget.currency)}`
            : m(left, budget.currency)}
        </Copy>
        <Copy size={12} muted>
          {m(budget.spent, budget.currency)} of{" "}
          {m(budget.limit, budget.currency)} spent together
        </Copy>
        <View style={{ marginTop: 12 }}>
          <Bar value={Math.max(0, 1 - pct)} color={color} />
        </View>
      </Frame>
      {budget.myStatus === "invited" && (
        <Frame style={{ padding: 16, gap: 8 }}>
          <Copy size={14}>Pick which of your spending counts, then join.</Copy>
          <CategoryChips value={cats ?? []} onChange={setCats} />
          <Line style={{ gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button
                onPress={() =>
                  G.respondBudget(budget.budgetId, true, cats ?? [])
                }
              >
                Join
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button
                tone="quiet"
                onPress={() => G.respondBudget(budget.budgetId, false)}
              >
                Decline
              </Button>
            </View>
          </Line>
        </Frame>
      )}
      <SectionHeading>Who spent what</SectionHeading>
      <Frame style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
        {budget.members.map((x) => (
          <View key={x.person.id} style={{ paddingVertical: 10, gap: 6 }}>
            <Line style={{ justifyContent: "space-between", gap: 8 }}>
              <Copy size={14} style={{ flex: 1 }}>
                {x.person.id === me ? "You" : x.person.name}
                {x.status === "invited" ? " · invited" : ""}
              </Copy>
              <Copy size={14} weight="medium">
                {m(x.amount, budget.currency)}
              </Copy>
            </Line>
            <Bar
              value={budget.limit ? Math.min(1, x.amount / budget.limit) : 0}
              color={t.fin}
            />
          </View>
        ))}
      </Frame>
      {budget.myStatus === "active" && (
        <>
          <SectionHeading>Your spending that counts</SectionHeading>
          <Frame style={{ padding: 16, gap: 8 }}>
            <CategoryChips
              value={cats ?? budget.myCategoryIds}
              onChange={(ids) => {
                setCats(ids)
                G.setBudgetCategories(budget.budgetId, ids)
              }}
            />
          </Frame>
        </>
      )}
      <Copy size={12} muted style={{ marginTop: 8 }}>
        Everyone is told at 80% and 100%. Figures refresh as members log.
      </Copy>
    </Screen>
  )
}
