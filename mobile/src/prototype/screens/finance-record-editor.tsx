import * as A from "@domain/finance/actions"
import * as C from "@domain/finance/calc"
import type { FinRecord, RecordType } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { dayKey, peso } from "@domain/lib/day"
import { Check, Paperclip } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { Copy, Line, Segmented, Tap } from "../native-kit"
import { Switch } from "../switch"
import { fonts, useTheme } from "../theme"
import { TimeInput } from "../time-input"
import { Button, Choices, DateField, Field, Sheet, undo } from "../ui"
import { isDay } from "../validation"

type Props = {
  record?: FinRecord
  prefill?: Partial<FinRecord>
  open: boolean
  onClose: () => void
}
export function RecordEditor(props: Props) {
  return props.open ? <Editor {...props} /> : null
}
function Editor({ record, prefill, onClose }: Props) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    init = { ...record, ...prefill }
  const [type, setType] = useState<RecordType>(init.type ?? "expense"),
    [amount, setAmount] = useState(init.amount ? String(init.amount) : ""),
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
    [query, setQuery] = useState(""),
    [tried, setTried] = useState(false)
  const accounts = s.accounts.filter((a) => !a.archived),
    catKind = type === "income" && !refund ? "income" : "expense",
    cats = s.categories.filter((c) => !c.archived && c.kind === catKind),
    chosen = s.categories.find((c) => c.id === category),
    suggestion = C.suggestCategory(s, payee),
    n = Number(amount),
    amountError =
      n > 0 && Number.isFinite(n) ? undefined : "Enter an amount above ₱0"
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
    undo(`Saved ${peso(n)}`, () => A.deleteRecords(created.map((r) => r.id)))
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
        picker ? "Category" : record ? "Edit transaction" : "New transaction"
      }
      open
      onClose={picker ? () => setPicker(false) : onClose}
    >
      {picker ? (
        <>
          <Field
            label="Search categories"
            value={query}
            onChangeText={setQuery}
          />
          {cats
            .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
            .map((c) => (
              <Tap
                key={c.id}
                onPress={() => {
                  setCategory(c.id)
                  setPicker(false)
                }}
                style={{
                  paddingVertical: 12,
                  paddingLeft: c.parentId ? 24 : 0,
                }}
              >
                <Line>
                  <Copy size={20}>{c.icon}</Copy>
                  <Copy style={{ flex: 1 }}>{c.name}</Copy>
                  {category === c.id && <Check color={t.fin} size={20} />}
                </Line>
              </Tap>
            ))}
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
          <Field
            label="Amount ₱"
            value={amount}
            onChangeText={setAmount}
            placeholder="0"
            keyboardType="decimal-pad"
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
          <Choices
            label={type === "transfer" ? "From" : "Account"}
            value={account}
            onChange={setAccount}
            options={accountOptions}
          />
          {type === "transfer" ? (
            <>
              <Choices
                label="To"
                value={to}
                onChange={setTo}
                options={accountOptions.filter((a) => a.value !== account)}
              />
              {tried && (!to || to === account) && (
                <Copy size={12} style={{ color: t.bad }}>
                  Pick a different destination account
                </Copy>
              )}
              {!record && (
                <>
                  <Field
                    label="Fee ₱ (optional)"
                    placeholder="e.g. 15"
                    value={fee}
                    onChangeText={setFee}
                    keyboardType="decimal-pad"
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
          <Line>
            <View style={{ flex: 1 }}>
              <DateField label="Date" value={date} onChangeText={setDate} />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Copy size={12} muted>
                Time
              </Copy>
              <TimeInput label="Time" value={time} onChange={setTime} />
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
            {record ? (
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
