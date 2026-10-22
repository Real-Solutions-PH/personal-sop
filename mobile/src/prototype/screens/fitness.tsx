import * as A from "@domain/fitness/actions"
import type { Exercise } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { useLocalSearchParams } from "expo-router"
import { useState } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { Stepper } from "../fitness-controls"
import { Copy, Line, Tap } from "../native-kit"
import { useTheme } from "../theme"
import { Button, Field, Sheet } from "../ui"
import { FitnessTrain } from "./fitness-train"
export function FitnessHome() {
  // Old links still carry ?tab=eat|body; the page now holds every section.
  const p = useLocalSearchParams<{ day?: string }>()
  return <FitnessTrain day={p.day} />
}
export function ExerciseEditor({
  exercise,
  open,
  onClose,
}: {
  exercise?: Exercise
  open: boolean
  onClose: () => void
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
            ] as const
          ).map((m) => chip(m, f.muscle === m, () => set({ muscle: m })))}
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
              A.upsertExercise({ ...f, name: f.name.trim() })
              onClose()
            }}
          >
            Save exercise
          </Button>
        </View>
      </Line>
    </Sheet>
  )
}
