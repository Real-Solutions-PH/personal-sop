import * as A from "@domain/habits/actions"
import * as L from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey, dayOffset, fmtDuration } from "@domain/lib/day"
import { useLocalSearchParams } from "expo-router"
import {
  Archive,
  Check,
  ChevronRight,
  GripVertical,
  Minus,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  Share2,
  Trash2,
  X,
} from "lucide-react-native"
import { useRef, useState } from "react"
import { PanResponder, Pressable, View } from "react-native"
import {
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Button, confirm, Empty, Field, Screen, Sheet, undo } from "../ui"

function HabitIcon({ icon }: { icon: string }) {
  const t = useTheme()
  return (
    <View
      style={{
        width: 56,
        height: 56,
        borderRadius: 16,
        backgroundColor: `${t.hab}1f`,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Copy size={28}>{icon}</Copy>
    </View>
  )
}
function DragHandle({
  name,
  onMove,
}: {
  name: string
  onMove: (delta: number) => void
}) {
  const t = useTheme()
  const move = useRef(onMove)
  move.current = onMove
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderRelease: (_, g) => move.current(Math.round(g.dy / 56)),
    }),
  ).current
  return (
    <View
      {...responder.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Reorder ${name}`}
      accessibilityHint="Drag up or down to move this step"
      accessibilityActions={[
        { name: "increment", label: "Move down" },
        { name: "decrement", label: "Move up" },
      ]}
      onAccessibilityAction={(e) =>
        move.current(e.nativeEvent.actionName === "increment" ? 1 : -1)
      }
      style={{
        width: 40,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <GripVertical size={18} color={t.muted} />
    </View>
  )
}
export function RoutineDetail({ id }: { id: string }) {
  const t = useTheme(),
    s = habitsStore.use((s) => s),
    r = s.routines.find((r) => r.id === id),
    p = useLocalSearchParams<{ add?: string }>()
  const [picker, setPicker] = useState(p.add === "1"),
    [more, setMore] = useState(false),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string[]>([])
  if (!r)
    return (
      <Screen prototypeLayout title="Routine">
        <Empty title="Routine not found" />
      </Screen>
    )
  const stats = L.routineStats(r, s.runs, 30),
    today = dayKey(),
    run = s.runs.find(
      (x) => x.routineId === id && x.day === today && x.state !== "abandoned",
    ),
    archived = r.steps.filter(
      (x) => s.habits.find((h) => h.id === x.habitId)?.status === "archived",
    ).length
  const setMin = (i: number, n: number) =>
    A.setRoutineSteps(
      id,
      r.steps.map((x, j) => (j === i ? { ...x, minutes: Math.max(1, n) } : x)),
    )
  const move = (i: number, delta: number) => {
    const next = [...r.steps],
      to = Math.max(0, Math.min(next.length - 1, i + delta))
    const [step] = next.splice(i, 1)
    next.splice(to, 0, step)
    A.setRoutineSteps(id, next)
  }
  return (
    <Screen
      prototypeLayout
      title={r.name}
      actions={
        <Line style={{ gap: 0 }}>
          <IconTap
            size={40}
            icon={Share2}
            label="Share routine"
            color={t.text}
            onPress={() => go(`/habits/share?t=routine&routine=${id}`)}
          />
          <IconTap
            size={40}
            icon={Pencil}
            label="Edit routine"
            color={t.text}
            onPress={() => go(`/habits/routines/${id}/edit`)}
          />
          <IconTap
            size={40}
            icon={MoreVertical}
            label="More actions"
            color={t.text}
            onPress={() => setMore(true)}
          />
        </Line>
      }
    >
      <View style={{ gap: 12, paddingTop: 4 }}>
        <Line style={{ gap: 16 }}>
          <HabitIcon icon={r.icon} />
          <View style={{ flex: 1 }}>
            <Tap
              label={`Schedule: ${L.scheduleLabel(r.schedule)}. Change`}
              onPress={() => go(`/habits/routines/${id}/edit`)}
            >
              <Copy size={14} muted>
                {L.scheduleLabel(r.schedule) || "Set days and a time"} ·{" "}
                <Copy size={14} weight="medium" style={{ color: t.hab }}>
                  Change
                </Copy>
              </Copy>
            </Tap>
            <Copy size={14} muted>
              {r.steps.length} steps · {L.plannedMin(r)} min planned
            </Copy>
          </View>
        </Line>
        {r.status === "active" && (
          <Pressable
            accessibilityRole="button"
            disabled={!r.steps.length || run?.state === "completed"}
            onPress={() => {
              A.startRoutine(id)
              go(`/habits/routines/${id}/play`)
            }}
            style={{
              height: 56,
              borderRadius: 14,
              backgroundColor: t.hab,
              opacity: !r.steps.length || run?.state === "completed" ? 0.5 : 1,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Line style={{ gap: 8 }}>
              <Play size={20} color={t.bg} fill={t.bg} />
              <Copy weight="semibold" style={{ color: t.bg }}>
                {run?.state === "completed"
                  ? `Done today in ${fmtDuration(L.runActualSec(run))}`
                  : run?.state === "in_progress"
                    ? `Resume · step ${run.current + 1}/${run.steps.length}`
                    : "Start routine"}
              </Copy>
            </Line>
          </Pressable>
        )}
        <Frame style={{ padding: 16 }}>
          <Line>
            {[
              ["Completion 30d", L.pct(stats.rate), t.hab],
              ["Pace vs plan", stats.pace ? L.pct(stats.pace) : "—", t.text],
              ["Runs 30d", String(stats.runs.length), t.text],
            ].map(([label, value, color]) => (
              <View key={label} style={{ flex: 1 }}>
                <Copy size={30} weight="displayMedium" style={{ color }}>
                  {value}
                </Copy>
                <Copy size={12} muted>
                  {label}
                </Copy>
              </View>
            ))}
          </Line>
        </Frame>
        {stats.pace > 1.15 && (
          <Copy size={12} style={{ color: t.warn }}>
            You usually run {Math.round((stats.pace - 1) * 100)}% over plan —
            consider raising the planned minutes.
          </Copy>
        )}
      </View>
      <View style={{ marginTop: -12 }}>
        <SectionHeading
          action={
            <Tap
              onPress={() => {
                setSelected([])
                setQuery("")
                setPicker(true)
              }}
            >
              <Copy size={12} style={{ color: t.hab }}>
                + Add step
              </Copy>
            </Tap>
          }
        >
          Steps
        </SectionHeading>
        <Frame style={{ padding: 4 }}>
          {!r.steps.length ? (
            <View style={{ padding: 24, gap: 8 }}>
              <Copy weight="medium">No steps yet</Copy>
              <Copy size={14} muted>
                Every step is a habit, so each one is tracked.
              </Copy>
              <Button onPress={() => setPicker(true)}>Add steps</Button>
            </View>
          ) : (
            r.steps.map((step, i) => {
              const h = s.habits.find((h) => h.id === step.habitId)
              if (!h) return null
              return (
                <Line
                  key={`${step.habitId}-${i}`}
                  style={{
                    gap: 4,
                    paddingVertical: 6,
                    paddingRight: 4,
                    opacity: h.status === "archived" ? 0.4 : 1,
                  }}
                >
                  <DragHandle name={h.name} onMove={(d) => move(i, d)} />
                  <Copy size={18}>{h.icon}</Copy>
                  <View style={{ flex: 1, marginLeft: 4 }}>
                    <Copy size={14} weight="medium" lines={1}>
                      {h.name}
                    </Copy>
                    {h.status === "archived" && (
                      <Copy size={12} muted>
                        archived — hidden in player
                      </Copy>
                    )}
                  </View>
                  <Line
                    style={{
                      gap: 0,
                      borderRadius: 999,
                      backgroundColor: t.soft,
                    }}
                  >
                    <IconTap
                      icon={Minus}
                      label={`Less time for ${h.name}`}
                      onPress={() => setMin(i, step.minutes - 1)}
                    />
                    <Copy size={14} style={{ width: 36, textAlign: "center" }}>
                      {step.minutes}m
                    </Copy>
                    <IconTap
                      icon={Plus}
                      label={`More time for ${h.name}`}
                      onPress={() => setMin(i, step.minutes + 1)}
                    />
                  </Line>
                  <IconTap
                    size={44}
                    icon={X}
                    label={`Remove ${h.name}`}
                    onPress={() => {
                      const prev = r.steps
                      A.setRoutineSteps(
                        id,
                        prev.filter((_, j) => j !== i),
                      )
                      undo("Step removed", () => A.setRoutineSteps(id, prev))
                    }}
                  />
                </Line>
              )
            })
          )}
          {!!r.steps.length && (
            <Line
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderTopWidth: 1,
                borderTopColor: border(t.border, 0.6),
                justifyContent: "space-between",
              }}
            >
              <Copy size={12} muted>
                {archived ? `${archived} archived step` : "Total"}
              </Copy>
              <Copy size={12} muted>
                {L.plannedMin(r)} min
              </Copy>
            </Line>
          )}
        </Frame>
      </View>
      <View style={{ marginTop: -12 }}>
        <SectionHeading>Last runs</SectionHeading>
        <Frame style={{ padding: 4 }}>
          {!stats.runs.length ? (
            <Copy size={14} muted style={{ padding: 24, textAlign: "center" }}>
              Never run — start it once to see pace and history here.
            </Copy>
          ) : (
            [...stats.runs]
              .reverse()
              .slice(0, 7)
              .map((x) => {
                const st = L.runState(x, today),
                  planned = x.steps.reduce((a, s) => a + s.minutes * 60, 0)
                return (
                  <Tap
                    key={x.id}
                    onPress={() =>
                      go(`/habits/routines/${id}/summary?run=${x.id}`)
                    }
                    style={{ paddingHorizontal: 12, paddingVertical: 10 }}
                  >
                    <Line>
                      <View
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          backgroundColor:
                            st === "completed" ? t.hab : `${t.warn}33`,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {st === "completed" ? (
                          <Check size={14} color={t.bg} />
                        ) : (
                          <Copy size={12} style={{ color: t.warn }}>
                            !
                          </Copy>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Copy size={14}>
                          {new Date(`${x.day}T12:00:00`).toLocaleDateString(
                            "en-US",
                            {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            },
                          )}
                        </Copy>
                        <Copy size={12} muted>
                          {st === "completed"
                            ? `${x.results.filter((r) => r.status === "done").length}/${x.steps.length} done · ${fmtDuration(L.runActualSec(x))} vs ${fmtDuration(planned)}`
                            : st === "abandoned"
                              ? `Abandoned at ${x.current}/${x.steps.length}`
                              : `In progress ${x.current}/${x.steps.length}`}
                        </Copy>
                      </View>
                      <ChevronRight size={16} color={t.muted} />
                    </Line>
                  </Tap>
                )
              })
          )}
        </Frame>
      </View>
      <Sheet title="Routine actions" open={more} onClose={() => setMore(false)}>
        {[
          {
            name: "Archive",
            icon: Archive,
            action: () => A.archiveRoutine(id),
            body: "It leaves Today and Plan. Restore it any time from Archived.",
          },
          {
            name: "Delete",
            icon: Trash2,
            action: () => A.deleteRoutine(id),
            body: `Deletes the routine and its ${stats.runs.length}+ past runs. Its habits and their logs stay.`,
          },
        ].map((a) => (
          <Tap
            key={a.name}
            onPress={() => {
              setMore(false)
              confirm(`${a.name} ${r.name}?`, a.body, () => {
                a.action()
                go("/habits/routines")
              })
            }}
            style={{ padding: 12 }}
          >
            <Line>
              <a.icon size={18} color={a.name === "Delete" ? t.bad : t.text} />
              <Copy style={{ color: a.name === "Delete" ? t.bad : t.text }}>
                {a.name}
              </Copy>
            </Line>
          </Tap>
        ))}
      </Sheet>
      <Sheet title="Add steps" open={picker} onClose={() => setPicker(false)}>
        <Copy size={14} muted>
          Pick habits — a habit can be in more than one routine.
        </Copy>
        <Field label="Search habits" value={query} onChangeText={setQuery} />
        <Tap
          onPress={() => {
            setPicker(false)
            go(
              `/habits/new?addToRoutine=${id}&name=${encodeURIComponent(query)}`,
            )
          }}
          style={{ padding: 10 }}
        >
          <Line>
            <Plus size={18} color={t.hab} />
            <Copy size={14} weight="medium" style={{ color: t.hab }}>
              New habit{query ? ` “${query}”` : ""}
            </Copy>
          </Line>
        </Tap>
        {s.habits
          .filter(
            (h) =>
              h.status !== "archived" &&
              h.name.toLowerCase().includes(query.toLowerCase()),
          )
          .map((h) => (
            <Pressable
              key={h.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected.includes(h.id) }}
              accessibilityLabel={h.name}
              onPress={() =>
                setSelected(
                  selected.includes(h.id)
                    ? selected.filter((x) => x !== h.id)
                    : [...selected, h.id],
                )
              }
              style={{ paddingHorizontal: 8, paddingVertical: 10 }}
            >
              <Line>
                <Copy size={18}>{h.icon}</Copy>
                <Copy size={14} style={{ flex: 1 }}>
                  {h.name}
                  {r.steps.some((x) => x.habitId === h.id) && (
                    <Copy size={12} muted>
                      {" "}
                      · already a step
                    </Copy>
                  )}
                </Copy>
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    borderWidth: 2,
                    borderColor: selected.includes(h.id)
                      ? t.hab
                      : `${t.muted}4d`,
                    backgroundColor: selected.includes(h.id)
                      ? t.hab
                      : "transparent",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {selected.includes(h.id) && <Check size={14} color={t.bg} />}
                </View>
              </Line>
            </Pressable>
          ))}
        <Button
          disabled={!selected.length}
          onPress={() => {
            A.setRoutineSteps(id, [
              ...r.steps,
              ...selected.map((habitId) => {
                const h = s.habits.find((h) => h.id === habitId)
                return {
                  habitId,
                  minutes: h?.type === "duration" ? (h.target ?? 5) : 5,
                }
              }),
            ])
            setPicker(false)
          }}
        >
          {`Add ${selected.length || ""} step${selected.length === 1 ? "" : "s"}`}
        </Button>
      </Sheet>
    </Screen>
  )
}

export function Routines() {
  const t = useTheme(),
    s = habitsStore.use((s) => s),
    [archived, setArchived] = useState(false),
    today = dayKey()
  const list = s.routines.filter(
      (r) => r.status === (archived ? "archived" : "active"),
    ),
    count = s.routines.filter((r) => r.status === "archived").length
  return (
    <Screen
      prototypeLayout
      title="Routines"
      actions={
        <IconTap
          size={40}
          icon={Plus}
          label="New routine"
          color={t.bg}
          background={t.hab}
          onPress={() => go("/habits/routines/new")}
        />
      }
    >
      <View style={{ gap: 12, paddingTop: 4 }}>
        <Line style={{ gap: 8 }}>
          {[false, true].map((v) => (
            <Tap
              key={String(v)}
              onPress={() => setArchived(v)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 999,
                backgroundColor: archived === v ? `${t.hab}26` : t.soft,
              }}
            >
              <Copy
                size={12}
                weight="medium"
                style={{ color: archived === v ? t.hab : t.muted }}
              >
                {v ? `Archived · ${count}` : "Active"}
              </Copy>
            </Tap>
          ))}
        </Line>
        {list.map((r) => {
          const last = [...s.runs].reverse().find((x) => x.routineId === r.id),
            st = last ? L.runState(last, today) : null
          return (
            <Frame key={r.id}>
              <Tap
                onPress={() => go(`/habits/routines/${r.id}`)}
                style={{ padding: 16, paddingBottom: 8 }}
              >
                <Line>
                  <HabitIcon icon={r.icon} />
                  <View style={{ flex: 1 }}>
                    <Copy weight="semibold" lines={1}>
                      {r.name}
                    </Copy>
                    <Copy size={12} muted lines={1}>
                      {L.scheduleLabel(r.schedule)}
                    </Copy>
                    <Copy size={12} muted>
                      {r.steps.length} steps · {L.plannedMin(r)}m planned
                    </Copy>
                  </View>
                  <ChevronRight size={16} color={t.muted} />
                </Line>
              </Tap>
              <Line style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                <Line style={{ gap: 4 }}>
                  {Array.from({ length: 7 }, (_, i) => {
                    const d = dayOffset(i - 6),
                      run = s.runs.find(
                        (x) => x.routineId === r.id && x.day === d,
                      ),
                      status = run ? L.runState(run, today) : null,
                      due = !!L.slotFor(r.schedule, d) && d >= r.createdAt
                    return (
                      <View
                        key={d}
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor:
                            status === "completed"
                              ? t.hab
                              : status === "abandoned"
                                ? `${t.warn}99`
                                : status === "in_progress"
                                  ? `${t.hab}80`
                                  : due && d < today
                                    ? `${t.bad}66`
                                    : t.soft,
                        }}
                      />
                    )
                  })}
                </Line>
                <Copy size={12} muted lines={1} style={{ flex: 1 }}>
                  {last
                    ? `Last: ${new Date(`${last.day}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" })} · ${st === "completed" ? `✓ ${fmtDuration(L.runActualSec(last))}` : st === "abandoned" ? `abandoned ${last.current}/${last.steps.length}` : "in progress"}`
                    : "Never run"}
                </Copy>
                {r.status === "active" && r.steps.length > 0 && (
                  <Tap
                    onPress={() => {
                      A.startRoutine(r.id)
                      go(`/habits/routines/${r.id}/play`)
                    }}
                    style={{
                      height: 36,
                      borderRadius: 99,
                      paddingHorizontal: 12,
                      backgroundColor: t.hab,
                      justifyContent: "center",
                    }}
                  >
                    <Line style={{ gap: 6 }}>
                      <Play size={14} fill={t.bg} color={t.bg} />
                      <Copy size={14} weight="medium" style={{ color: t.bg }}>
                        Start
                      </Copy>
                    </Line>
                  </Tap>
                )}
                {archived && (
                  <Tap onPress={() => A.restoreRoutine(r.id)}>
                    <Copy size={12} style={{ color: t.hab }}>
                      Restore
                    </Copy>
                  </Tap>
                )}
              </Line>
            </Frame>
          )
        })}
        {!list.length && (
          <Frame style={{ padding: 24 }}>
            <Copy muted size={14}>
              {archived
                ? "No archived routines."
                : "Stack habits into one guided flow"}
            </Copy>
            {!archived && (
              <Button href="/habits/routines/new?name=Morning%20routine">
                Build Morning routine
              </Button>
            )}
          </Frame>
        )}
      </View>
    </Screen>
  )
}

export function RoutineSummary({ id, runId }: { id: string; runId?: string }) {
  const t = useTheme(),
    s = habitsStore.use((s) => s),
    r = s.routines.find((r) => r.id === id),
    run =
      s.runs.find((r) => r.id === runId && r.routineId === id) ??
      [...s.runs].reverse().find((r) => r.routineId === id)
  if (!r || !run)
    return (
      <Screen prototypeLayout title="Routine summary">
        <Empty title="Run not found" />
      </Screen>
    )
  const st = L.runState(run),
    actual = L.runActualSec(run),
    planned = run.steps.reduce((a, s) => a + s.minutes * 60, 0),
    done = run.results.filter((r) => r.status === "done").length,
    completed = s.runs.filter(
      (x) =>
        x.routineId === id &&
        x.day >= dayOffset(-30) &&
        L.runState(x) === "completed",
    ),
    fastest =
      st === "completed" &&
      completed.length > 2 &&
      completed.every((x) => x.id === run.id || L.runActualSec(x) >= actual),
    idx = L.logIndex(s.logs)
  return (
    <Screen prototypeLayout title="Routine summary">
      <View style={{ gap: 12, paddingTop: 4 }}>
        <View style={{ alignItems: "center", gap: 8, paddingVertical: 16 }}>
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 24,
              backgroundColor: `${t.hab}1f`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Copy size={40}>{r.icon}</Copy>
            {st === "completed" && (
              <View
                style={{
                  position: "absolute",
                  right: -8,
                  bottom: -8,
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: t.good,
                  borderWidth: 4,
                  borderColor: t.bg,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Check size={20} color={t.bg} />
              </View>
            )}
          </View>
          <Copy
            size={24}
            weight="semibold"
            style={{ marginTop: 8, textAlign: "center" }}
          >
            {st === "completed"
              ? `${r.name} done!`
              : `${r.name} — ${st.replace("_", " ")}`}
          </Copy>
          <Copy size={14} muted>
            {new Date(`${run.day}T12:00:00`).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </Copy>
          {fastest && (
            <Copy
              size={14}
              style={{
                color: t.warn,
                backgroundColor: `${t.warn}26`,
                borderRadius: 99,
                paddingHorizontal: 12,
                paddingVertical: 4,
              }}
            >
              🏆 Fastest this month
            </Copy>
          )}
        </View>
        <Frame style={{ padding: 16 }}>
          <Line>
            {[
              ["Steps done", `${done}/${run.steps.length}`],
              ["Actual", fmtDuration(actual)],
              ["vs planned", fmtDuration(planned)],
            ].map(([label, value], i) => (
              <View key={label} style={{ flex: 1 }}>
                <Copy
                  weight="displayMedium"
                  size={30}
                  style={{ color: i === 0 ? t.hab : t.text }}
                >
                  {value}
                </Copy>
                <Copy size={12} muted>
                  {label}
                </Copy>
              </View>
            ))}
          </Line>
        </Frame>
      </View>
      <View style={{ marginTop: -12 }}>
        <SectionHeading>Steps</SectionHeading>
        <Frame style={{ padding: 4 }}>
          {run.steps.map((step, i) => {
            const h = s.habits.find((h) => h.id === step.habitId),
              res = run.results[i],
              streak = h ? L.streaks(h, idx).current : 0
            return (
              <Line
                key={i}
                style={{ paddingHorizontal: 12, paddingVertical: 10 }}
              >
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor:
                      res?.status === "done"
                        ? t.hab
                        : res?.status === "skipped"
                          ? `${t.warn}33`
                          : t.soft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {res?.status === "done" ? (
                    <Check size={14} color={t.bg} />
                  ) : (
                    <Copy muted size={12}>
                      {res?.status === "skipped" ? "–" : "·"}
                    </Copy>
                  )}
                </View>
                <Copy>{h?.icon}</Copy>
                <View style={{ flex: 1 }}>
                  <Copy size={14} lines={1}>
                    {h?.name ?? "Deleted habit"}
                  </Copy>
                  <Copy muted size={12}>
                    {res?.status === "done"
                      ? `${fmtDuration(res.actualSec)} of ${step.minutes}m`
                      : res?.status === "skipped"
                        ? "skipped"
                        : "not reached"}
                  </Copy>
                </View>
                {res?.status === "done" && streak > 0 && (
                  <Copy
                    size={12}
                    style={{
                      color: t.warn,
                      backgroundColor: `${t.warn}26`,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 99,
                    }}
                  >
                    🔥 {streak}
                  </Copy>
                )}
              </Line>
            )
          })}
        </Frame>
      </View>
      <Line style={{ paddingTop: 8, gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button
            tone="quiet"
            href={`/habits/share?t=routine&routine=${id}&run=${run.id}`}
          >
            Share
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button href="/today">Done</Button>
        </View>
      </Line>
    </Screen>
  )
}
