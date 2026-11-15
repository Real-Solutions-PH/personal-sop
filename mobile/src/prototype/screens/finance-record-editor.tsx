import * as A from "@domain/finance/actions"
import * as C from "@domain/finance/calc"
import type { FinRecord, RecordType } from "@domain/finance/data"
import { convert, fxStore, refreshRate } from "@domain/finance/fx"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { money, useCurrency } from "@domain/lib/money"
import * as Haptics from "expo-haptics"
import {
  Paperclip,
  Repeat as RepeatIcon,
  TriangleAlert,
} from "lucide-react-native"
import { useEffect, useMemo, useState } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import {
  type BudgetHit,
  budgetHits,
  goalsReached,
  hitLine,
  withDraft,
} from "../budget-alerts"
import { MoneyInput } from "../money-input"
import { alpha, feel } from "../motion"
import { Copy, Line, Segmented, SmallButton, Tap } from "../native-kit"
import { Switch } from "../switch"
import { fonts, useTheme } from "../theme"
import { TimeInput } from "../time-input"
import {
  amountText,
  overdraws,
  QUICK_SHARES,
  quickAmount,
} from "../transfer-amounts"
import { Button, Choices, DateField, Field, Sheet } from "../ui"
import { isDay } from "../validation"
import { CategoryPicker } from "./finance-category-picker"
import {
  followStart,
  type Repeat,
  RepeatChooser,
  repeatText,
} from "./finance-repeat-picker"

type Props = {
  record?: FinRecord
  prefill?: Partial<FinRecord>
  open: boolean
  onClose: () => void
  /** A new (not edited) record was saved. */
  onSaved?: (r: FinRecord) => void
  /** Records a scheduled payment's occurrence: nothing is written until
   * Save, and the record is linked to that date of the plan. */
  settles?: { plannedId: string; day: string }
}
export function RecordEditor(props: Props) {
  return props.open ? <Editor {...props} /> : null
}
function Editor({ record, prefill, onClose, onSaved, settles }: Props) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    cur = useCurrency(),
    init = { ...record, ...prefill }
  const [type, setType] = useState<RecordType>(init.type ?? "expense"),
    // The currency the amount is typed in: the user's own, or another one
    // (USD) converted at the latest rate.
    [inCur, setInCur] = useState(init.origCurrency ?? cur.code),
    [amount, setAmount] = useState(
      init.origCurrency && init.origAmount
        ? String(init.origAmount)
        : init.amount
          ? String(init.amount)
          : "",
    ),
    rates = fxStore.use((s) => s.rates),
    [account, setAccount] = useState(
      init.accountId ?? s.settings.lastAccountId ?? s.settings.defaultAccountId,
    ),
    [to, setTo] = useState(init.toAccountId ?? ""),
    [category, setCategory] = useState(init.categoryId ?? ""),
    [date, setDate] = useState(
      init.at ? C.recDay(init as FinRecord) : dayKey(),
    ),
    [time, setTime] = useState(() => {
      const d = new Date(init.at ?? Date.now())
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
    }),
    [payee, setPayee] = useState(init.payee ?? ""),
    [note, setNote] = useState(init.note ?? ""),
    [fee, setFee] = useState(""),
    [refund, setRefund] = useState(!!init.isRefund),
    [receipt, setReceipt] = useState(!!init.receipt),
    [picker, setPicker] = useState(false),
    // A new expense or income can repeat: saving makes an auto-log
    // scheduled payment whose first occurrence is this transaction.
    [rule, setRule] = useState<Repeat>(null),
    [repeatOpen, setRepeatOpen] = useState(false),
    [tried, setTried] = useState(false),
    // What the last "Save & add another" did to the budgets, until the next
    // amount is typed.
    [landed, setLanded] = useState<BudgetHit[]>([])
  const accounts = s.accounts.filter((a) => !a.archived),
    catKind = type === "income" && !refund ? "income" : "expense",
    _cats = s.categories.filter((c) => !c.archived && c.kind === catKind),
    chosen = s.categories.find((c) => c.id === category),
    plan = settles && s.planned.find((p) => p.id === settles.plannedId),
    suggestion = C.suggestCategory(s, payee),
    foreign = type !== "transfer" && inCur !== cur.code,
    other = cur.code === "USD" ? "PHP" : "USD",
    // The latest rate, else the one this record was saved at.
    fx = foreign
      ? (rates[inCur] ??
        (init.origCurrency === inCur && init.fxRate
          ? {
              rate: init.fxRate,
              asOf: C.recDay(init as FinRecord),
              quote: cur.code,
            }
          : undefined))
      : undefined,
    typed = Number(amount),
    // What is saved and counted: the amount in the user's currency.
    n = foreign && fx ? convert(typed, fx.rate) : typed,
    amountError = !(typed > 0 && Number.isFinite(typed))
      ? `Enter an amount above ${money(0, cur)}`
      : foreign && !fx
        ? `Couldn't get the ${inCur} rate — try again online, or enter it in ${cur.code}`
        : undefined
  // What saving would do to this month's budgets, shown before Save so the
  // cost is known while it can still be changed.
  const draftAt = /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : "12:00"
  const ahead = useMemo(
    () =>
      type !== "expense" || amountError || !category || !isDay(date)
        ? []
        : budgetHits(
            s,
            withDraft(
              s,
              {
                id: record?.id ?? "draft",
                type: "expense",
                amount: n,
                accountId: account,
                categoryId: category,
                at: new Date(`${date}T${draftAt}:00`).toISOString(),
                source: "manual",
                status: "cleared",
              },
              record?.id,
            ),
            date,
          ),
    [s, type, amountError, category, date, draftAt, n, account, record?.id],
  )
  const hits = landed.length ? landed : ahead
  // What each account holds: the same running balance the Accounts screen
  // shows. An edited record is taken out first, so its own amount isn't
  // counted against the balance it moves.
  const bal = useMemo(
    () =>
      C.balances(
        record
          ? { ...s, records: s.records.filter((r) => r.id !== record.id) }
          : s,
      ),
    [s, record],
  )
  const fromAcct = accounts.find((a) => a.id === account),
    toAcct = accounts.find((a) => a.id === to),
    fromBal = fromAcct ? bal[fromAcct.id] : undefined,
    toBal = toAcct ? bal[toAcct.id] : undefined,
    feeN = Math.max(0, Number(fee) || 0),
    quick =
      type === "transfer"
        ? QUICK_SHARES.flatMap((q) => {
            const v = quickAmount(fromBal, q.fraction, feeN)
            return v == null ? [] : [{ ...q, value: v }]
          })
        : [],
    overdrawn =
      type === "transfer" && !amountError && overdraws(fromBal, n, feeN)
  // A record kept in another currency: fetch today's rate as it opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on open only
  useEffect(() => {
    if (init.origCurrency) void refreshRate(init.origCurrency)
  }, [])
  function save(again = false) {
    setTried(true)
    if (
      amountError ||
      !accounts.some((a) => a.id === account) ||
      !isDay(date) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
      (type === "transfer" ? !to || to === account : !category)
    )
      return
    const before = finStore.get()
    // After the write: warn for a budget it broke, cheer a savings goal it
    // reached. Both ride on the Undo toast's line, since the sheet closes.
    /** Haptics for what the save changed. A budget it broke is a miss with
     * a cost: when the editor closes (so the sheet's own line is gone), it
     * says so in a warning. */
    const outcome = (closing: boolean) => {
      const after = finStore.get()
      const broke = budgetHits(before, after, date)
      const reached = goalsReached(before, after)
      if (broke.length) {
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Warning,
        ).catch(() => {})
        if (closing) toast.warning(hitLine(broke[0], (v) => money(v, cur)))
      } else if (reached.length) feel.success()
      return { broke }
    }
    const at = new Date(`${date}T${time}:00`).toISOString(),
      input = {
        type,
        amount: n,
        accountId: account,
        toAccountId: type === "transfer" ? to : undefined,
        categoryId: type === "transfer" ? undefined : category,
        at,
        payee: payee || undefined,
        note: note || undefined,
        isRefund: type === "income" && refund,
        receipt,
        status: "cleared" as const,
        origCurrency: foreign ? inCur : undefined,
        origAmount: foreign ? typed : undefined,
        fxRate: foreign ? fx?.rate : undefined,
      }
    if (settles) {
      const r = A.settleOccurrence(settles.plannedId, settles.day, {
        amount: n,
        accountId: account,
        date,
        at,
        toAccountId: type === "transfer" ? to : undefined,
        categoryId: type === "transfer" ? undefined : category,
        payee: payee || undefined,
        note: note || undefined,
        receipt,
        origCurrency: foreign ? inCur : undefined,
        origAmount: foreign ? typed : undefined,
        fxRate: foreign ? fx?.rate : undefined,
      })
      if (!r) toast.error("That scheduled payment no longer exists")
      // The list shows it; an update is not a new record to report.
      else if (!r.updated) {
        onSaved?.(r.record)
        outcome(true)
      }
      onClose()
      return
    }
    if (record) {
      A.updateRecord(record.id, input)
      outcome(false)
      onClose()
      return
    }
    let created: FinRecord[]
    if (type === "transfer") {
      const r = A.logTransfer({
        from: account,
        to,
        amount: n,
        fee: Math.max(0, Number(fee) || 0) || undefined,
        note: note || undefined,
        at,
      })
      created = [r.transfer, ...(r.fee ? [r.fee] : [])]
    } else if (rule) {
      // The repeat's first date is this transaction's date, so the record
      // settles that occurrence under the id the server derives for it and
      // the auto-log job never logs it a second time.
      const p = A.addPlanned({
        name:
          payee.trim() ||
          chosen?.name ||
          (type === "income" ? "Income" : "Expense"),
        type,
        amount: n,
        estimated: false,
        accountId: account,
        categoryId: category,
        schedule: rule,
        start: date,
        end: { kind: "never" },
        autoLog: true,
        isWhatIf: false,
        inProjection: true,
      })
      // A date the rule does not land on (a 15th with "the last day")
      // starts the repeat but stays a plain transaction.
      const onRule = C.occurrences(p, date, date).length > 0
      const r = !onRule
        ? { record: A.addRecord({ ...input, source: "manual" }) }
        : A.settleOccurrence(p.id, date, {
            amount: n,
            accountId: account,
            date,
            at,
            categoryId: category,
            payee: payee || undefined,
            note: note || undefined,
            receipt,
            origCurrency: foreign ? inCur : undefined,
            origAmount: foreign ? typed : undefined,
            fxRate: foreign ? fx?.rate : undefined,
          })
      created = r ? [r.record] : []
      onSaved?.(created[0])
      const result = outcome(!again)
      if (again) {
        setLanded(result.broke)
        setAmount("")
        setPayee("")
        setNote("")
        setRule(null)
        setTried(false)
      } else onClose()
      return
    } else created = [A.addRecord({ ...input, source: "manual" })]
    onSaved?.(created[0])
    const result = outcome(!again)
    if (again) {
      setLanded(result.broke)
      setAmount("")
      setPayee("")
      setNote("")
      setFee("")
      setTried(false)
    } else onClose()
  }
  const accountOptions = accounts.map((a) => ({
    value: a.id,
    label: `${a.name}`,
  }))
  return (
    <Sheet
      title={
        picker
          ? "Category"
          : repeatOpen
            ? "Repeat"
            : settles
              ? `Record ${plan?.name ?? "payment"}`
              : record
                ? "Edit transaction"
                : "New transaction"
      }
      open
      // Choosing a category is a step: back returns to the transaction,
      // close (X, backdrop, drag) closes the whole sheet.
      onBack={
        picker
          ? () => setPicker(false)
          : repeatOpen
            ? () => setRepeatOpen(false)
            : undefined
      }
      backLabel="Back to transaction"
      onClose={onClose}
      // Save stays in reach above the keyboard however long the form runs.
      footer={
        picker || repeatOpen ? undefined : (
          <Line>
            {settles ? null : record ? (
              <Button
                tone="danger"
                onPress={() => {
                  A.deleteRecords([record.id])
                  onClose()
                }}
              >
                Delete
              </Button>
            ) : (
              <Button tone="quiet" onPress={() => save(true)}>
                Save & add another
              </Button>
            )}
            <View style={{ flex: 1 }}>
              <Button onPress={() => save()}>
                {settles ? (type === "income" ? "Received" : "Paid") : "Save"}
              </Button>
            </View>
          </Line>
        )
      }
    >
      {repeatOpen ? (
        <RepeatChooser
          value={rule}
          start={isDay(date) ? date : dayKey()}
          onPick={setRule}
          onClose={() => setRepeatOpen(false)}
        />
      ) : picker ? (
        <CategoryPicker
          kind={catKind}
          value={category}
          onPick={(id) => {
            setCategory(id)
            setPicker(false)
          }}
        />
      ) : (
        <>
          {plan && settles && (
            <Copy size={12} muted>
              Expected {plan.estimated ? "≈ " : ""}
              {money(plan.amount, cur)} · due {C.shortDate(settles.day)}
            </Copy>
          )}
          {/* A scheduled payment keeps its own kind. */}
          {!settles && (
            <Segmented
              value={type}
              onChange={(v) => {
                setType(v)
                setCategory("")
              }}
              options={[
                { value: "expense", label: "Expense" },
                { value: "income", label: "Income" },
                { value: "transfer", label: "Transfer" },
              ]}
            />
          )}
          {type !== "transfer" && (
            <Segmented
              value={inCur}
              onChange={(v) => {
                setInCur(v)
                if (v !== cur.code) void refreshRate(v)
              }}
              options={[
                { value: cur.code, label: `${cur.symbol} ${cur.code}` },
                { value: other, label: other === "USD" ? "$ USD" : other },
              ]}
            />
          )}
          <MoneyInput
            label={`Amount ${foreign ? inCur : cur.symbol}`}
            value={amount}
            onChange={(v) => {
              setAmount(v)
              setLanded([])
            }}
            placeholder="0"
            error={tried ? amountError : undefined}
            // The 30pt figure gets the whole box to sit in (no vertical
            // padding: a fixed 56pt box with 10pt padding left the text a
            // 36pt strip, and Kai saw its top cut off), and the box grows
            // with the iOS text size instead of clipping.
            maxFontSizeMultiplier={1.4}
            style={{
              minHeight: 56,
              paddingVertical: 0,
              includeFontPadding: false,
              textAlignVertical: "center",
              borderWidth: 1,
              borderColor: t.line,
              borderRadius: 12,
              paddingHorizontal: 12,
              color: t.text,
              fontFamily: fonts.semibold,
              fontSize: 30,
              backgroundColor: t.card,
            }}
          />
          {foreign && (
            <Copy size={12} muted style={{ marginTop: -4 }}>
              {fx
                ? `${typed > 0 ? `≈ ${cur.symbol}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · ` : ""}1 ${inCur} = ${cur.symbol}${fx.rate.toLocaleString("en-US", { maximumFractionDigits: 4 })} · reference rate of ${C.shortDate(fx.asOf)}`
                : `Getting the ${inCur} rate…`}
            </Copy>
          )}
          {quick.length > 0 && (
            <Line style={{ gap: 8, marginTop: -4 }}>
              {quick.map((q) => (
                <SmallButton
                  key={q.label}
                  quiet
                  label={`${q.label}: ${money(q.value, cur)}`}
                  onPress={() => {
                    setAmount(amountText(q.value))
                    setLanded([])
                  }}
                >
                  {q.label}
                </SmallButton>
              ))}
            </Line>
          )}
          {/* Next to the amount: the cost is seen while it can still change. */}
          {hits.length > 0 && (
            <BudgetWarning
              hits={hits}
              saved={landed.length > 0}
              money={(v) => money(v, cur)}
            />
          )}
          <Choices
            label={type === "transfer" ? "From" : "Account"}
            value={account}
            onChange={setAccount}
            options={accountOptions}
            wrap
          />
          {/* Save said nothing when no account was picked. */}
          {tried && !accounts.some((a) => a.id === account) && (
            <Copy size={12} style={{ color: t.bad }}>
              {accounts.length ? "Pick an account" : "Add an account first"}
            </Copy>
          )}
          {type === "transfer" && fromAcct && (
            <AccountBalance name={fromAcct.name} balance={fromBal} />
          )}
          {type === "transfer" ? (
            <>
              <Choices
                label="To"
                value={to}
                onChange={setTo}
                options={accountOptions.filter((a) => a.value !== account)}
                wrap
              />
              {tried && (!to || to === account) && (
                <Copy size={12} style={{ color: t.bad }}>
                  Pick a different destination account
                </Copy>
              )}
              {toAcct && toAcct.id !== account && (
                <AccountBalance name={toAcct.name} balance={toBal} small />
              )}
              {!record && !settles && (
                <>
                  <MoneyInput
                    label={`Fee ${cur.symbol} (optional)`}
                    placeholder="e.g. 15"
                    value={fee}
                    onChange={setFee}
                  />
                  <Copy size={12} muted>
                    Logged as a separate Fees expense — the transfer itself
                    isn't spending.
                  </Copy>
                </>
              )}
              {overdrawn && fromAcct && fromBal !== undefined && (
                <Line style={{ gap: 6, alignItems: "flex-start" }}>
                  <TriangleAlert
                    size={14}
                    color={t.warn}
                    style={{ marginTop: 2 }}
                  />
                  <Copy
                    size={12}
                    weight="medium"
                    style={{ color: t.warn, flex: 1 }}
                  >
                    {feeN > 0
                      ? `${money(n, cur)} + ${money(feeN, cur)} fee is more than the ${money(fromBal, cur)} in ${fromAcct.name}: it will go below zero.`
                      : `More than the ${money(fromBal, cur)} in ${fromAcct.name}: it will go below zero.`}
                  </Copy>
                </Line>
              )}
            </>
          ) : (
            <>
              <Field
                label="Payee"
                placeholder="e.g. Jollibee"
                value={payee}
                onChangeText={setPayee}
                onBlur={() => {
                  if (!category && suggestion) setCategory(suggestion)
                }}
              />
              <Copy size={12} muted>
                Category
              </Copy>
              <Tap
                label="Choose category"
                onPress={() => setPicker(true)}
                style={{
                  borderWidth: 1,
                  borderColor: tried && !category ? t.bad : t.line,
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <Copy size={14}>
                  {chosen ? `${chosen.icon} ${chosen.name}` : "Choose…"}
                </Copy>
              </Tap>
              {tried && !category && (
                <Copy size={12} style={{ color: t.bad }}>
                  Pick a category
                </Copy>
              )}
              {type === "income" && !settles && (
                <Line>
                  <View style={{ flex: 1 }}>
                    <Copy size={14}>This is a refund</Copy>
                    <Copy size={12} muted>
                      Reduces spending in the original category and its budget.
                    </Copy>
                  </View>
                  <Switch
                    label="This is a refund"
                    value={refund}
                    onChange={(v) => {
                      setRefund(v)
                      setCategory("")
                    }}
                    accent="fin"
                  />
                </Line>
              )}
            </>
          )}
          <Line style={{ alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <DateField
                label="Date"
                value={date}
                onChangeText={(d) => {
                  if (isDay(d) && isDay(date))
                    setRule(followStart(rule, date, d))
                  setDate(d)
                }}
              />
            </View>
            {/* The same label, gap and box as the Date field beside it. */}
            <View style={{ flex: 1, gap: 6, marginVertical: 8 }}>
              <Copy size={12} muted weight="medium">
                Time
              </Copy>
              <TimeInput label="Time" value={time} onChange={setTime} field />
            </View>
          </Line>
          {/* New expenses and income only: a transfer repeats from
              Scheduled payments, an edit or a settled payment never. */}
          {!record && !settles && type !== "transfer" && (
            <View style={{ gap: 6 }}>
              <Copy size={12} muted weight="medium">
                Repeat
              </Copy>
              <Tap
                label={`Repeat: ${repeatText(rule)}. Change`}
                onPress={() => setRepeatOpen(true)}
                style={{
                  borderWidth: 1,
                  borderColor: t.line,
                  borderRadius: 12,
                  padding: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <RepeatIcon size={16} color={rule ? t.text : t.muted} />
                <Copy size={14} style={{ flex: 1 }}>
                  {repeatText(rule)}
                </Copy>
              </Tap>
            </View>
          )}
          <Field
            label="Note"
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={3}
          />
          {type !== "transfer" && (
            <Tap
              onPress={() => setReceipt(!receipt)}
              style={{ paddingVertical: 8 }}
            >
              <Line>
                <Paperclip color={t.text} size={16} />
                <Copy size={14}>
                  {receipt ? "Receipt attached · remove" : "Attach receipt"}
                </Copy>
              </Line>
            </Tap>
          )}
        </>
      )}
    </Sheet>
  )
}

/** The budgets a save breaks, in the bad colour (amber when only ahead of
 * pace), above the Save button. */
/** What an account holds, under its chips. A balance that can't be worked
 * out says so rather than showing a made-up zero. */
function AccountBalance({
  name,
  balance,
  small = false,
}: {
  name: string
  balance: number | undefined
  small?: boolean
}) {
  const t = useTheme(),
    cur = useCurrency(),
    known = balance !== undefined && Number.isFinite(balance),
    negative = known && (balance as number) < 0
  return (
    <Copy
      size={small ? 12 : 13}
      muted={!negative}
      weight={small ? "body" : "medium"}
      style={{ marginTop: -4, ...(negative ? { color: t.bad } : {}) }}
    >
      {known
        ? `${name} balance: ${money(balance as number, cur)}`
        : `${name} balance unavailable`}
    </Copy>
  )
}
function BudgetWarning({
  hits,
  saved,
  money,
}: {
  hits: BudgetHit[]
  saved: boolean
  money: (n: number) => string
}) {
  const t = useTheme()
  const color = hits.some((h) => h.kind === "over") ? t.bad : t.warn
  return (
    <View
      testID="budget-warning"
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: "row",
        gap: 8,
        alignItems: "flex-start",
        borderRadius: 12,
        padding: 12,
        backgroundColor: alpha(color, 0.12),
      }}
    >
      <TriangleAlert size={16} color={color} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {hits.slice(0, 2).map((h) => (
          <Copy
            key={h.id}
            size={13}
            weight="medium"
            style={{ color: h.kind === "over" ? t.bad : t.warn }}
          >
            {hitLine(h, money, saved)}
          </Copy>
        ))}
      </View>
    </View>
  )
}
