import * as A from "@domain/fitness/actions"
import * as C from "@domain/fitness/calc"
import type {
  FitnessSettings,
  FitnessState,
  WeighIn,
} from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
import { useLocalSearchParams } from "expo-router"
import type { LucideIcon } from "lucide-react-native"
import {
  ChevronRight,
  Minus,
  Plus,
  Ruler,
  Scale,
  Settings,
  Target,
} from "lucide-react-native"
import { useEffect, useState } from "react"
import { TextInput, View } from "react-native"
import { toast } from "sonner-native"
import { FLASH_MS, FlashLine, weighInSaved } from "../body-moments"
import type { WeighStep } from "../body-rewards"
import { FitnessTrend, Sparkline } from "../chart"
import { parseAmount } from "../fitness-controls"
import { MomentCard } from "../moment"
import { Burst } from "../motion"
import {
  Bar,
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  Segmented,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Button, DateField, Field, PinnedFooter, Screen, Sheet } from "../ui"
import { isDay } from "../validation"
import { Dimmed, EmptyFoot, LockedPreview } from "./locked-preview"
import { StatsShell } from "./stats-shell"
export function GoalSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const s = fitStore.use((s) => s),
    t = useTheme(),
    [dir, setDir] = useState<FitnessSettings["goalDirection"]>(
      s.settings.goalDirection,
    ),
    [weight, setWeight] = useState(
      s.settings.goalWeight ?? Math.round(C.weeklyRate(s)?.avg ?? 75),
    )
  return (
    <Sheet title="Body goal" open={open} onClose={onClose}>
      <Copy size={14} muted>
        Sets whether the trend reads as good or bad.
      </Copy>
      <Segmented
        value={dir}
        onChange={setDir}
        options={[
          { value: "cut", label: "Lose" },
          { value: "maintain", label: "Maintain" },
          { value: "bulk", label: "Gain" },
        ]}
      />
      <Copy size={14} muted>
        Goal weight
      </Copy>
      <Line style={{ justifyContent: "center", gap: 20 }}>
        <IconTap
          size={44}
          icon={Minus}
          background={t.soft}
          label="Lower goal weight"
          onPress={() => setWeight(Math.max(30, weight - 0.5))}
        />
        <Copy size={36} weight="displayMedium">
          {weight} kg
        </Copy>
        <IconTap
          size={44}
          icon={Plus}
          background={t.soft}
          label="Higher goal weight"
          onPress={() => setWeight(Math.min(250, weight + 0.5))}
        />
      </Line>
      <Line>
        <View style={{ flex: 1 }}>
          <Button
            tone="quiet"
            onPress={() => {
              A.updateSettings({ goalDirection: dir, goalWeight: undefined })
              onClose()
            }}
          >
            No goal weight
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button
            onPress={() => {
              A.updateSettings({ goalDirection: dir, goalWeight: weight })
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
export function WeighInEditor({
  entry,
  open,
  onClose,
  onLogged,
}: {
  entry?: WeighIn
  open: boolean
  onClose: () => void
  /** A new weigh-in landed, with its step toward the goal. */
  onLogged?: (step: WeighStep | null) => void
}) {
  const s = fitStore.use((s) => s),
    [weight, setWeight] = useState<number | undefined>(
      entry?.weightKg ?? C.latestBodyweight(s) ?? 75,
    ),
    [day, setDay] = useState(
      entry ? dayKey(new Date(entry.measuredAt)) : dayKey(),
    ),
    [fat, setFat] = useState<number | undefined>(entry?.bodyFatPct),
    [waist, setWaist] = useState<number | undefined>(entry?.waistCm),
    [note, setNote] = useState(entry?.note ?? ""),
    comp =
      weight !== undefined && weight > 0 && fat !== undefined && fat > 0
        ? C.bodyComposition(weight, fat)
        : undefined
  const save = () => {
    if (
      !isDay(day) ||
      weight === undefined ||
      !(weight > 0 && weight < 500) ||
      (fat !== undefined && !(fat > 0 && fat < 100)) ||
      (waist !== undefined && !(waist > 0 && waist < 300))
    ) {
      toast.error("Enter a valid weight, date, body fat and waist")
      return
    }
    const measuredAt =
      entry && dayKey(new Date(entry.measuredAt)) === day
        ? entry.measuredAt
        : day === dayKey()
          ? new Date().toISOString()
          : new Date(`${day}T12:00:00`).toISOString()
    if (entry)
      A.updateWeighIn(entry.id, {
        weightKg: weight,
        measuredAt,
        note,
        bodyFatPct: fat,
        waistCm: waist,
      })
    else {
      const step = weighInSaved(weight, measuredAt)
      A.logWeighIn(weight, measuredAt, note, fat, waist)
      onLogged?.(step)
    }
    onClose()
  }
  return (
    <Sheet
      title={entry ? "Edit weigh-in" : "Weigh in"}
      open={open}
      onClose={onClose}
    >
      <MeasureField
        label="Weight"
        unit="kg"
        value={weight}
        onChange={setWeight}
        step={0.1}
        seed={C.latestBodyweight(s) ?? 75}
        min={20}
        max={499}
        placeholder="e.g. 72.4"
      />
      <DateField
        label="Date"
        value={day}
        onChangeText={setDay}
        maximumDate={dayKey()}
      />
      <MeasureField
        label="Body fat (optional)"
        unit="%"
        value={fat}
        onChange={setFat}
        step={0.1}
        seed={C.latestBodyFat(s) ?? 20}
        min={1}
        max={75}
        placeholder="From a smart scale or calipers"
      />
      {comp && (
        <View testID="weigh-derived">
          <Copy size={13} muted>
            Fat mass {comp.fatKg.toFixed(1)} kg · Lean mass{" "}
            {comp.leanKg.toFixed(1)} kg
          </Copy>
        </View>
      )}
      <MeasureField
        label="Waist (optional)"
        unit="cm"
        value={waist}
        onChange={setWaist}
        step={0.5}
        seed={C.metricChange(s, "waist", 0)?.latest ?? 80}
        min={30}
        max={250}
        placeholder="Around the navel, e.g. 82.5"
      />
      <Field
        label="Note (optional)"
        value={note}
        onChangeText={setNote}
        placeholder="e.g. after a late dinner"
      />
      <PinnedFooter>
        <Button onPress={save}>
          {entry ? "Save changes" : "Log weigh-in"}
        </Button>
      </PinnedFooter>
      {entry && (
        <Button
          tone="quiet"
          onPress={() => {
            A.deleteWeighIn(entry.id)
            onClose()
          }}
        >
          Delete weigh-in
        </Button>
      )}
    </Sheet>
  )
}
/** A measurement typed or stepped with − / +. An empty field is no value;
 * the first step from empty starts at ``seed`` (the last reading). */
export function MeasureField({
  label,
  unit,
  value,
  onChange,
  step,
  seed,
  min,
  max,
  placeholder,
}: {
  label: string
  unit: string
  value: number | undefined
  onChange: (n: number | undefined) => void
  step: number
  seed: number
  min: number
  max: number
  placeholder?: string
}) {
  const t = useTheme(),
    show = (n: number | undefined) => (n === undefined ? "" : String(n)),
    read = (v: string) => {
      const n = parseAmount(v)
      return v.trim() === "" || !Number.isFinite(n) ? undefined : n
    },
    [draft, setDraft] = useState(show(value)),
    [last, setLast] = useState(value)
  // A step from outside rewrites the text; typing "72." keeps its dot.
  if (last !== value) {
    setLast(value)
    if (read(draft) !== value) setDraft(show(value))
  }
  const bump = (d: number) =>
    onChange(
      value === undefined
        ? seed
        : Math.min(max, Math.max(min, Math.round((value + d) * 10) / 10)),
    )
  const name = label.replace(/ \(optional\)$/, "").toLowerCase()
  return (
    <View style={{ gap: 6, marginVertical: 6 }}>
      <Copy size={12} weight="medium" muted>
        {label}
      </Copy>
      <Line style={{ gap: 8 }}>
        <IconTap
          size={44}
          icon={Minus}
          background={t.soft}
          label={`Lower ${name}`}
          onPress={() => bump(-step)}
        />
        <Line
          style={{
            flex: 1,
            minHeight: 44,
            borderWidth: 1,
            borderColor: t.line,
            borderRadius: 12,
            paddingHorizontal: 12,
            gap: 6,
          }}
        >
          <TextInput
            accessibilityLabel={label}
            value={draft}
            onChangeText={(v) => {
              setDraft(v)
              onChange(read(v))
            }}
            placeholder={placeholder}
            placeholderTextColor={t.muted}
            keyboardType="decimal-pad"
            style={{
              flex: 1,
              minWidth: 0,
              paddingVertical: 10,
              fontSize: 16,
              fontFamily: fonts.semibold,
              color: t.text,
            }}
          />
          <Copy size={14} muted>
            {unit}
          </Copy>
        </Line>
        <IconTap
          size={44}
          icon={Plus}
          background={t.soft}
          label={`Raise ${name}`}
          onPress={() => bump(step)}
        />
      </Line>
    </View>
  )
}
/** A compact pill action, so secondary actions don't take a card each. */
function Chip({
  icon: Icon,
  label,
  color,
  solid = false,
  onPress,
}: {
  icon: LucideIcon
  label: string
  color: string
  solid?: boolean
  onPress: () => void
}) {
  const t = useTheme()
  return (
    <Tap
      label={label}
      onPress={onPress}
      style={{
        minHeight: 32,
        paddingHorizontal: 12,
        borderRadius: 16,
        justifyContent: "center",
        backgroundColor: solid ? color : `${color}1f`,
      }}
    >
      <Line style={{ gap: 6 }}>
        <Icon size={14} color={solid ? t.onPrimary : color} />
        <Copy
          size={13}
          weight="medium"
          style={{ color: solid ? t.onPrimary : color }}
        >
          {label}
        </Copy>
      </Line>
    </Tap>
  )
}
/** What the page holds once someone weighs in, drawn dimmed behind the
 * first-weigh-in card: twelve weeks of mornings drifting from 75.0 to 72.6 kg,
 * with a body-fat reading and a waist measurement about once a week. Fixed values, so the preview
 * looks the same on every open. */
export function sampleWeighIns(now = Date.now()): WeighIn[] {
  const wobble = [0.2, -0.1, 0.3, 0, -0.2, 0.1, 0.25]
  const out: WeighIn[] = []
  for (let n = 84; n >= 1; n--) {
    if (n % 5 === 2) continue
    const at = new Date(now - n * 86400000)
    at.setHours(6, 40, 0, 0)
    const kg = 72.6 + (2.4 * n) / 84 + wobble[n % 7]
    out.push({
      id: `sample-${n}`,
      measuredAt: at.toISOString(),
      weightKg: Math.round(kg * 10) / 10,
      ...(n % 7 === 0
        ? { bodyFatPct: Math.round((21.4 + (2.2 * n) / 84) * 10) / 10 }
        : {}),
      ...(n % 7 === 3
        ? { waistCm: Math.round((81.5 + (3 * n) / 84) * 10) / 10 }
        : {}),
    })
  }
  return out
}
export function Body({
  hub = false,
  embedded = false,
}: {
  hub?: boolean
  /** A section of the Fitness page instead of its own screen. */
  embedded?: boolean
}) {
  const real = fitStore.use((s) => s),
    // With no weigh-ins the page draws its real layout from sample mornings,
    // dimmed and inert under the first-weigh-in card.
    empty = !real.weighIns.length,
    s = empty ? { ...real, weighIns: sampleWeighIns() } : real,
    t = useTheme(),
    p = useLocalSearchParams<{ log?: string; weigh?: string; goal?: string }>(),
    [range, setRange] = useState("84"),
    [add, setAdd] = useState(p.log === "1" || p.weigh === "1"),
    [entry, setEntry] = useState<WeighIn | undefined>(),
    [goal, setGoal] = useState(p.goal === "1"),
    [more, setMore] = useState(false),
    trend = C.weightTrend(s, hub ? 28 : Number(range)),
    rate = C.weeklyRate(s),
    sorted = [...s.weighIns].sort((a, b) =>
      b.measuredAt.localeCompare(a.measuredAt),
    ),
    first = sorted.at(-1),
    avg = rate?.avg ?? sorted[0]?.weightKg,
    dir = s.settings.goalDirection,
    target = s.settings.goalWeight,
    good = rate
      ? dir === "cut"
        ? rate.kg <= 0
        : dir === "bulk"
          ? rate.kg >= 0
          : Math.abs(rate.kg) < 0.25
      : true,
    progress =
      first &&
      target !== undefined &&
      avg !== undefined &&
      first.weightKg !== target
        ? (first.weightKg - avg) / (first.weightKg - target)
        : undefined,
    today = C.dailyWeights(s).get(dayKey()),
    [logged, setLogged] = useState<{ step: WeighStep; at: number } | null>(
      null,
    ),
    step = logged?.step
  // The step stays a moment, the goal card a little longer.
  useEffect(() => {
    if (!logged) return
    const id = setTimeout(
      () => setLogged(null),
      logged.step.reached ? 4200 : FLASH_MS,
    )
    return () => clearTimeout(id)
  }, [logged])
  const addWeigh = () => {
    setEntry(undefined)
    setAdd(true)
  }
  const content = (
    <>
      <LockedPreview
        gap={12}
        locked={empty}
        color={t.fit}
        title="No weigh-ins yet"
        detail="Your first weigh-in sets the starting point. Weigh in each morning; the 7-day average smooths out daily noise."
        action={{ label: "Weigh in", onPress: addWeigh }}
      >
        <Frame style={{ padding: 16, marginTop: hub ? 4 : 0 }}>
          <Tap onPress={() => hub && go("/fitness/body")}>
            <Line
              style={{
                justifyContent: "space-between",
                alignItems: "flex-end",
              }}
            >
              <View>
                <Burst
                  fire={step?.reached ? (logged?.at ?? 0) : 0}
                  color={t.good}
                  size={96}
                />
                {!hub && (
                  <Copy size={12} muted>
                    7-day average
                  </Copy>
                )}
                <Copy
                  size={hub ? 30 : 36}
                  weight={hub ? "displayMedium" : "semibold"}
                  style={{ color: hub ? t.fit : t.text }}
                >
                  {avg?.toFixed(1)}
                  {hub ? (
                    " kg"
                  ) : (
                    <Copy size={16} muted>
                      {" "}
                      kg
                    </Copy>
                  )}
                </Copy>
                {hub && (
                  <Copy size={12} muted>
                    7-day average
                  </Copy>
                )}
              </View>
              {rate && (
                <View style={{ alignItems: "flex-end" }}>
                  <Copy
                    size={hub ? 14 : 16}
                    weight={hub ? "body" : "semibold"}
                    style={{ color: good ? t.good : t.bad }}
                  >
                    {rate.kg > 0 ? "▲" : "▼"} {Math.abs(rate.kg).toFixed(2)}{" "}
                    kg/wk
                  </Copy>
                  {!hub && (
                    <Copy size={12} muted>
                      {rate.pct.toFixed(2)}% of bodyweight
                    </Copy>
                  )}
                </View>
              )}
            </Line>
          </Tap>
          {step && (
            <View style={{ marginTop: 8 }}>
              <FlashLine
                testID="weigh-step"
                text={step.text}
                tone={
                  step.toward === true
                    ? "good"
                    : step.toward === false
                      ? "warn"
                      : "muted"
                }
              />
            </View>
          )}
          {step?.reached && target !== undefined && (
            <MomentCard
              kind="goal-weight"
              testID="goal-weight-reached"
              label="Goal weight reached"
              title={`${C.kg(target)} reached`}
              detail={
                <Copy size={13} muted>
                  {`Weighed ${C.kg(step.kg)} today${first ? ` · started at ${C.kg(first.weightKg)}` : ""}`}
                </Copy>
              }
              badge={<Target size={22} color={t.bg} />}
              tint={t.good}
              say={`Goal weight reached: ${C.kg(target)}.`}
              hint="Opens your body page"
              onOpen={() => go("/fitness/body")}
            />
          )}
          {hub && (
            <Line
              style={{
                marginTop: 10,
                gap: 8,
                justifyContent: "space-between",
                flexWrap: "wrap",
              }}
            >
              {today !== undefined ? (
                <Line style={{ gap: 6 }}>
                  <Scale size={14} color={t.muted} />
                  <Copy size={13} muted>
                    Today{" "}
                    <Copy size={13} weight="semibold">
                      {today.toFixed(1)} kg
                    </Copy>
                  </Copy>
                </Line>
              ) : (
                <Chip
                  icon={Plus}
                  label="Weigh in"
                  color={t.fit}
                  solid
                  onPress={addWeigh}
                />
              )}
              <Chip
                icon={Target}
                label={
                  target !== undefined && avg !== undefined
                    ? `Goal ${C.kg(target)} · ${Math.abs(avg - target).toFixed(1)} to go`
                    : "Set goal"
                }
                color={t.fit}
                onPress={() => go("/fitness/body?goal=1")}
              />
            </Line>
          )}
          {!hub && rate && Math.abs(rate.pct) > 1 && (
            <Copy
              size={12}
              style={{
                marginTop: 8,
                padding: 8,
                borderRadius: 8,
                backgroundColor: `${t.warn}26`,
                color: t.warn,
              }}
            >
              Faster than ~1%/week — consider easing the deficit to keep your
              lifts.
            </Copy>
          )}
          <View style={{ marginTop: hub ? 8 : 12 }}>
            <FitnessTrend
              height={hub ? 110 : 160}
              line={trend.map((p) => p.avg)}
              dots={trend.map((p) => p.raw)}
              goal={target}
              labels={
                hub || !trend[0] ? undefined : [C.fmtDay(trend[0].day), "Today"]
              }
            />
          </View>
          {!hub && (
            <>
              <View style={{ marginTop: 12 }}>
                <Segmented
                  value={range}
                  onChange={setRange}
                  options={[
                    { value: "28", label: "4w" },
                    { value: "84", label: "12w" },
                    { value: "90", label: "All" },
                  ]}
                />
              </View>
              <Line style={{ marginTop: 8, justifyContent: "center", gap: 12 }}>
                {[
                  { label: "daily", color: t.muted },
                  { label: "7-day avg", color: t.fit },
                  ...(target !== undefined
                    ? [{ label: "goal", color: t.good }]
                    : []),
                ].map((x) => (
                  <Line key={x.label} style={{ gap: 4 }}>
                    <View
                      style={{
                        width: x.label === "daily" ? 8 : 12,
                        height: x.label === "daily" ? 8 : 2,
                        borderRadius: 4,
                        backgroundColor: x.color,
                      }}
                    />
                    <Copy size={12} muted>
                      {x.label}
                    </Copy>
                  </Line>
                ))}
              </Line>
            </>
          )}
        </Frame>
        {hub ? (
          <BodyFat onLog={addWeigh} />
        ) : (
          <>
            <Tap onPress={() => setGoal(true)}>
              <Frame style={{ padding: 16 }}>
                <Line style={{ justifyContent: "space-between" }}>
                  <Line style={{ gap: 8 }}>
                    <Target size={16} color={t.fit} />
                    <Copy size={14} weight="medium">
                      Goal
                    </Copy>
                  </Line>
                  <Copy
                    size={12}
                    style={{
                      color: t.muted,
                      backgroundColor: t.soft,
                      borderRadius: 99,
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      textTransform: "capitalize",
                    }}
                  >
                    {
                      {
                        cut: "lose weight",
                        maintain: "maintain",
                        bulk: "gain weight",
                      }[dir]
                    }
                  </Copy>
                </Line>
                {target !== undefined && avg !== undefined ? (
                  <>
                    <Line
                      style={{
                        justifyContent: "space-between",
                        marginTop: 8,
                      }}
                    >
                      <Copy size={20} weight="semibold">
                        {C.kg(target)}
                      </Copy>
                      <Copy size={14} muted>
                        {Math.abs(avg - target).toFixed(1)} kg to go
                      </Copy>
                    </Line>
                    {progress !== undefined && (
                      <View style={{ marginTop: 8 }}>
                        <Bar value={progress} color={t.fit} />
                      </View>
                    )}
                    {first && (
                      <Copy size={12} muted style={{ marginTop: 4 }}>
                        Started at {C.kg(first.weightKg)} on{" "}
                        {C.fmtDay(dayKey(new Date(first.measuredAt)))}
                      </Copy>
                    )}
                  </>
                ) : (
                  <Copy size={14} muted style={{ marginTop: 4 }}>
                    No goal weight — trend colours stay neutral. Tap to set.
                  </Copy>
                )}
              </Frame>
            </Tap>
            <BodyComposition state={s} days={Number(range)} onLog={addWeigh} />
            <Waist
              state={s}
              range={range}
              setRange={setRange}
              onLog={addWeigh}
            />
            <Frame style={{ padding: 16 }}>
              <Line>
                {[
                  { label: "Latest", value: sorted[0].weightKg.toFixed(1) },
                  {
                    label: "Lowest",
                    value: Math.min(...sorted.map((w) => w.weightKg)).toFixed(
                      1,
                    ),
                  },
                  {
                    label: "Weigh-in days",
                    value: `${Math.round((trend.filter((p) => p.raw !== undefined).length / trend.length) * 100)}%`,
                  },
                ].map((x) => (
                  <View key={x.label} style={{ flex: 1 }}>
                    <Copy size={30} weight="displayMedium">
                      {x.value}
                    </Copy>
                    <Copy size={12} muted>
                      {x.label}
                    </Copy>
                  </View>
                ))}
              </Line>
            </Frame>
            <View style={{ marginTop: -12 }}>
              <SectionHeading>Entries</SectionHeading>
              <Frame>
                {(more ? sorted : sorted.slice(0, 14)).map((w, i) => {
                  const prev = sorted[i + 1],
                    diff = prev ? w.weightKg - prev.weightKg : 0
                  return (
                    <Tap
                      key={w.id}
                      onPress={() => {
                        setEntry(w)
                        setAdd(true)
                      }}
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        borderTopWidth: i ? 1 : 0,
                        borderColor: border(t.line, 0.6),
                      }}
                    >
                      <Line>
                        <View style={{ flex: 1 }}>
                          <Copy size={14}>
                            {C.fmtDay(dayKey(new Date(w.measuredAt)))}
                          </Copy>
                          <Copy size={12} muted>
                            {[
                              C.fmtTime(w.measuredAt),
                              w.bodyFatPct !== undefined &&
                                `${w.bodyFatPct}% fat`,
                              w.waistCm !== undefined &&
                                `${w.waistCm} cm waist`,
                              w.note,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </Copy>
                        </View>
                        {!!diff && (
                          <Copy size={12} muted>
                            {diff > 0 ? "+" : ""}
                            {diff.toFixed(1)}
                          </Copy>
                        )}
                        <Copy
                          weight="semibold"
                          style={{ width: 64, textAlign: "right" }}
                        >
                          {w.weightKg.toFixed(1)}
                        </Copy>
                      </Line>
                    </Tap>
                  )
                })}
              </Frame>
            </View>
            {!more && sorted.length > 14 && (
              <Tap
                onPress={() => setMore(true)}
                style={{ padding: 12, alignItems: "center" }}
              >
                <Copy size={14} weight="medium">
                  Show all {sorted.length}
                </Copy>
              </Tap>
            )}
          </>
        )}
      </LockedPreview>
      {add && (
        <WeighInEditor
          key={entry?.id ?? "new"}
          entry={entry}
          open={add}
          onClose={() => setAdd(false)}
          onLogged={(x) => x && setLogged({ step: x, at: Date.now() })}
        />
      )}
      {goal && <GoalSheet open={goal} onClose={() => setGoal(false)} />}
    </>
  )
  if (embedded)
    return (
      <StatsShell
        embedded
        title="Body"
        heading="Body"
        actions={
          <Tap label="All entries" onPress={() => go("/fitness/body")}>
            <Line style={{ gap: 2, minHeight: 44 }}>
              <Copy size={13} weight="medium" style={{ color: t.primary }}>
                All entries
              </Copy>
              <ChevronRight size={16} color={t.fit} />
            </Line>
          </Tap>
        }
      >
        {content}
      </StatsShell>
    )
  return (
    <Screen
      title={hub ? "Fitness" : "Body weight"}
      actions={
        hub ? (
          <IconTap
            size={40}
            icon={Settings}
            label="Fitness settings"
            onPress={() => go("/fitness/settings")}
          />
        ) : (
          <IconTap
            size={40}
            icon={Plus}
            label="Add weigh-in"
            onPress={addWeigh}
          />
        )
      }
    >
      {content}
    </Screen>
  )
}
function BodyFat({ onLog }: { onLog: () => void }) {
  const s = fitStore.use((s) => s),
    t = useTheme(),
    real = s.weighIns.filter((w) => w.bodyFatPct !== undefined),
    // No reading yet: the card draws sample readings, dimmed, above the
    // step that adds the first.
    empty = !real.length,
    points = (empty ? sampleWeighIns() : real)
      .filter((w) => w.bodyFatPct !== undefined)
      .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt)),
    last = points.at(-1),
    base = points.find(
      (p) => new Date(p.measuredAt).getTime() >= Date.now() - 30 * 86400000,
    )
  if (!last) return null
  const delta =
      base && base !== last
        ? Math.round((last.bodyFatPct! - base.bodyFatPct!) * 10) / 10
        : null,
    { fatKg: fat, leanKg: lean } = C.bodyComposition(
      last.weightKg,
      last.bodyFatPct!,
    ),
    old = base ? C.bodyComposition(base.weightKg, base.bodyFatPct!) : undefined,
    oldFat = old?.fatKg,
    oldLean = old?.leanKg
  const card = (
    <>
      <Line style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <View>
          <Copy size={30} weight="displayMedium">
            {last.bodyFatPct}%
          </Copy>
          <Copy size={12} muted>
            Body fat · latest
          </Copy>
        </View>
        {delta !== null && (
          <Copy
            size={14}
            style={{
              color: (
                s.settings.goalDirection === "bulk"
                  ? delta <= 0.5
                  : delta <= 0
              )
                ? t.good
                : t.bad,
            }}
          >
            {delta > 0 ? "▲" : delta < 0 ? "▼" : ""} {Math.abs(delta)} pts / 30d
          </Copy>
        )}
      </Line>
      <View style={{ marginTop: 8 }}>
        <Sparkline
          label="Body trend"
          values={points.slice(-20).map((p) => p.bodyFatPct!)}
          color={t.fit}
          height={48}
        />
      </View>
      <Line style={{ marginTop: 12, gap: 8 }}>
        {[
          { label: "Fat mass", value: fat, old: oldFat },
          { label: "Lean mass", value: lean, old: oldLean },
        ].map((x) => (
          <View
            key={x.label}
            style={{
              flex: 1,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 12,
              backgroundColor: border(t.soft, 0.5),
            }}
          >
            <Copy size={12} muted>
              {x.label}
            </Copy>
            <Copy size={14} weight="semibold">
              {x.value.toFixed(1)} kg{" "}
              {x.old !== undefined && base !== last && (
                <Copy
                  size={12}
                  style={{
                    color: (
                      x.label === "Fat mass"
                        ? x.value - x.old <= 0
                        : x.value - x.old >= -0.3
                    )
                      ? t.good
                      : t.bad,
                  }}
                >
                  {x.value - x.old > 0 ? "+" : "−"}
                  {Math.abs(x.value - x.old).toFixed(1)} kg
                </Copy>
              )}
            </Copy>
          </View>
        ))}
      </Line>
    </>
  )
  return (
    <Frame style={{ padding: 16 }}>
      {empty ? <Dimmed>{card}</Dimmed> : card}
      {empty && (
        <EmptyFoot
          testID="body-fat-empty"
          hint="Add body fat when you weigh in, from a smart scale or calipers."
          action={{ label: "Add", onPress: onLog }}
        />
      )}
    </Frame>
  )
}

type Series = { key: C.BodyMetric; label: string; unit: "%" | "kg" | "cm" }
const COMPOSITION: Series[] = [
  { key: "bodyFat", label: "Body fat", unit: "%" },
  { key: "leanMass", label: "Lean mass", unit: "kg" },
  { key: "fatMass", label: "Fat mass", unit: "kg" },
]
const RANGE_WORDS: Record<string, string> = {
  "28": "4 weeks",
  "84": "12 weeks",
  "90": "90 days",
}
export const fmtMeasure = (v: number, unit: Series["unit"]) =>
  unit === "%" ? `${v.toFixed(1)}%` : `${v.toFixed(1)} ${unit}`
/** "▼ 0.4 pts" · "▲ 1.2 kg": a change in a series' own unit (points for a
 * percentage, since a change in percent of a percent misleads). */
export function fmtChange(d: number, unit: Series["unit"]) {
  const r = Math.round(d * 10) / 10
  return `${r > 0 ? "▲" : r < 0 ? "▼" : ""} ${Math.abs(r).toFixed(1)} ${unit === "%" ? "pts" : unit}`.trim()
}
/** Whether a change is the good kind for the goal: lean mass should hold or
 * grow; fat, body fat and waist should hold or fall (a gaining phase allows
 * a little). */
export function goodChange(
  m: C.BodyMetric,
  d: number,
  dir: FitnessSettings["goalDirection"],
) {
  if (m === "leanMass") return d >= -0.3
  return dir === "bulk" ? d <= 0.5 : d <= 0
}
const lastAvg = (trend: C.TrendPoint[]) =>
  [...trend].reverse().find((p) => p.avg !== undefined)?.avg
/** Body fat, lean mass and fat mass on the body page: each one's latest
 * reading with its change over 30 days, then a small chart per series on the
 * weight chart's time range. The kg series get charts of their own rather
 * than one shared axis: lean mass sits near 50 kg and fat mass near 13 kg, so
 * one axis would flatten both lines. */
export function BodyComposition({
  state,
  days,
  onLog,
}: {
  state: FitnessState
  days: number
  onLog: () => void
}) {
  const t = useTheme(),
    // No body fat yet: sample readings, dimmed, above the step that adds one.
    empty = !state.weighIns.some((w) => w.bodyFatPct !== undefined),
    s = empty ? { ...state, weighIns: sampleWeighIns() } : state,
    [shown, setShown] = useState<C.BodyMetric[]>(COMPOSITION.map((x) => x.key)),
    rows = COMPOSITION.map((x) => ({
      ...x,
      change: C.metricChange(s, x.key, 30),
      trend: C.metricTrend(s, x.key, days),
    })),
    charts = rows.filter((x) => shown.includes(x.key))
  const toggle = (k: C.BodyMetric) =>
    setShown((v) => (v.includes(k) ? v.filter((x) => x !== k) : [...v, k]))
  const body = (
    <>
      <Line style={{ marginTop: 10, gap: 8, alignItems: "flex-start" }}>
        {rows.map((x) => (
          <View key={x.key} style={{ flex: 1 }} testID={`comp-${x.key}`}>
            <Copy size={20} weight="semibold">
              {x.change ? fmtMeasure(x.change.latest, x.unit) : "–"}
            </Copy>
            <Copy size={12} muted>
              {x.label}
            </Copy>
            {x.change?.delta !== undefined && (
              <Copy
                size={12}
                style={{
                  color: goodChange(
                    x.key,
                    x.change.delta,
                    s.settings.goalDirection,
                  )
                    ? t.good
                    : t.bad,
                }}
              >
                {fmtChange(x.change.delta, x.unit)} / 30d
              </Copy>
            )}
          </View>
        ))}
      </Line>
      <Line style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
        {rows.map((x) => {
          const on = shown.includes(x.key)
          return (
            <Tap
              key={x.key}
              label={`${x.label} chart`}
              hint={on ? "Hides this chart" : "Shows this chart"}
              selected={on}
              onPress={() => toggle(x.key)}
              style={{
                minHeight: 32,
                paddingHorizontal: 12,
                borderRadius: 16,
                justifyContent: "center",
                borderWidth: 1,
                borderColor: on ? t.fit : t.line,
                backgroundColor: on ? `${t.fit}1f` : "transparent",
              }}
            >
              <Copy
                size={13}
                weight="medium"
                style={{ color: on ? t.fit : t.muted }}
              >
                {x.label}
              </Copy>
            </Tap>
          )
        })}
      </Line>
      {charts.map((x, i) => {
        const avg = lastAvg(x.trend)
        return (
          <View
            key={x.key}
            testID={`comp-chart-${x.key}`}
            style={{ marginTop: 12 }}
          >
            {/* The series is named beside its own line, so no legend. */}
            <Line style={{ justifyContent: "space-between" }}>
              <Copy size={13} weight="medium" style={{ color: t.fit }}>
                {x.label}
              </Copy>
              {avg !== undefined && (
                <Copy size={12} muted>
                  7-day avg {fmtMeasure(avg, x.unit)}
                </Copy>
              )}
            </Line>
            <View style={{ marginTop: 4 }}>
              <FitnessTrend
                height={96}
                label={`${x.label} trend`}
                line={x.trend.map((p) => p.avg)}
                dots={x.trend.map((p) => p.raw)}
                fmt={(n) => n.toFixed(1)}
                labels={
                  i === charts.length - 1 && x.trend[0]
                    ? [C.fmtDay(x.trend[0].day), "Today"]
                    : undefined
                }
              />
            </View>
          </View>
        )
      })}
    </>
  )
  return (
    <Frame style={{ padding: 16 }}>
      <Copy size={14} weight="medium">
        Body composition
      </Copy>
      {empty ? <Dimmed>{body}</Dimmed> : body}
      {empty && (
        <EmptyFoot
          testID="body-comp-empty"
          hint="Add body fat when you weigh in, from a smart scale or calipers. Lean and fat mass follow from it."
          action={{ label: "Add", onPress: onLog }}
        />
      )}
    </Frame>
  )
}
/** Waist on the body page: the latest measurement, its change over the
 * range, and the same daily-dots-and-7-day-average chart as weight. */
export function Waist({
  state,
  range,
  setRange,
  onLog,
}: {
  state: FitnessState
  range: string
  setRange: (r: string) => void
  onLog: () => void
}) {
  const t = useTheme(),
    empty = !state.weighIns.some((w) => w.waistCm !== undefined),
    s = empty ? { ...state, weighIns: sampleWeighIns() } : state,
    days = Number(range),
    trend = C.metricTrend(s, "waist", days),
    change = C.metricChange(s, "waist", days),
    avg = lastAvg(trend)
  const body = (
    <>
      <Line
        style={{
          marginTop: 10,
          justifyContent: "space-between",
          alignItems: "flex-end",
        }}
      >
        <View testID="waist-latest">
          <Copy size={30} weight="displayMedium">
            {change ? fmtMeasure(change.latest, "cm") : "–"}
          </Copy>
          <Copy size={12} muted>
            Latest
          </Copy>
        </View>
        {change?.delta !== undefined && (
          <View testID="waist-change" style={{ alignItems: "flex-end" }}>
            <Copy
              size={14}
              weight="semibold"
              style={{
                color: goodChange(
                  "waist",
                  change.delta,
                  s.settings.goalDirection,
                )
                  ? t.good
                  : t.bad,
              }}
            >
              {fmtChange(change.delta, "cm")}
            </Copy>
            <Copy size={12} muted>
              over {RANGE_WORDS[range] ?? `${days} days`}
            </Copy>
          </View>
        )}
      </Line>
      <View style={{ marginTop: 12 }}>
        {avg !== undefined && (
          <Copy size={12} style={{ textAlign: "right", color: t.fit }}>
            7-day avg {fmtMeasure(avg, "cm")}
          </Copy>
        )}
        <FitnessTrend
          height={120}
          label="Waist trend"
          line={trend.map((p) => p.avg)}
          dots={trend.map((p) => p.raw)}
          fmt={(n) => n.toFixed(1)}
          labels={trend[0] ? [C.fmtDay(trend[0].day), "Today"] : undefined}
        />
      </View>
      <View style={{ marginTop: 12 }}>
        <Segmented
          value={range}
          onChange={setRange}
          options={[
            { value: "28", label: "4w" },
            { value: "84", label: "12w" },
            { value: "90", label: "All" },
          ]}
        />
      </View>
    </>
  )
  return (
    <View testID="waist-section">
      <Frame style={{ padding: 16 }}>
        <Line style={{ gap: 8 }}>
          <Ruler size={16} color={t.fit} />
          <Copy size={14} weight="medium">
            Waist
          </Copy>
        </Line>
        {empty ? <Dimmed>{body}</Dimmed> : body}
        {empty && (
          <EmptyFoot
            testID="waist-empty"
            hint="Add your waist when you weigh in: measure around the navel, relaxed, same time each week."
            action={{ label: "Add", onPress: onLog }}
          />
        )}
      </Frame>
    </View>
  )
}
