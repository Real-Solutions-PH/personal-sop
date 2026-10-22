import { logQuickAdd } from "@domain/capture/actions"
import type { Payload, Target } from "@domain/capture/data"
import { finStore } from "@domain/finance/store"
import { parseMealText } from "@domain/fitness/actions"
import { latestBodyweight } from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import { isDue, lk, logIndex } from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { parseTask } from "@domain/tasks/parse"
import {
  ArrowLeftRight,
  BookOpen,
  Check,
  CheckSquare,
  Dumbbell,
  Repeat,
  Scale,
  TrendingUp,
  Utensils,
  Wallet,
} from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { Copy, Line, Tap } from "../native-kit"
import { AccentContext, useTheme } from "../theme"
import { Button, Choices, Field, Sheet } from "../ui"
import { PayloadForm, validPayload } from "./capture-edit"

const types = [
  { v: "expense", label: "Expense", I: Wallet, accent: "fin" },
  { v: "income", label: "Income", I: TrendingUp, accent: "fin" },
  { v: "transfer", label: "Transfer", I: ArrowLeftRight, accent: "fin" },
  { v: "task", label: "Task", I: CheckSquare, accent: "tsk" },
  { v: "habit", label: "Habit check", I: Repeat, accent: "hab" },
  { v: "weigh", label: "Weigh-in", I: Scale, accent: "fit" },
  { v: "meal", label: "Meal", I: Utensils, accent: "fit" },
  { v: "workout", label: "Set / workout", I: Dumbbell, accent: "fit" },
  { v: "journal", label: "Journal", I: BookOpen, accent: "life" },
] as const
export function QuickAdd({ onClose }: { onClose: () => void }) {
  const t = useTheme(),
    [type, setType] = useState<string>(),
    cur = types.find((x) => x.v === type)
  return (
    <Sheet
      title={cur?.label ?? "Quick add"}
      open
      onClose={onClose}
      onBack={cur ? () => setType(undefined) : undefined}
      backLabel="Back to all types"
    >
      <View style={{ gap: 14, paddingTop: 4, paddingBottom: 8 }}>
        <Copy size={13} muted>
          {cur
            ? "Saved straight away. Undo from the toast."
            : "Pick what to log. Works offline and when AI is off."}
        </Copy>
        {!cur ? (
          <View style={{ gap: 10 }}>
            {rowsOf(types, 3).map((row) => (
              <View key={row[0].v} style={{ flexDirection: "row", gap: 10 }}>
                {row.map((x) => (
                  <Tap
                    key={x.v}
                    label={`Add ${x.label.toLowerCase()}`}
                    onPress={() => setType(x.v)}
                    style={{
                      flex: 1,
                      minHeight: 88,
                      paddingVertical: 14,
                      paddingHorizontal: 8,
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: t.line,
                      backgroundColor: t.card,
                    }}
                  >
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 12,
                        backgroundColor: `${t[x.accent]}26`,
                      }}
                    >
                      <x.I size={20} color={t[x.accent]} />
                    </View>
                    <Copy
                      size={13}
                      weight="medium"
                      style={{ textAlign: "center" }}
                    >
                      {x.label}
                    </Copy>
                  </Tap>
                ))}
              </View>
            ))}
          </View>
        ) : (
          <AccentContext.Provider value={cur.accent}>
            <QuickForm key={cur.v} type={cur.v} onDone={onClose} />
          </AccentContext.Provider>
        )}
      </View>
    </Sheet>
  )
}
function rowsOf<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}
function QuickForm({ type, onDone }: { type: string; onDone: () => void }) {
  const fin = finStore.use((s) => s),
    fit = fitStore.use((s) => s),
    hab = habitsStore.use((s) => s),
    t = useTheme(),
    [text, setText] = useState(""),
    [exercise, setExercise] = useState("bench"),
    [sets, setSets] = useState("3"),
    [reps, setReps] = useState("5"),
    [kg, setKg] = useState("60")
  const initial = (): Payload =>
    type === "expense"
      ? {
          kind: "expense",
          amount: 0,
          accountId:
            fin.settings.lastAccountId ?? fin.settings.defaultAccountId,
          categoryId: fin.categories.find(
            (c) => c.kind === "expense" && !c.archived,
          )?.id,
        }
      : type === "income"
        ? {
            kind: "income",
            amount: 0,
            accountId: fin.settings.defaultAccountId,
            categoryId: "other-in",
          }
        : type === "transfer"
          ? { kind: "transfer", amount: 0, from: fin.settings.defaultAccountId }
          : type === "weigh"
            ? { kind: "weighIn", kg: latestBodyweight(fit) ?? 70 }
            : type === "journal"
              ? { kind: "journal", body: "", tags: [] }
              : {
                  kind: "task",
                  tasks: [
                    {
                      title: "",
                      listId: null,
                      dueDate: null,
                      dueTime: null,
                      remind: false,
                    },
                  ],
                }
  const [p, set] = useState<Payload>(initial),
    target: Target = ["expense", "income", "transfer"].includes(type)
      ? "finance"
      : type === "task"
        ? "tasks"
        : type === "habit"
          ? "habits"
          : type === "journal"
            ? "journal"
            : "fitness",
    est = type === "meal" && text.trim() ? parseMealText(text) : null
  function save(another = false) {
    let payload = p
    if (type === "task") {
      const parsed = parseTask(text)
      payload = {
        kind: "task",
        tasks: [
          {
            title: parsed.title,
            listId: null,
            dueDate: parsed.dueDate,
            dueTime: parsed.dueTime,
            remind: !!parsed.dueTime,
          },
        ],
      }
    }
    if (type === "meal") {
      if (!est) return
      payload = {
        kind: "meal",
        raw: text,
        items: est.items.map(({ id: _id, ...r }) => r),
        confidence: est.confidence,
      }
    }
    if (type === "workout")
      payload = {
        kind: "workout",
        name: fit.exercises.find((e) => e.id === exercise)?.name ?? "Exercise",
        exercises: [
          {
            exercise,
            sets: Array.from(
              { length: Math.min(100, Math.max(1, Number(sets) || 1)) },
              () => ({
                reps: Math.max(1, Number(reps) || 1),
                weight: Math.max(0, Number(kg) || 0),
              }),
            ),
          },
        ],
      }
    if (!validPayload(payload)) return
    logQuickAdd(text || `${type} entry`, payload, target)
    if (another) {
      set(initial())
      setText("")
    } else onDone()
  }
  if (type === "habit") {
    const index = logIndex(hab.logs),
      rows = hab.habits.filter(
        (h) => h.status === "active" && isDue(h, dayKey()),
      )
    return (
      <View style={{ gap: 8 }}>
        {rows.map((h) => {
          const done = index.get(lk(h.id, dayKey()))?.status === "done"
          return (
            <Tap
              key={h.id}
              onPress={() => {
                if (!done)
                  logQuickAdd(
                    `${h.icon} ${h.name}`,
                    {
                      kind: "habitLog",
                      habitId: h.id,
                      value: h.type === "check" ? undefined : h.target,
                    },
                    "habits",
                  )
              }}
              style={{
                minHeight: 56,
                justifyContent: "center",
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderWidth: 1,
                borderColor: t.line,
                borderRadius: 12,
                opacity: done ? 0.6 : 1,
              }}
            >
              <Line>
                <Copy size={20}>{h.icon}</Copy>
                <Copy weight="medium" style={{ flex: 1 }}>
                  {h.name}
                </Copy>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    borderWidth: 2,
                    borderColor: done ? "transparent" : `${t.hab}66`,
                    backgroundColor: done ? t.hab : "transparent",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {done && <Check size={16} color={t.bg} />}
                </View>
              </Line>
            </Tap>
          )
        })}
        {!rows.length && <Copy muted>Nothing due today.</Copy>}
      </View>
    )
  }
  return (
    <View style={{ gap: 14 }}>
      {type === "task" ? (
        <>
          <Field
            label="Task"
            value={text}
            onChangeText={setText}
            placeholder="e.g. call dentist fri 10am"
          />
          {!!text && (
            <Copy size={12} muted>
              {parseTask(text).matched.join(" · ")}
            </Copy>
          )}
        </>
      ) : type === "meal" ? (
        <>
          <Field
            label="What did you eat?"
            value={text}
            onChangeText={setText}
            placeholder="e.g. tapsilog, coffee"
          />
          <Choices
            value={text}
            onChange={setText}
            options={[
              "2 eggs, pandesal",
              "adobo with 1 cup rice",
              "whey shake",
              "banana",
            ].map((value) => ({ value, label: value }))}
          />
          {est ? (
            <View
              style={{ borderRadius: 12, padding: 12, backgroundColor: t.soft }}
            >
              <Copy weight="semibold">
                {est.items.reduce((n, i) => n + i.kcal, 0)} kcal
              </Copy>
              {est.items.map((i) => (
                <Line key={i.id} style={{ justifyContent: "space-between" }}>
                  <Copy size={12} muted>
                    {i.name}
                  </Copy>
                  <Copy size={12} muted>
                    {i.kcal} · P{i.protein}
                  </Copy>
                </Line>
              ))}
            </View>
          ) : (
            !!text && (
              <Copy size={12} muted>
                No match in the food library yet — try a dish name.
              </Copy>
            )
          )}
        </>
      ) : type === "workout" ? (
        <>
          <Choices
            label="Exercise"
            value={exercise}
            onChange={setExercise}
            options={fit.exercises
              .filter((e) => !e.archived)
              .map((e) => ({ value: e.id, label: e.name }))}
          />
          <Line>
            {[
              { label: "Sets", value: sets, set: setSets },
              { label: "Reps", value: reps, set: setReps },
              { label: "kg", value: kg, set: setKg },
            ].map((x) => (
              <View key={x.label} style={{ flex: 1 }}>
                <Field
                  label={x.label}
                  keyboardType="decimal-pad"
                  value={x.value}
                  onChangeText={x.set}
                />
              </View>
            ))}
          </Line>
        </>
      ) : (
        <PayloadForm p={p} set={set} />
      )}
      <Line>
        {type === "expense" && (
          <Button tone="quiet" onPress={() => save(true)}>
            Save & add another
          </Button>
        )}
        <View style={{ flex: 1 }}>
          <Button
            disabled={
              type === "meal"
                ? !est
                : type === "task"
                  ? !text.trim()
                  : !validPayload(p)
            }
            onPress={() => save()}
          >
            Save
          </Button>
        </View>
      </Line>
    </View>
  )
}
