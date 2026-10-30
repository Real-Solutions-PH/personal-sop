import * as A from "@domain/finance/actions"
import * as C from "@domain/finance/calc"
import type { FinRecord, RecordType } from "@domain/finance/data"
import { convert, fxStore, refreshRate } from "@domain/finance/fx"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { money, useCurrency } from "@domain/lib/money"
import { Check, Paperclip } from "lucide-react-native"
import { useEffect, useState } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { MoneyInput } from "../money-input"
import { Copy, Line, Segmented, Tap } from "../native-kit"
import { Switch } from "../switch"
import { fonts, useTheme } from "../theme"
import { TimeInput } from "../time-input"
import { Button, Choices, DateField, Field, Sheet, undo } from "../ui"
import { isDay } from "../validation"
import { CategoryForm } from "./finance-categories"

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
    // Adding a category from the picker: under which main one, if any.
    [adding, setAdding] = useState<{ parentId?: string } | null>(null),
    [query, setQuery] = useState(""),
    [tried, setTried] = useState(false)
  const accounts = s.accounts.filter((a) => !a.archived),
    catKind = type === "income" && !refund ? "income" : "expense",
    cats = s.categories.filter((c) => !c.archived && c.kind === catKind),
    tops = cats.filter(
      (c) => !c.parentId || !cats.some((p) => p.id === c.parentId),
    ),
    q = query.trim().toLowerCase(),
    // Each main category followed by its own sub-categories; a search
    // matches either name and keeps a match's parent above it.
    pickRows = tops.flatMap((top) => {
      const kids = cats.filter((c) => c.parentId === top.id),
        hit = (c: { name: string }) => c.name.toLowerCase().includes(q),
        shown = q && !hit(top) ? kids.filter(hit) : kids
      return !q || hit(top) || shown.length
        ? [{ c: top, sub: false }, ...shown.map((c) => ({ c, sub: true }))]
        : []
    }),
    chosen = s.categories.find((c) => c.id === category),
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
  // A record kept in another currency: fetch today's rate as it opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on open only
  useEffect(() => {
    if (init.origCurrency) void refreshRate(init.origCurrency)
  }, [])
  function save(again = false) {
    setTried(true)
    if (
      amountError ||
      !account ||
      !isDay(date) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
      (type === "transfer" ? !to || to === account : !category)
    )
      return
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
      })
      if (r) {
        onSaved?.(r)
        undo(
          `${type === "income" ? "Received" : "Paid"} ${money(n, cur)}`,
          () => A.deleteRecords([r.id]),
        )
      }
      onClose()
      return
    }
    if (record) {
      A.updateRecord(record.id, input)
      toast.success("Transaction updated")
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
    } else created = [A.addRecord({ ...input, source: "manual" })]
    onSaved?.(created[0])
    undo(`Saved ${money(n, cur)}`, () =>
      A.deleteRecords(created.map((r) => r.id)),
    )
    if (again) {
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
        adding
          ? adding.parentId
            ? "New sub-category"
            : "New category"
          : picker
            ? "Category"
            : settles
              ? type === "income"
                ? "Record income received"
                : type === "transfer"
                  ? "Record transfer"
                  : "Record payment"
              : record
                ? "Edit transaction"
                : "New transaction"
      }
      open
      onClose={
        adding
          ? () => setAdding(null)
          : picker
            ? () => setPicker(false)
            : onClose
      }
    >
      {adding ? (
        <CategoryForm
          catKind={catKind}
          parentId={adding.parentId}
          lockKind
          onAdded={(id) => {
            setCategory(id)
            setPicker(false)
          }}
          onClose={() => setAdding(null)}
        />
      ) : picker ? (
        <>
          <Field
            label="Search categories"
            value={query}
            onChangeText={setQuery}
          />
          {pickRows.map(({ c, sub }) => (
            <Line key={c.id} style={{ gap: 0 }}>
              {sub && (
                // A sub-category hangs off its parent: an elbow in the
                // gutter where the parent's icon sits.
                <View
                  style={{
                    width: 28,
                    alignSelf: "stretch",
                    marginLeft: 10,
                    borderLeftWidth: 1,
                    borderColor: t.line,
                  }}
                />
              )}
              <Tap
                label={
                  sub
                    ? `${c.name}, under ${cats.find((p) => p.id === c.parentId)?.name}`
                    : c.name
                }
                onPress={() => {
                  setCategory(c.id)
                  setPicker(false)
                }}
                style={{ flex: 1, paddingVertical: sub ? 10 : 12 }}
              >
                <Line>
                  <Copy size={sub ? 16 : 20}>{c.icon}</Copy>
                  <Copy
                    size={sub ? 14 : 16}
                    weight={sub ? "body" : "medium"}
                    style={{ flex: 1 }}
                  >
                    {c.name}
                  </Copy>
                  {category === c.id && <Check color={t.fin} size={20} />}
                </Line>
              </Tap>
            </Line>
          ))}
          {!pickRows.length && (
            <Copy size={14} muted style={{ paddingVertical: 8 }}>
              No category matches “{query.trim()}”.
            </Copy>
          )}
          <Line style={{ gap: 8, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Button tone="quiet" onPress={() => setAdding({})}>
                New category
              </Button>
            </View>
            {tops.length > 0 && (
              <View style={{ flex: 1 }}>
                <Button
                  tone="quiet"
                  onPress={() =>
                    setAdding({
                      parentId: (chosen?.parentId ?? chosen?.id) || tops[0].id,
                    })
                  }
                >
                  New sub-category
                </Button>
              </View>
            )}
          </Line>
        </>
      ) : (
        <>
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
            onChange={setAmount}
            placeholder="0"
            error={tried ? amountError : undefined}
            style={{
              height: 56,
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
          <Choices
            label={type === "transfer" ? "From" : "Account"}
            value={account}
            onChange={setAccount}
            options={accountOptions}
            wrap
          />
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
              {type === "income" && (
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
              <DateField label="Date" value={date} onChangeText={setDate} />
            </View>
            {/* The same label, gap and box as the Date field beside it. */}
            <View style={{ flex: 1, gap: 6, marginVertical: 8 }}>
              <Copy size={12} muted weight="medium">
                Time
              </Copy>
              <TimeInput label="Time" value={time} onChange={setTime} field />
            </View>
          </Line>
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
          <Line>
            {settles ? null : record ? (
              <Button
                tone="danger"
                onPress={() => {
                  const gone = A.deleteRecords([record.id])
                  onClose()
                  undo("Transaction deleted", () => A.restoreRecords(gone))
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
              <Button onPress={() => save()}>Save</Button>
            </View>
          </Line>
        </>
      )}
    </Sheet>
  )
}
