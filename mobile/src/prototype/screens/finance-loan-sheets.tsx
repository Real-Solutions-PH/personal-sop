// The sheets of shared money: make a loan, pay (with proof), record cash,
// and answer a sent payment. Amounts are typed in major units on a stepper
// and leave as integer centavos.
import { dashStore } from "@domain/dash/store"
import { shortDate } from "@domain/finance/calc"
import * as L from "@domain/finance/loans"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { currencyInfo, money, useCurrency } from "@domain/lib/money"
import { getConnectivity } from "@domain/lib/platform"
import { Camera, Check, ImagePlus, X } from "lucide-react-native"
import { useEffect, useState } from "react"
import { Image, View } from "react-native"
import { Stepper } from "../fitness-controls"
import { pickPhoto } from "../media"
import { prototypeMode } from "../mode"
import { Copy, IconTap, Line, Tap } from "../native-kit"
import { socialStore } from "../social/store"
import { Switch } from "../switch"
import { useTheme } from "../theme"
import { Button, Choices, DateField, Field, Sheet } from "../ui"

/** Major units -> centavos, half-up, without float noise. */
export const toCentavos = (major: number) =>
  Math.round(Number.parseFloat((major * 100).toPrecision(12)))

const live = () =>
  require("@/live/shared-finance") as typeof import("@/live/shared-finance")
const owner = () =>
  prototypeMode
    ? "me"
    : ((
        require("@/live/runtime") as typeof import("@/live/runtime")
      ).liveOwner() ?? "me")

/** Who this person may lend to: everyone they follow or who follows them. */
function useConnections(open: boolean) {
  const demo = socialStore.use((s) => s.people)
  const [people, setPeople] = useState<L.LoanPerson[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!open) return
    if (prototypeMode) {
      setPeople(
        demo
          .filter((p) => p.isFollowing)
          .map((p) => ({ id: p.id, name: p.name, handle: p.username })),
      )
      return
    }
    let gone = false
    setFailed(false)
    live()
      .connections(owner())
      .then((list) => !gone && setPeople(list))
      .catch(() => !gone && setFailed(true))
    return () => {
      gone = true
    }
  }, [open, demo])
  return { people, failed }
}

function AccountChoice({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (id: string) => void
}) {
  const accounts = finStore.use((s) => s.accounts).filter((a) => !a.archived)
  if (!accounts.length)
    return (
      <Copy size={12} muted>
        Add an account in Finance first.
      </Copy>
    )
  return (
    <Choices
      label={label}
      value={value}
      onChange={onChange}
      options={accounts.map((a) => ({ value: a.id, label: a.name }))}
      wrap
    />
  )
}

function AmountStepper({
  label,
  value,
  onChange,
  max,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  max?: number
}) {
  const c = useCurrency()
  return (
    <Stepper
      label={label}
      value={value}
      onChange={onChange}
      step={100}
      min={0}
      max={max ?? 100_000_000}
      decimals={c.digits}
      unit={c.code}
    />
  )
}

// ---------------------------------------------------------------- new loan

export function NewLoanSheet({
  open,
  onClose,
  onMade,
}: {
  open: boolean
  onClose: () => void
  onMade: (loanId: string) => void
}) {
  const t = useTheme(),
    c = useCurrency(),
    accounts = finStore.use((s) => s.accounts).filter((a) => !a.archived),
    myName = dashStore.use((s) => s.profile.name),
    { people, failed } = useConnections(open),
    today = dayKey(),
    [who, setWho] = useState(""),
    [q, setQ] = useState(""),
    [amount, setAmount] = useState(0),
    [interest, setInterest] = useState(0),
    [purpose, setPurpose] = useState(""),
    [account, setAccount] = useState(""),
    [logOutlay, setLogOutlay] = useState(true),
    [count, setCount] = useState(6),
    [start, setStart] = useState(today),
    [day, setDay] = useState(Number(today.slice(8, 10))),
    [tried, setTried] = useState(false)
  const total = toCentavos(amount) + toCentavos(interest),
    plan = L.monthlyInstallments(total, count, start, day),
    picked = people?.find((p) => p.id === who),
    shown = (people ?? []).filter((p) =>
      `${p.name} ${p.handle ?? ""}`.toLowerCase().includes(q.toLowerCase()),
    ),
    ok = !!picked && total > 0 && plan.length === count
  const save = () => {
    setTried(true)
    if (!ok || !picked) return
    const loan = L.createLoan({
      me: { id: owner(), name: myName || "You" },
      borrower: picked,
      principal: toCentavos(amount),
      interest: toCentavos(interest),
      currency: c.code,
      purpose,
      accountId: account || undefined,
      logOutlay: account ? logOutlay : undefined,
      count,
      start,
      day,
    })
    onMade(loan.loanId)
  }
  return (
    <Sheet
      title="New loan"
      open={open}
      onClose={onClose}
      footer={
        <Button onPress={save} disabled={tried && !ok}>
          {picked ? `Send to ${picked.name}` : "Send invite"}
        </Button>
      }
    >
      <Copy size={12} muted>
        Who borrowed
      </Copy>
      {failed ? (
        <Copy size={14} style={{ color: t.bad }}>
          Couldn't load the people you follow. Check your connection.
        </Copy>
      ) : (
        <>
          <Field
            label="Search people"
            hideLabel
            placeholder="Search people you follow"
            value={q}
            onChangeText={setQ}
          />
          <View style={{ gap: 4 }}>
            {(people ?? []).length === 0 && (
              <Copy size={13} muted>
                {people === null
                  ? "Loading…"
                  : "Follow someone in Social first — loans are between people who follow each other."}
              </Copy>
            )}
            {shown.slice(0, 8).map((p) => (
              <Tap
                key={p.id}
                label={`Lend to ${p.name}`}
                onPress={() => setWho(p.id)}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: p.id === who ? t.fin : t.line,
                  backgroundColor: p.id === who ? `${t.fin}14` : t.card,
                }}
              >
                <Line style={{ gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Copy size={14} weight="medium">
                      {p.name}
                    </Copy>
                    {p.handle && (
                      <Copy size={12} muted>
                        @{p.handle}
                      </Copy>
                    )}
                  </View>
                  {p.id === who && <Check size={18} color={t.fin} />}
                </Line>
              </Tap>
            ))}
          </View>
          {tried && !picked && (
            <Copy size={12} style={{ color: t.bad }}>
              Pick who borrowed
            </Copy>
          )}
        </>
      )}
      <AmountStepper label="Amount lent" value={amount} onChange={setAmount} />
      {tried && total <= 0 && (
        <Copy size={12} style={{ color: t.bad }}>
          Enter how much
        </Copy>
      )}
      <Field
        label="For (optional)"
        placeholder="e.g. Phone, Rent share"
        value={purpose}
        onChangeText={setPurpose}
        maxLength={120}
      />
      <AmountStepper
        label="Interest on top (optional)"
        value={interest}
        onChange={setInterest}
      />
      {accounts.length > 0 && (
        <>
          <Choices
            label="Paid from (optional)"
            value={account}
            onChange={(v) => setAccount(v === account ? "" : v)}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
            wrap
          />
          {account !== "" && (
            <Line style={{ gap: 12 }}>
              <Copy size={14} style={{ flex: 1 }}>
                Also log {money(amount, c)} as spent from this account
              </Copy>
              <Switch
                value={logOutlay}
                onChange={setLogOutlay}
                accent="fin"
                label="Log as spent"
              />
            </Line>
          )}
        </>
      )}
      <Line style={{ gap: 12, alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Stepper
            label="Monthly payments"
            value={count}
            onChange={(n) => setCount(Math.round(n))}
            step={1}
            min={1}
            max={60}
            decimals={0}
            compact
          />
        </View>
        <View style={{ flex: 1 }}>
          <Stepper
            label="Day of month"
            value={day}
            onChange={(n) => setDay(Math.round(n))}
            step={1}
            min={1}
            max={31}
            decimals={0}
            compact
          />
        </View>
      </Line>
      <DateField label="Starting" value={start} onChangeText={setStart} />
      {plan.length > 0 && (
        <View
          style={{
            padding: 12,
            borderRadius: 12,
            backgroundColor: t.soft,
            gap: 2,
          }}
        >
          <Copy size={14} weight="medium">
            {count} × {money(plan[plan.length - 1].amount / 100, c)}
            {plan[0].amount !== plan[plan.length - 1].amount
              ? ` (first ${money(plan[0].amount / 100, c)})`
              : ""}
          </Copy>
          <Copy size={12} muted>
            {shortDate(plan[0].due)} to {shortDate(plan[plan.length - 1].due)} ·{" "}
            {money(total / 100, c)} in all
          </Copy>
        </View>
      )}
    </Sheet>
  )
}

// ---------------------------------------------------------------- pay / cash

function ProofPicker({
  uri,
  onPick,
  onClear,
}: {
  uri: string | null
  onPick: (uri: string) => void
  onClear: () => void
}) {
  const t = useTheme()
  if (uri)
    return (
      <View style={{ alignSelf: "flex-start" }}>
        <Image
          source={{ uri }}
          accessibilityLabel="Proof of payment"
          style={{ width: 120, height: 160, borderRadius: 12 }}
        />
        <View style={{ position: "absolute", top: 4, right: 4 }}>
          <IconTap
            size={32}
            icon={X}
            label="Remove proof photo"
            color="#fff"
            onPress={onClear}
          />
        </View>
      </View>
    )
  return (
    <Line style={{ gap: 8 }}>
      <Button
        small
        tone="quiet"
        icon={ImagePlus}
        onPress={() => void pickPhoto(false).then((u) => u && onPick(u))}
      >
        Add screenshot
      </Button>
      <Button
        small
        tone="quiet"
        icon={Camera}
        label="Take a photo of the receipt"
        onPress={() => void pickPhoto(true).then((u) => u && onPick(u))}
      >
        Photo
      </Button>
      <Copy size={12} muted style={{ flex: 1, color: t.muted }}>
        Proof helps them confirm it
      </Copy>
    </Line>
  )
}

export function PaySheet({
  loan,
  cash = false,
  open,
  onClose,
}: {
  loan: L.Loan
  /** The lender recording cash received in hand. */
  cash?: boolean
  open: boolean
  onClose: () => void
}) {
  const t = useTheme(),
    cur = currencyInfo(loan.currency),
    today = dayKey(),
    room = L.room(loan),
    [amount, setAmount] = useState(L.suggestedPayment(loan, today) / 100),
    [paidOn, setPaidOn] = useState(today),
    [account, setAccount] = useState(
      () => finStore.get().accounts.find((a) => !a.archived)?.id ?? "",
    ),
    [note, setNote] = useState(""),
    [photo, setPhoto] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    minor = toCentavos(amount),
    ok = minor > 0 && minor <= room && !!account
  const save = async () => {
    setError("")
    if (!ok) {
      setError(
        minor > room
          ? `That's more than the ${money(room / 100, cur)} left`
          : !account
            ? "Pick an account"
            : "Enter how much",
      )
      return
    }
    let proofMediaId: string | undefined
    if (photo && !prototypeMode) {
      if (!getConnectivity()) {
        setError("You're offline — send it without the photo, or try again")
        return
      }
      setBusy(true)
      try {
        proofMediaId = await live().uploadProof(photo)
      } catch {
        setBusy(false)
        setError("Couldn't upload the photo. Try again.")
        return
      }
      setBusy(false)
    }
    const p = {
      amount: minor,
      paidOn,
      accountId: account,
      note,
      proofMediaId,
      proofUri: photo ?? undefined,
    }
    if (cash) L.recordCash(loan.loanId, p)
    else L.sendPayment(loan.loanId, p)
    onClose()
  }
  const other = cash ? loan.borrower : loan.lender
  return (
    <Sheet
      title={cash ? "Record cash" : `Pay ${other.name}`}
      open={open}
      onClose={onClose}
      footer={
        <Button onPress={() => void save()} disabled={busy}>
          {busy
            ? "Uploading…"
            : cash
              ? `Record ${money(amount, cur)}`
              : `Send ${money(amount, cur)}`}
        </Button>
      }
    >
      <AmountStepper
        label="Amount"
        value={amount}
        onChange={setAmount}
        max={room / 100}
      />
      <Copy size={12} muted style={{ textAlign: "center" }}>
        {money(room / 100, cur)} left to pay
      </Copy>
      <DateField
        label={cash ? "Received on" : "Paid on"}
        value={paidOn}
        onChangeText={setPaidOn}
        maximumDate={today}
      />
      <AccountChoice
        label={cash ? "Into" : "Paid from"}
        value={account}
        onChange={setAccount}
      />
      {!cash && (
        <ProofPicker
          uri={photo}
          onPick={setPhoto}
          onClear={() => setPhoto(null)}
        />
      )}
      <Field
        label="Note (optional)"
        placeholder={cash ? "e.g. Handed over at lunch" : "e.g. GCash ref 1234"}
        value={note}
        onChangeText={setNote}
        maxLength={280}
      />
      {!cash && (
        <Copy size={12} muted>
          {other.name} confirms it before it counts as paid.
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

// ---------------------------------------------------------------- decide

export function DecideSheet({
  loan,
  payment,
  open,
  onClose,
}: {
  loan: L.Loan
  payment: L.LoanPayment
  open: boolean
  onClose: () => void
}) {
  const t = useTheme(),
    cur = currencyInfo(loan.currency),
    [account, setAccount] = useState(
      () =>
        loan.accountId ??
        finStore.get().accounts.find((a) => !a.archived)?.id ??
        "",
    ),
    [rejecting, setRejecting] = useState(false),
    [reason, setReason] = useState(""),
    [tried, setTried] = useState(false)
  const accept = () => {
    setTried(true)
    if (!account) return
    L.acceptPayment(loan.loanId, payment.id, account)
    onClose()
  }
  const reject = () => {
    setTried(true)
    if (!reason.trim()) return
    L.rejectPayment(loan.loanId, payment.id, reason)
    onClose()
  }
  return (
    <Sheet
      title={`${money(payment.amount / 100, cur)} from ${loan.borrower.name}`}
      open={open}
      onClose={onClose}
      footer={
        rejecting ? (
          <Button tone="danger" onPress={reject}>
            Don't confirm
          </Button>
        ) : (
          <Button onPress={accept}>Confirm it arrived</Button>
        )
      }
    >
      <Copy size={14}>
        Paid on {shortDate(payment.paidOn)}
        {payment.note ? ` · ${payment.note}` : ""}
      </Copy>
      {rejecting ? (
        <>
          <Field
            label="Why not?"
            placeholder="e.g. Not in my account yet"
            value={reason}
            onChangeText={setReason}
            maxLength={280}
            error={
              tried && !reason.trim()
                ? "Say why, so they can fix it"
                : undefined
            }
          />
          <Tap onPress={() => setRejecting(false)}>
            <Copy size={13} style={{ color: t.fin }}>
              Back to confirming
            </Copy>
          </Tap>
        </>
      ) : (
        <>
          <AccountChoice
            label="It arrived in"
            value={account}
            onChange={setAccount}
          />
          {tried && !account && (
            <Copy size={12} style={{ color: t.bad }}>
              Pick the account it arrived in
            </Copy>
          )}
          <Copy size={12} muted>
            Confirming books it as income here and as paid in{" "}
            {loan.borrower.name}'s money.
          </Copy>
          <Tap onPress={() => setRejecting(true)}>
            <Copy size={13} style={{ color: t.bad }}>
              It didn't arrive
            </Copy>
          </Tap>
        </>
      )}
    </Sheet>
  )
}
