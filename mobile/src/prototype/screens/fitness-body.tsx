import * as A from "@domain/fitness/actions"
import * as C from "@domain/fitness/calc"
import type { FitnessSettings, WeighIn } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
import { useLocalSearchParams } from "expo-router"
import type { LucideIcon } from "lucide-react-native"
import {
  ChevronRight,
  Minus,
  Percent,
  Plus,
  Scale,
  Settings,
  Target,
} from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { FitnessTrend, Sparkline } from "../chart"
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
import { useTheme } from "../theme"
import { Button, DateField, Field, Screen, Sheet, undo } from "../ui"
import { isDay } from "../validation"
import { LockedPreview } from "./locked-preview"
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
}: {
  entry?: WeighIn
  open: boolean
  onClose: () => void
}) {
  const s = fitStore.use((s) => s),
    [weight, setWeight] = useState(
      String(entry?.weightKg ?? C.latestBodyweight(s) ?? 75),
    ),
    [day, setDay] = useState(
      entry ? dayKey(new Date(entry.measuredAt)) : dayKey(),
    ),
    [fat, setFat] = useState(String(entry?.bodyFatPct ?? "")),
    [note, setNote] = useState(entry?.note ?? "")
  const save = () => {
    if (
      !isDay(day) ||
      !(Number(weight) > 0) ||
      !Number.isFinite(Number(weight)) ||
      (fat && (!(Number(fat) > 0) || Number(fat) > 100))
    ) {
      toast.error("Enter a valid weight, date and body-fat percentage")
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
        weightKg: Number(weight),
        measuredAt,
        note,
        bodyFatPct: fat ? Number(fat) : undefined,
      })
    else
      A.logWeighIn(
        Number(weight),
        measuredAt,
        note,
        fat ? Number(fat) : undefined,
      )
    onClose()
  }
  return (
    <Sheet
      title={entry ? "Edit weigh-in" : "Weigh in"}
      open={open}
      onClose={onClose}
    >
      <Field
        label="Weight (kg)"
        value={weight}
        onChangeText={setWeight}
        keyboardType="decimal-pad"
      />
      <DateField label="Date" value={day} onChangeText={setDay} />
      <Field
        label="Body fat % (optional)"
        value={fat}
        onChangeText={setFat}
        keyboardType="decimal-pad"
      />
      <Field label="Note (optional)" value={note} onChangeText={setNote} />
      <Button onPress={save}>{entry ? "Save changes" : "Log weigh-in"}</Button>
      {entry && (
        <Button
          tone="quiet"
          onPress={() => {
            const removed = A.deleteWeighIn(entry.id)
            if (removed)
              undo("Weigh-in deleted", () => A.restoreWeighIn(removed))
            onClose()
          }}
        >
          Delete weigh-in
        </Button>
      )}
    </Sheet>
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
export function Body({
  hub = false,
  embedded = false,
}: {
  hub?: boolean
  /** A section of the Fitness page instead of its own screen. */
  embedded?: boolean
}) {
  const s = fitStore.use((s) => s),
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
    today = C.dailyWeights(s).get(dayKey())
  const addWeigh = () => {
    setEntry(undefined)
    setAdd(true)
  }
  const content = (
    <>
      <LockedPreview
        locked={!sorted.length}
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
                    <Copy size={11} muted>
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
                    size={11}
                    style={{
                      color: t.fit,
                      backgroundColor: `${t.fit}1a`,
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
                            {C.fmtTime(w.measuredAt)}
                            {w.note ? ` · ${w.note}` : ""}
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
              <Copy size={13} weight="medium" style={{ color: t.fit }}>
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
    points = s.weighIns
      .filter((w) => w.bodyFatPct !== undefined)
      .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt)),
    last = points.at(-1),
    base = points.find(
      (p) => new Date(p.measuredAt).getTime() >= Date.now() - 30 * 86400000,
    )
  if (!last)
    return (
      <Frame style={{ padding: 16 }}>
        <Line>
          <Percent size={20} color={t.fit} />
          <View style={{ flex: 1 }}>
            <Copy size={14} weight="medium">
              Track body fat
            </Copy>
            <Copy size={12} muted>
              Add it when you weigh in — from a smart scale or calipers.
            </Copy>
          </View>
          <Button small tone="quiet" onPress={onLog}>
            Add
          </Button>
        </Line>
      </Frame>
    )
  const delta =
      base && base !== last
        ? Math.round((last.bodyFatPct! - base.bodyFatPct!) * 10) / 10
        : null,
    fat = (last.weightKg * last.bodyFatPct!) / 100,
    lean = last.weightKg - fat,
    oldFat = base ? (base.weightKg * base.bodyFatPct!) / 100 : undefined,
    oldLean = base && oldFat !== undefined ? base.weightKg - oldFat : undefined
  return (
    <Frame style={{ padding: 16 }}>
      <Line style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <View>
          <Copy size={30} weight="displayMedium" style={{ color: t.fit }}>
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
    </Frame>
  )
}
