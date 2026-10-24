// The body-stats form behind personalized plans: collects the profile and
// goal, saves them, and hands back the estimated daily targets.
import {
  logWeighIn,
  updateSettings,
  updateWeighIn,
} from "@domain/fitness/actions"
import { latestBodyweight, latestWeighIn } from "@domain/fitness/calc"
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
import { type ReactNode, useState } from "react"
import { TextInput, View } from "react-native"
import { Copy, Line, Tap } from "../native-kit"
import { fonts, useTheme } from "../theme"
import { Button } from "../ui"
import { displayMass, kilograms } from "../units"

const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s))

/** cm as ft + in fields; rounding total inches first so 11.8 in carries. */
function feetInches(cm: number | undefined) {
  if (cm === undefined || Number.isNaN(cm)) return { ft: "", inch: "" }
  const inches = Math.round(cm / 2.54)
  return { ft: String(Math.floor(inches / 12)), inch: String(inches % 12) }
}

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
    latest = latestWeighIn(fit),
    bw = latestBodyweight(fit),
    feet = feetInches(st.heightCm),
    // Units start from the app setting; each field can be switched here.
    [heightUnit, setHeightUnit] = useState<"cm" | "ft">(
      st.units === "lb" ? "ft" : "cm",
    ),
    [massUnit, setMassUnit] = useState<"kg" | "lb">(st.units),
    [sex, setSex] = useState<Sex | undefined>(st.sex),
    [year, setYear] = useState(st.birthYear ? String(st.birthYear) : ""),
    [cm, setCm] = useState(st.heightCm ? String(st.heightCm) : ""),
    [ft, setFt] = useState(feet.ft),
    [inch, setInch] = useState(feet.inch),
    [weight, setWeight] = useState(bw ? String(displayMass(bw, st.units)) : ""),
    [activity, setActivity] = useState<ActivityLevel | undefined>(st.activity),
    [goal, setGoal] = useState<PlanGoal>(planGoalFor(st)),
    // Optional, so never pre-filled: an old reading would silently switch
    // the estimate to the lean-mass formula.
    [bf, setBf] = useState("")

  const heightCm =
      heightUnit === "ft" ? (num(ft) * 12 + num(inch || "0")) * 2.54 : num(cm),
    weightKg = kilograms(num(weight), massUnit),
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

  // Switching a unit converts what's typed, so nothing has to be re-entered.
  const toHeight = (u: "cm" | "ft") => {
    if (u === heightUnit) return
    if (u === "ft") {
      const f = feetInches(cm.trim() ? num(cm) : undefined)
      setFt(f.ft)
      setInch(f.inch)
    } else if (ft.trim())
      setCm(String(Math.round((num(ft) * 12 + num(inch || "0")) * 25.4) / 10))
    setHeightUnit(u)
  }
  const toMass = (u: "kg" | "lb") => {
    if (u === massUnit) return
    if (weight.trim())
      setWeight(String(displayMass(kilograms(num(weight), massUnit), u)))
    setMassUnit(u)
  }

  const label = (text: string, units?: ReactNode) => (
    <Line style={{ marginTop: 16, marginBottom: 4, gap: 8 }}>
      <Copy size={14} weight="medium" style={{ flex: 1 }}>
        {text}
      </Copy>
      {units}
    </Line>
  )
  const unit = (text: string, on: boolean, press: () => void) => (
    <Tap
      key={text}
      role="radio"
      selected={on}
      onPress={press}
      label={`${text} units`}
      style={{
        height: 28,
        paddingHorizontal: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: on ? t.fit : t.line,
        backgroundColor: on ? t.fit : "transparent",
        justifyContent: "center",
      }}
    >
      <Copy size={12} weight="medium" style={{ color: on ? t.bg : t.muted }}>
        {text}
      </Copy>
    </Tap>
  )
  const input = (
    name: string,
    value: string,
    set: (v: string) => void,
    placeholder: string,
    unit?: string,
    integer?: boolean,
  ) => (
    <Line style={{ gap: 8, flex: 1, minWidth: 0 }}>
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
          // Two inputs share a row for ft + in; without this they won't shrink.
          minWidth: 0,
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
      {label(
        "Height",
        <>
          {unit("cm", heightUnit === "cm", () => toHeight("cm"))}
          {unit("ft", heightUnit === "ft", () => toHeight("ft"))}
        </>,
      )}
      {heightUnit === "ft" ? (
        <Line style={{ gap: 8 }}>
          {input("Height (ft)", ft, setFt, "5", "ft")}
          {input("Height (in)", inch, setInch, "9", "in")}
        </Line>
      ) : (
        input("Height (cm)", cm, setCm, "e.g. 175", "cm")
      )}
      {askWeight &&
        label(
          "Weight",
          <>
            {unit("kg", massUnit === "kg", () => toMass("kg"))}
            {unit("lb", massUnit === "lb", () => toMass("lb"))}
          </>,
        )}
      {askWeight &&
        input(
          `Weight (${massUnit})`,
          weight,
          setWeight,
          massUnit === "lb" ? "e.g. 160" : "e.g. 72.5",
          massUnit,
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
