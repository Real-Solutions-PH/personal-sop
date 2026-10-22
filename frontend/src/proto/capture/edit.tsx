"use client"

import { Bell, Minus, Plus, Trash2 } from "lucide-react"
import { useId, useState } from "react"
import { cn } from "@/lib/utils"
import { finStore } from "../finance/store"
import { habitsStore } from "../habits/store"
import { tasksStore } from "../tasks/store"
import { Btn, Chip, NumberInput, Segmented } from "../ui/kit"
import { undoCard } from "./actions"
import { AREAS, MOODS, type Mood, type Payload, type RecordCard } from "./data"
import {
  AREA_ICON,
  BottomSheet,
  KIND_LABEL,
  MOOD_ICON,
  TARGET_META,
} from "./ui"

// CAP-06 Record edit sheet: fix fields, or switch a money record's type.

const inputCls =
  "h-11 w-full rounded-xl border border-border bg-background px-3 text-[15px] outline-none focus:border-primary"

export function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-3 block">
      <div className="mb-1 font-medium text-muted-foreground text-xs">
        {label}
      </div>
      {children}
    </div>
  )
}

export function NumInput({
  value,
  onChange,
  step = 1,
  suffix,
  label,
}: {
  value: number
  onChange: (n: number) => void
  step?: number
  suffix?: string
  label: string
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={`Less ${label}`}
        onClick={() =>
          onChange(Math.max(0, Math.round((value - step) * 10) / 10))
        }
        className="grid size-11 place-items-center rounded-xl bg-muted"
      >
        <Minus className="size-4" />
      </button>
      <div className="relative flex-1">
        <NumberInput
          inputMode="decimal"
          aria-label={label}
          value={Number.isFinite(value) ? String(value) : ""}
          onChange={(e) =>
            onChange(Number(e.target.value.replace(/[^\d.]/g, "")) || 0)
          }
          className={cn(inputCls, "num text-center font-semibold text-lg")}
        />
        {suffix && (
          <span className="-translate-y-1/2 absolute top-1/2 right-3 text-muted-foreground text-sm">
            {suffix}
          </span>
        )}
      </div>
      <button
        type="button"
        aria-label={`More ${label}`}
        onClick={() => onChange(Math.round((value + step) * 10) / 10)}
        className="grid size-11 place-items-center rounded-xl bg-muted"
      >
        <Plus className="size-4" />
      </button>
    </div>
  )
}

export function MoneyInput({
  value,
  onChange,
}: {
  value: number
  onChange: (n: number) => void
}) {
  return (
    <div className="relative">
      <span className="-translate-y-1/2 absolute top-1/2 left-3 font-semibold text-muted-foreground text-xl">
        ₱
      </span>
      <NumberInput
        inputMode="decimal"
        aria-label="Amount"
        value={value ? String(value) : ""}
        placeholder="0"
        onChange={(e) =>
          onChange(Number(e.target.value.replace(/[^\d.]/g, "")) || 0)
        }
        className={cn(inputCls, "num h-14 pl-9 font-semibold text-2xl")}
      />
    </div>
  )
}

export function CategoryChips({
  kind,
  value,
  onChange,
}: {
  kind: "expense" | "income"
  value?: string
  onChange: (id: string) => void
}) {
  const cats = finStore.use((s) => s.categories)
  return (
    <div className="flex flex-wrap gap-1.5">
      {cats
        .filter((c) => c.kind === kind && !c.archived && !c.system)
        .map((c) => (
          <Chip
            key={c.id}
            active={c.id === value}
            accent="fin"
            onClick={() => onChange(c.id)}
            className="h-11"
          >
            {c.icon} {c.name}
          </Chip>
        ))}
    </div>
  )
}

export function AccountChips({
  value,
  onChange,
  exclude,
}: {
  value?: string
  onChange: (id: string) => void
  exclude?: string
}) {
  const accts = finStore.use((s) => s.accounts)
  return (
    <div className="flex flex-wrap gap-1.5">
      {accts
        .filter(
          (a) => !a.archived && a.type !== "investment" && a.id !== exclude,
        )
        .map((a) => (
          <Chip
            key={a.id}
            active={a.id === value}
            accent="fin"
            onClick={() => onChange(a.id)}
            className="h-11"
          >
            {a.name}
          </Chip>
        ))}
    </div>
  )
}

function Form({ p, set }: { p: Payload; set: (p: Payload) => void }) {
  const habits = habitsStore.use((s) => s.habits)
  const lists = tasksStore.use((s) => s.lists)
  switch (p.kind) {
    case "expense":
    case "income":
      return (
        <>
          <Field label="Type">
            <Segmented
              value={p.kind}
              options={[
                { value: "expense", label: "Expense" },
                { value: "income", label: "Income" },
              ]}
              onChange={(k) =>
                set(
                  k === "income"
                    ? {
                        kind: "income",
                        amount: p.amount,
                        categoryId: "other-in",
                        accountId: p.accountId,
                        payee: p.payee,
                      }
                    : {
                        kind: "expense",
                        amount: p.amount,
                        accountId: p.accountId ?? "gcash",
                        payee: p.payee,
                      },
                )
              }
            />
          </Field>
          <Field label="Amount">
            <MoneyInput
              value={p.amount}
              onChange={(amount) => set({ ...p, amount })}
            />
          </Field>
          <Field label="Category">
            <CategoryChips
              kind={p.kind}
              value={p.categoryId}
              onChange={(categoryId) => set({ ...p, categoryId } as Payload)}
            />
          </Field>
          <Field label="Account">
            <AccountChips
              value={p.accountId}
              onChange={(accountId) => set({ ...p, accountId } as Payload)}
            />
          </Field>
          <Field label="Payee / note">
            <input
              className={inputCls}
              value={p.payee ?? ""}
              onChange={(e) => set({ ...p, payee: e.target.value })}
            />
          </Field>
        </>
      )
    case "transfer":
      return (
        <>
          <Field label="Amount">
            <MoneyInput
              value={p.amount}
              onChange={(amount) => set({ ...p, amount })}
            />
          </Field>
          <Field label="From">
            <AccountChips
              value={p.from}
              onChange={(from) => set({ ...p, from })}
            />
          </Field>
          <Field label="To">
            <AccountChips
              value={p.to}
              exclude={p.from}
              onChange={(to) => set({ ...p, to })}
            />
          </Field>
        </>
      )
    case "planned":
      return (
        <>
          <Field label="Name">
            <input
              className={inputCls}
              value={p.name}
              onChange={(e) => set({ ...p, name: e.target.value })}
            />
          </Field>
          <Field label="Amount">
            <MoneyInput
              value={p.amount}
              onChange={(amount) => set({ ...p, amount })}
            />
          </Field>
          {p.date ? null : (
            <Field label="Day of month">
              <NumInput
                label="day"
                value={p.day ?? 1}
                onChange={(day) =>
                  set({ ...p, day: Math.min(31, Math.max(1, day)) })
                }
              />
            </Field>
          )}
        </>
      )
    case "task":
      return (
        <>
          {p.tasks.map((t, i) => (
            <div
              key={i}
              className="mb-3 rounded-xl border border-border/60 p-3"
            >
              <input
                className={inputCls}
                value={t.title}
                aria-label="Task title"
                onChange={(e) =>
                  set({
                    ...p,
                    tasks: p.tasks.map((x, j) =>
                      j === i ? { ...x, title: e.target.value } : x,
                    ),
                  })
                }
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  type="date"
                  aria-label="Due date"
                  className={inputCls}
                  value={t.dueDate ?? ""}
                  onChange={(e) =>
                    set({
                      ...p,
                      tasks: p.tasks.map((x, j) =>
                        j === i ? { ...x, dueDate: e.target.value || null } : x,
                      ),
                    })
                  }
                />
                <input
                  type="time"
                  aria-label="Due time"
                  className={inputCls}
                  value={t.dueTime ?? ""}
                  onChange={(e) =>
                    set({
                      ...p,
                      tasks: p.tasks.map((x, j) =>
                        j === i ? { ...x, dueTime: e.target.value || null } : x,
                      ),
                    })
                  }
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {lists
                  .filter((l) => !l.archivedAt)
                  .map((l) => (
                    <Chip
                      key={l.id}
                      accent="tsk"
                      active={t.listId === l.id}
                      className="h-11"
                      onClick={() =>
                        set({
                          ...p,
                          tasks: p.tasks.map((x, j) =>
                            j === i ? { ...x, listId: l.id } : x,
                          ),
                        })
                      }
                    >
                      {l.name}
                    </Chip>
                  ))}
                <Chip
                  accent="tsk"
                  active={t.remind}
                  className="h-11"
                  onClick={() =>
                    set({
                      ...p,
                      tasks: p.tasks.map((x, j) =>
                        j === i ? { ...x, remind: !x.remind } : x,
                      ),
                    })
                  }
                >
                  <Bell className="size-4" aria-hidden /> Remind
                </Chip>
              </div>
            </div>
          ))}
        </>
      )
    case "habitLog": {
      const h = habits.find((x) => x.id === p.habitId)
      return (
        <>
          <Field label="Habit">
            <div className="flex flex-wrap gap-1.5">
              {habits
                .filter((x) => x.status === "active")
                .map((x) => (
                  <Chip
                    key={x.id}
                    accent="hab"
                    active={x.id === p.habitId}
                    className="h-11"
                    onClick={() => set({ ...p, habitId: x.id })}
                  >
                    {x.icon} {x.name}
                  </Chip>
                ))}
            </div>
          </Field>
          {h && h.type !== "check" && (
            <Field
              label={h.type === "duration" ? "Minutes" : (h.unit ?? "Amount")}
            >
              <NumInput
                label="value"
                value={p.value ?? 0}
                onChange={(value) => set({ ...p, value })}
              />
            </Field>
          )}
        </>
      )
    }
    case "habitCreate":
      return (
        <>
          <Field label="Name">
            <input
              className={inputCls}
              value={p.name}
              onChange={(e) => set({ ...p, name: e.target.value })}
            />
          </Field>
          <Field label="Days">
            <div className="flex gap-1">
              {"SMTWTFS".split("").map((d, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() =>
                    set({
                      ...p,
                      days: p.days.includes(i)
                        ? p.days.filter((x) => x !== i)
                        : [...p.days, i].sort(),
                    })
                  }
                  className={cn(
                    "size-11 rounded-full font-semibold text-sm",
                    p.days.includes(i)
                      ? "bg-hab text-background"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Time (optional)">
            <input
              type="time"
              className={inputCls}
              value={p.time ?? ""}
              onChange={(e) => set({ ...p, time: e.target.value || undefined })}
            />
          </Field>
        </>
      )
    case "workout":
      return (
        <>
          <Field label="Name">
            <input
              className={inputCls}
              value={p.name}
              onChange={(e) => set({ ...p, name: e.target.value })}
            />
          </Field>
          {p.cardio ? (
            <>
              <Field label="Distance">
                <NumInput
                  label="km"
                  step={0.5}
                  suffix="km"
                  value={p.cardio.km ?? 0}
                  onChange={(km) => set({ ...p, cardio: { ...p.cardio!, km } })}
                />
              </Field>
              <Field label="Time">
                <NumInput
                  label="minutes"
                  suffix="min"
                  value={p.cardio.min ?? 0}
                  onChange={(min) =>
                    set({ ...p, cardio: { ...p.cardio!, min } })
                  }
                />
              </Field>
            </>
          ) : (
            p.exercises.map((e, i) => (
              <Field key={i} label={e.exercise}>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <NumMini
                    label="sets"
                    value={e.sets.length}
                    onChange={(n) =>
                      set({
                        ...p,
                        exercises: p.exercises.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                sets: Array.from(
                                  { length: Math.max(1, n) },
                                  () => x.sets[0],
                                ),
                              }
                            : x,
                        ),
                      })
                    }
                  />
                  <NumMini
                    label="reps"
                    value={e.sets[0]?.reps ?? 0}
                    onChange={(reps) =>
                      set({
                        ...p,
                        exercises: p.exercises.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                sets: x.sets.map((s) => ({ ...s, reps })),
                              }
                            : x,
                        ),
                      })
                    }
                  />
                  <NumMini
                    label="kg"
                    value={e.sets[0]?.weight ?? 0}
                    onChange={(weight) =>
                      set({
                        ...p,
                        exercises: p.exercises.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                sets: x.sets.map((s) => ({ ...s, weight })),
                              }
                            : x,
                        ),
                      })
                    }
                  />
                </div>
              </Field>
            ))
          )}
        </>
      )
    case "weighIn":
      return (
        <Field label="Weight">
          <NumInput
            label="weight"
            step={0.1}
            suffix="kg"
            value={p.kg}
            onChange={(kg) => set({ ...p, kg })}
          />
        </Field>
      )
    case "meal":
      return (
        <>
          <Field label="Meal">
            <Segmented
              value={p.label ?? "lunch"}
              options={(["breakfast", "lunch", "dinner", "snack"] as const).map(
                (v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }),
              )}
              onChange={(label) => set({ ...p, label })}
            />
          </Field>
          {p.items.map((it, i) => (
            <Field key={i} label={it.name}>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <NumMini
                  label={it.unit}
                  step={0.5}
                  value={it.qty}
                  onChange={(qty) => {
                    const f = it.qty ? qty / it.qty : 1
                    set({
                      ...p,
                      items: p.items.map((x, j) =>
                        j === i
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
                <NumMini
                  label="kcal"
                  value={it.kcal}
                  onChange={(kcal) =>
                    set({
                      ...p,
                      items: p.items.map((x, j) =>
                        j === i ? { ...x, kcal } : x,
                      ),
                    })
                  }
                />
              </div>
            </Field>
          ))}
        </>
      )
    case "journal":
      return (
        <>
          <Field label="Entry">
            <textarea
              rows={6}
              className={cn(inputCls, "h-auto py-2 leading-relaxed")}
              value={p.body}
              onChange={(e) => set({ ...p, body: e.target.value })}
            />
          </Field>
          <Field label="Mood">
            <MoodPicker
              value={p.mood}
              onChange={(mood) => set({ ...p, mood })}
            />
          </Field>
          <Field label="Area">
            <AreaPicker
              value={p.area}
              onChange={(area) => set({ ...p, area })}
            />
          </Field>
        </>
      )
    default:
      return (
        <p className="text-muted-foreground text-sm">Nothing to edit here.</p>
      )
  }
}

function NumMini({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  step?: number
}) {
  const id = useId()
  return (
    <div className="block rounded-xl bg-muted/60 p-1.5">
      <NumberInput
        id={id}
        inputMode="decimal"
        value={String(value)}
        onChange={(e) =>
          onChange(Number(e.target.value.replace(/[^\d.]/g, "")) || 0)
        }
        className="num w-full bg-transparent text-center font-semibold text-base outline-none"
      />
      <label htmlFor={id} className="block text-muted-foreground">
        {label}
        <span className="sr-only">step {step}</span>
      </label>
    </div>
  )
}

export function EditSheet({
  card,
  open,
  onOpenChange,
  onSave,
}: {
  card: RecordCard
  open: boolean
  onOpenChange: (v: boolean) => void
  onSave: (p: Payload) => void
}) {
  const [p, set] = useState<Payload>(card.payload)
  const saved = card.state === "saved" || card.state === "edited"
  const meta = TARGET_META[card.target]
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${KIND_LABEL[p.kind === "income" ? "income" : card.kind].toLowerCase()}`}
      description={`${meta.label} · ${saved ? "saved — changes update the entry" : "not saved yet"}`}
      footer={
        <div className="flex gap-2">
          {saved && (
            <Btn
              variant="danger"
              onClick={() => {
                undoCard(card.id)
                onOpenChange(false)
              }}
            >
              <Trash2 className="size-4" /> Delete
            </Btn>
          )}
          <Btn
            className="flex-1"
            accent={meta.accent}
            onClick={() => {
              onSave(p)
              onOpenChange(false)
            }}
          >
            Save
          </Btn>
        </div>
      }
    >
      <Form p={p} set={set} />
    </BottomSheet>
  )
}

export function MoodPicker({
  value,
  onChange,
}: {
  value?: Mood
  onChange: (m: Mood | undefined) => void
}) {
  return (
    <fieldset className="flex gap-1.5" aria-label="Mood">
      {MOODS.map((m) => {
        const I = MOOD_ICON[m.v]
        const on = value === m.v
        return (
          <button
            key={m.v}
            type="button"
            aria-pressed={on}
            aria-label={m.label}
            onClick={() => onChange(on ? undefined : m.v)}
            className={cn(
              "flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] transition-colors duration-150",
              on
                ? "bg-life/20 text-life ring-2 ring-life"
                : "bg-muted text-muted-foreground",
            )}
          >
            <I className="size-5" />
            {m.label}
          </button>
        )
      })}
    </fieldset>
  )
}

export function AreaPicker({
  value,
  onChange,
}: {
  value?: string
  onChange: (a: string | undefined) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {AREAS.map((a) => {
        const I = AREA_ICON[a.key]
        return (
          <Chip
            key={a.key}
            accent="life"
            active={value === a.key}
            className="h-11"
            onClick={() => onChange(value === a.key ? undefined : a.key)}
          >
            <I className="size-4" aria-hidden /> {a.label}
          </Chip>
        )
      })}
    </div>
  )
}
