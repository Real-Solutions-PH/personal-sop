// Changing a routine while it plays: the run's steps (tap the progress
// header) with each unplayed one removable, and a picker that adds a habit.
// Both change today's run only unless "Also change the routine" is on.
import * as A from "@domain/habits/actions"
import type { Habit, RoutineRun } from "@domain/habits/data"
import { habitsStore } from "@domain/habits/store"
import { Check, Plus, Search, X } from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import { TextInput, type TextInputInstance, View } from "react-native"
import { feel } from "../motion"
import { Copy, IconTap, Line, Tap } from "../native-kit"
import { fonts, useTheme } from "../theme"
import { Button, Choices, confirm, Sheet, Toggle } from "../ui"

export type Removal = A.RemovedStep & { name: string }

/** How long a removal can still be undone. */
export const UNDO_MS = 8000

/** Habits that can join a run: not archived, not in it already, matching
 * the search, in the habits list's own order. */
export function addableHabits(habits: Habit[], run: RoutineRun, query = "") {
  const inRun = new Set(run.steps.map((s) => s.habitId))
  const q = query.trim().toLowerCase()
  return habits
    .filter(
      (h) =>
        h.status !== "archived" &&
        !inRun.has(h.id) &&
        h.name.toLowerCase().includes(q),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

/** "Removed X · Undo", in place where the change was made (never a toast:
 * those are only for ticking a habit or task). */
export function UndoRemoval({
  removal,
  onUndo,
}: {
  removal: Removal | null
  onUndo: () => void
}) {
  const t = useTheme()
  if (!removal) return null
  return (
    <Line
      style={{
        gap: 8,
        paddingLeft: 12,
        paddingRight: 4,
        minHeight: 44,
        borderRadius: 12,
        backgroundColor: t.soft,
      }}
    >
      <Copy size={14} style={{ flex: 1 }}>
        Removed {removal.name} · not counted as missed
      </Copy>
      <Tap
        label={`Undo removing ${removal.name}`}
        onPress={onUndo}
        style={{ paddingHorizontal: 12, paddingVertical: 10 }}
      >
        <Copy size={14} weight="semibold" style={{ color: t.hab }}>
          Undo
        </Copy>
      </Tap>
    </Line>
  )
}

export function RunEditSheet({
  run,
  mode,
  onMode,
  onClose,
  removal,
  onRemoved,
  onUndo,
  onFinished,
}: {
  run: RoutineRun
  /** Which page is showing; null closes the sheet. */
  mode: "steps" | "add" | null
  onMode: (mode: "steps" | "add") => void
  onClose: () => void
  removal: Removal | null
  onRemoved: (removal: Removal) => void
  onUndo: () => void
  /** The removal ended the run (it took the last step left). */
  onFinished: () => void
}) {
  const t = useTheme(),
    habits = habitsStore.use((s) => s.habits),
    [also, setAlso] = useState(false),
    [place, setPlace] = useState<A.StepPlace>("next"),
    [query, setQuery] = useState(""),
    search = useRef<TextInputInstance>(null)
  // Each opening starts as "this run only": changing the saved routine is
  // a choice made each time, never one left on from an earlier visit.
  useEffect(() => {
    if (!mode) {
      setAlso(false)
      setQuery("")
      setPlace("next")
    }
  }, [mode])
  const name = (id: string) => habits.find((h) => h.id === id)
  const remove = (i: number) => {
    const h = name(run.steps[i].habitId)
    const go = () => {
      const r = A.runRemoveStep(run, i, also)
      if (!r) return
      feel.tap()
      if (r.finished) onFinished()
      else onRemoved({ ...r, name: h?.name ?? "step" })
    }
    // Taking the last step left ends the run, and an ended run can't take
    // it back, so that one asks first.
    if (i === run.current && run.current === run.steps.length - 1)
      confirm(
        "Remove the last step?",
        "The routine finishes now. This step isn't logged or counted as missed.",
        go,
        "Remove",
      )
    else go()
  }
  const add = (habitId: string) => {
    if (A.runAddStep(run, habitId, place, also) === null) return
    feel.tap()
    onMode("steps")
  }
  const create = () => {
    const n = query.trim()
    if (!n) {
      search.current?.focus()
      return
    }
    const h = A.createHabit({ name: n })
    add(h.id)
  }
  const alsoToggle = (
    <View>
      <Toggle label="Also change the routine" value={also} onChange={setAlso} />
      <Copy size={12} muted>
        {also
          ? "The saved routine changes too, for every run from now on."
          : "Only today's run changes; the saved routine stays as it is."}
      </Copy>
    </View>
  )
  const list = addableHabits(habits, run, query)
  return (
    <Sheet
      title={mode === "add" ? "Add a step" : "Steps"}
      open={!!mode}
      onClose={onClose}
      onBack={mode === "add" ? () => onMode("steps") : undefined}
      backLabel="Back to steps"
      footer={
        mode === "steps" ? (
          <Button onPress={() => onMode("add")}>Add a step</Button>
        ) : undefined
      }
    >
      {mode === "steps" ? (
        <View style={{ gap: 8 }}>
          <UndoRemoval removal={removal} onUndo={onUndo} />
          {run.steps.map((step, i) => {
            const h = name(step.habitId),
              res = run.results[i],
              played = i < run.current,
              now = i === run.current
            return (
              <Line
                key={`${step.habitId}-${i}`}
                style={{
                  gap: 10,
                  minHeight: 52,
                  paddingLeft: 12,
                  borderRadius: 12,
                  backgroundColor: now ? `${t.hab}1f` : "transparent",
                  opacity: played ? 0.6 : 1,
                }}
              >
                <View
                  style={{ width: 20, alignItems: "center" }}
                  accessibilityLabel={
                    played
                      ? res?.status === "skipped"
                        ? "Skipped"
                        : "Done"
                      : now
                        ? "Now"
                        : `Step ${i + 1}`
                  }
                >
                  {played ? (
                    res?.status === "skipped" ? (
                      <Copy size={14} style={{ color: t.warn }}>
                        –
                      </Copy>
                    ) : (
                      <Check size={16} color={t.hab} />
                    )
                  ) : (
                    <Copy size={14} muted>
                      {i + 1}
                    </Copy>
                  )}
                </View>
                <Copy size={18}>{h?.icon}</Copy>
                <View style={{ flex: 1, paddingVertical: 8 }}>
                  <Copy size={14} weight={now ? "semibold" : "body"}>
                    {h?.name ?? "Habit"}
                  </Copy>
                  <Copy size={12} muted>
                    {now ? "Now · " : ""}
                    {step.minutes} min
                  </Copy>
                </View>
                {A.canRemoveStep(run, i) ? (
                  <IconTap
                    size={44}
                    icon={X}
                    label={
                      now
                        ? `Remove ${h?.name ?? "this step"} and move on`
                        : `Remove ${h?.name ?? "this step"}`
                    }
                    onPress={() => remove(i)}
                  />
                ) : (
                  <View style={{ width: 44 }} />
                )}
              </Line>
            )
          })}
          <Copy size={12} muted>
            Removed steps aren't logged, so they never count as skipped or
            missed. Removing the current step moves on to the next one.
          </Copy>
          {alsoToggle}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Line
            style={{
              borderWidth: 1,
              borderColor: t.line,
              borderRadius: 12,
              paddingHorizontal: 12,
              gap: 8,
              backgroundColor: t.card,
            }}
          >
            <Search size={16} color={t.muted} />
            <TextInput
              ref={search}
              accessibilityLabel="Search habits"
              placeholder="Search habits or name a new one"
              placeholderTextColor={t.muted}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              returnKeyType="search"
              style={{
                height: 44,
                flex: 1,
                fontFamily: fonts.body,
                fontSize: 16,
                color: t.text,
              }}
            />
            {!!query && (
              <IconTap
                icon={X}
                label="Clear search"
                onPress={() => setQuery("")}
              />
            )}
          </Line>
          <Choices
            label="Add it"
            value={place}
            onChange={setPlace}
            options={[
              { value: "next", label: "Up next" },
              { value: "end", label: "At the end" },
            ]}
          />
          {alsoToggle}
          <Tap
            label={query.trim() ? `Create habit ${query.trim()}` : "New habit"}
            onPress={create}
            style={{
              minHeight: 48,
              paddingHorizontal: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: t.line,
              justifyContent: "center",
            }}
          >
            <Line style={{ gap: 8 }}>
              <Plus size={18} color={t.primary} />
              <Copy
                size={14}
                weight="medium"
                style={{ color: t.primary, flex: 1 }}
              >
                {query.trim()
                  ? `New habit “${query.trim()}”`
                  : "New habit — type its name above"}
              </Copy>
            </Line>
          </Tap>
          {list.map((h) => (
            <Tap
              key={h.id}
              label={`Add ${h.name}`}
              onPress={() => add(h.id)}
              style={{ paddingHorizontal: 8, paddingVertical: 10 }}
            >
              <Line style={{ gap: 10 }}>
                <Copy size={18}>{h.icon}</Copy>
                <Copy size={14} style={{ flex: 1 }}>
                  {h.name}
                </Copy>
                <Copy size={12} muted>
                  {A.stepMinutesFor(h)} min
                </Copy>
                <Plus size={18} color={t.hab} />
              </Line>
            </Tap>
          ))}
        </View>
      )}
    </Sheet>
  )
}
