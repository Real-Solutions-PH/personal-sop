"use client"

import {
  ArrowLeftRight,
  Bell,
  BookOpen,
  Check,
  CheckSquare,
  ChevronLeft,
  Dumbbell,
  Repeat,
  Scale,
  TrendingUp,
  Utensils,
  Wallet,
} from "lucide-react"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { finStore } from "../finance/store"
import { parseMealText } from "../fitness/actions"
import { latestBodyweight } from "../fitness/calc"
import { fitStore } from "../fitness/store"
import { isDue, lk, logIndex } from "../habits/logic"
import { habitsStore } from "../habits/store"
import { dayKey, peso } from "../lib/day"
import { fmtDay, fmtTime } from "../tasks/logic"
import { parseTask } from "../tasks/parse"
import { type Accent, Btn, Chip, NumberInput } from "../ui/kit"
import { logQuickAdd } from "./actions"
import type { Mood, Payload, Target } from "./data"
import {
  AccountChips,
  AreaPicker,
  CategoryChips,
  Field,
  MoneyInput,
  MoodPicker,
  NumInput,
} from "./edit"
import { recentExpenseCats } from "./parse"
import { BottomSheet, tint } from "./ui"

// CAP-09 Quick-add sheet + CAP-10 minimal forms: the manual fallback that works
// with AI off or offline (direct writes, same undo).

type QType =
  | "expense"
  | "income"
  | "transfer"
  | "task"
  | "habit"
  | "weigh"
  | "meal"
  | "workout"
  | "journal"

const TYPES: {
  t: QType
  label: string
  icon: typeof Wallet
  accent: Accent
}[] = [
  { t: "expense", label: "Expense", icon: Wallet, accent: "fin" },
  { t: "income", label: "Income", icon: TrendingUp, accent: "fin" },
  { t: "transfer", label: "Transfer", icon: ArrowLeftRight, accent: "fin" },
  { t: "task", label: "Task", icon: CheckSquare, accent: "tsk" },
  { t: "habit", label: "Habit check", icon: Repeat, accent: "hab" },
  { t: "weigh", label: "Weigh-in", icon: Scale, accent: "fit" },
  { t: "meal", label: "Meal", icon: Utensils, accent: "fit" },
  { t: "workout", label: "Set / workout", icon: Dumbbell, accent: "fit" },
  { t: "journal", label: "Journal", icon: BookOpen, accent: "life" },
]

const inputCls =
  "h-11 w-full rounded-xl border border-border bg-background px-3 text-[15px] outline-none focus:border-primary"

export function QuickAddSheet({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initial?: QType
}) {
  const [type, setType] = useState<QType | null>(initial ?? null)
  const cur = TYPES.find((x) => x.t === type)
  const done = () => onOpenChange(false)
  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) setType(initial ?? null)
      }}
      title={
        cur ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Back to types"
              onClick={() => setType(null)}
              className="-ml-3 grid size-11 place-items-center rounded-full hover:bg-muted"
            >
              <ChevronLeft className="size-5" />
            </button>
            {cur.label}
          </span>
        ) : (
          "Quick add"
        )
      }
      description={
        cur
          ? "Saved straight away — undo from the toast."
          : "Manual entry. Works offline and when AI is off."
      }
    >
      {!type ? (
        <div className="grid grid-cols-3 gap-2 pb-2">
          {TYPES.map((x) => (
            <button
              key={x.t}
              type="button"
              onClick={() => setType(x.t)}
              className="flex aspect-[4/3] flex-col items-center justify-center gap-1.5 rounded-2xl border border-border/60 bg-card font-medium text-sm active:scale-95"
            >
              <span
                className={cn(
                  "grid size-9 place-items-center rounded-xl",
                  tint[x.accent].bg,
                )}
              >
                <x.icon className={cn("size-5", tint[x.accent].text)} />
              </span>
              {x.label}
            </button>
          ))}
        </div>
      ) : type === "expense" ? (
        <ExpenseForm onDone={done} />
      ) : type === "income" ? (
        <IncomeForm onDone={done} />
      ) : type === "transfer" ? (
        <TransferForm onDone={done} />
      ) : type === "task" ? (
        <TaskForm onDone={done} />
      ) : type === "habit" ? (
        <HabitForm />
      ) : type === "weigh" ? (
        <WeighForm onDone={done} />
      ) : type === "meal" ? (
        <MealForm onDone={done} />
      ) : type === "workout" ? (
        <WorkoutForm onDone={done} />
      ) : (
        <JournalForm onDone={done} />
      )}
    </BottomSheet>
  )
}

function save(text: string, p: Payload, target: Target) {
  logQuickAdd(text, p, target)
}

function SaveRow({
  disabled,
  onSave,
  onAnother,
  accent,
}: {
  disabled?: boolean
  onSave: () => void
  onAnother?: () => void
  accent: Accent
}) {
  return (
    <div className="mt-4 flex gap-2">
      {onAnother && (
        <Btn variant="secondary" disabled={disabled} onClick={onAnother}>
          Save & add another
        </Btn>
      )}
      <Btn
        className="flex-1"
        accent={accent}
        disabled={disabled}
        onClick={onSave}
      >
        Save
      </Btn>
    </div>
  )
}

function ExpenseForm({ onDone }: { onDone: () => void }) {
  const st = finStore.use((s) => s.settings)
  const recent = useMemo(() => recentExpenseCats(), [])
  const [amount, setAmount] = useState(0)
  const [cat, setCat] = useState<string | undefined>(recent[0]?.value)
  const [acct, setAcct] = useState(st.lastAccountId ?? st.defaultAccountId)
  const [note, setNote] = useState("")
  const [all, setAll] = useState(false)
  const submit = (another: boolean) => {
    save(
      `Expense ${peso(amount)}`,
      {
        kind: "expense",
        amount,
        categoryId: cat,
        accountId: acct,
        payee: note || undefined,
      },
      "finance",
    )
    if (another) {
      setAmount(0)
      setNote("")
    } else onDone()
  }
  return (
    <>
      <Field label="Amount">
        <MoneyInput value={amount} onChange={setAmount} />
      </Field>
      <Field label="Category">
        {all ? (
          <CategoryChips kind="expense" value={cat} onChange={setCat} />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {recent.map((c) => (
              <Chip
                key={c.value}
                accent="fin"
                active={cat === c.value}
                onClick={() => setCat(c.value)}
                className="h-11"
              >
                {c.label}
              </Chip>
            ))}
            <Chip onClick={() => setAll(true)} className="h-11">
              All…
            </Chip>
          </div>
        )}
      </Field>
      <Field label="Account">
        <AccountChips value={acct} onChange={setAcct} />
      </Field>
      <Field label="Note / payee">
        <input
          className={inputCls}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional"
        />
      </Field>
      <SaveRow
        accent="fin"
        disabled={!amount}
        onSave={() => submit(false)}
        onAnother={() => submit(true)}
      />
    </>
  )
}

function IncomeForm({ onDone }: { onDone: () => void }) {
  const st = finStore.use((s) => s.settings)
  const [amount, setAmount] = useState(0)
  const [cat, setCat] = useState("salary")
  const [acct, setAcct] = useState(st.defaultAccountId)
  return (
    <>
      <Field label="Amount">
        <MoneyInput value={amount} onChange={setAmount} />
      </Field>
      <Field label="Category">
        <CategoryChips kind="income" value={cat} onChange={setCat} />
      </Field>
      <Field label="Into">
        <AccountChips value={acct} onChange={setAcct} />
      </Field>
      <SaveRow
        accent="fin"
        disabled={!amount}
        onSave={() => {
          save(
            `Income ${peso(amount)}`,
            { kind: "income", amount, categoryId: cat, accountId: acct },
            "finance",
          )
          onDone()
        }}
      />
    </>
  )
}

function TransferForm({ onDone }: { onDone: () => void }) {
  const [amount, setAmount] = useState(0)
  const [from, setFrom] = useState("gcash")
  const [to, setTo] = useState("bpi")
  return (
    <>
      <Field label="Amount">
        <MoneyInput value={amount} onChange={setAmount} />
      </Field>
      <Field label="From">
        <AccountChips value={from} onChange={setFrom} />
      </Field>
      <Field label="To">
        <AccountChips value={to} exclude={from} onChange={setTo} />
      </Field>
      <SaveRow
        accent="fin"
        disabled={!amount || from === to}
        onSave={() => {
          save(
            `Transfer ${peso(amount)}`,
            { kind: "transfer", amount, from, to },
            "finance",
          )
          onDone()
        }}
      />
    </>
  )
}

function TaskForm({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("")
  const [remind, setRemind] = useState(false)
  const parsed = useMemo(() => parseTask(text), [text])
  const submit = (another: boolean) => {
    save(
      `Task · ${parsed.title || text}`,
      {
        kind: "task",
        tasks: [
          {
            title: parsed.title || text,
            listId: null,
            dueDate: parsed.dueDate,
            dueTime: parsed.dueTime,
            remind,
          },
        ],
      },
      "tasks",
    )
    if (another) setText("")
    else onDone()
  }
  return (
    <>
      <Field label="Task">
        <input
          className={inputCls}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. call the dentist fri 10am"
        />
      </Field>
      {(parsed.dueDate || parsed.dueTime) && (
        <div className="-mt-1 mb-3 text-tsk text-xs">
          Due {parsed.dueDate ? fmtDay(parsed.dueDate) : "today"}
          {parsed.dueTime ? ` · ${fmtTime(parsed.dueTime)}` : ""}
        </div>
      )}
      <Chip
        accent="tsk"
        active={remind}
        onClick={() => setRemind(!remind)}
        className="h-11"
      >
        <Bell className="size-4" aria-hidden /> Remind me
      </Chip>
      <SaveRow
        accent="tsk"
        disabled={!text.trim()}
        onSave={() => submit(false)}
        onAnother={() => submit(true)}
      />
    </>
  )
}

function HabitForm() {
  const st = habitsStore.use((s) => s)
  const t = dayKey()
  const rows = useMemo(() => {
    const idx = logIndex(st.logs)
    return st.habits
      .filter((h) => h.status === "active" && isDue(h, t))
      .map((h) => ({ h, done: idx.get(lk(h.id, t))?.status === "done" }))
  }, [st, t])
  return (
    <div className="space-y-1.5 pb-2">
      {rows.map(({ h, done }) => (
        <button
          key={h.id}
          type="button"
          disabled={done}
          onClick={() =>
            save(
              `${h.icon} ${h.name}`,
              {
                kind: "habitLog",
                habitId: h.id,
                value: h.type === "check" ? undefined : h.target,
              },
              "habits",
            )
          }
          className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5 text-left active:scale-[0.99] disabled:opacity-60"
        >
          <span className="text-xl">{h.icon}</span>
          <span className="flex-1 font-medium">{h.name}</span>
          <span
            className={cn(
              "grid size-9 place-items-center rounded-full border-2",
              done
                ? "border-transparent bg-hab text-background"
                : "border-hab/40",
            )}
          >
            {done && <Check className="size-4" strokeWidth={3} />}
          </span>
        </button>
      ))}
      {!rows.length && (
        <p className="py-6 text-center text-muted-foreground text-sm">
          Nothing due today.
        </p>
      )}
    </div>
  )
}

function WeighForm({ onDone }: { onDone: () => void }) {
  const last = fitStore.use((s) => latestBodyweight(s))
  const [kg, setKg] = useState(last ?? 70)
  return (
    <>
      <Field label={last ? `Last: ${last} kg` : "Weight"}>
        <NumInput
          label="weight"
          step={0.1}
          suffix="kg"
          value={kg}
          onChange={setKg}
        />
      </Field>
      <SaveRow
        accent="fit"
        disabled={!kg}
        onSave={() => {
          save(
            `Weigh-in ${kg} kg`,
            { kind: "weighIn", kg, prevKg: last },
            "fitness",
          )
          onDone()
        }}
      />
    </>
  )
}

function MealForm({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("")
  const est = useMemo(() => (text.trim() ? parseMealText(text) : null), [text])
  const kcal = est?.items.reduce((a, i) => a + i.kcal, 0) ?? 0
  return (
    <>
      <Field label="What did you eat?">
        <input
          className={inputCls}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. tapsilog, coffee"
        />
      </Field>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {[
          "2 eggs, pandesal",
          "adobo with 1 cup rice",
          "whey shake",
          "banana",
        ].map((s) => (
          <Chip key={s} className="h-11" onClick={() => setText(s)}>
            {s}
          </Chip>
        ))}
      </div>
      {est ? (
        <div className="rounded-xl bg-muted/50 p-3 text-sm">
          <div className="num font-semibold">{kcal} kcal</div>
          {est.items.map((i) => (
            <div
              key={i.id}
              className="flex justify-between text-muted-foreground text-xs"
            >
              <span>{i.name}</span>
              <span className="num">
                {i.kcal} · P{i.protein}
              </span>
            </div>
          ))}
        </div>
      ) : (
        text.trim() && (
          <div className="text-muted-foreground text-xs">
            No match in the food library yet — try a dish name.
          </div>
        )
      )}
      <SaveRow
        accent="fit"
        disabled={!est}
        onSave={() => {
          if (!est) return
          save(
            `Meal · ${text}`,
            {
              kind: "meal",
              raw: text,
              items: est.items.map(({ id: _id, ...r }) => r),
              confidence: est.confidence,
            },
            "fitness",
          )
          onDone()
        }}
      />
    </>
  )
}

function WorkoutForm({ onDone }: { onDone: () => void }) {
  const exercises = fitStore.use((s) => s.exercises)
  const [ex, setEx] = useState("bench")
  const [sets, setSets] = useState(3)
  const [reps, setReps] = useState(5)
  const [kg, setKg] = useState(60)
  const name = exercises.find((e) => e.id === ex)?.name ?? "Exercise"
  return (
    <>
      <Field label="Exercise">
        <div className="flex flex-wrap gap-1.5">
          {exercises
            .filter((e) => !e.archived)
            .map((e) => (
              <Chip
                key={e.id}
                accent="fit"
                active={ex === e.id}
                onClick={() => setEx(e.id)}
                className="h-11"
              >
                {e.name}
              </Chip>
            ))}
        </div>
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Sets">
          <NumberInput
            inputMode="numeric"
            className={cn(inputCls, "num text-center")}
            value={sets}
            onChange={(e) => setSets(Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="Reps">
          <NumberInput
            inputMode="numeric"
            className={cn(inputCls, "num text-center")}
            value={reps}
            onChange={(e) => setReps(Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="kg">
          <NumberInput
            inputMode="decimal"
            className={cn(inputCls, "num text-center")}
            value={kg}
            onChange={(e) => setKg(Number(e.target.value) || 0)}
          />
        </Field>
      </div>
      <SaveRow
        accent="fit"
        disabled={!sets || !reps}
        onSave={() => {
          save(
            `${name} ${sets}×${reps} @ ${kg} kg`,
            {
              kind: "workout",
              name,
              exercises: [
                {
                  exercise: ex,
                  sets: Array.from({ length: sets }, () => ({
                    reps,
                    weight: kg,
                  })),
                },
              ],
            },
            "fitness",
          )
          onDone()
        }}
      />
    </>
  )
}

function JournalForm({ onDone }: { onDone: () => void }) {
  const [body, setBody] = useState("")
  const [mood, setMood] = useState<Mood | undefined>()
  const [area, setArea] = useState<string | undefined>()
  return (
    <>
      <textarea
        rows={5}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What's on your mind?"
        className={cn(inputCls, "h-auto py-2 leading-relaxed")}
      />
      <div className="mt-3">
        <MoodPicker value={mood} onChange={setMood} />
      </div>
      <div className="mt-2">
        <AreaPicker value={area} onChange={setArea} />
      </div>
      <SaveRow
        accent="life"
        disabled={!body.trim()}
        onSave={() => {
          save(
            "Journal entry",
            { kind: "journal", body, mood, area, tags: [] },
            "journal",
          )
          onDone()
        }}
      />
    </>
  )
}
