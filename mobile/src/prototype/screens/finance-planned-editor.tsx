import * as A from "@domain/finance/actions"
import { addDays, occurrences } from "@domain/finance/calc"
import type {
  EndRule,
  PlannedItem,
  RecordType,
  Schedule,
} from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { useCurrency } from "@domain/lib/money"
import { useLocalSearchParams } from "expo-router"
import { Repeat as RepeatIcon, Trash2 } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { MoneyInput } from "../money-input"
import { Copy, Segmented, Tap } from "../native-kit"
import { back } from "../navigation"
import { useTheme } from "../theme"
import {
  Button,
  Choices,
  DateField,
  Field,
  PinnedFooter,
  Sheet,
  Toggle,
} from "../ui"
import { isDay } from "../validation"
import { CategoryPicker } from "./finance-category-picker"
import {
  followStart,
  type Repeat,
  RepeatChooser,
  repeatText,
  ruleFrom,
} from "./finance-repeat-picker"
export function PlannedEditor(props: {
  id?: string
  prefill?: Partial<PlannedItem>
  open: boolean
  onClose: () => void
}) {
  return props.open ? <Editor {...props} /> : null
}
function Editor({
  id,
  open,
  prefill,
  onClose,
}: {
  id?: string
  prefill?: Partial<PlannedItem>
  open: boolean
  onClose: () => void
}) {
  const s = finStore.use((s) => s)
  const params = useLocalSearchParams<{
    amount?: string
    date?: string
    count?: string
  }>()
  const p = s.planned.find((p) => p.id === id)
  const init = { ...p, ...prefill }
  const [name, setName] = useState(init.name ?? "")
  const [amount, setAmount] = useState(
    String(init.amount ?? params.amount ?? ""),
  )
  const [type, setType] = useState<RecordType>(init.type ?? "expense")
  const [account, setAccount] = useState(
    init.accountId ?? s.settings.defaultAccountId,
  )
  const [to, setTo] = useState(init.toAccountId ?? "")
  const [category, setCategory] = useState(init.categoryId ?? "")
  const [proj, setProj] = useState(init.inProjection ?? true)
  const [inst, setInst] = useState(init.isInstallment ?? false)
  const [picker, setPicker] = useState(false)
  const t = useTheme()
  const sym = useCurrency().symbol
  const [date, setDate] = useState(
    init.start ??
      (init.schedule?.kind === "once" ? init.schedule.date : params.date) ??
      dayKey(),
  )
  // No repeat is a one-off on its date; a new item repeats monthly on the
  // start's day unless it came from a dated prompt.
  const [rule, setRule] = useState<Repeat>(
    init.schedule
      ? init.schedule.kind === "once"
        ? null
        : init.schedule
      : params.date
        ? null
        : ruleFrom("months", 1, date),
  )
  const [repeatOpen, setRepeatOpen] = useState(false)
  const [endKind, setEndKind] = useState<EndRule["kind"]>(
    init.end?.kind ?? (params.count ? "count" : "never"),
  )
  // The end day and the count are kept apart, so switching "Ends" never
  // shows a count as a date or a date as a count.
  const [endDay, setEndDay] = useState(
    init.end?.kind === "date" ? init.end.date : "",
  )
  const [count, setCount] = useState(
    init.end?.kind === "count" ? String(init.end.n) : (params.count ?? ""),
  )
  const [auto, setAuto] = useState(init.autoLog ?? false)
  const [whatIf, setWhatIf] = useState(init.isWhatIf ?? false)
  const [estimated, setEstimated] = useState(init.estimated ?? false)
  return (
    <Sheet
      title={
        picker
          ? "Category"
          : repeatOpen
            ? "Repeat"
            : p
              ? "Edit scheduled payment"
              : "New scheduled payment"
      }
      open={open}
      onClose={
        picker
          ? () => setPicker(false)
          : repeatOpen
            ? () => setRepeatOpen(false)
            : onClose
      }
    >
      {repeatOpen ? (
        <RepeatChooser
          value={rule}
          start={isDay(date) ? date : dayKey()}
          semimonthly
          onPick={setRule}
          onClose={() => setRepeatOpen(false)}
        />
      ) : picker ? (
        <CategoryPicker
          kind={type === "income" ? "income" : "expense"}
          value={category}
          onPick={(id) => {
            setCategory(id)
            setPicker(false)
          }}
        />
      ) : (
        <>
          <Segmented
            value={type}
            onChange={(v) => {
              setType(v)
              setCategory("")
            }}
            options={[
              { value: "expense", label: "Bill / expense" },
              { value: "income", label: "Income" },
              { value: "transfer", label: "Transfer" },
            ]}
          />
          <Field label="Name" value={name} onChangeText={setName} />
          <MoneyInput
            label={`Amount ${sym}`}
            value={amount}
            onChange={setAmount}
          />
          <Toggle
            label="Amount varies (estimate)"
            value={estimated}
            onChange={setEstimated}
          />
          <Copy size={12} muted>
            e.g. Meralco. You'll enter the actual when it's due.
          </Copy>
          <Choices
            label={type === "transfer" ? "From" : "Account"}
            value={account}
            onChange={setAccount}
            options={s.accounts
              .filter((a) => !a.archived)
              .map((a) => ({ value: a.id, label: a.name }))}
          />
          {type === "transfer" ? (
            <Choices
              label="To"
              value={to}
              onChange={setTo}
              options={s.accounts
                .filter((a) => !a.archived && a.id !== account)
                .map((a) => ({ value: a.id, label: a.name }))}
            />
          ) : (
            <View style={{ gap: 6 }}>
              <Copy size={12} muted>
                Category
              </Copy>
              <Tap
                label="Choose category"
                onPress={() => setPicker(true)}
                style={{
                  padding: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: t.line,
                }}
              >
                <Copy size={14}>
                  {category
                    ? `${s.categories.find((c) => c.id === category)?.icon} ${s.categories.find((c) => c.id === category)?.name}`
                    : "Choose…"}
                </Copy>
              </Tap>
            </View>
          )}
          <DateField
            label={rule ? "Starts" : "Date"}
            value={date}
            onChangeText={(d) => {
              if (isDay(d) && isDay(date)) setRule(followStart(rule, date, d))
              setDate(d)
            }}
          />
          <View style={{ gap: 6 }}>
            <Copy size={12} muted>
              Repeat
            </Copy>
            <Tap
              label={`Repeat: ${repeatText(rule)}. Change`}
              onPress={() => setRepeatOpen(true)}
              style={{
                padding: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: t.line,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              <RepeatIcon size={16} color={t.muted} />
              <Copy size={14} style={{ flex: 1 }}>
                {repeatText(rule)}
              </Copy>
            </Tap>
          </View>
          {rule && (
            <Choices
              label="Ends"
              value={endKind}
              onChange={setEndKind}
              options={["never", "date", "count"].map((value) => ({
                value: value as EndRule["kind"],
                label: (
                  {
                    once: "Once",
                    monthly: "Monthly",
                    semimonthly: "15th & 30th",
                    weekly: "Weekly",
                    never: "Never",
                    date: "On a date",
                    count: "After N times",
                  } as Record<string, string>
                )[value],
              }))}
            />
          )}
          {rule && endKind === "date" && (
            <DateField
              label="End date"
              value={endDay}
              onChangeText={setEndDay}
              minimumDate={isDay(date) ? date : undefined}
              defaultValue={rule ? nextAfterStart(rule, date) : undefined}
            />
          )}
          {rule && endKind === "count" && (
            <Field
              label="Occurrences"
              keyboardType="number-pad"
              value={count}
              onChangeText={setCount}
            />
          )}
          {type !== "income" && (
            <Toggle label="Installment" value={inst} onChange={setInst} />
          )}
          <Copy size={12} muted>
            When it's due
          </Copy>
          <Segmented
            value={auto ? "auto" : "confirm"}
            onChange={(v) => setAuto(v === "auto")}
            options={[
              { value: "confirm", label: "Ask me (Paid / Skip)" },
              { value: "auto", label: "Auto-log" },
            ]}
          />
          <Toggle
            label="Count in savings projection"
            value={proj && !whatIf}
            onChange={setProj}
          />
          <Toggle
            label="Draft what-if only"
            value={whatIf}
            onChange={setWhatIf}
          />
          <Copy size={12} muted>
            Shows in scenarios, never in the real plan.
          </Copy>
          {p && (
            <Button
              tone="danger"
              icon={Trash2}
              onPress={() => {
                const gone = A.deletePlanned(p.id)
                onClose()
                if (!gone) return
                back("/finance/planned")
              }}
            >
              Delete
            </Button>
          )}
          <PinnedFooter>
            <Button
              onPress={() => {
                if (
                  !name.trim() ||
                  !(Number(amount) > 0) ||
                  !account ||
                  (type !== "transfer" && !category) ||
                  !isDay(date) ||
                  (rule &&
                    endKind === "date" &&
                    (!isDay(endDay) || endDay < date)) ||
                  (rule &&
                    endKind === "count" &&
                    (!Number.isInteger(Number(count)) || Number(count) < 1)) ||
                  (type === "transfer" && (!to || to === account))
                ) {
                  toast.error("Check the planned item fields")
                  return
                }
                const endRule: EndRule = !rule
                  ? { kind: "never" }
                  : endKind === "date"
                    ? { kind: "date", date: endDay }
                    : endKind === "count"
                      ? { kind: "count", n: Math.max(1, Number(count) || 1) }
                      : { kind: "never" }
                const input = {
                  name,
                  type,
                  amount: Number(amount),
                  accountId: account,
                  toAccountId: type === "transfer" ? to : undefined,
                  categoryId: type === "transfer" ? undefined : category,
                  schedule: rule ?? { kind: "once" as const, date },
                  start: date,
                  end: endRule,
                  estimated,
                  autoLog: auto,
                  isWhatIf: whatIf,
                  inProjection: !whatIf && proj,
                  isInstallment: type !== "income" && inst,
                }
                if (p) A.updatePlanned(p.id, input)
                else A.addPlanned(input)
                onClose()
              }}
            >
              Save
            </Button>
          </PinnedFooter>
        </>
      )}
    </Sheet>
  )
}

/** Where an empty end date opens: the payment's next occurrence after the
 * first one on or after the start, so "end after the next one" is a tap. */
export function nextAfterStart(rule: Schedule, start: string) {
  if (!isDay(start) || rule.kind === "once") return undefined
  const days = occurrences(
    { schedule: rule, start, end: { kind: "never" } } as PlannedItem,
    start,
    addDays(start, 120),
  )
  return days[1] ?? days[0]
}
