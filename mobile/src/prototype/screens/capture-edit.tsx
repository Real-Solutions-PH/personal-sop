import { editCard, undoCard } from "@domain/capture/actions"
import type { Payload, RecordCard } from "@domain/capture/data"
import { finStore } from "@domain/finance/store"
import { habitsStore } from "@domain/habits/store"
import { useCurrency } from "@domain/lib/money"
import { tasksStore } from "@domain/tasks/store"
import { useEffect, useState } from "react"
import { TextInput, View } from "react-native"
import { toast } from "sonner-native"
import { MoneyInput } from "../money-input"
import { Copy, Line, Segmented, Tap } from "../native-kit"
import { fonts, useTheme } from "../theme"
import { TimeInput } from "../time-input"
import { Button, Choices, DateField, Field, Sheet, Toggle } from "../ui"
import { AreaPicker } from "./journal"
import { MoodPicker } from "./mood-picker"

/** The card's amount: typed with separators and decimals, kept exact. */
function AmountField({
  value,
  onChange,
}: {
  value: number
  onChange: (n: number) => void
}) {
  const t = useTheme(),
    sym = useCurrency().symbol,
    [draft, setDraft] = useState(value ? String(value) : "")
  // A new card (another kind picked) resets the amount from outside.
  useEffect(() => {
    if ((Number(draft) || 0) !== value) setDraft(value ? String(value) : "")
  }, [value, draft])
  return (
    <View style={{ gap: 6 }}>
      <Copy size={12} muted>
        Amount
      </Copy>
      <Line
        style={{
          height: 56,
          borderWidth: 1,
          borderColor: t.line,
          borderRadius: 12,
          paddingHorizontal: 12,
          backgroundColor: t.bg,
          gap: 8,
        }}
      >
        <Copy size={20} muted weight="semibold">
          {sym}
        </Copy>
        <MoneyInput
          bare
          label="Amount"
          value={draft}
          placeholder="0"
          onChange={(v) => {
            setDraft(v)
            onChange(Number(v) || 0)
          }}
          style={{
            flex: 1,
            fontFamily: fonts.semibold,
            fontSize: 24,
            color: t.text,
          }}
        />
      </Line>
    </View>
  )
}
export function NumberControl({
  label,
  value,
  onChange,
  step = 1,
  suffix = "",
}: {
  label: string
  value: number
  onChange: (n: number) => void
  step?: number
  suffix?: string
}) {
  const t = useTheme(),
    [draft, setDraft] = useState(String(value)),
    [last, setLast] = useState(value)
  if (last !== value) {
    setLast(value)
    setDraft(String(value))
  }
  return (
    <View style={{ gap: 6 }}>
      <Copy size={12} muted>
        {label}
      </Copy>
      <Line style={{ backgroundColor: t.soft, borderRadius: 12, gap: 0 }}>
        <Tap
          label={`Decrease ${label}`}
          onPress={() =>
            onChange(Math.max(0, Math.round((value - step) * 100) / 100))
          }
          style={{ padding: 12 }}
        >
          <Copy>−</Copy>
        </Tap>
        <TextInput
          accessibilityLabel={label}
          value={draft}
          onChangeText={(v) => {
            setDraft(v)
            const n = Number(v)
            if (Number.isFinite(n) && n >= 0) onChange(n)
          }}
          keyboardType="decimal-pad"
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: "center",
            fontFamily: fonts.semibold,
            fontSize: 18,
            color: t.text,
            paddingVertical: 10,
          }}
        />
        <Copy size={14} muted>
          {suffix}
        </Copy>
        <Tap
          label={`Increase ${label}`}
          onPress={() => onChange(Math.round((value + step) * 100) / 100)}
          style={{ padding: 12 }}
        >
          <Copy>+</Copy>
        </Tap>
      </Line>
    </View>
  )
}
export function PayloadForm({
  p,
  set,
}: {
  p: Payload
  set: (p: Payload) => void
}) {
  const fin = finStore.use((s) => s),
    habits = habitsStore.use((s) => s.habits),
    lists = tasksStore.use((s) => s.lists),
    t = useTheme()
  const accountOptions = fin.accounts
      .filter((a) => !a.archived)
      .map((a) => ({ value: a.id, label: a.name })),
    money = (value: number, onChange: (n: number) => void) => (
      <AmountField value={value} onChange={onChange} />
    )
  switch (p.kind) {
    case "expense":
    case "income":
      return (
        <>
          <Segmented
            value={p.kind}
            onChange={(kind) =>
              set(
                kind === "income"
                  ? {
                      kind,
                      amount: p.amount,
                      accountId: p.accountId,
                      payee: p.payee,
                      categoryId: "other-in",
                    }
                  : {
                      kind,
                      amount: p.amount,
                      accountId: p.accountId ?? fin.settings.defaultAccountId,
                      payee: p.payee,
                    },
              )
            }
            options={[
              { value: "expense", label: "Expense" },
              { value: "income", label: "Income" },
            ]}
          />
          {money(p.amount, (amount) => set({ ...p, amount }))}
          <Choices
            wrap
            label="Category"
            value={p.categoryId ?? ""}
            onChange={(categoryId) => set({ ...p, categoryId })}
            options={fin.categories
              .filter((c) => !c.archived && c.kind === p.kind)
              .map((c) => ({ value: c.id, label: `${c.icon} ${c.name}` }))}
          />
          <Choices
            wrap
            label="Account"
            value={p.accountId ?? ""}
            onChange={(accountId) => set({ ...p, accountId })}
            options={accountOptions}
          />
          <Field
            label="Payee / note"
            value={p.payee ?? ""}
            onChangeText={(payee) => set({ ...p, payee })}
          />
        </>
      )
    case "transfer":
      return (
        <>
          {money(p.amount, (amount) => set({ ...p, amount }))}
          <Choices
            wrap
            label="From"
            value={p.from ?? ""}
            onChange={(from) => set({ ...p, from })}
            options={accountOptions}
          />
          <Choices
            wrap
            label="To"
            value={p.to ?? ""}
            onChange={(to) => set({ ...p, to })}
            options={accountOptions.filter((a) => a.value !== p.from)}
          />
        </>
      )
    case "planned":
      return (
        <>
          <Field
            label="Name"
            value={p.name}
            onChangeText={(name) => set({ ...p, name })}
          />
          {money(p.amount, (amount) => set({ ...p, amount }))}
          {p.date ? null : (
            <NumberControl
              label="Day of month"
              value={p.day ?? 1}
              onChange={(day) =>
                set({ ...p, day: Math.max(1, Math.min(31, day)) })
              }
            />
          )}
        </>
      )
    case "task":
      return (
        <>
          {p.tasks.map((task, i) => {
            const update = (patch: Partial<typeof task>) =>
              set({
                ...p,
                tasks: p.tasks.map((x, j) =>
                  i === j ? { ...x, ...patch } : x,
                ),
              })
            return (
              <View
                key={i}
                style={{
                  borderWidth: 1,
                  borderColor: t.line,
                  borderRadius: 12,
                  padding: 12,
                  gap: 8,
                }}
              >
                <Field
                  label="Task title"
                  value={task.title}
                  onChangeText={(title) => update({ title })}
                />
                <Line>
                  <View style={{ flex: 1 }}>
                    <DateField
                      label="Due date"
                      value={task.dueDate ?? ""}
                      onChangeText={(dueDate) =>
                        update({ dueDate: dueDate || null })
                      }
                    />
                  </View>
                  <TimeInput
                    label="Due time"
                    value={task.dueTime ?? "09:00"}
                    onChange={(dueTime) => update({ dueTime })}
                  />
                </Line>
                <Choices
                  wrap
                  value={task.listId ?? ""}
                  onChange={(listId) => update({ listId: listId || null })}
                  options={[
                    { value: "", label: "Inbox" },
                    ...lists
                      .filter((l) => !l.archivedAt)
                      .map((l) => ({ value: l.id, label: l.name })),
                  ]}
                />
                <Toggle
                  label="Remind"
                  value={task.remind}
                  onChange={(remind) => update({ remind })}
                />
              </View>
            )
          })}
        </>
      )
    case "habitLog": {
      const h = habits.find((h) => h.id === p.habitId)
      return (
        <>
          <Choices
            wrap
            label="Habit"
            value={p.habitId}
            onChange={(habitId) => set({ ...p, habitId })}
            options={habits
              .filter((h) => h.status === "active")
              .map((h) => ({ value: h.id, label: `${h.icon} ${h.name}` }))}
          />
          {h && h.type !== "check" && (
            <NumberControl
              label={h.type === "duration" ? "Minutes" : (h.unit ?? "Amount")}
              value={p.value ?? 0}
              onChange={(value) => set({ ...p, value })}
            />
          )}
        </>
      )
    }
    case "habitCreate":
      return (
        <>
          <Field
            label="Name"
            value={p.name}
            onChangeText={(name) => set({ ...p, name })}
          />
          <Copy size={12} muted>
            Days
          </Copy>
          <Line style={{ gap: 4 }}>
            {"SMTWTFS".split("").map((d, i) => (
              <Tap
                key={i}
                label={`Day ${i}`}
                onPress={() =>
                  set({
                    ...p,
                    days: p.days.includes(i)
                      ? p.days.filter((v) => v !== i)
                      : [...p.days, i].sort(),
                  })
                }
                style={{
                  flex: 1,
                  aspectRatio: 1,
                  borderRadius: 30,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: p.days.includes(i) ? t.hab : t.soft,
                }}
              >
                <Copy
                  size={14}
                  style={{ color: p.days.includes(i) ? t.bg : t.muted }}
                >
                  {d}
                </Copy>
              </Tap>
            ))}
          </Line>
          <Copy size={12} muted>
            Time (optional)
          </Copy>
          <TimeInput
            label="Time"
            value={p.time ?? "09:00"}
            onChange={(time) => set({ ...p, time })}
          />
        </>
      )
    case "workout":
      return (
        <>
          <Field
            label="Name"
            value={p.name}
            onChangeText={(name) => set({ ...p, name })}
          />
          {p.cardio ? (
            <>
              <NumberControl
                label="Distance"
                suffix="km"
                step={0.5}
                value={p.cardio.km ?? 0}
                onChange={(km) => set({ ...p, cardio: { ...p.cardio!, km } })}
              />
              <NumberControl
                label="Time"
                suffix="min"
                value={p.cardio.min ?? 0}
                onChange={(min) => set({ ...p, cardio: { ...p.cardio!, min } })}
              />
            </>
          ) : (
            p.exercises.map((e, i) => (
              <View key={i} style={{ gap: 6 }}>
                <Copy size={12} muted>
                  {e.exercise}
                </Copy>
                <Line style={{ gap: 6 }}>
                  {(["sets", "reps", "kg"] as const).map((k) => (
                    <View key={k} style={{ flex: 1, minWidth: 0 }}>
                      <Field
                        label={k}
                        keyboardType="decimal-pad"
                        value={String(
                          k === "sets"
                            ? e.sets.length
                            : k === "reps"
                              ? (e.sets[0]?.reps ?? 0)
                              : (e.sets[0]?.weight ?? 0),
                        )}
                        onChangeText={(v) => {
                          const n = Math.max(0, Number(v) || 0)
                          set({
                            ...p,
                            exercises: p.exercises.map((x, j) =>
                              j !== i
                                ? x
                                : {
                                    ...x,
                                    sets:
                                      k === "sets"
                                        ? Array.from(
                                            {
                                              length: Math.min(
                                                100,
                                                Math.max(1, Math.round(n)),
                                              ),
                                            },
                                            () => ({ ...x.sets[0] }),
                                          )
                                        : x.sets.map((s) => ({
                                            ...s,
                                            [k === "reps" ? "reps" : "weight"]:
                                              n,
                                          })),
                                  },
                            ),
                          })
                        }}
                      />
                    </View>
                  ))}
                </Line>
              </View>
            ))
          )}
        </>
      )
    case "weighIn":
      return (
        <NumberControl
          label="Weight"
          value={p.kg}
          onChange={(kg) => set({ ...p, kg })}
          step={0.1}
          suffix="kg"
        />
      )
    case "meal":
      return (
        <>
          <Segmented
            value={p.label ?? "lunch"}
            onChange={(label) => set({ ...p, label })}
            options={(["breakfast", "lunch", "dinner", "snack"] as const).map(
              (value) => ({
                value,
                label: value[0].toUpperCase() + value.slice(1),
              }),
            )}
          />
          {p.items.map((it, i) => (
            <View key={i} style={{ gap: 6 }}>
              <Copy size={12} muted>
                {it.name}
              </Copy>
              <Line>
                <View style={{ flex: 1 }}>
                  <NumberControl
                    label={it.unit}
                    value={it.qty}
                    step={0.5}
                    onChange={(qty) => {
                      const f = it.qty ? qty / it.qty : 1
                      set({
                        ...p,
                        items: p.items.map((x, j) =>
                          i === j
                            ? {
                                ...x,
                                qty,
                                kcal: Math.round(x.kcal * f),
                                protein: Math.round(x.protein * f),
                                carbs: Math.round(x.carbs * f),
                                fat: Math.round(x.fat * f),
                              }
                            : x,
                        ),
                      })
                    }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label="kcal"
                    keyboardType="decimal-pad"
                    value={String(it.kcal)}
                    onChangeText={(v) =>
                      set({
                        ...p,
                        items: p.items.map((x, j) =>
                          j === i
                            ? { ...x, kcal: Math.max(0, Number(v) || 0) }
                            : x,
                        ),
                      })
                    }
                  />
                </View>
              </Line>
            </View>
          ))}
        </>
      )
    case "journal":
      return (
        <>
          <Field
            label="Entry"
            multiline
            numberOfLines={6}
            value={p.body}
            onChangeText={(body) => set({ ...p, body })}
          />
          <Copy size={12} muted>
            Mood
          </Copy>
          <MoodPicker value={p.mood} onChange={(mood) => set({ ...p, mood })} />
          <Copy size={12} muted>
            Area
          </Copy>
          <AreaPicker value={p.area} onChange={(area) => set({ ...p, area })} />
        </>
      )
    default:
      return (
        <Copy size={14} muted>
          Nothing to edit here.
        </Copy>
      )
  }
}
export function validPayload(p: Payload) {
  if ("amount" in p && (!Number.isFinite(p.amount) || (p.amount ?? 0) <= 0))
    return false
  if (p.kind === "transfer") return !!p.from && !!p.to && p.from !== p.to
  if (p.kind === "task")
    return p.tasks.length > 0 && p.tasks.every((t) => t.title.trim())
  if (p.kind === "weighIn") return p.kg > 0
  if (p.kind === "journal") return !!p.body.trim()
  return true
}
export function CaptureEdit({
  card,
  onClose,
}: {
  card: RecordCard
  onClose: () => void
}) {
  const [p, set] = useState(card.payload),
    saved = card.state === "saved" || card.state === "edited",
    labels: Record<string, string> = {
      habitLog: "check-in",
      habitCreate: "new habit",
      weighIn: "weigh-in",
      planned: "bill / recurring",
      task: "task",
      journal: "entry",
    }
  return (
    <Sheet title={`Edit ${labels[p.kind] ?? p.kind}`} open onClose={onClose}>
      <Copy size={12} muted>
        {card.target[0].toUpperCase() + card.target.slice(1)} ·{" "}
        {saved ? "saved — changes update the entry" : "not saved yet"}
      </Copy>
      <PayloadForm p={p} set={set} />
      <Line>
        {saved && (
          <Button
            tone="danger"
            onPress={() => {
              undoCard(card.id)
              onClose()
            }}
          >
            Delete
          </Button>
        )}
        <View style={{ flex: 1 }}>
          <Button
            onPress={() => {
              if (!validPayload(p)) {
                toast.error("Check the required fields")
                return
              }
              editCard(card.id, p)
              onClose()
            }}
          >
            Save
          </Button>
        </View>
      </Line>
    </Sheet>
  )
}
