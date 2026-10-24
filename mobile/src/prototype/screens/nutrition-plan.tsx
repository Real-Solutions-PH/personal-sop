// The body-stats form behind personalized plans: collects the profile and
// goal, saves them, and hands back the estimated daily targets.
import {
  logWeighIn,
  updateSettings,
  updateWeighIn,
} from "@domain/fitness/actions"
import {
  latestBodyFat,
  latestBodyweight,
  latestWeighIn,
} from "@domain/fitness/calc"
import {
  ACTIVITY,
  type ActivityLevel,
  ageFrom,
  estimatePlan,
  GOALS,
  type NoteField,
  type Plan,
  type PlanGoal,
  type PlanInputs,
  type PlanNote,
  planGoalFor,
  type Sex,
} from "@domain/fitness/plan"
import { fitStore } from "@domain/fitness/store"
import { useState } from "react"
import { TextInput, View } from "react-native"
import { Copy, Line, Tap } from "../native-kit"
import { fonts, useTheme } from "../theme"
import { Button } from "../ui"
import { displayMass, kilograms } from "../units"

const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s))

/** Muted warning copy for one field's notes; nothing when there are none. */
export function PlanNotes({
  notes,
  field,
}: {
  notes: PlanNote[]
  field: NoteField
}) {
  const t = useTheme(),
    mine = notes.filter((n) => n.field === field)
  if (!mine.length) return null
  return (
    <View style={{ marginTop: 4 }}>
      {mine.map((n) => (
        <Copy key={n.text} size={12} style={{ color: t.warn }}>
          {n.text}
        </Copy>
      ))}
    </View>
  )
}

export function PlanForm({
  onApply,
  applyLabel = "Apply",
  askWeight = true,
}: {
  onApply: (plan: Plan, inputs: PlanInputs) => void
  applyLabel?: string
  askWeight?: boolean
}) {
  const t = useTheme(),
    fit = fitStore.use((s) => s),
    st = fit.settings,
    lb = st.units === "lb",
    latest = latestWeighIn(fit),
    bw = latestBodyweight(fit),
    inches = st.heightCm ? Math.round(st.heightCm / 2.54) : undefined,
    [sex, setSex] = useState<Sex | undefined>(st.sex),
    [year, setYear] = useState(st.birthYear ? String(st.birthYear) : ""),
    [cm, setCm] = useState(st.heightCm ? String(st.heightCm) : ""),
    [ft, setFt] = useState(inches ? String(Math.floor(inches / 12)) : ""),
    [inch, setInch] = useState(inches ? String(inches % 12) : ""),
    [weight, setWeight] = useState(bw ? String(displayMass(bw, st.units)) : ""),
    [activity, setActivity] = useState<ActivityLevel | undefined>(st.activity),
    [goal, setGoal] = useState<PlanGoal>(planGoalFor(st)),
    [bf, setBf] = useState(() => {
      const v = latestBodyFat(fit)
      return v !== undefined ? String(v) : ""
    })

  const heightCm = lb ? (num(ft) * 12 + num(inch || "0")) * 2.54 : num(cm),
    weightKg = kilograms(num(weight), st.units),
    age = ageFrom(num(year)),
    bodyFat = bf.trim() === "" ? undefined : num(bf),
    valid =
      !!sex &&
      !!activity &&
      Number.isInteger(num(year)) &&
      age >= 13 &&
      age <= 100 &&
      heightCm >= 100 &&
      heightCm <= 250 &&
      weightKg > 20 &&
      weightKg < 500 &&
      (bodyFat === undefined || (bodyFat >= 3 && bodyFat <= 70))

  const submit = () => {
    if (!valid || !sex || !activity) return
    const h = Math.round(heightCm * 10) / 10
    updateSettings({
      sex,
      birthYear: num(year),
      heightCm: h,
      activity,
      planGoal: goal,
      goalDirection: GOALS[goal].direction,
    })
    // A pre-filled weight shown in lb and converted back mustn't count as new.
    if (!latest || Math.abs(weightKg - latest.weightKg) > 0.05)
      logWeighIn(weightKg, undefined, undefined, bodyFat)
    else if (bodyFat !== undefined)
      updateWeighIn(latest.id, { bodyFatPct: bodyFat })
    const inputs: PlanInputs = {
      sex,
      age,
      heightCm: h,
      weightKg,
      bodyFatPct: bodyFat,
      activity,
      goal,
    }
    onApply(estimatePlan(inputs), inputs)
  }

  const label = (text: string) => (
    <Copy size={14} weight="medium" style={{ marginTop: 16, marginBottom: 4 }}>
      {text}
    </Copy>
  )
  const input = (
    name: string,
    value: string,
    set: (v: string) => void,
    placeholder: string,
    unit?: string,
    integer?: boolean,
  ) => (
    <Line style={{ gap: 8, flex: 1 }}>
      <TextInput
        accessibilityLabel={name}
        placeholder={placeholder}
        placeholderTextColor={t.muted}
        value={value}
        onChangeText={(v) => set(v.replace(integer ? /\D/g : /[^\d.]/g, ""))}
        keyboardType={integer ? "number-pad" : "decimal-pad"}
        style={{
          height: 44,
          flex: 1,
          paddingHorizontal: 12,
          borderWidth: 1,
          borderColor: t.line,
          borderRadius: 12,
          backgroundColor: t.card,
          color: t.text,
          fontFamily: fonts.body,
          fontSize: 16,
        }}
      />
      {unit && <Copy muted>{unit}</Copy>}
    </Line>
  )
  const chip = (text: string, on: boolean, press: () => void) => (
    <Tap
      key={text}
      role="radio"
      selected={on}
      onPress={press}
      style={{
        height: 36,
        paddingHorizontal: 14,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: on ? t.fit : t.line,
        backgroundColor: on ? t.fit : t.card,
        justifyContent: "center",
      }}
    >
      <Copy size={14} weight="medium" style={{ color: on ? t.bg : t.text }}>
        {text}
      </Copy>
    </Tap>
  )
  const wrap = { flexDirection: "row", flexWrap: "wrap", gap: 8 } as const

  return (
    <View>
      {label("Sex")}
      <View style={wrap}>
        {chip("Male", sex === "male", () => setSex("male"))}
        {chip("Female", sex === "female", () => setSex("female"))}
      </View>
      {label("Birth year")}
      {input("Birth year", year, setYear, "e.g. 1995", undefined, true)}
      {label("Height")}
      {lb ? (
        <Line style={{ gap: 8 }}>
          {input("Height (ft)", ft, setFt, "5", "ft")}
          {input("Height (in)", inch, setInch, "9", "in")}
        </Line>
      ) : (
        input("Height (cm)", cm, setCm, "e.g. 175", "cm")
      )}
      {askWeight && label("Weight")}
      {askWeight &&
        input(
          `Weight (${st.units})`,
          weight,
          setWeight,
          lb ? "e.g. 160" : "e.g. 72.5",
          st.units,
        )}
      {label("Activity")}
      <View style={wrap}>
        {(Object.keys(ACTIVITY) as ActivityLevel[]).map((k) =>
          chip(ACTIVITY[k].label, activity === k, () => setActivity(k)),
        )}
      </View>
      {label("Goal")}
      <View style={wrap}>
        {(Object.keys(GOALS) as PlanGoal[]).map((k) =>
          chip(GOALS[k].label, goal === k, () => setGoal(k)),
        )}
      </View>
      {GOALS[goal].help && (
        <Copy size={12} muted style={{ marginTop: 8 }}>
          {GOALS[goal].help}
        </Copy>
      )}
      {label("Body fat % (optional)")}
      {input("Body fat % (optional)", bf, setBf, "e.g. 20", "%")}
      <View style={{ marginTop: "auto", paddingTop: 24 }}>
        <Button disabled={!valid} onPress={submit}>
          {applyLabel}
        </Button>
      </View>
    </View>
  )
}
