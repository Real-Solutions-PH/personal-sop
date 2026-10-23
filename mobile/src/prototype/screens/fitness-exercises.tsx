import * as A from "@domain/fitness/actions"
import * as C from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import {
  Archive,
  ChevronRight,
  Dumbbell,
  Pencil,
  Plus,
  Search,
  Share2,
  TrendingUp,
  TriangleAlert,
  Trophy,
} from "lucide-react-native"
import { useState } from "react"
import { TextInput, View } from "react-native"
import { FitnessTrend } from "../chart"
import {
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
import { Button, Empty, Screen, undo } from "../ui"
import { CreateExerciseRow, ExerciseEditor } from "./fitness"

const MUSCLES = [
  "chest",
  "back",
  "shoulders",
  "biceps",
  "triceps",
  "quads",
  "hamstrings",
  "glutes",
  "core",
]
export function Exercises({ id }: { id?: string }) {
  const s = fitStore.use((s) => s),
    t = useTheme(),
    [query, setQuery] = useState(""),
    [archived, setArchived] = useState(false),
    [edit, setEdit] = useState(false),
    // A new exercise's name, from the search when it found nothing.
    [newName, setNewName] = useState(""),
    [range, setRange] = useState("12w"),
    [metric, setMetric] = useState("e1rm")
  const ex = s.exercises.find((e) => e.id === id),
    hist = ex ? C.exerciseHistory(s, ex.id) : [],
    from =
      range === "all"
        ? ""
        : dayOffset(-({ "4w": 28, "12w": 84, "1y": 365 }[range] ?? 84)),
    inRange = hist.filter((h) => dayKey(new Date(h.workout.startedAt)) >= from),
    prs = C.allPrs(s)
      .filter((p) => p.exerciseId === id)
      .reverse(),
    best = hist.reduce(
      (b, h) => (h.stats.bestE1rm > (b?.stats.bestE1rm ?? 0) ? h : b),
      hist[0],
    ),
    sug = ex ? C.suggestion(s, ex.id) : undefined,
    stalled = C.isStalled(hist),
    series = inRange.map((h) =>
      metric === "e1rm"
        ? h.stats.bestE1rm
        : metric === "top"
          ? h.stats.heaviest
          : h.stats.volume,
    ),
    first = series[0],
    last = series.at(-1),
    change = first && last ? last - first : undefined
  const pill = (label: string, color: string = t.muted) => (
    <View
      style={{
        backgroundColor: `${color}1a`,
        borderRadius: 99,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      <Copy size={11} weight="medium" style={{ color }}>
        {label}
      </Copy>
    </View>
  )
  const heading = (label: string) => (
    <View style={{ marginTop: -12, marginBottom: -12 }}>
      <SectionHeading>{label}</SectionHeading>
    </View>
  )
  return (
    <Screen
      title={ex?.name ?? (id ? "Exercise" : "Exercises")}
      actions={
        <IconTap
          size={40}
          icon={ex ? Pencil : Plus}
          label={ex ? "Edit exercise" : "New exercise"}
          color={t.text}
          onPress={() => setEdit(true)}
        />
      }
    >
      {id && !ex ? (
        <Empty title="Exercise not found" />
      ) : !ex ? (
        <>
          <Line
            style={{
              height: 36,
              borderWidth: 1,
              borderColor: t.line,
              borderRadius: 8,
              paddingHorizontal: 12,
              gap: 8,
            }}
          >
            <Search size={16} color={t.muted} />
            <TextInput
              accessibilityLabel="Search exercises"
              placeholder="Search exercises"
              placeholderTextColor={t.muted}
              value={query}
              onChangeText={setQuery}
              style={{
                flex: 1,
                fontFamily: fonts.body,
                fontSize: 14,
                color: t.text,
              }}
            />
          </Line>
          <CreateExerciseRow
            query={query}
            onPress={(name) => {
              setNewName(name)
              setEdit(true)
            }}
          />
          <Tap
            onPress={() => setArchived(!archived)}
            style={{
              alignSelf: "flex-start",
              borderRadius: 99,
              paddingHorizontal: 12,
              paddingVertical: 8,
              backgroundColor: archived ? t.fit : t.card,
              borderWidth: 1,
              borderColor: archived ? t.fit : t.line,
            }}
          >
            <Line style={{ gap: 6 }}>
              <Archive size={16} color={archived ? t.bg : t.text} />
              <Copy
                size={14}
                weight="medium"
                style={{ color: archived ? t.bg : t.text }}
              >
                Show archived
              </Copy>
            </Line>
          </Tap>
          {MUSCLES.map((m) => ({
            m,
            list: s.exercises
              .filter(
                (e) =>
                  (archived || !e.archived) &&
                  e.muscle === m &&
                  e.name.toLowerCase().includes(query.trim().toLowerCase()),
              )
              .sort((a, b) => a.name.localeCompare(b.name)),
          }))
            .filter((g) => g.list.length)
            .map((g) => (
              <View key={g.m} style={{ marginTop: -12 }}>
                <SectionHeading>{g.m}</SectionHeading>
                {g.list.map((e) => (
                  <Tap
                    key={e.id}
                    onPress={() => go(`/fitness/exercises/${e.id}`)}
                    style={{ paddingHorizontal: 4, paddingVertical: 12 }}
                  >
                    <Line>
                      <View
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 12,
                          backgroundColor: t.soft,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Dumbbell size={20} color={t.muted} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Copy weight="medium">{e.name}</Copy>
                        <Copy
                          size={14}
                          muted
                          style={{ textTransform: "capitalize" }}
                        >
                          {e.equipment} · {e.repMin}–{e.repMax} reps · +
                          {e.increment} kg
                        </Copy>
                      </View>
                      {e.archived && pill("Archived")}
                      <ChevronRight size={16} color={t.muted} />
                    </Line>
                  </Tap>
                ))}
              </View>
            ))}
          {!s.exercises.some(
            (e) =>
              (archived || !e.archived) &&
              e.name.toLowerCase().includes(query.trim().toLowerCase()),
          ) && (
            <Empty
              title={`No exercise matches “${query}”`}
              action={
                <Button
                  onPress={() => setEdit(true)}
                >{`Create “${query}”`}</Button>
              }
            />
          )}
        </>
      ) : (
        <>
          <Copy size={14} muted style={{ textTransform: "capitalize" }}>
            {ex.muscle} · {ex.equipment} · {ex.repMin}–{ex.repMax} reps · +
            {ex.increment} kg
          </Copy>
          {!hist.length ? (
            <Empty
              title="No sets logged yet"
              detail="Add it to a workout — your progress chart starts with the first set."
              action={
                <Button onPress={() => go("/fitness?start=1")}>
                  Start workout
                </Button>
              }
            />
          ) : (
            <>
              <Frame
                style={{
                  padding: 16,
                  backgroundColor: `${t.fit}1a`,
                  borderColor: `${t.fit}66`,
                  marginTop: 4,
                }}
              >
                <Line style={{ gap: 8 }}>
                  <TrendingUp size={16} color={t.fit} />
                  <Copy size={12} style={{ color: t.fit, letterSpacing: 0.6 }}>
                    NEXT SESSION · SUGGESTED
                  </Copy>
                </Line>
                <Line style={{ gap: 8, marginTop: 4 }}>
                  <Copy size={24} weight="semibold">
                    {C.kgShort(sug!.weight)} kg × {sug!.reps}
                  </Copy>
                  {pill(sug!.badge, t.fit)}
                </Line>
                <Copy size={14} muted style={{ marginTop: 4 }}>
                  {sug!.detail}
                </Copy>
              </Frame>
              {stalled && (
                <Frame
                  style={{
                    padding: 16,
                    backgroundColor: `${t.warn}1a`,
                    borderColor: `${t.warn}66`,
                  }}
                >
                  <Line style={{ alignItems: "flex-start" }}>
                    <TriangleAlert size={20} color={t.warn} />
                    <View style={{ flex: 1 }}>
                      <Copy size={14} weight="medium">
                        Stalled for 3 weeks
                      </Copy>
                      <Copy size={14} muted>
                        No strength gain since{" "}
                        {C.relDay(
                          hist
                            .filter(
                              (h) =>
                                dayKey(new Date(h.workout.startedAt)) <
                                dayOffset(-21),
                            )
                            .at(-1)?.workout.startedAt ?? "",
                        )}
                        . Go 10% lighter for a week, or switch to{" "}
                        {Math.max(3, ex.repMin - 2)}–{ex.repMin + 1} reps.
                      </Copy>
                    </View>
                  </Line>
                </Frame>
              )}
              <Frame style={{ padding: 16 }}>
                <Line>
                  {[
                    {
                      label: "Best est. 1-rep max",
                      value: C.kgShort(
                        Math.round((best?.stats.bestE1rm ?? 0) * 10) / 10,
                      ),
                      color: t.fit,
                    },
                    {
                      label: "Best set",
                      value: best?.stats.top
                        ? `${C.kgShort(best.stats.top.weight)}×${best.stats.top.reps}`
                        : "—",
                      color: t.text,
                    },
                    {
                      label: "Sessions",
                      value: String(hist.length),
                      color: t.text,
                    },
                  ].map((x) => (
                    <View key={x.label} style={{ flex: 1 }}>
                      <Copy
                        size={30}
                        weight="displayMedium"
                        style={{ color: x.color }}
                      >
                        {x.value}
                      </Copy>
                      <Copy size={12} muted>
                        {x.label}
                      </Copy>
                    </View>
                  ))}
                </Line>
              </Frame>
              <Frame style={{ padding: 16, gap: 12 }}>
                <Segmented
                  value={metric}
                  onChange={setMetric}
                  options={[
                    { value: "e1rm", label: "Est. max" },
                    { value: "top", label: "Top weight" },
                    { value: "volume", label: "Volume" },
                  ]}
                />
                <Line style={{ justifyContent: "space-between", gap: 8 }}>
                  <Copy size={20} weight="semibold">
                    {last === undefined
                      ? "—"
                      : metric === "volume"
                        ? C.fmtVolume(last)
                        : C.kg(Math.round(last * 10) / 10)}
                  </Copy>
                  {change !== undefined && (
                    <Copy
                      size={14}
                      style={{ color: change >= 0 ? t.good : t.muted }}
                    >
                      {change >= 0 ? "▲" : "▼"}{" "}
                      {metric === "volume"
                        ? C.fmtVolume(Math.abs(change))
                        : C.kg(Math.round(Math.abs(change) * 10) / 10)}{" "}
                      in range
                    </Copy>
                  )}
                </Line>
                <FitnessTrend
                  line={series}
                  dots={series}
                  height={150}
                  fmt={(n) =>
                    metric === "volume"
                      ? `${Math.round(n / 100) / 10}t`
                      : n.toFixed(0)
                  }
                  labels={
                    inRange.length
                      ? [
                          C.relDay(inRange[0].workout.startedAt),
                          C.relDay(inRange.at(-1)!.workout.startedAt),
                        ]
                      : undefined
                  }
                />
                <Segmented
                  value={range}
                  onChange={setRange}
                  options={[
                    { value: "4w", label: "4w" },
                    { value: "12w", label: "12w" },
                    { value: "1y", label: "1y" },
                    { value: "all", label: "All" },
                  ]}
                />
              </Frame>
              {heading("PR history")}
              <Frame>
                {prs.length ? (
                  prs.slice(0, 8).map((p, i) => (
                    <Line
                      key={`${p.workoutId}-${p.kind}`}
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        borderTopWidth: i ? 1 : 0,
                        borderColor: border(t.line, 0.6),
                      }}
                    >
                      <Trophy size={16} color={t.warn} />
                      <Copy size={14} style={{ flex: 1 }}>
                        {C.prLabel[p.kind]}{" "}
                        <Copy size={14} muted>
                          · {C.relDay(p.at)}
                        </Copy>
                      </Copy>
                      <Copy size={14} weight="semibold">
                        {p.kind === "volume"
                          ? C.fmtVolume(p.value)
                          : C.kg(Math.round(p.value * 10) / 10)}
                      </Copy>
                      <IconTap
                        size={24}
                        icon={Share2}
                        label="Share PR"
                        onPress={() =>
                          go(
                            `/fitness/share/${p.workoutId}?template=pr&exercise=${id}`,
                          )
                        }
                      />
                    </Line>
                  ))
                ) : (
                  <Copy size={14} muted style={{ padding: 16 }}>
                    No PRs yet — your first session set the starting point.
                  </Copy>
                )}
              </Frame>
              {heading("Last 5 sessions")}
              <Frame>
                {hist
                  .slice(-5)
                  .reverse()
                  .map((h, i) => (
                    <Tap
                      key={h.workout.id}
                      onPress={() => go(`/fitness/workouts/${h.workout.id}`)}
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        borderTopWidth: i ? 1 : 0,
                        borderColor: border(t.line, 0.6),
                      }}
                    >
                      <Line>
                        <Copy size={14} muted style={{ width: 80 }}>
                          {C.relDay(h.workout.startedAt)}
                        </Copy>
                        <Copy size={14} lines={1} style={{ flex: 1 }}>
                          {h.we.sets
                            .filter((x) => x.kind !== "warmup")
                            .map((x) => `${C.kgShort(x.weight)}×${x.reps}`)
                            .join("  ")}
                        </Copy>
                        <Copy size={12} muted>
                          {C.kgShort(Math.round(h.stats.bestE1rm))}
                        </Copy>
                      </Line>
                    </Tap>
                  ))}
              </Frame>
            </>
          )}
          <Tap
            onPress={() => {
              A.setExerciseArchived(ex.id, !ex.archived)
              undo(ex.archived ? "Unarchived" : "Archived — history kept", () =>
                A.setExerciseArchived(ex.id, !!ex.archived),
              )
            }}
            style={{ paddingVertical: 16, alignItems: "center" }}
          >
            <Line style={{ gap: 8 }}>
              <Archive size={16} color={t.muted} />
              <Copy size={14} muted>
                {ex.archived ? "Unarchive" : "Archive exercise"}
              </Copy>
            </Line>
          </Tap>
        </>
      )}
      {edit && (
        <ExerciseEditor
          key={ex?.id ?? "new"}
          exercise={ex}
          open={edit}
          initialName={ex ? undefined : newName}
          onClose={() => {
            setEdit(false)
            setNewName("")
          }}
          onSaved={(e) => {
            if (!ex) {
              setQuery("")
              go(`/fitness/exercises/${e.id}`)
            }
          }}
        />
      )}
    </Screen>
  )
}
