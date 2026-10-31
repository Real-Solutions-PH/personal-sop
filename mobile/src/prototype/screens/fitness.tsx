import * as A from "@domain/fitness/actions"
import * as C from "@domain/fitness/calc"
import type { Exercise } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { Redirect, useLocalSearchParams } from "expo-router"
import { Check, Plus } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { Stepper } from "../fitness-controls"
import { Copy, Line, Tap } from "../native-kit"
import { useTheme } from "../theme"
import { Button, Field, Sheet } from "../ui"
import { FitnessTrain } from "./fitness-train"
export function FitnessHome() {
  // Old links still carry ?tab=eat|body. Eating is Nutrition's page now
  // (ADR-0024); every other section is on this one.
  const p = useLocalSearchParams<{ tab?: string; day?: string }>()
  if (p.tab === "eat")
    return (
      <Redirect
        href={{ pathname: "/nutrition", params: p.day ? { day: p.day } : {} }}
      />
    )
  return <FitnessTrain />
}
/** Under an exercise picker's results: make a new exercise, named from
 * the search when it found no exact match. Exercises are one shared
 * catalog, so a name that is already an exercise (or one of its former
 * names, any case or spacing) is never created again: when the picker
 * passes ``onExisting``, the row offers that exercise instead. */
export function CreateExerciseRow({
  query,
  onPress,
  onExisting,
}: {
  query: string
  onPress: (name: string) => void
  onExisting?: (e: Exercise) => void
}) {
  const t = useTheme()
  const exercises = fitStore.use((s) => s.exercises)
  const name = query.trim().replace(/\s+/g, " ")
  const existing = name ? C.exerciseNamed({ exercises }, name) : undefined
  // Already in the results above.
  if (existing && !existing.archived) return null
  if (existing && onExisting)
    return (
      <Tap
        label={`Use exercise ${existing.name}`}
        onPress={() => onExisting(existing)}
        style={{ paddingVertical: 10 }}
      >
        <Line style={{ gap: 12 }}>
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `${t.fit}26`,
            }}
          >
            <Check size={16} color={t.fit} />
          </View>
          <Copy weight="medium" style={{ color: t.fit }}>
            {`Use “${existing.name}”`}
          </Copy>
        </Line>
      </Tap>
    )
  return (
    <Tap
      label={name ? `Create exercise ${name}` : "New exercise"}
      onPress={() => onPress(name)}
      style={{ paddingVertical: 10 }}
    >
      <Line style={{ gap: 12 }}>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${t.fit}26`,
          }}
        >
          <Plus size={16} color={t.fit} />
        </View>
        <Copy weight="medium" style={{ color: t.fit }}>
          {name ? `Create “${name}”` : "New exercise"}
        </Copy>
      </Line>
    </Tap>
  )
}

export function ExerciseEditor({
  exercise,
  open,
  onClose,
  initialName,
  onSaved,
}: {
  exercise?: Exercise
  open: boolean
  onClose: () => void
  /** A new exercise's name, prefilled (what the picker's search held). */
  initialName?: string
  /** After saving: a picker uses the new exercise straight away. */
  onSaved?: (e: Exercise) => void
}) {
  const t = useTheme(),
    s = fitStore.use((s) => s),
    [f, setF] = useState<Partial<Exercise>>({
      equipment: "barbell",
      muscle: "chest",
      loadType: "weight",
      repMin: 8,
      repMax: 12,
      increment: 2.5,
      ...(initialName ? { name: initialName } : {}),
      ...exercise,
    }),
    set = (patch: Partial<Exercise>) => setF({ ...f, ...patch }),
    duplicate = s.exercises.some(
      (e) =>
        e.id !== f.id &&
        e.name.toLowerCase() === (f.name ?? "").trim().toLowerCase(),
    )
  const chip = (label: string, active: boolean, press: () => void) => (
    <Tap
      key={label}
      onPress={press}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 99,
        borderWidth: 1,
        borderColor: active ? t.fit : t.line,
        backgroundColor: active ? t.fit : t.card,
      }}
    >
      <Copy
        size={14}
        weight="medium"
        style={{ color: active ? t.bg : t.text, textTransform: "capitalize" }}
      >
        {label}
      </Copy>
    </Tap>
  )
  return (
    <Sheet
      title={exercise ? "Edit exercise" : "New exercise"}
      open={open}
      onClose={onClose}
    >
      <Field
        label="Exercise name"
        value={f.name ?? ""}
        onChangeText={(name) => set({ name })}
      />
      {duplicate && (
        <Copy size={12} style={{ color: t.warn }}>
          An exercise with this name already exists.
        </Copy>
      )}
      <View style={{ gap: 6 }}>
        <Copy size={12} muted>
          Equipment
        </Copy>
        <Line style={{ gap: 8, flexWrap: "wrap" }}>
          {(
            ["barbell", "dumbbell", "machine", "cable", "bodyweight"] as const
          ).map((e) =>
            chip(e, f.equipment === e, () =>
              set({
                equipment: e,
                increment: e === "dumbbell" ? 2 : e === "machine" ? 5 : 2.5,
              }),
            ),
          )}
        </Line>
      </View>
      <View style={{ gap: 6 }}>
        <Copy size={12} muted>
          Primary muscle
        </Copy>
        <Line style={{ gap: 8, flexWrap: "wrap" }}>
          {(
            [
              "chest",
              "back",
              "shoulders",
              "biceps",
              "triceps",
              "quads",
              "hamstrings",
              "glutes",
              "core",
              "calves",
              "forearms",
              "cardio",
            ] as const
          ).map((m) =>
            chip(m, f.muscle === m, () =>
              // Cardio is timed, and speed is what walks and runs track.
              set(
                m === "cardio"
                  ? { muscle: m, loadType: "time", track: f.track ?? "speed" }
                  : { muscle: m },
              ),
            ),
          )}
        </Line>
      </View>
      <View style={{ gap: 6 }}>
        <Copy size={12} muted>
          Load type
        </Copy>
        <Line style={{ gap: 8, flexWrap: "wrap" }}>
          {(
            [
              { v: "weight", label: "Weight" },
              { v: "bodyweight", label: "Bodyweight + added" },
              { v: "reps", label: "Reps only" },
              { v: "time", label: "Time" },
            ] as const
          ).map((l) =>
            chip(l.label, f.loadType === l.v, () => set({ loadType: l.v })),
          )}
        </Line>
      </View>
      {f.loadType === "time" && (
        <View style={{ gap: 6 }}>
          <Copy size={12} muted>
            Also record
          </Copy>
          <Line style={{ gap: 8, flexWrap: "wrap" }}>
            {(
              [
                { v: undefined, label: "Time only" },
                { v: "speed", label: "Speed (km/h)" },
                { v: "weight", label: "Added weight (kg)" },
              ] as const
            ).map((o) =>
              chip(o.label, (f.track ?? undefined) === o.v, () =>
                set({ track: o.v }),
              ),
            )}
          </Line>
        </View>
      )}
      {f.loadType !== "time" && (
        <Line style={{ gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Stepper
              label="Rep min"
              value={f.repMin ?? 8}
              onChange={(repMin) => set({ repMin })}
              step={1}
              min={1}
              max={100}
              decimals={0}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Stepper
              label="Rep max"
              value={f.repMax ?? 12}
              onChange={(repMax) => set({ repMax })}
              step={1}
              min={1}
              max={100}
              decimals={0}
            />
          </View>
        </Line>
      )}
      {f.loadType !== "time" && (
        <View style={{ gap: 6 }}>
          <Copy size={12} muted>
            Weight increment
          </Copy>
          <Line style={{ gap: 8 }}>
            {[1, 2, 2.5, 5].map((n) =>
              chip(`${n} kg`, f.increment === n, () => set({ increment: n })),
            )}
          </Line>
        </View>
      )}
      {(f.repMin ?? 0) > (f.repMax ?? 0) && (
        <Copy size={12} style={{ color: t.bad }}>
          Rep min is above rep max.
        </Copy>
      )}
      <Line style={{ gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button
            tone={f.id ? "danger" : "quiet"}
            onPress={() => {
              if (f.id) A.setExerciseArchived(f.id, !f.archived)
              onClose()
            }}
          >
            {f.id ? (f.archived ? "Unarchive" : "Archive") : "Cancel"}
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button
            disabled={!f.name?.trim() || (f.repMin ?? 0) > (f.repMax ?? 0)}
            onPress={() => {
              if (
                !f.name?.trim() ||
                !Number.isFinite(f.repMin) ||
                !Number.isFinite(f.repMax) ||
                !Number.isInteger(f.repMin) ||
                !Number.isInteger(f.repMax) ||
                f.repMin! < 1 ||
                f.repMax! > 100 ||
                f.repMin! > f.repMax!
              ) {
                toast.error("Check the name and rep range")
                return
              }
              const saved = A.upsertExercise({ ...f, name: f.name.trim() })
              onClose()
              onSaved?.(saved)
            }}
          >
            Save exercise
          </Button>
        </View>
      </Line>
    </Sheet>
  )
}
