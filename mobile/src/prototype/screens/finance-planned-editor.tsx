import * as A from "@domain/finance/actions"
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
import { useState } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { MoneyInput } from "../money-input"
import { Copy, Segmented, Tap } from "../native-kit"
import { useTheme } from "../theme"
import { Button, Choices, DateField, Field, Sheet, Toggle, undo } from "../ui"
import { isDay } from "../validation"
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
  const [schedule, setSchedule] = useState<Schedule["kind"]>(
    init.schedule?.kind ?? (params.date ? "once" : "monthly"),
  )
  const [date, setDate] = useState(
    init.start ??
      (init.schedule?.kind === "once" ? init.schedule.date : params.date) ??
      dayKey(),
  )
  const [interval, setInterval] = useState(
    init.schedule?.kind === "monthly"
      ? String(init.schedule.day)
      : init.schedule?.kind === "semimonthly"
        ? init.schedule.days.join(",")
        : init.schedule?.kind === "weekly"
          ? String(init.schedule.every)
          : "1",
  )
  const [endKind, setEndKind] = useState<EndRule["kind"]>(
    init.end?.kind ?? (params.count ? "count" : "never"),
  )
  const [end, setEnd] = useState(
    init.end?.kind === "date"
      ? init.end.date
      : init.end?.kind === "count"
        ? String(init.end.n)
        : (params.count ?? ""),
  )
  const [auto, setAuto] = useState(init.autoLog ?? false)
  const [whatIf, setWhatIf] = useState(init.isWhatIf ?? false)
  const [estimated, setEstimated] = useState(init.estimated ?? false)
  return (
    <Sheet
      title={
        picker
          ? "Category"
          : p
            ? "Edit scheduled payment"
            : "New scheduled payment"
      }
      open={open}
      onClose={picker ? () => setPicker(false) : onClose}
    >
      {picker ? (
        s.categories
          .filter(
            (c) =>
              !c.archived &&
              c.kind === (type === "income" ? "income" : "expense"),
          )
          .map((c) => (
            <Tap
              key={c.id}
              onPress={() => {
                setCategory(c.id)
                setPicker(false)
              }}
              style={{ paddingVertical: 12, paddingLeft: c.parentId ? 24 : 0 }}
            >
              <Copy>
                {c.icon} {c.name}
              </Copy>
            </Tap>
          ))
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
          <Choices
            label="Repeats"
            value={schedule}
            onChange={(v) => {
              setSchedule(v)
              setInterval(
                v === "semimonthly" ? "15,30" : v === "monthly" ? "5" : "1",
              )
            }}
            options={["once", "monthly", "semimonthly", "weekly"].map(
              (value) => ({
                value: value as Schedule["kind"],
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
              }),
            )}
          />
          <DateField
            label={schedule === "once" ? "Date" : "Starts"}
            value={date}
            onChangeText={setDate}
          />
          {schedule !== "once" && (
            <Field
              label={
                schedule === "monthly"
                  ? "Day of month"
                  : schedule === "semimonthly"
                    ? "Days of month (e.g. 15,30)"
                    : "Every N weeks"
              }
              value={interval}
              onChangeText={setInterval}
            />
          )}
          {schedule !== "once" && (
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
          {schedule !== "once" && endKind !== "never" && (
            <Field
              label={endKind === "date" ? "End date" : "Occurrences"}
              value={end}
              onChangeText={setEnd}
            />
          )}
          {type === "transfer" && (
            <Toggle
              label="Credit-card installment"
              value={inst}
              onChange={setInst}
            />
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
              onPress={() => {
                if (A.deletePlanned(p.id)) toast.success(`${p.name} deleted`)
                else {
                  A.updatePlanned(p.id, { archived: true })
                  undo(`${p.name} archived (it has history)`, () =>
                    A.updatePlanned(p.id, { archived: false }),
                  )
                }
                onClose()
              }}
            >
              {s.records.some((r) => r.plannedId === p.id)
                ? "Archive"
                : "Delete"}
            </Button>
          )}
          <Button
            onPress={() => {
              if (
                !name.trim() ||
                !(Number(amount) > 0) ||
                !account ||
                (type !== "transfer" && !category) ||
                !isDay(date) ||
                (endKind === "date" && (!isDay(end) || end < date)) ||
                (endKind === "count" &&
                  (!Number.isInteger(Number(end)) || Number(end) < 1)) ||
                (schedule === "semimonthly" &&
                  (interval.split(",").length !== 2 ||
                    interval
                      .split(",")
                      .some(
                        (v) =>
                          !Number.isInteger(Number(v)) ||
                          Number(v) < 1 ||
                          Number(v) > 31,
                      ))) ||
                (type === "transfer" && (!to || to === account))
              ) {
                toast.error("Check the planned item fields")
                return
              }
              const rule: Schedule =
                schedule === "once"
                  ? { kind: "once", date }
                  : schedule === "monthly"
                    ? {
                        kind: "monthly",
                        day: Math.max(1, Math.min(31, Number(interval) || 1)),
                      }
                    : schedule === "semimonthly"
                      ? {
                          kind: "semimonthly",
                          days: interval
                            .split(",")
                            .map((v) =>
                              Math.max(1, Math.min(31, Number(v) || 15)),
                            )
                            .slice(0, 2) as [number, number],
                        }
                      : {
                          kind: "weekly",
                          every: Math.max(1, Number(interval) || 1),
                          anchor: date,
                        }
              const endRule: EndRule =
                endKind === "date"
                  ? { kind: "date", date: end }
                  : endKind === "count"
                    ? { kind: "count", n: Math.max(1, Number(end) || 1) }
                    : { kind: "never" }
              const input = {
                name,
                type,
                amount: Number(amount),
                accountId: account,
                toAccountId: type === "transfer" ? to : undefined,
                categoryId: type === "transfer" ? undefined : category,
                schedule: rule,
                start: date,
                end: endRule,
                estimated,
                autoLog: auto,
                isWhatIf: whatIf,
                inProjection: !whatIf && proj,
                isInstallment: type === "transfer" && inst,
              }
              if (p) A.updatePlanned(p.id, input)
              else A.addPlanned(input)
              onClose()
            }}
          >
            Save
          </Button>
        </>
      )}
    </Sheet>
  )
}
