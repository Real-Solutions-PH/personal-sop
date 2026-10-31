import * as A from "@domain/fitness/actions"
import * as C from "@domain/fitness/calc"
import type { Exercise, WorkoutSet } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { fmtDuration } from "@domain/lib/day"
import { liveStore } from "@domain/lib/live"
import { router, useLocalSearchParams } from "expo-router"
import {
  ArrowDown,
  ArrowUp,
  Check,
  ClockArrowDown,
  ClockArrowUp,
  Dumbbell,
  Ellipsis,
  Flag,
  History,
  Minus,
  NotebookPen,
  Plus,
  Replace,
  SkipForward,
  Timer,
  Trash2,
  TrendingUp,
} from "lucide-react-native"
import { useEffect, useState } from "react"
import { TextInput, View } from "react-native"
import Animated from "react-native-reanimated"
import { toast } from "sonner-native"
import { LiveNotice } from "@/surfaces/live-notice"
import { rowEnter, rowExit } from "../motion"
import {
  Bar,
  border,
  Copy,
  Countdown,
  Frame,
  IconTap,
  Line,
  Segmented,
  Tap,
  ToolButton,
} from "../native-kit"
import { go, replace } from "../navigation"
import { fonts, useTheme } from "../theme"
import {
  Button,
  confirm,
  Empty,
  Field,
  Screen,
  Sheet,
  SwipeRow,
  undo,
  useNow,
} from "../ui"
import { displayMass } from "../units"
import { CreateExerciseRow, ExerciseEditor } from "./fitness"
import { StartWorkoutSheet } from "./fitness-start"

/** The rest countdown, pinned under the header so it never scrolls away.
 * ``rest`` is the seconds left (negative once rest is over). */
function RestBar({
  rest,
  durationSec,
  defaultSec,
}: {
  rest: number
  durationSec: number
  defaultSec: number
}) {
  const t = useTheme(),
    over = rest <= 0
  return (
    <Animated.View entering={rowEnter} exiting={rowExit}>
      <Frame
        style={{
          padding: 10,
          borderColor: over ? `${t.good}66` : `${t.fit}66`,
          backgroundColor: over ? `${t.good}26` : t.card,
        }}
      >
        <Line>
          <Timer size={20} color={over ? t.good : t.fit} />
          {/* The readout keeps its width; the buttons give way. */}
          <View style={{ flex: 1, minWidth: 96 }}>
            <Countdown size={22} style={{ textAlign: "left" }}>
              {over ? `+${fmtDuration(-rest)}` : fmtDuration(rest)}
            </Countdown>
            <Line style={{ gap: 8, flexWrap: "wrap" }}>
              <Copy size={12} muted style={{ flexShrink: 1 }}>
                {over ? "Rest over — next set" : `Rest · ${durationSec}s`}
              </Copy>
              {!over && durationSec !== defaultSec && (
                <Tap
                  onPress={() => {
                    A.updateSettings({ restSec: durationSec })
                    toast.success(`Default rest set to ${durationSec}s`)
                  }}
                  style={{ marginLeft: "auto" }}
                >
                  <Copy size={12} style={{ color: t.fit }}>
                    Make {durationSec}s my default
                  </Copy>
                </Tap>
              )}
            </Line>
          </View>
          {!over && (
            <>
              <ToolButton
                icon={ClockArrowDown}
                label="−15"
                name="Rest 15 seconds less"
                max={56}
                onPress={() => A.adjustRest(-15)}
              />
              <ToolButton
                icon={ClockArrowUp}
                label="+15"
                name="Rest 15 seconds more"
                max={56}
                onPress={() => A.adjustRest(15)}
              />
            </>
          )}
          <ToolButton
            icon={over ? Check : SkipForward}
            label={over ? "OK" : "Skip"}
            name={over ? "Dismiss rest timer" : "Skip rest"}
            max={56}
            onPress={A.skipRest}
          />
        </Line>
        {!over && (
          <View style={{ marginTop: 8 }}>
            <Bar value={rest / Math.max(1, durationSec)} color={t.fit} />
          </View>
        )}
      </Frame>
    </Animated.View>
  )
}

export function WorkoutLogger() {
  const p = useLocalSearchParams<{
      edit?: string
      resume?: string
      /** "1": just started empty, so open on the exercise picker. */
      add?: string
    }>(),
    s = fitStore.use((s) => s),
    t = useTheme(),
    now = useNow(),
    w = s.workouts.find((w) =>
      p.edit
        ? w.id === p.edit
        : w.id === s.activeId && w.status === "in_progress",
    ),
    [picker, setPicker] = useState<null | string>(null),
    // A new exercise made from the picker: its name, and what the picker
    // was for ("add", or the workout exercise it replaces).
    [creating, setCreating] = useState<{ name: string; mode: string } | null>(
      null,
    ),
    // "Create" in the picker: held until the picker is gone, then opened
    // (iOS will not present the editor while the picker is still leaving).
    [handoff, setHandoff] = useState<{ name: string; mode: string } | null>(
      null,
    ),
    [query, setQuery] = useState(""),
    [picked, setPicked] = useState<string[]>([]),
    [editing, setEditing] = useState<{ we: string; set: string } | null>(null),
    [menu, setMenu] = useState<string | null>(null),
    [note, setNote] = useState<string | null>(null),
    [finish, setFinish] = useState(false),
    [start, setStart] = useState(false),
    [rename, setRename] = useState(false),
    [nameDraft, setNameDraft] = useState<string | null>(null),
    [resume, setResume] = useState(
      () =>
        !!w &&
        !p.edit &&
        (p.resume === "1" ||
          Date.now() - new Date(A.lastActivity(w)).getTime() > 3 * 3600000),
    )
  const openPicker = (id = "add") => {
    setPicked([])
    setQuery("")
    setPicker(id)
  }
  const emptyStart = p.add === "1" && !!w && !w.exercises.length
  // Runs when the param arrives only: the picker opens once, not again
  // after the person closes it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (p.add !== "1") return
    router.setParams({ add: undefined })
    if (emptyStart) openPicker()
  }, [p.add])

  if (!w)
    return (
      <Screen title="Workout">
        <Empty
          icon={Dumbbell}
          title="No workout running"
          detail="Start from a template, repeat your last session, or go empty."
          action={<Button onPress={() => setStart(true)}>Start workout</Button>}
        />
        {liveStore.get().live && (
          <Button tone="quiet" href={liveStore.get().live!.href}>
            Return to running activity
          </Button>
        )}
        {start && (
          <StartWorkoutSheet
            onClose={() => setStart(false)}
            onStarted={(empty) => empty && openPicker()}
          />
        )}
      </Screen>
    )
  // Each set shows its weight in its own unit (stored in kg either way);
  // a set with none follows the settings unit.
  const mass = (x: WorkoutSet) => {
    const u = x.unit ?? s.settings.units
    return `${C.kgShort(displayMass(x.weight, u))} ${u}`
  }
  const totals = C.workoutTotals(s, w),
    unfinished = w.exercises.flatMap((e) =>
      e.sets.filter((x) => !C.isDone(x)),
    ).length,
    rest = s.rest ? (new Date(s.rest.endsAt).getTime() - now) / 1000 : 0,
    we = w.exercises.find((x) => x.id === menu),
    target = editing
      ? w.exercises
          .find((x) => x.id === editing.we)
          ?.sets.find((x) => x.id === editing.set)
      : undefined
  const finishWorkout = (mode: "remove" | "done", endAt?: string) => {
    if (A.finishWorkout(w.id, { unfinished: mode, endAt })) {
      setFinish(false)
      setResume(false)
      // The celebration summary, which leads with Share, Post and Done.
      replace(`/fitness/workouts/${w.id}/summary`)
    }
  }
  const discard = () =>
    confirm(
      "Discard this workout?",
      "Nothing from this session will be saved.",
      () => {
        A.discardWorkout(w.id)
        replace("/fitness")
      },
    )
  const deleteSet = (weId: string, setId: string) => {
    const removed = A.removeSet(w.id, weId, setId)
    if (removed) undo("Set deleted", () => A.restoreSet(w.id, weId, removed))
  }
  /** "Create" named an exercise the catalog already has: use that one. */
  const pickExisting = (e: Exercise) => {
    if (picker === "add")
      A.addExercises(w.id, [...picked.filter((x) => x !== e.id), e.id])
    else if (picker) A.replaceExercise(w.id, picker, e.id)
    setPicker(null)
    toast.success(`${e.name} is already an exercise — added it`)
  }
  return (
    <Screen
      title={p.edit ? `Edit · ${w.name}` : w.name}
      onTitlePress={() => setRename(!rename)}
      actions={
        <ToolButton
          tone="primary"
          icon={p.edit ? Check : Flag}
          label={p.edit ? "Done" : "Finish"}
          name={p.edit ? "Done editing" : "Finish workout"}
          max={96}
          onPress={() => {
            if (p.edit) {
              toast.success("Workout updated — PRs recomputed")
              replace(`/fitness/workouts/${w.id}`)
            } else if (unfinished) setFinish(true)
            else finishWorkout("remove")
          }}
        />
      }
      pinned={
        !p.edit && s.rest ? (
          <RestBar
            rest={rest}
            durationSec={s.rest.durationSec}
            defaultSec={s.settings.restSec}
          />
        ) : null
      }
    >
      <LiveNotice active={!p.edit} accent="fit" inset={false} />
      {rename && (
        <Field
          label="Workout name"
          value={nameDraft ?? w.name}
          onChangeText={(name) => {
            // A blank name is never stored: live sync would push it, the
            // server refuses it, and the old name snaps back mid-typing.
            setNameDraft(name)
            if (name.trim()) A.updateWorkoutMeta(w.id, { name })
          }}
          onBlur={() => setNameDraft(null)}
        />
      )}
      {!p.edit && (
        <View
          style={{ padding: 12, borderRadius: 16, backgroundColor: t.card }}
        >
          <Line style={{ gap: 8 }}>
            {[
              {
                label: "Elapsed",
                value: fmtDuration(
                  (now - new Date(w.startedAt).getTime()) / 1000,
                ),
              },
              { label: "Sets", value: `${totals.done}/${totals.planned}` },
              { label: "Volume", value: C.fmtVolume(totals.volume) },
            ].map((v, i) => (
              <View key={v.label} style={{ flex: 1, alignItems: "center" }}>
                <Copy
                  size={20}
                  weight="semibold"
                  style={{ color: i === 0 ? t.fit : t.text }}
                >
                  {v.value}
                </Copy>
                <Copy size={11} muted>
                  {v.label}
                </Copy>
              </View>
            ))}
          </Line>
        </View>
      )}
      {!w.exercises.length && (
        <Empty
          title="No exercises yet"
          detail="Add your first exercise — recents are on top."
          action={
            <Button icon={Plus} onPress={() => openPicker()}>
              Add exercises
            </Button>
          }
        />
      )}
      {w.exercises.map((we) => {
        const ex = s.exercises.find((e) => e.id === we.exerciseId),
          other = { ...s, workouts: s.workouts.filter((x) => x.id !== w.id) },
          prev = C.exerciseHistory(other, we.exerciseId).at(-1),
          timed = C.isTimed(ex),
          // A timed exercise's goal comes from the workout's template.
          goalSec = timed
            ? s.templates
                .find((x) => x.id === w.templateId)
                ?.items.find((it) => it.exerciseId === we.exerciseId)?.targetSec
            : undefined,
          doneSec = timed
            ? we.sets.filter(C.isDone).reduce((a, x) => a + C.setSeconds(x), 0)
            : 0,
          suggestion = C.suggestion(other, we.exerciseId, goalSec),
          prevWorking = prev?.we.sets.filter(C.isWorking) ?? [],
          prevWarm = prev?.we.sets.filter((x) => !C.isWorking(x)) ?? [],
          allDone =
            we.sets.some((x) => C.isWorking(x) && C.isDone(x)) &&
            we.sets.every(C.isDone)
        let working = 0,
          warm = 0
        return (
          <Frame
            key={we.id}
            style={{
              padding: 12,
              borderColor: allDone ? `${t.fit}66` : border(t.line, 0.6),
            }}
          >
            <Line style={{ alignItems: "flex-start", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Tap onPress={() => go(`/fitness/exercises/${we.exerciseId}`)}>
                  <Copy weight="semibold" lines={1}>
                    {ex?.name ?? "Unknown exercise"}
                  </Copy>
                </Tap>
                <Line style={{ marginTop: 2, gap: 6 }}>
                  <Line
                    style={{
                      gap: 3,
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      borderRadius: 99,
                      backgroundColor: `${t.fit}1a`,
                    }}
                  >
                    {suggestion.kind !== "new" && (
                      <TrendingUp size={12} color={t.fit} />
                    )}
                    <Copy size={11} style={{ color: t.fit }}>
                      {suggestion.kind === "new" ? "New" : suggestion.badge}
                    </Copy>
                  </Line>
                  <Copy size={12} muted lines={1} style={{ flex: 1 }}>
                    {suggestion.detail}
                  </Copy>
                </Line>
              </View>
              <IconTap
                icon={Ellipsis}
                label={`Options for ${ex?.name}`}
                onPress={() => setMenu(we.id)}
              />
            </Line>
            {(note === we.id || we.note) && (
              <TextInput
                accessibilityLabel="Exercise note"
                value={we.note ?? ""}
                onChangeText={(value) => A.setExerciseNote(w.id, we.id, value)}
                placeholder="Note (seat 4, grip width…)"
                placeholderTextColor={t.muted}
                style={{
                  marginTop: 8,
                  height: 36,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: t.line,
                  paddingHorizontal: 12,
                  fontFamily: fonts.body,
                  fontSize: 14,
                  color: t.text,
                }}
              />
            )}
            <Line style={{ marginTop: 12, paddingHorizontal: 4, gap: 8 }}>
              {[
                "Set",
                "Last",
                timed
                  ? ex?.track === "speed"
                    ? "km/h"
                    : ex?.track === "weight"
                      ? "+weight"
                      : ""
                  : ex?.loadType === "bodyweight"
                    ? "+weight"
                    : "weight",
                timed ? "time" : "reps",
                "",
              ].map((x, i) => (
                <Copy
                  key={`${i}-${x}`}
                  size={10}
                  muted
                  style={{
                    width: i === 0 ? 32 : i === 4 ? 44 : undefined,
                    flex: i > 0 && i < 4 ? 1 : undefined,
                    textAlign: i > 1 ? "center" : "left",
                    letterSpacing: 0.5,
                    textTransform: "uppercase",
                  }}
                >
                  {x}
                </Copy>
              ))}
            </Line>
            <View style={{ marginTop: 4, gap: 4 }}>
              {we.sets.map((set) => {
                const isWarm = !C.isWorking(set),
                  ghost = isWarm ? prevWarm[warm++] : prevWorking[working++],
                  label = isWarm
                    ? "W"
                    : set.kind === "drop"
                      ? "D"
                      : set.kind === "failure"
                        ? "F"
                        : String(working),
                  needsWeight =
                    !C.isDone(set) &&
                    set.weight === 0 &&
                    ex?.loadType === "weight"
                return (
                  <SwipeRow
                    key={set.id}
                    onDismiss={() => deleteSet(we.id, set.id)}
                    dismissLabel="Delete set"
                    background={t.card}
                  >
                    <Line
                      style={{
                        gap: 8,
                        paddingHorizontal: 4,
                        paddingVertical: 4,
                        borderRadius: 12,
                        backgroundColor: C.isDone(set)
                          ? `${t.fit}1a`
                          : "transparent",
                      }}
                    >
                      <Copy
                        size={14}
                        weight="semibold"
                        style={{
                          width: 32,
                          textAlign: "center",
                          color: isWarm ? t.warn : t.muted,
                        }}
                      >
                        {label}
                      </Copy>
                      <Copy size={12} muted lines={1} style={{ flex: 1 }}>
                        {ghost
                          ? timed
                            ? C.fmtSpan(C.setSeconds(ghost))
                            : `${mass(ghost)}×${ghost.reps}`
                          : "—"}
                      </Copy>
                      {[
                        timed
                          ? ex?.track === "speed"
                            ? set.speedKmh
                              ? C.kgShort(set.speedKmh)
                              : "—"
                            : ex?.track === "weight"
                              ? mass(set)
                              : ""
                          : needsWeight
                            ? "—"
                            : mass(set),
                        timed ? C.fmtSpan(C.setSeconds(set)) : String(set.reps),
                      ].map((value, i) => (
                        <Tap
                          key={`${i}-${set.id}`}
                          label={`${ex?.name} set ${label} ${i ? (timed ? "time" : "reps") : timed ? (ex?.track ?? "detail") : "weight"}`}
                          onPress={() => setEditing({ we: we.id, set: set.id })}
                          style={{
                            flex: 1,
                            height: 40,
                            borderRadius: 8,
                            backgroundColor: border(t.soft, 0.6),
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Copy
                            weight="semibold"
                            style={{
                              color: !i && needsWeight ? t.muted : t.text,
                            }}
                          >
                            {value}
                          </Copy>
                        </Tap>
                      ))}
                      <View style={{ width: 44 }}>
                        <Tap
                          label={C.isDone(set) ? "Undo set" : "Complete set"}
                          onPress={() =>
                            needsWeight
                              ? setEditing({ we: we.id, set: set.id })
                              : A.toggleSet(w.id, we.id, set.id)
                          }
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 12,
                            borderWidth: 2,
                            borderColor: C.isDone(set) ? t.fit : t.line,
                            backgroundColor: C.isDone(set)
                              ? t.fit
                              : "transparent",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Check
                            size={20}
                            strokeWidth={3}
                            color={C.isDone(set) ? t.bg : t.muted}
                          />
                        </Tap>
                      </View>
                    </Line>
                  </SwipeRow>
                )
              })}
            </View>
            <Line style={{ marginTop: 8 }}>
              {/* Swipe-to-delete is hidden; this says it out loud. */}
              {we.sets.length > 0 && (
                <Tap
                  label={`Remove last set of ${ex?.name}`}
                  onPress={() => deleteSet(we.id, we.sets.at(-1)!.id)}
                  style={{
                    flex: 1,
                    height: 36,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Line style={{ gap: 4 }}>
                    <Minus size={16} color={t.muted} />
                    <Copy size={14} muted>
                      Remove set
                    </Copy>
                  </Line>
                </Tap>
              )}
              <Tap
                onPress={() => A.addSet(w.id, we.id)}
                style={{
                  flex: 1,
                  height: 36,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Line style={{ gap: 4 }}>
                  <Plus size={16} color={t.muted} />
                  <Copy size={14} muted>
                    Add set
                  </Copy>
                </Line>
              </Tap>
            </Line>
            {goalSec ? (
              <View style={{ gap: 6, marginTop: 4 }}>
                <Line style={{ justifyContent: "space-between" }}>
                  <Copy size={12} muted>
                    Goal {C.fmtSpan(goalSec)}
                  </Copy>
                  <Copy
                    size={12}
                    weight="semibold"
                    style={{ color: doneSec >= goalSec ? t.good : t.text }}
                  >
                    {doneSec >= goalSec
                      ? "Goal reached"
                      : `${C.fmtSpan(doneSec)} of ${C.fmtSpan(goalSec)}`}
                  </Copy>
                </Line>
                <Bar value={Math.min(1, doneSec / goalSec)} color={t.fit} />
              </View>
            ) : null}
          </Frame>
        )
      })}
      <Button tone="quiet" icon={Plus} onPress={() => openPicker()}>
        Add exercise
      </Button>
      {!p.edit && (
        <Tap
          onPress={discard}
          style={{ paddingVertical: 12, alignItems: "center" }}
        >
          <Copy size={14} style={{ color: t.bad }}>
            Discard workout
          </Copy>
        </Tap>
      )}
      <Sheet
        title={picker === "add" ? "Add exercises" : "Replace exercise"}
        open={picker !== null}
        onClose={() => setPicker(null)}
        onClosed={() => {
          if (!handoff) return
          setCreating(handoff)
          setHandoff(null)
        }}
      >
        <Field label="Search exercises" value={query} onChangeText={setQuery} />
        {C.liveExercises(s)
          .filter((e) => !e.archived && C.exerciseMatches(e, query))
          .map((e) => (
            <Tap
              key={e.id}
              onPress={() => {
                if (picker !== "add") {
                  A.replaceExercise(w.id, picker!, e.id)
                  setPicker(null)
                } else
                  setPicked(
                    picked.includes(e.id)
                      ? picked.filter((x) => x !== e.id)
                      : [...picked, e.id],
                  )
              }}
              style={{ paddingVertical: 8 }}
            >
              <Line>
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: picked.includes(e.id) ? t.fit : t.line,
                    backgroundColor: picked.includes(e.id)
                      ? t.fit
                      : "transparent",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {picked.includes(e.id) && <Check size={16} color={t.bg} />}
                </View>
                <View>
                  <Copy weight="medium">{e.name}</Copy>
                  <Copy size={12} muted>
                    {e.muscle} · {e.equipment}
                  </Copy>
                </View>
              </Line>
            </Tap>
          ))}
        <CreateExerciseRow
          query={query}
          onExisting={pickExisting}
          onPress={(name) => {
            // The catalog is shared: a name it already has is that exercise.
            const hit = name ? C.exerciseNamed(fitStore.get(), name) : undefined
            if (hit) return pickExisting(hit)
            setHandoff({ name, mode: picker ?? "add" })
            setPicker(null)
          }}
        />
        {picker === "add" && (
          <Button
            disabled={!picked.length}
            onPress={() => {
              A.addExercises(w.id, picked)
              setPicker(null)
            }}
          >{`Add ${picked.length || ""} exercises`}</Button>
        )}
      </Sheet>
      <Sheet
        title="Exercise options"
        open={menu !== null}
        onClose={() => setMenu(null)}
      >
        {we && (
          <>
            <Button
              tone="quiet"
              icon={History}
              onPress={() => {
                go(`/fitness/exercises/${we.exerciseId}`)
                setMenu(null)
              }}
            >
              History
            </Button>
            <Button
              tone="quiet"
              icon={Replace}
              onPress={() => {
                openPicker(we.id)
                setMenu(null)
              }}
            >
              Replace
            </Button>
            <Button
              tone="quiet"
              icon={NotebookPen}
              onPress={() => {
                setNote(we.id)
                setMenu(null)
              }}
            >
              Note
            </Button>
            <Button
              tone="quiet"
              icon={ArrowUp}
              onPress={() => {
                A.moveExercise(w.id, we.id, -1)
                setMenu(null)
              }}
            >
              Move up
            </Button>
            <Button
              tone="quiet"
              icon={ArrowDown}
              onPress={() => {
                A.moveExercise(w.id, we.id, 1)
                setMenu(null)
              }}
            >
              Move down
            </Button>
            <Button
              tone="danger"
              icon={Trash2}
              onPress={() => {
                A.removeExercise(w.id, we.id)
                setMenu(null)
              }}
            >
              Remove
            </Button>
          </>
        )}
      </Sheet>
      {creating && (
        <ExerciseEditor
          key="new-exercise"
          open
          initialName={creating.name}
          onClose={() => setCreating(null)}
          onSaved={(e) => {
            if (creating.mode === "add") A.addExercises(w.id, [...picked, e.id])
            else A.replaceExercise(w.id, creating.mode, e.id)
            toast.success(`${e.name} added`)
          }}
        />
      )}
      {target && editing && (
        <SetEditor
          key={target.id}
          set={target}
          exercise={s.exercises.find(
            (e) =>
              e.id === w.exercises.find((x) => x.id === editing.we)?.exerciseId,
          )}
          open
          onClose={() => setEditing(null)}
          onSave={(patch) => A.updateSet(w.id, editing.we, editing.set, patch)}
          onDelete={() => deleteSet(editing.we, editing.set)}
        />
      )}
      <Sheet
        title={`${unfinished} set${unfinished === 1 ? "" : "s"} not done`}
        open={finish}
        onClose={() => setFinish(false)}
      >
        <Copy size={14} muted>
          Planned sets you never checked off.
        </Copy>
        <Button onPress={() => finishWorkout("remove")}>
          Remove them & finish
        </Button>
        <Button tone="quiet" onPress={() => finishWorkout("done")}>
          Mark all done & finish
        </Button>
        <Button tone="quiet" onPress={() => setFinish(false)}>
          Keep logging
        </Button>
      </Sheet>
      <Sheet
        title={`${w.name} is still running`}
        open={resume}
        onClose={() => setResume(false)}
      >
        <Copy size={14} muted>
          Started {C.relDay(w.startedAt).toLowerCase()} · last set{" "}
          {C.fmtMin(
            (Date.now() - new Date(A.lastActivity(w)).getTime()) / 1000,
          )}{" "}
          ago
        </Copy>
        <Button onPress={() => finishWorkout("remove", A.lastActivity(w))}>
          Finish at last set time
        </Button>
        <Button tone="quiet" onPress={() => setResume(false)}>
          Resume
        </Button>
        <Button tone="danger" onPress={discard}>
          Discard
        </Button>
      </Sheet>
    </Screen>
  )
}
export function SetEditor({
  set,
  exercise,
  open,
  onClose,
  onSave,
  onDelete,
}: {
  set: WorkoutSet
  /** A timed exercise edits minutes and seconds, and speed or added weight. */
  exercise?: Exercise
  open: boolean
  onClose: () => void
  onSave: (patch: Partial<WorkoutSet>) => void
  onDelete: () => void
}) {
  // Weight is entered in this set's own unit (the settings unit until it is
  // switched here) and always stored in kg.
  const fallback = fitStore.use((s) => s.settings.units)
  const [unit, setUnit] = useState(set.unit ?? fallback)
  const t = useTheme(),
    [weight, setWeight] = useState(
      String(unit === "lb" ? A.kgToLb(set.weight) : set.weight),
    ),
    [reps, setReps] = useState(String(set.reps)),
    [kind, setKind] = useState(set.kind),
    timed = C.isTimed(exercise),
    secs = C.setSeconds(set),
    [mins, setMins] = useState(String(Math.floor(secs / 60))),
    [rest, setRest] = useState(String(secs % 60)),
    [speed, setSpeed] = useState(set.speedKmh ? String(set.speedKmh) : "")
  // The stored weight as the editor shows it in a unit. While the field
  // still shows exactly that, the stored kg is kept: flipping kg/lb back and
  // forth never drifts it (20 kg → 44.1 lb → 20.003 kg).
  const shown = (u: "kg" | "lb") =>
    String(u === "lb" ? A.kgToLb(set.weight) : set.weight)
  const kg = (v: string) =>
    v === shown(unit)
      ? set.weight
      : unit === "lb"
        ? A.lbToKg(Number(v))
        : Number(v)
  const switchUnit = (next: "kg" | "lb") => {
    if (next === unit) return
    const n = Number(weight)
    if (weight === shown(unit)) setWeight(shown(next))
    else if (Number.isFinite(n))
      setWeight(String(next === "lb" ? A.kgToLb(n) : A.lbToKg(n)))
    setUnit(next)
  }
  return (
    <Sheet title="Edit set" open={open} onClose={onClose}>
      <Segmented
        value={kind}
        onChange={setKind}
        options={(["working", "warmup", "drop", "failure"] as const).map(
          (value) => ({
            value,
            label: {
              working: "Working",
              warmup: "Warm-up",
              drop: "Drop",
              failure: "Failure",
            }[value],
          }),
        )}
      />
      {(timed
        ? [
            { label: "Minutes", value: mins, set: setMins, step: 1 },
            { label: "Seconds", value: rest, set: setRest, step: 15 },
            ...(exercise?.track === "speed"
              ? [
                  {
                    label: "Speed (km/h)",
                    value: speed,
                    set: setSpeed,
                    step: 0.5,
                  },
                ]
              : []),
            ...(exercise?.track === "weight"
              ? [
                  {
                    label: `Weight (${unit})`,
                    value: weight,
                    set: setWeight,
                    step: unit === "lb" ? 5 : 2.5,
                  },
                ]
              : []),
          ]
        : [
            {
              label: `Weight (${unit})`,
              value: weight,
              set: setWeight,
              step: unit === "lb" ? 5 : 2.5,
            },
            { label: "Reps", value: reps, set: setReps, step: 1 },
          ]
      ).map((row) => (
        <View key={row.label} style={{ gap: 8 }}>
          <Copy size={14} muted>
            {row.label}
          </Copy>
          <Line style={{ justifyContent: "center", gap: 16 }}>
            <IconTap
              size={44}
              icon={Minus}
              background={t.soft}
              label={`Less ${row.label}`}
              onPress={() =>
                row.set(String(Math.max(0, Number(row.value) - row.step)))
              }
            />
            <TextInput
              accessibilityLabel={row.label}
              value={row.value}
              onChangeText={row.set}
              keyboardType="decimal-pad"
              style={{
                width: 100,
                height: 56,
                fontFamily: fonts.semibold,
                fontSize: 30,
                textAlign: "center",
                color: t.text,
              }}
            />
            <IconTap
              size={44}
              icon={Plus}
              background={t.soft}
              label={`More ${row.label}`}
              onPress={() => row.set(String(Number(row.value) + row.step))}
            />
          </Line>
          {row.label.startsWith("Weight") && (
            <View style={{ alignItems: "center", gap: 8 }}>
              <View style={{ width: 160 }}>
                <Segmented
                  value={unit}
                  onChange={switchUnit}
                  options={[
                    { value: "kg", label: "kg" },
                    { value: "lb", label: "lb" },
                  ]}
                />
              </View>
              {unit === "lb" && Number.isFinite(Number(weight)) && (
                <Copy size={12} muted>
                  = {C.kgShort(Math.round(kg(weight) * 10) / 10)} kg, saved in
                  kg
                </Copy>
              )}
            </View>
          )}
        </View>
      ))}
      <Button
        onPress={() => {
          if (timed) {
            const m = Number(mins || 0),
              sec = Number(rest || 0),
              total = Math.round(m * 60 + sec),
              kmh = speed === "" ? undefined : Number(speed)
            if (
              !Number.isFinite(total) ||
              total <= 0 ||
              total > 86400 ||
              sec >= 60 ||
              (kmh !== undefined && !(kmh >= 0 && kmh <= 60)) ||
              !Number.isFinite(Number(weight))
            ) {
              toast.error("Enter a time, and seconds under 60")
              return
            }
            onSave({
              kind,
              reps: 0,
              durationSec: total,
              weight: exercise?.track === "weight" ? kg(weight) : set.weight,
              ...(exercise?.track === "weight" ? { unit } : {}),
              ...(exercise?.track === "speed" ? { speedKmh: kmh } : {}),
            })
            onClose()
            return
          }
          if (
            !Number.isFinite(Number(weight)) ||
            Number(weight) < 0 ||
            !Number.isInteger(Number(reps)) ||
            Number(reps) < 0
          ) {
            toast.error("Enter valid weight and reps")
            return
          }
          onSave({ weight: kg(weight), reps: Number(reps), kind, unit })
          onClose()
        }}
      >
        Save
      </Button>
      <Button
        tone="danger"
        onPress={() => {
          onDelete()
          onClose()
        }}
      >
        Delete set
      </Button>
    </Sheet>
  )
}
