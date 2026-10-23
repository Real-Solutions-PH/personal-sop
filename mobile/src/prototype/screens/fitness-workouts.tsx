import * as A from "@domain/fitness/actions"
import * as C from "@domain/fitness/calc"
import type { Workout } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
import {
  ChevronRight,
  Dumbbell,
  Ellipsis,
  Repeat,
  Search,
  Share2,
  Trophy,
} from "lucide-react-native"
import { useState } from "react"
import { ScrollView, TextInput, View } from "react-native"
import { toast } from "sonner-native"
import { Copy, Frame, IconTap, Line, SectionHeading, Tap } from "../native-kit"
import { go, replace } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Button, confirm, Empty, Screen, Sheet, undo } from "../ui"
export function Workouts() {
  const s = fitStore.use((s) => s),
    t = useTheme(),
    [q, setQ] = useState(""),
    [template, setTemplate] = useState<string | null>(null),
    prMap = C.prsByWorkout(C.allPrs(s)),
    rows = C.finished(s)
      .reverse()
      .filter((w) => !template || w.templateId === template)
      .filter(
        (w) =>
          !q.trim() ||
          w.name.toLowerCase().includes(q.trim().toLowerCase()) ||
          w.exercises.some((e) =>
            s.exercises
              .find((x) => x.id === e.exerciseId)
              ?.name.toLowerCase()
              .includes(q.trim().toLowerCase()),
          ),
      )
  return (
    <Screen title="Workouts">
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
          accessibilityLabel="Search by name or exercise"
          value={q}
          onChangeText={setQ}
          placeholder="Search by name or exercise"
          placeholderTextColor={t.muted}
          style={{
            flex: 1,
            fontFamily: fonts.body,
            fontSize: 14,
            color: t.text,
          }}
        />
      </Line>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -16 }}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
      >
        {[{ id: null, name: "All" }, ...s.templates].map((tpl) => (
          <Tap
            key={tpl.id ?? "all"}
            onPress={() => setTemplate(tpl.id)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 99,
              borderWidth: 1,
              borderColor: template === tpl.id ? t.fit : t.line,
              backgroundColor: template === tpl.id ? t.fit : t.card,
            }}
          >
            <Copy
              size={14}
              weight="medium"
              style={{ color: template === tpl.id ? t.bg : t.text }}
            >
              {tpl.name}
            </Copy>
          </Tap>
        ))}
      </ScrollView>
      {!rows.length ? (
        <Empty
          title={
            q || template
              ? "No matching workouts"
              : "No workouts yet — start one"
          }
          detail={
            q || template
              ? "Try another name or clear the filter."
              : "Your sessions, volume and PRs will land here."
          }
        />
      ) : (
        <View>
          {rows.map((w, i) => {
            const totals = C.workoutTotals(s, w),
              prs = prMap.get(w.id)?.length ?? 0,
              wk = C.weekStart(dayKey(new Date(w.startedAt))),
              newWeek =
                i === 0 ||
                C.weekStart(dayKey(new Date(rows[i - 1].startedAt))) !== wk
            return (
              <View key={w.id}>
                {newWeek && (
                  <SectionHeading>
                    Week of{" "}
                    {new Date(`${wk}T12:00:00`).toLocaleDateString("en-PH", {
                      month: "short",
                      day: "numeric",
                    })}
                  </SectionHeading>
                )}
                <Tap
                  onPress={() => go(`/fitness/workouts/${w.id}`)}
                  style={{ paddingHorizontal: 4, paddingVertical: 12 }}
                >
                  <Line>
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 12,
                        backgroundColor: `${t.fit}26`,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Dumbbell size={20} color={t.fit} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Copy weight="medium">{w.name}</Copy>
                      <Copy size={14} muted>
                        {C.relDay(w.startedAt)} · {C.fmtMin(totals.durationSec)}{" "}
                        · {C.fmtVolume(totals.volume)}
                      </Copy>
                    </View>
                    {!!prs && (
                      <Line
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          borderRadius: 99,
                          gap: 4,
                          backgroundColor: `${t.warn}1a`,
                        }}
                      >
                        <Trophy size={12} color={t.warn} />
                        <Copy size={11} style={{ color: t.warn }}>
                          {prs}
                        </Copy>
                      </Line>
                    )}
                    <ChevronRight size={16} color={t.muted} />
                  </Line>
                </Tap>
              </View>
            )
          })}
        </View>
      )}
    </Screen>
  )
}
function Sets({ workout }: { workout: Workout }) {
  const s = fitStore.use((s) => s),
    t = useTheme()
  return (
    <View style={{ gap: 12 }}>
      {workout.exercises.map((we) => {
        const ex = s.exercises.find((e) => e.id === we.exerciseId),
          stats = C.exStats(we, ex, C.latestBodyweight(s) ?? 0)
        let n = 0
        return (
          <Tap
            key={we.id}
            onPress={() => go(`/fitness/exercises/${we.exerciseId}`)}
          >
            <Frame style={{ padding: 16 }}>
              <Line style={{ justifyContent: "space-between", gap: 8 }}>
                <Copy weight="semibold" style={{ flex: 1 }}>
                  {ex?.name}
                </Copy>
                <Copy size={12} muted>
                  {stats.bestE1rm
                    ? `Est. 1-rep max ${C.kgShort(Math.round(stats.bestE1rm * 10) / 10)}`
                    : ""}
                </Copy>
              </Line>
              {we.note && (
                <Copy size={12} muted style={{ marginTop: 4 }}>
                  “{we.note}”
                </Copy>
              )}
              <Line style={{ marginTop: 8, gap: 6, flexWrap: "wrap" }}>
                {we.sets.map((x) => (
                  <Copy
                    key={x.id}
                    size={12}
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 8,
                      backgroundColor: C.isWorking(x) ? t.soft : `${t.warn}1a`,
                      color: C.isWorking(x) ? t.text : t.warn,
                    }}
                  >
                    {C.isWorking(x) ? `${++n}.` : "W"} {C.kgShort(x.weight)}×
                    {x.reps}
                  </Copy>
                ))}
              </Line>
            </Frame>
          </Tap>
        )
      })}
    </View>
  )
}
function Records({ prs }: { prs: C.Pr[] }) {
  const s = fitStore.use((s) => s),
    t = useTheme()
  return (
    <View style={{ gap: 8 }}>
      {prs.map((p) => (
        <Tap
          key={`${p.exerciseId}-${p.kind}`}
          onPress={() => go(`/fitness/exercises/${p.exerciseId}`)}
          style={{
            padding: 12,
            borderRadius: 12,
            backgroundColor: `${t.warn}1a`,
          }}
        >
          <Line>
            <Trophy size={20} color={t.warn} />
            <View style={{ flex: 1 }}>
              <Copy weight="medium" lines={1}>
                {s.exercises.find((e) => e.id === p.exerciseId)?.name}
              </Copy>
              <Copy size={12} muted>
                {C.prLabel[p.kind]} PR
              </Copy>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Copy weight="semibold">
                {p.kind === "volume"
                  ? C.fmtVolume(p.value)
                  : C.kg(Math.round(p.value * 10) / 10)}
              </Copy>
              <Copy size={12} style={{ color: t.good }}>
                +
                {p.kind === "volume"
                  ? C.fmtVolume(p.value - p.prev)
                  : C.kg(Math.round((p.value - p.prev) * 10) / 10)}
              </Copy>
            </View>
          </Line>
        </Tap>
      ))}
    </View>
  )
}
export function WorkoutDetail({
  id,
  summary = false,
}: {
  id: string
  summary?: boolean
}) {
  const s = fitStore.use((s) => s),
    t = useTheme(),
    w = s.workouts.find((w) => w.id === id),
    [menu, setMenu] = useState(false),
    [name, setName] = useState(w?.name ?? ""),
    [notes, setNotes] = useState(w?.notes ?? "")
  if (!w)
    return (
      <Screen title={summary ? "Summary" : "Workout"}>
        <Empty title="Workout not found" detail="It may have been deleted." />
      </Screen>
    )
  const totals = C.workoutTotals(s, w),
    prs = C.allPrs(s).filter((p) => p.workoutId === id),
    prev = C.finished(s)
      .filter(
        (x) => x.id !== id && x.name === w.name && x.startedAt < w.startedAt,
      )
      .at(-1),
    prevVol = prev ? C.workoutTotals(s, prev).volume : undefined,
    delta = prevVol
      ? Math.round(((totals.volume - prevVol) / prevVol) * 100)
      : undefined,
    week = C.sessionsByWeek(s, 1)[0]?.count ?? 0,
    stalled = w.exercises
      .filter((e) => C.isStalled(C.exerciseHistory(s, e.exerciseId)))
      .map((e) => s.exercises.find((x) => x.id === e.exerciseId)?.name)
  const repeat = () => {
    const result = A.startWorkout({ from: "repeat", workoutId: id })
    if (result.ok) go("/fitness/workout")
    else toast.error(result.reason)
  }
  const remove = () =>
    confirm(
      "Delete this workout?",
      prs.length
        ? `It holds ${prs.length} PR${prs.length > 1 ? "s" : ""} — they’ll be recomputed.`
        : "You can undo right after.",
      () => {
        const del = A.deleteWorkout(id)
        replace("/fitness/workouts")
        if (del) undo(`${del.name} deleted`, () => A.restoreWorkout(del))
      },
    )
  const heading = (title: string) => (
    <View style={{ marginTop: -12, marginBottom: -12 }}>
      <SectionHeading>{title}</SectionHeading>
    </View>
  )
  const stats = (
    <Line style={{ gap: 12 }}>
      {[
        { label: "Duration", value: C.fmtMin(totals.durationSec) },
        {
          label: summary ? "Sets" : "Volume",
          value: summary
            ? `${totals.done}/${totals.planned}`
            : C.fmtVolume(totals.volume),
        },
        {
          label: summary ? "Volume" : "Sets",
          value: summary ? C.fmtVolume(totals.volume) : String(totals.done),
        },
      ].map((x) => (
        <View key={x.label} style={{ flex: 1 }}>
          <Copy size={30} weight="displayMedium">
            {x.value}
          </Copy>
          <Copy size={12} muted>
            {x.label}
            {summary && x.label === "Volume" && delta !== undefined && (
              <Copy size={12} style={{ color: delta >= 0 ? t.good : t.muted }}>
                {" "}
                {delta >= 0 ? "▲" : "▼"}
                {Math.abs(delta)}% vs last
              </Copy>
            )}
          </Copy>
        </View>
      ))}
    </Line>
  )
  return (
    <Screen
      title={summary ? "Workout complete" : w.name}
      actions={
        !summary ? (
          <IconTap
            size={40}
            icon={Ellipsis}
            label="Workout options"
            onPress={() => setMenu(true)}
          />
        ) : undefined
      }
    >
      {summary ? (
        <View style={{ padding: 20, borderRadius: 24 }}>
          <TextInput
            accessibilityLabel="Workout name"
            value={name}
            onChangeText={setName}
            onBlur={() =>
              A.updateWorkoutMeta(id, { name: name.trim() || w.name })
            }
            style={{ fontFamily: fonts.semibold, fontSize: 24, color: t.text }}
          />
          <Copy size={14} muted>
            {C.relDay(w.startedAt)} · session {week}/{s.settings.weeklyTarget}{" "}
            this week
          </Copy>
          <View style={{ marginTop: 16 }}>{stats}</View>
        </View>
      ) : (
        <>
          <Copy size={14} muted>
            {new Date(w.startedAt).toLocaleString("en-PH", {
              weekday: "long",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
            {w.source === "chat" ? " · logged from chat" : ""}
          </Copy>
          <Frame style={{ padding: 16 }}>{stats}</Frame>
        </>
      )}
      {(prs.length > 0 || summary) && (
        <>
          {heading(
            summary && prs.length
              ? `${prs.length} new PR${prs.length > 1 ? "s" : ""}`
              : "Personal records",
          )}
          {prs.length ? (
            <Records prs={prs} />
          ) : (
            <Frame style={{ padding: 16 }}>
              <Copy size={14} muted>
                No PRs this time — consistency is what makes the next one.
              </Copy>
            </Frame>
          )}
        </>
      )}
      {summary && stalled.length > 0 && (
        <>
          {heading("Stalled lifts")}
          <Frame style={{ padding: 16 }}>
            <Copy size={14}>
              <Copy size={14} weight="medium">
                {stalled.join(", ")}
              </Copy>{" "}
              — no strength gain in 3 weeks. Try 10% lighter for a week or a new
              rep range.
            </Copy>
          </Frame>
        </>
      )}
      {summary && (
        <>
          {heading("Notes")}
          <TextInput
            accessibilityLabel="Workout notes"
            value={notes}
            onChangeText={setNotes}
            onBlur={() => A.updateWorkoutMeta(id, { notes })}
            placeholder="How did it feel? (optional)"
            placeholderTextColor={t.muted}
            multiline
            style={{
              minHeight: 80,
              padding: 12,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: t.line,
              backgroundColor: t.card,
              fontFamily: fonts.body,
              fontSize: 14,
              color: t.text,
              textAlignVertical: "top",
            }}
          />
        </>
      )}
      {heading("Exercises")}
      <Sets workout={w} />
      {!summary && w.notes && (
        <>
          {heading("Notes")}
          <Frame style={{ padding: 16 }}>
            <Copy size={14}>{w.notes}</Copy>
          </Frame>
        </>
      )}
      <Line style={{ marginTop: 8, gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button
            tone="quiet"
            icon={Share2}
            onPress={() => go(`/fitness/share/${id}`)}
          >
            Share
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button
            icon={summary ? undefined : Repeat}
            onPress={
              summary
                ? () => {
                    A.updateWorkoutMeta(id, {
                      name: name.trim() || w.name,
                      notes,
                    })
                    toast.success("Workout saved")
                    go("/fitness")
                  }
                : repeat
            }
          >
            {summary ? "Save" : "Repeat"}
          </Button>
        </View>
      </Line>
      {summary && (
        <Tap
          onPress={() => {
            const del = A.deleteWorkout(id)
            replace("/fitness")
            if (del) undo("Workout discarded", () => A.restoreWorkout(del))
          }}
          style={{ padding: 12, alignItems: "center" }}
        >
          <Copy size={14} style={{ color: t.bad }}>
            Discard workout
          </Copy>
        </Tap>
      )}
      <Sheet title="Workout options" open={menu} onClose={() => setMenu(false)}>
        <Button
          tone="quiet"
          onPress={() => {
            setMenu(false)
            go(`/fitness/workout?edit=${id}`)
          }}
        >
          Edit
        </Button>
        <Button
          tone="quiet"
          onPress={() => {
            setMenu(false)
            repeat()
          }}
        >
          Repeat
        </Button>
        <Button
          tone="quiet"
          onPress={() => {
            const tpl = A.saveAsTemplate(id, w.name)
            setMenu(false)
            if (tpl) go(`/fitness/templates/${tpl.id}`)
          }}
        >
          Save as template
        </Button>
        <Button
          tone="quiet"
          onPress={() => {
            setMenu(false)
            go(`/fitness/share/${id}`)
          }}
        >
          Share
        </Button>
        <Button
          tone="danger"
          onPress={() => {
            setMenu(false)
            remove()
          }}
        >
          Delete
        </Button>
      </Sheet>
    </Screen>
  )
}
