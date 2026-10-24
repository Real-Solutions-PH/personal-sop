import type { ModuleKey } from "@domain/contract"
import { AREA } from "@domain/dash/data"
import { dashStore, setOnboarded, skipSetup } from "@domain/dash/store"
import { finStore } from "@domain/finance/store"
import {
  logWeighIn,
  setMacroTarget,
  updateSettings,
  upsertTemplate,
} from "@domain/fitness/actions"
import type { FitnessSettings } from "@domain/fitness/data"
import { type Plan, type PlanInputs, planNotes } from "@domain/fitness/plan"
import { fitStore } from "@domain/fitness/store"
import { saveFocusSettings } from "@domain/focus/actions"
import { PRESETS, type PresetKey } from "@domain/focus/data"
import { focusStore } from "@domain/focus/store"
import { createHabit, type HabitInput } from "@domain/habits/actions"
import { habitsStore } from "@domain/habits/store"
import { captureTasks } from "@domain/tasks/actions"
import { tasksStore } from "@domain/tasks/store"
import { useLocalSearchParams } from "expo-router"
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Dumbbell,
  ListChecks,
  Repeat2,
  Timer,
  Utensils,
  Wallet,
  X,
} from "lucide-react-native"
import { useState } from "react"
import { ScrollView, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { Stepper } from "../fitness-controls"
import {
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  Segmented,
  Tap,
} from "../native-kit"
import { back, go, replace } from "../navigation"
import { AccentContext, fonts, useTheme } from "../theme"
import { Button } from "../ui"
import { FinanceSetup } from "./finance-setup"
import { PlanForm, PlanNotes } from "./nutrition-plan"

const ORDER: ModuleKey[] = [
  "finance",
  "habits",
  "fitness",
  "nutrition",
  "focus",
  "tasks",
]

const STEP: Record<ModuleKey, { title: string; why: string; time: string }> = {
  finance: {
    title: "Your accounts & balances",
    why: "Where your money lives today — the starting point for net worth and savings.",
    time: "1 min",
  },
  habits: {
    title: "A few starter habits",
    why: "Pick two or three. Small ones stick.",
    time: "30 sec",
  },
  fitness: {
    title: "Your training baseline",
    why: "Today's weight and the split you run, so progress has a day 1.",
    time: "30 sec",
  },
  nutrition: {
    title: "Your daily targets",
    why: "Your calories and macros, worked out from your body and goal. Adjust anything.",
    time: "30 sec",
  },
  focus: {
    title: "Your daily focus goal",
    why: "How many hours of deep work a day counts as a good day, and the timer you like.",
    time: "15 sec",
  },
  tasks: {
    title: "What's on your plate",
    why: "Dump what's in your head. Dates like 'friday' are picked up for you.",
    time: "1 min",
  },
}

const HABIT_PICKS: (Partial<HabitInput> & { name: string })[] = [
  {
    name: "Drink water",
    icon: "💧",
    type: "count",
    target: 8,
    unit: "glasses",
    step: 1,
  },
  {
    name: "Read",
    icon: "📖",
    type: "count",
    target: 10,
    unit: "pages",
    step: 5,
  },
  { name: "Meditate", icon: "🧘", type: "duration", target: 5 },
  {
    name: "Work out",
    icon: "🏋️",
    linkWorkout: true,
    schedule: [{ days: [1, 3, 5] }],
  },
  {
    name: "Journal",
    icon: "✍️",
    schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], time: "21:30" }],
  },
  { name: "No phone first hour", icon: "📵" },
  {
    name: "Sleep by 11",
    icon: "🌙",
    schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], time: "23:00" }],
  },
]

const SPLITS: Record<string, { label: string; days: [string, string[]][] }> = {
  full: {
    label: "Full body",
    days: [["Full body", ["squat", "bench", "row", "ohp", "curl"]]],
  },
  ul: {
    label: "Upper / Lower",
    days: [
      ["Upper", ["bench", "row", "ohp", "pulldown", "curl"]],
      ["Lower", ["squat", "rdl", "legpress"]],
    ],
  },
  ppl: {
    label: "Push / Pull / Legs",
    days: [
      ["Push", ["bench", "ohp", "incline-db", "lateral", "pushdown"]],
      ["Pull", ["row", "pulldown", "pullup", "facepull", "curl"]],
      ["Legs", ["squat", "rdl", "legpress"]],
    ],
  },
  none: { label: "Not lifting yet", days: [] },
}

const modules = {
  habits: { icon: Repeat2, color: "hab" },
  tasks: { icon: ListChecks, color: "tsk" },
  fitness: { icon: Dumbbell, color: "fit" },
  nutrition: { icon: Utensils, color: "nut" },
  focus: { icon: Timer, color: "foc" },
  finance: { icon: Wallet, color: "fin" },
} as const
export function Setup() {
  const t = useTheme(),
    safe = useSafeAreaInsets(),
    params = useLocalSearchParams<{ step?: ModuleKey }>(),
    [step, setStep] = useState<ModuleKey | null>(
      params.step && ORDER.includes(params.step) ? params.step : null,
    ),
    enabled = dashStore.use((s) => s.enabled),
    skipped = dashStore.use((s) => s.setupSkipped),
    // The last part of onboarding: nothing here can be skipped or left
    // until every section is set up. Afterwards it is "Run setup again".
    firstRun = !dashStore.use((s) => s.onboarded),
    has = {
      finance: finStore.use((s) => s.accounts.length > 0),
      habits: habitsStore.use((s) => s.habits.length > 0),
      fitness: fitStore.use(
        (s) => s.templates.length + s.workouts.length + s.weighIns.length > 0,
      ),
      nutrition: fitStore.use((s) => s.targets.length + s.meals.length > 0),
      focus: focusStore.use((s) => s.settingsSaved || s.sessions.length > 0),
      tasks: tasksStore.use((s) => s.tasks.length > 0),
    },
    steps = ORDER.filter((k) => enabled[k]),
    pending = steps.filter((k) => !has[k]),
    allDone = (firstRun || steps.length > 0) && !pending.length
  const finishOnboarding = () => {
    setOnboarded(true)
    toast.success("You're set", { description: "Day 1 starts now" })
    replace("/today")
  }
  const advance = (k: ModuleKey) =>
    setStep(
      steps
        .slice(steps.indexOf(k) + 1)
        .find((x) => pending.includes(x) && x !== k) ?? null,
    )
  const icon = (k: ModuleKey, size = 32) => {
    const I = modules[k].icon,
      color = t[modules[k].color]
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 3,
          backgroundColor: border(color, 0.15),
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <I size={size / 2} color={color} />
      </View>
    )
  }
  return (
    <View style={{ flex: 1, paddingTop: safe.top, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 20,
          paddingBottom: 32,
        }}
      >
        <Line style={{ height: 56, gap: 12 }}>
          <IconTap
            size={44}
            icon={step || firstRun ? ArrowLeft : X}
            label={step ? "Back to setup" : firstRun ? "Back" : "Close"}
            color={t.text}
            onPress={() =>
              step
                ? setStep(null)
                : firstRun
                  ? back("/onboarding")
                  : go("/today")
            }
          />
          {step && (
            <>
              <Line style={{ flex: 1, gap: 6 }}>
                {steps.map((k) => (
                  <View
                    key={k}
                    style={{
                      height: 6,
                      flex: 1,
                      borderRadius: 3,
                      backgroundColor:
                        k === step || has[k] ? t.primary : t.soft,
                    }}
                  />
                ))}
              </Line>
              {!firstRun && (
                <Tap
                  onPress={() => {
                    skipSetup(step)
                    advance(step)
                  }}
                  style={{ padding: 8 }}
                >
                  <Copy size={14} muted>
                    Skip
                  </Copy>
                </Tap>
              )}
            </>
          )}
        </Line>
        {step ? (
          <>
            <Line
              style={{
                marginTop: 8,
                marginBottom: 16,
                gap: 12,
                alignItems: "flex-start",
              }}
            >
              {icon(step, 40)}
              <View style={{ flex: 1 }}>
                <Copy
                  size={20}
                  weight="display"
                  style={{ letterSpacing: -0.5 }}
                >
                  {STEP[step].title}
                </Copy>
                <Copy size={14} muted>
                  {STEP[step].why}
                </Copy>
              </View>
            </Line>
            <AccentContext.Provider value={modules[step].color}>
              <View style={{ flex: 1 }}>
                {step === "finance" ? (
                  <FinanceSetup embedded onDone={() => advance(step)} />
                ) : step === "habits" ? (
                  <HabitsStep onDone={() => advance(step)} />
                ) : step === "fitness" ? (
                  <FitnessStep onDone={() => advance(step)} />
                ) : step === "nutrition" ? (
                  <NutritionStep onDone={() => advance(step)} />
                ) : step === "focus" ? (
                  <FocusStep onDone={() => advance(step)} />
                ) : (
                  <TasksStep onDone={() => advance(step)} />
                )}
              </View>
            </AccentContext.Provider>
          </>
        ) : (
          <>
            <Copy size={24} weight="display" style={{ letterSpacing: -0.6 }}>
              {allDone ? "You're all set" : "Bring your life in"}
            </Copy>
            <Copy muted style={{ marginTop: 4, marginBottom: 20 }}>
              {allDone
                ? "Every section has its starting data. Change any of it later from the section itself."
                : firstRun
                  ? "A few quick steps so every section starts with your real numbers."
                  : "A few quick steps so every section starts with your real numbers. Skip anything — it waits here until you're ready."}
            </Copy>
            <View style={{ gap: 8 }}>
              {steps.map((k) => (
                <Tap
                  key={k}
                  onPress={() => {
                    if (!has[k]) setStep(k)
                  }}
                >
                  <Frame style={{ padding: 16, opacity: has[k] ? 0.7 : 1 }}>
                    <Line style={{ gap: 12 }}>
                      {icon(k)}
                      <View style={{ flex: 1 }}>
                        <Copy weight="medium">{STEP[k].title}</Copy>
                        <Copy size={12} muted>
                          {has[k]
                            ? `${AREA[k].label} is set up`
                            : skipped.includes(k)
                              ? `Skipped · ${STEP[k].time}`
                              : STEP[k].time}
                        </Copy>
                      </View>
                      {has[k] ? (
                        <View
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 12,
                            backgroundColor: t.primary,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Check size={16} color={t.bg} />
                        </View>
                      ) : (
                        <ChevronRight size={16} color={t.muted} />
                      )}
                    </Line>
                  </Frame>
                </Tap>
              ))}
            </View>
            <View style={{ marginTop: "auto", paddingTop: 24 }}>
              {allDone ? (
                firstRun ? (
                  <Button onPress={finishOnboarding}>Go to Today</Button>
                ) : (
                  <Button href="/today">Go to Today</Button>
                )
              ) : (
                <>
                  <Button onPress={() => setStep(pending[0] ?? null)}>
                    {pending.length === steps.length ? "Start" : "Continue"}
                  </Button>
                  {!firstRun && (
                    <Button tone="quiet" href="/today">
                      I'll finish later
                    </Button>
                  )}
                </>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  )
}
function HabitsStep({ onDone }: { onDone: () => void }) {
  const t = useTheme(),
    [picked, setPicked] = useState<string[]>([]),
    [custom, setCustom] = useState(""),
    toggle = (n: string) =>
      setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]))
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {[
          ...HABIT_PICKS,
          ...picked
            .filter((n) => !HABIT_PICKS.some((h) => h.name === n))
            .map((name) => ({ name, icon: "✅" })),
        ].map((h) => (
          <Tap
            key={h.name}
            onPress={() => toggle(h.name)}
            style={{
              height: 36,
              justifyContent: "center",
              paddingHorizontal: 14,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: picked.includes(h.name) ? t.hab : t.line,
              backgroundColor: picked.includes(h.name) ? t.hab : t.card,
            }}
          >
            <Copy
              size={14}
              weight="medium"
              style={{ color: picked.includes(h.name) ? t.bg : t.text }}
            >
              {h.icon} {h.name}
            </Copy>
          </Tap>
        ))}
      </View>
      <Line style={{ marginTop: 12, gap: 8 }}>
        <TextInput
          accessibilityLabel="Your own habit"
          placeholder="Or type your own…"
          placeholderTextColor={t.muted}
          value={custom}
          onChangeText={setCustom}
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
        <Button
          tone="quiet"
          disabled={!custom.trim()}
          onPress={() => {
            const n = custom.trim()
            if (n && !picked.includes(n)) setPicked((p) => [...p, n])
            setCustom("")
          }}
        >
          Add
        </Button>
      </Line>
      <View style={{ marginTop: "auto", paddingTop: 24 }}>
        <Button
          disabled={!picked.length}
          onPress={() => {
            for (const n of picked)
              createHabit(HABIT_PICKS.find((h) => h.name === n) ?? { name: n })
            toast(`${picked.length} habit${picked.length > 1 ? "s" : ""} added`)
            onDone()
          }}
        >
          {picked.length ? `Add ${picked.length} habits` : "Pick at least one"}
        </Button>
      </View>
    </View>
  )
}
function FitnessStep({ onDone }: { onDone: () => void }) {
  const t = useTheme(),
    units = fitStore.use((s) => s.settings.units),
    [weight, setWeight] = useState(""),
    [goal, setGoal] = useState<FitnessSettings["goalDirection"]>("maintain"),
    [split, setSplit] = useState("full"),
    [perWeek, setPerWeek] = useState(3)
  const chip = (label: string, on: boolean, press: () => void) => (
    <Tap
      key={label}
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
        {label}
      </Copy>
    </Tap>
  )
  return (
    <View style={{ flex: 1 }}>
      <Copy size={14} weight="medium" style={{ marginBottom: 4 }}>
        Today's weight
      </Copy>
      <Line style={{ gap: 8 }}>
        <TextInput
          accessibilityLabel="Today's weight"
          placeholder="e.g. 72.5"
          placeholderTextColor={t.muted}
          value={weight}
          onChangeText={(v) => setWeight(v.replace(/[^\d.]/g, ""))}
          keyboardType="decimal-pad"
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
        <Copy muted>{units}</Copy>
      </Line>
      <Copy
        size={14}
        weight="medium"
        style={{ marginTop: 16, marginBottom: 4 }}
      >
        Goal
      </Copy>
      <Segmented
        value={goal}
        onChange={setGoal}
        options={[
          { value: "cut", label: "Lose" },
          { value: "maintain", label: "Maintain" },
          { value: "bulk", label: "Gain" },
        ]}
      />
      <Copy
        size={14}
        weight="medium"
        style={{ marginTop: 16, marginBottom: 4 }}
      >
        How do you train?
      </Copy>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {Object.entries(SPLITS).map(([k, s]) =>
          chip(s.label, split === k, () => setSplit(k)),
        )}
      </View>
      <Copy
        size={14}
        weight="medium"
        style={{ marginTop: 16, marginBottom: 4 }}
      >
        Sessions per week
      </Copy>
      <Line style={{ gap: 8 }}>
        {[2, 3, 4, 5, 6].map((n) =>
          chip(String(n), perWeek === n, () => setPerWeek(n)),
        )}
      </Line>
      <View style={{ marginTop: "auto", paddingTop: 24 }}>
        <Button
          disabled={!weight && split === "none"}
          onPress={() => {
            const w = Number(weight)
            if (w) logWeighIn(units === "lb" ? w / 2.2046 : w)
            for (const [name, ids] of SPLITS[split].days)
              upsertTemplate({
                name,
                items: ids.map((exerciseId) => ({ exerciseId, sets: 3 })),
              })
            updateSettings({ goalDirection: goal, weeklyTarget: perWeek })
            toast("Training baseline saved")
            onDone()
          }}
        >
          Save baseline
        </Button>
      </View>
    </View>
  )
}
/** The daily focus goal and the Pomodoro the timer starts with. */
function FocusStep({ onDone }: { onDone: () => void }) {
  const st = focusStore.use((s) => s.settings),
    [hours, setHours] = useState(st.dailyGoalMin / 60),
    [preset, setPreset] = useState<PresetKey>(
      st.preset === "custom" ? "25-5" : st.preset,
    )
  return (
    <View style={{ flex: 1, gap: 12 }}>
      <Stepper
        label="Deep work a day"
        unit="h"
        value={hours}
        onChange={setHours}
        step={0.5}
        min={0.5}
        max={12}
        decimals={1}
      />
      <Copy size={14} weight="medium">
        Pomodoro
      </Copy>
      <Segmented
        value={preset}
        onChange={setPreset}
        options={(Object.keys(PRESETS) as PresetKey[]).map((k) => ({
          value: k,
          label: `${PRESETS[k].lengths[0]}/${PRESETS[k].lengths[1]}`,
        }))}
      />
      <Copy size={12} muted>
        {PRESETS[preset].lengths[0]} minutes of focus, a{" "}
        {PRESETS[preset].lengths[1]}-minute break, and a longer{" "}
        {PRESETS[preset].lengths[2]}-minute one after every{" "}
        {PRESETS[preset].lengths[3]}. Change it any time in Focus, Settings.
      </Copy>
      <View style={{ marginTop: "auto", paddingTop: 24 }}>
        <Button
          onPress={() => {
            const [f, sb, lb, n] = PRESETS[preset].lengths
            saveFocusSettings({
              dailyGoalMin: Math.round(hours * 60),
              mode: "pomodoro",
              preset,
              focusMin: f,
              shortBreakMin: sb,
              longBreakMin: lb,
              setsBeforeLong: n,
            })
            toast("Focus goal saved")
            onDone()
          }}
        >
          Save goal
        </Button>
      </View>
    </View>
  )
}
/** Daily targets worked out from the body-stats form; every number stays
 * editable, with warn-only notes under the ones that look off. */
export function NutritionStep({ onDone }: { onDone: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null),
    [inputs, setInputs] = useState<PlanInputs | null>(null),
    hasWeighIn = fitStore.use((s) => s.weighIns.length > 0)
  if (!plan || !inputs)
    return (
      <PlanForm
        applyLabel="See my plan"
        askWeight={!hasWeighIn}
        onApply={(p, i) => {
          setPlan(p)
          setInputs(i)
        }}
      />
    )
  const set = (patch: Partial<Plan>) => setPlan({ ...plan, ...patch }),
    notes = planNotes(plan, inputs)
  return (
    <View style={{ flex: 1, gap: 12 }}>
      <Stepper
        label="Calories"
        unit="kcal"
        value={plan.kcal}
        onChange={(kcal) => set({ kcal })}
        step={50}
        min={500}
        max={6000}
        decimals={0}
      />
      <PlanNotes notes={notes} field="kcal" />
      <Stepper
        label="Protein"
        unit="g"
        value={plan.protein}
        onChange={(protein) => set({ protein })}
        step={5}
        min={30}
        max={500}
        decimals={0}
      />
      <PlanNotes notes={notes} field="protein" />
      <Stepper
        label="Carbs"
        unit="g"
        value={plan.carbs}
        onChange={(carbs) => set({ carbs })}
        step={5}
        max={900}
        decimals={0}
      />
      <Stepper
        label="Fat"
        unit="g"
        value={plan.fat}
        onChange={(fat) => set({ fat })}
        step={5}
        max={500}
        decimals={0}
      />
      <PlanNotes notes={notes} field="fat" />
      <Stepper
        label="Fiber"
        unit="g"
        value={plan.fiberG}
        onChange={(fiberG) => set({ fiberG })}
        step={1}
        max={150}
        decimals={0}
      />
      <PlanNotes notes={notes} field="fiber" />
      <PlanNotes notes={notes} field="totals" />
      <View style={{ marginTop: "auto", paddingTop: 24 }}>
        <Button
          onPress={() => {
            const { kcal, protein, carbs, fat, fiberG } = plan
            setMacroTarget({ kcal, protein, carbs, fat, fiberGoal: fiberG })
            toast("Daily targets saved")
            onDone()
          }}
        >
          Save targets
        </Button>
      </View>
    </View>
  )
}
function TasksStep({ onDone }: { onDone: () => void }) {
  const t = useTheme(),
    [text, setText] = useState("")
  return (
    <View style={{ flex: 1 }}>
      <TextInput
        accessibilityLabel="Your tasks, one per line"
        multiline
        numberOfLines={7}
        placeholder={"pay rent friday\nrenew passport\nbuy groceries"}
        placeholderTextColor={t.muted}
        value={text}
        onChangeText={setText}
        style={{
          minHeight: 192,
          padding: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.line,
          backgroundColor: t.card,
          fontFamily: fonts.body,
          fontSize: 16,
          color: t.text,
          textAlignVertical: "top",
        }}
      />
      <Copy size={12} muted style={{ marginTop: 4 }}>
        One per line.
      </Copy>
      <View style={{ marginTop: "auto", paddingTop: 24 }}>
        <Button
          disabled={!text.trim()}
          onPress={() => {
            const { tasks } = captureTasks(text, "manual")
            toast(`${tasks.length} task${tasks.length > 1 ? "s" : ""} added`)
            onDone()
          }}
        >
          Add tasks
        </Button>
      </View>
    </View>
  )
}
