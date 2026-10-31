import * as A from "@domain/fitness/actions"
import * as C from "@domain/fitness/calc"
import {
  FOODS,
  type Macros,
  type MealItem,
  type MealLabel,
} from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { openCapture } from "@domain/lib/capture"
import { dayKey } from "@domain/lib/day"
import { uid } from "@domain/lib/store"
import { useLocalSearchParams } from "expo-router"
import {
  BookOpen,
  Camera,
  CloudOff,
  Copy as CopyIcon,
  Mic,
  Minus,
  Plus,
  ScanBarcode,
  Sparkles,
  Trash2,
  X,
} from "lucide-react-native"
import { useState } from "react"
import { TextInput, type TextInputProps, View } from "react-native"
import { toast } from "sonner-native"
import {
  Bar,
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  Tap,
} from "../native-kit"
import { go, replace } from "../navigation"
import { fonts, useTheme } from "../theme"
import { TimeInput } from "../time-input"
import { Button, Empty, Screen, undo } from "../ui"
import { isDay } from "../validation"
import { MealThumb } from "./nutrition"
import { LibraryPickSheet } from "./nutrition-food-pick"

const keys = ["kcal", "protein", "carbs", "fat"] as const
/** An item picked from the food library says so instead of "AI assumed". */
const LIBRARY_NOTE = "From your food library: "
const labels: MealLabel[] = ["breakfast", "lunch", "snack", "dinner"]
export function Input(props: TextInputProps) {
  const t = useTheme()
  return (
    <TextInput
      placeholderTextColor={t.muted}
      {...props}
      style={[
        {
          height: 36,
          borderWidth: 1,
          borderColor: t.input,
          backgroundColor: t.dark ? border(t.input, 0.3) : "transparent",
          borderRadius: 8,
          paddingHorizontal: 12,
          fontFamily: fonts.body,
          fontSize: 14,
          color: t.text,
        },
        props.style,
      ]}
    />
  )
}
function MacroLine({ m }: { m: Macros }) {
  return (
    <Copy size={12} muted style={{ lineHeight: 24 }}>
      {Math.round(m.kcal)} kcal · P{Math.round(m.protein)} · C
      {Math.round(m.carbs)} · F{Math.round(m.fat)}
    </Copy>
  )
}
function MacroFields({
  value,
  onChange,
}: {
  value: Macros
  onChange: (patch: Partial<Macros>) => void
}) {
  return (
    <Line style={{ gap: 8 }}>
      {keys.map((k) => (
        <View key={k} style={{ flex: 1 }}>
          <Copy size={10} muted>
            {k === "kcal" ? "KCAL" : `${k[0].toUpperCase()} (g)`}
          </Copy>
          <Input
            accessibilityLabel={k}
            value={String(value[k] || "")}
            onChangeText={(v) => {
              const n = Number(v)
              if (Number.isFinite(n) && n >= 0) onChange({ [k]: n })
            }}
            keyboardType="decimal-pad"
            style={{ marginTop: 2 }}
          />
        </View>
      ))}
    </Line>
  )
}
function FoodPicker({ onPick }: { onPick: (key: string) => void }) {
  const t = useTheme(),
    [q, setQ] = useState("")
  return (
    <View>
      <Input
        accessibilityLabel="Add food"
        placeholder="Add food (adobo, rice, egg…)"
        value={q}
        onChangeText={setQ}
      />
      <Line style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {FOODS.filter(
          (f) =>
            !q ||
            f.name.toLowerCase().includes(q.toLowerCase()) ||
            f.aliases.some((a) => a.includes(q.toLowerCase())),
        )
          .slice(0, 8)
          .map((f) => (
            <Tap
              key={f.key}
              onPress={() => {
                onPick(f.key)
                setQ("")
              }}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 99,
                borderWidth: 1,
                borderColor: t.line,
              }}
            >
              <Line style={{ gap: 4 }}>
                <Plus size={12} color={t.text} />
                <Copy size={12}>{f.name.replace(/\s*\(.*\)/, "")}</Copy>
              </Line>
            </Tap>
          ))}
      </Line>
    </View>
  )
}
function When({
  label,
  time,
  onLabel,
  onTime,
}: {
  label: MealLabel
  time: string
  onLabel: (l: MealLabel) => void
  onTime: (time: string) => void
}) {
  const t = useTheme()
  return (
    <Line style={{ gap: 8, flexWrap: "wrap" }}>
      {labels.map((l) => (
        <Tap
          key={l}
          onPress={() => onLabel(l)}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 99,
            borderWidth: 1,
            borderColor: l === label ? t.nut : t.line,
            backgroundColor: l === label ? t.nut : t.card,
          }}
        >
          <Copy
            size={14}
            weight="medium"
            style={{
              textTransform: "capitalize",
              color: l === label ? t.bg : t.text,
            }}
          >
            {l}
          </Copy>
        </Tap>
      ))}
      <TimeInput label="Time eaten" value={time} onChange={onTime} />
    </Line>
  )
}
function ItemRow({
  item,
  readOnly,
  onQty,
  onMacros,
  onRemove,
}: {
  item: MealItem
  readOnly?: boolean
  onQty: (n: number) => void
  onMacros: (p: Partial<Macros>) => void
  onRemove: () => void
}) {
  const t = useTheme(),
    [edit, setEdit] = useState(false),
    step = item.unit === "g" ? 25 : 0.5
  return (
    <View style={{ paddingVertical: 12 }}>
      <Line style={{ alignItems: "flex-start", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Copy size={14} weight="medium">
            {item.name}
          </Copy>
          <MacroLine m={item} />
          {item.assumption && (
            <Copy size={11} muted style={{ fontStyle: "italic" }}>
              {item.assumption.startsWith(LIBRARY_NOTE)
                ? item.assumption
                : `AI assumed: ${item.assumption}`}
            </Copy>
          )}
        </View>
        {!readOnly && (
          <IconTap size={20} icon={X} label="Remove item" onPress={onRemove} />
        )}
      </Line>
      {!readOnly && (
        <Line style={{ marginTop: 8, gap: 8 }}>
          <IconTap
            size={32}
            icon={Minus}
            label="Less"
            background={t.soft}
            onPress={() => onQty(Math.max(step, item.qty - step))}
          />
          <Copy size={14} style={{ minWidth: 80, textAlign: "center" }}>
            {item.qty} {item.unit}
          </Copy>
          <IconTap
            size={32}
            icon={Plus}
            label="More"
            background={t.soft}
            onPress={() => onQty(item.qty + step)}
          />
          <Tap onPress={() => setEdit(!edit)} style={{ marginLeft: "auto" }}>
            <Copy size={12} style={{ color: t.nut }}>
              {edit ? "Done" : "Edit macros"}
            </Copy>
          </Tap>
        </Line>
      )}
      {edit && !readOnly && (
        <View style={{ marginTop: 8 }}>
          <MacroFields value={item} onChange={onMacros} />
        </View>
      )}
    </View>
  )
}
export function MealDetail({ id }: { id: string }) {
  const s = fitStore.use((s) => s),
    t = useTheme(),
    p = useLocalSearchParams<{ state?: string }>(),
    meal = s.meals.find((m) => m.id === id),
    [editing, setEditing] = useState(false),
    [hint, setHint] = useState(""),
    [hintErr, setHintErr] = useState(false)
  if (!meal)
    return (
      <Screen title="Meal">
        <Empty title="Meal not found" detail="It may have been deleted." />
      </Screen>
    )
  const totals = C.mealTotals(meal),
    review = meal.status === "estimated",
    editable = review || editing,
    failed = p.state === "error",
    conf = meal.confidence ?? 0,
    back = `/nutrition?day=${dayKey(new Date(meal.eatenAt))}`
  const del = () => {
      const m = A.deleteMeal(id)
      replace(back)
      if (m)
        undo(review ? "Estimate discarded" : "Meal deleted", () =>
          A.restoreMeal(m),
        )
    },
    rehint = () => {
      if (!hint.trim()) return
      const ok = A.reestimateMeal(id, hint)
      setHintErr(!ok)
      if (ok) {
        setHint("")
        if (failed) replace(`/nutrition/meals/${id}`)
      }
    }
  const heading = (name: string) => (
    <View style={{ marginTop: -12, marginBottom: -12 }}>
      <SectionHeading>{name}</SectionHeading>
    </View>
  )
  return (
    <Screen
      title={
        review
          ? "Review estimate"
          : meal.status === "pending_estimate"
            ? "Queued photo"
            : meal.label[0].toUpperCase() + meal.label.slice(1)
      }
      actions={
        meal.status === "confirmed" ? (
          <Tap
            onPress={() => setEditing(!editing)}
            style={{
              paddingHorizontal: 12,
              height: 36,
              justifyContent: "center",
            }}
          >
            <Copy size={14} weight="medium" style={{ color: t.nut }}>
              {editing ? "Done" : "Edit"}
            </Copy>
          </Tap>
        ) : undefined
      }
    >
      <Line>
        <MealThumb meal={meal} size={meal.photo ? 72 : 48} />
        <View style={{ flex: 1 }}>
          <Copy size={14} muted lines={1}>
            “{meal.rawInput}”
          </Copy>
          <Copy size={12} muted style={{ textTransform: "capitalize" }}>
            {meal.source === "connector"
              ? "via Claude connector"
              : `via ${meal.source}`}{" "}
            · {C.fmtTime(meal.eatenAt)}
          </Copy>
        </View>
      </Line>
      {failed ? (
        <Frame
          style={{
            padding: 16,
            gap: 8,
            borderColor: `${t.bad}66`,
            backgroundColor: `${t.bad}1a`,
          }}
        >
          <Copy weight="medium">Couldn’t estimate this one</Copy>
          <Copy size={14} muted>
            Describe it in words, or enter macros manually. Nothing is saved
            until you confirm.
          </Copy>
          <Input
            value={hint}
            onChangeText={setHint}
            placeholder="e.g. 1 cup rice, sinigang na baboy"
          />
          <Button onPress={rehint}>Estimate</Button>
          {hintErr && (
            <Copy size={12} style={{ color: t.bad }}>
              Still couldn’t match that — try naming the dishes.
            </Copy>
          )}
          <Button tone="quiet" href="/nutrition/new">
            Enter macros manually
          </Button>
        </Frame>
      ) : meal.status === "pending_estimate" ? (
        <Frame
          style={{ padding: 16, gap: 8, alignItems: "center", marginTop: 4 }}
        >
          <CloudOff size={32} color={t.warn} />
          <Copy weight="medium">Estimating when online</Copy>
          <Copy size={14} muted style={{ textAlign: "center" }}>
            Your photo is saved on this device. It won’t count toward today’s
            macros until it’s estimated and confirmed.
          </Copy>
          <Button icon={Sparkles} onPress={() => A.runPendingEstimate(id)}>
            Estimate now
          </Button>
        </Frame>
      ) : (
        <>
          {review && (
            <Frame style={{ padding: 16, marginTop: 4 }}>
              <Line style={{ justifyContent: "space-between", gap: 6 }}>
                <Line style={{ gap: 6 }}>
                  <Sparkles size={16} color={t.nut} />
                  <Copy size={14} weight="medium">
                    AI estimate
                  </Copy>
                </Line>
                <Copy
                  size={11}
                  style={{
                    color: conf >= 0.8 ? t.good : conf >= 0.65 ? t.warn : t.bad,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 99,
                    backgroundColor:
                      conf >= 0.8
                        ? `${t.good}1a`
                        : conf >= 0.65
                          ? `${t.warn}1a`
                          : `${t.bad}1a`,
                  }}
                >
                  {conf >= 0.8 ? "High" : conf >= 0.65 ? "Medium" : "Low"}{" "}
                  confidence · {Math.round(conf * 100)}%
                </Copy>
              </Line>
              <View style={{ marginTop: 8 }}>
                <Bar value={conf} color={t.nut} />
              </View>
              {meal.followUp && (
                <View
                  style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 12,
                    backgroundColor: border(t.soft, 0.6),
                  }}
                >
                  <Copy size={14}>{meal.followUp.question}</Copy>
                  <Line style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
                    {meal.followUp.options.map((o) => (
                      <Button
                        key={o}
                        small
                        tone="quiet"
                        onPress={() => A.answerFollowUp(id, o)}
                      >
                        {o}
                      </Button>
                    ))}
                  </Line>
                </View>
              )}
            </Frame>
          )}
          <Frame style={{ padding: 16 }}>
            <Line style={{ gap: 8 }}>
              {keys.map((k, i) => (
                <View key={k} style={{ flex: 1, alignItems: "center" }}>
                  <Copy
                    size={30}
                    weight="displayMedium"
                    style={{ color: i === 0 ? t.nut : t.text }}
                  >
                    {Math.round(totals[k])}
                    {k === "kcal" ? "" : "g"}
                  </Copy>
                  <Copy size={12} muted>
                    {k === "kcal" ? "kcal" : k[0].toUpperCase() + k.slice(1)}
                  </Copy>
                </View>
              ))}
            </Line>
          </Frame>
          {heading("Items")}
          <Frame style={{ paddingHorizontal: 16 }}>
            {meal.items.map((item, i) => (
              <View
                key={item.id}
                style={{
                  borderTopWidth: i ? 1 : 0,
                  borderColor: border(t.line, 0.6),
                }}
              >
                <ItemRow
                  item={item}
                  readOnly={!editable}
                  onQty={(qty) => A.setMealItemQty(id, item.id, qty)}
                  onMacros={(m) => A.setMealItemMacros(id, item.id, m)}
                  onRemove={() => A.removeMealItem(id, item.id)}
                />
              </View>
            ))}
            {!meal.items.length && (
              <Copy
                size={14}
                muted
                style={{ paddingVertical: 16, textAlign: "center" }}
              >
                No items — add one below.
              </Copy>
            )}
          </Frame>
          {editable && (
            <>
              <FoodPicker onPick={(key) => A.addMealItem(id, key)} />
              {heading("When")}
              <When
                label={meal.label}
                time={new Date(meal.eatenAt).toTimeString().slice(0, 5)}
                onLabel={(label) => A.updateMeal(id, { label })}
                onTime={(time) => {
                  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
                    const d = new Date(meal.eatenAt),
                      [h, m] = time.split(":").map(Number)
                    d.setHours(h, m)
                    A.updateMeal(id, { eatenAt: d.toISOString() })
                  }
                }}
              />
            </>
          )}
          {review && (
            <>
              {heading("Not quite right?")}
              <Line style={{ gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Input
                    accessibilityLabel="Re-estimate hint"
                    value={hint}
                    onChangeText={setHint}
                    placeholder="Add a hint: “2 cups rice, fried egg”"
                  />
                </View>
                <Button tone="quiet" onPress={rehint}>
                  Re-estimate
                </Button>
              </Line>
              {hintErr && (
                <Copy size={12} style={{ color: t.bad }}>
                  Couldn’t match that — try naming the dishes.
                </Copy>
              )}
            </>
          )}
          {meal.status === "confirmed" && !editing && (
            <Line style={{ marginTop: 8, gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button
                  icon={CopyIcon}
                  tone="quiet"
                  onPress={() => {
                    const c = A.duplicateMeal(id)
                    if (c) undo("Added to today", () => A.deleteMeal(c.id))
                  }}
                >
                  Duplicate to today
                </Button>
              </View>
              <View style={{ flex: 1 }}>
                <Button icon={Trash2} tone="danger" onPress={del}>
                  Delete
                </Button>
              </View>
            </Line>
          )}
        </>
      )}
      {(review || meal.status === "pending_estimate" || failed) && (
        <Line style={{ marginTop: 12, paddingVertical: 12, gap: 8 }}>
          <Tap
            onPress={del}
            style={{ paddingHorizontal: 16, paddingVertical: 12 }}
          >
            <Copy size={14} style={{ color: t.bad }}>
              Discard
            </Copy>
          </Tap>
          {review && !failed && (
            <View style={{ flex: 1 }}>
              <Button
                disabled={!meal.items.length}
                onPress={() => {
                  A.confirmMeal(id)
                  toast.success("Meal confirmed")
                  replace(back)
                }}
              >{`Confirm · ${Math.round(totals.kcal)} kcal`}</Button>
            </View>
          )}
        </Line>
      )}
    </Screen>
  )
}
export function ManualMeal() {
  const p = useLocalSearchParams<{ day?: string }>(),
    day = p.day ?? dayKey(),
    t = useTheme(),
    [label, setLabel] = useState<MealLabel>(C.labelForTime(new Date())),
    [time, setTime] = useState(new Date().toTimeString().slice(0, 5)),
    [text, setText] = useState(""),
    [err, setErr] = useState(false),
    [items, setItems] = useState<MealItem[]>([]),
    [custom, setCustom] = useState({ name: "", ...C.zero() }),
    [recipeName, setRecipeName] = useState(""),
    [library, setLibrary] = useState(false),
    recipes = fitStore.use((s) => s.recipes),
    totals = C.sumMacros(items)
  const stamp = () => {
    if (!isDay(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      toast.error("Enter a valid meal date and time")
      return null
    }
    return new Date(`${day}T${time}:00`).toISOString()
  }
  const scale = (it: MealItem, qty: number) => {
    const f = it.qty ? qty / it.qty : 1,
      // The optional detail (a library food's fiber, sodium…) follows too.
      more = (v: number | undefined) =>
        v === undefined ? undefined : Math.round(v * f * 10) / 10
    return {
      ...it,
      qty,
      kcal: Math.round(it.kcal * f),
      protein: Math.round(it.protein * f),
      carbs: Math.round(it.carbs * f),
      fat: Math.round(it.fat * f),
      ...(it.fiber !== undefined ? { fiber: more(it.fiber) } : {}),
      ...(it.satFat !== undefined ? { satFat: more(it.satFat) } : {}),
      ...(it.sugar !== undefined ? { sugar: more(it.sugar) } : {}),
      ...(it.sodium !== undefined ? { sodium: more(it.sodium) } : {}),
    }
  }
  return (
    <Screen
      title="Log meal"
      footer={
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: t.bg,
          }}
        >
          <Button
            disabled={!items.length}
            onPress={() => {
              const eatenAt = stamp()
              if (!eatenAt) return
              const meal = A.logMeal({
                items: items.map(({ id: _id, ...rest }) => rest),
                eatenAt,
                label,
              })
              undo(
                `Logged ${meal.label} · ${Math.round(totals.kcal)} kcal`,
                () => A.deleteMeal(meal.id),
              )
              replace(`/nutrition?day=${day}`)
            }}
          >{`Save meal${items.length ? ` · ${Math.round(totals.kcal)} kcal` : ""}`}</Button>
        </View>
      }
    >
      <Frame style={{ padding: 8 }}>
        <Line style={{ gap: 8 }}>
          {(
            [
              { label: "Scan", icon: ScanBarcode, mode: "scan" },
              { label: "Photo", icon: Camera, mode: "photo" },
              { label: "Voice", icon: Mic, mode: "voice" },
            ] as const
          ).map((b) => (
            <Tap
              key={b.label}
              label={b.label}
              onPress={() =>
                b.mode === "scan"
                  ? go(`/nutrition/scan?day=${day}`)
                  : openCapture({ mode: b.mode, hint: "meal" })
              }
              style={{
                flex: 1,
                alignItems: "center",
                paddingVertical: 8,
                gap: 4,
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 16,
                  backgroundColor: `${t.nut}26`,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <b.icon size={20} color={t.nut} />
              </View>
              <Copy size={12}>{b.label}</Copy>
            </Tap>
          ))}
        </Line>
      </Frame>
      <Frame style={{ padding: 16, gap: 8 }}>
        <Line style={{ gap: 8 }}>
          <Sparkles size={16} color={t.nut} />
          <Copy size={14} weight="medium">
            Describe it
          </Copy>
        </Line>
        <TextInput
          accessibilityLabel="Describe your meal"
          value={text}
          onChangeText={(v) => {
            setText(v)
            setErr(false)
          }}
          multiline
          placeholder="lunch: 1 cup rice, adobo 2 pcs, softdrinks 1 can"
          placeholderTextColor={t.muted}
          style={{
            minHeight: 80,
            padding: 12,
            borderRadius: 12,
            backgroundColor: border(t.soft, 0.6),
            color: t.text,
            fontFamily: fonts.body,
            fontSize: 14,
            textAlignVertical: "top",
          }}
        />
        {err && (
          <Copy size={12} style={{ color: t.bad }}>
            Couldn’t estimate — name the dishes, or add items manually below.
          </Copy>
        )}
        <Button
          disabled={!text.trim()}
          onPress={() => {
            const eatenAt = stamp()
            if (!eatenAt) return
            const m = A.estimateMeal(text, { source: "text", eatenAt, label })
            if (!m) {
              setErr(true)
              return
            }
            replace(`/nutrition/meals/${m.id}`)
          }}
        >
          Estimate macros
        </Button>
      </Frame>
      <View style={{ marginTop: -12, marginBottom: -12 }}>
        <SectionHeading>Or build it yourself</SectionHeading>
      </View>
      <When label={label} time={time} onLabel={setLabel} onTime={setTime} />
      <FoodPicker
        onPick={(key) => {
          const f = FOODS.find((x) => x.key === key)
          if (f)
            setItems([
              ...items,
              {
                id: uid(),
                name: f.name,
                qty: f.qty,
                unit: f.unit,
                kcal: f.kcal,
                protein: f.protein,
                carbs: f.carbs,
                fat: f.fat,
              },
            ])
        }}
      />
      <Button icon={BookOpen} tone="quiet" onPress={() => setLibrary(true)}>
        Pick from library
      </Button>
      {library && (
        <LibraryPickSheet
          onClose={() => setLibrary(false)}
          onAdd={(item, food) => {
            setItems((now) => [...now, item])
            setLibrary(false)
            toast.success(`Added ${food.name} · ${Math.round(item.kcal)} kcal`)
          }}
        />
      )}
      {!!recipes.length && (
        <Frame style={{ padding: 16, gap: 8 }}>
          <Copy size={14} weight="medium">
            My recipes
          </Copy>
          <Line style={{ gap: 6, flexWrap: "wrap" }}>
            {recipes.map((r) => (
              <Line
                key={r.id}
                style={{
                  gap: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 99,
                  borderWidth: 1,
                  borderColor: t.line,
                }}
              >
                <Tap
                  label={`Add ${r.name}`}
                  onPress={() =>
                    setItems([
                      ...items,
                      {
                        id: uid(),
                        name: r.name,
                        qty: 1,
                        unit: "serving",
                        assumption: r.items
                          .map((i) => `${i.name} ${i.qty} ${i.unit}`)
                          .join(", "),
                        ...C.sumMacros(r.items),
                      },
                    ])
                  }
                >
                  <Line style={{ gap: 4 }}>
                    <Plus size={12} color={t.text} />
                    <Copy size={12}>{r.name}</Copy>
                  </Line>
                </Tap>
                <Tap
                  label={`Delete recipe ${r.name}`}
                  onPress={() => {
                    A.deleteRecipe(r.id)
                    undo(`Deleted ${r.name}`, () =>
                      fitStore.set((s) => ({
                        ...s,
                        recipes: [...s.recipes, r],
                      })),
                    )
                  }}
                >
                  <X size={12} color={t.muted} />
                </Tap>
              </Line>
            ))}
          </Line>
        </Frame>
      )}
      <Frame style={{ padding: 16, gap: 8 }}>
        <Copy size={14} weight="medium">
          Custom item
        </Copy>
        <Input
          accessibilityLabel="Custom item name"
          value={custom.name}
          onChangeText={(name) => setCustom({ ...custom, name })}
          placeholder="Name (e.g. Jollibee Chickenjoy)"
        />
        <MacroFields
          value={custom}
          onChange={(m) => setCustom({ ...custom, ...m })}
        />
        {!!custom.kcal &&
          !!(custom.protein + custom.carbs + custom.fat) &&
          Math.abs(
            custom.protein * 4 +
              custom.carbs * 4 +
              custom.fat * 9 -
              custom.kcal,
          ) >
            custom.kcal * 0.15 && (
            <Copy size={12} style={{ color: t.warn }}>
              P×4 + C×4 + F×9 ={" "}
              {custom.protein * 4 + custom.carbs * 4 + custom.fat * 9} kcal —
              doesn’t match {custom.kcal}.
            </Copy>
          )}
        <Button
          icon={Plus}
          tone="quiet"
          disabled={!custom.name.trim() || !custom.kcal}
          onPress={() => {
            setItems([
              ...items,
              { id: uid(), qty: 1, unit: "serving", ...custom },
            ])
            setCustom({ name: "", ...C.zero() })
          }}
        >
          Add custom item
        </Button>
      </Frame>
      {!!items.length && (
        <View style={{ marginTop: -12 }}>
          <SectionHeading action={<MacroLine m={totals} />}>
            This meal
          </SectionHeading>
          <Frame style={{ paddingHorizontal: 16 }}>
            {items.map((item, i) => (
              <View
                key={item.id}
                style={{
                  borderTopWidth: i ? 1 : 0,
                  borderColor: border(t.line, 0.6),
                }}
              >
                <ItemRow
                  item={item}
                  onQty={(qty) =>
                    setItems(
                      items.map((x) => (x.id === item.id ? scale(x, qty) : x)),
                    )
                  }
                  onMacros={(m) =>
                    setItems(
                      items.map((x) => (x.id === item.id ? { ...x, ...m } : x)),
                    )
                  }
                  onRemove={() =>
                    setItems(items.filter((x) => x.id !== item.id))
                  }
                />
              </View>
            ))}
          </Frame>
          <Frame style={{ padding: 16, gap: 8, marginTop: 12 }}>
            <Copy size={14} weight="medium">
              Save as recipe
            </Copy>
            <Copy size={12} muted>
              Keep these items as one food to log again in a tap.
            </Copy>
            <Input
              accessibilityLabel="Recipe name"
              value={recipeName}
              onChangeText={setRecipeName}
              placeholder="Name (e.g. Iced coffee)"
            />
            <Button
              icon={Plus}
              tone="quiet"
              disabled={!recipeName.trim()}
              onPress={() => {
                const r = A.saveRecipe(
                  recipeName,
                  items.map(({ id: _id, ...rest }) => rest),
                )
                setRecipeName("")
                toast.success(`Saved ${r.name}`)
              }}
            >
              Save recipe
            </Button>
          </Frame>
        </View>
      )}
    </Screen>
  )
}
