// Editing one of the member's own foods, opened from the food page's Edit:
// photo, name, basis, state, the nutrients, other names and notes. Save
// sends only what changed and says how it went, on screen and (on a
// failure) in a toast. A food the member cannot edit (a built-in one,
// another member's) never shows the form.
import { Lock } from "lucide-react-native"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { toast } from "sonner-native"
import { liveMode } from "@/live/config"
import {
  type FoodPatch,
  foodEditError,
  type LibraryFood,
  useFood,
  useFoodEdits,
} from "@/live/nutrition-foods"
import { pickPhoto } from "../media"
import { Copy, Frame, Line, SectionHeading, Tap } from "../native-kit"
import { useTheme } from "../theme"
import { Button, Field, PinnedFooter, Screen } from "../ui"
import {
  BASIS_LABEL,
  DetailSkeleton,
  FoodLoadError,
  FoodThumb,
  fmt,
  STATE_LABEL,
} from "./nutrition-food-detail"

const NUTRIENT_FIELDS = [
  { key: "kcal", label: "Calories", unit: "kcal", required: true },
  { key: "protein", label: "Protein", unit: "g", required: true },
  { key: "carbs", label: "Carbs", unit: "g", required: true },
  { key: "fat", label: "Fat", unit: "g", required: true },
  { key: "fiber", label: "Fiber", unit: "g", required: false },
  { key: "fiber_soluble", label: "Soluble fiber", unit: "g", required: false },
  {
    key: "fiber_insoluble",
    label: "Insoluble fiber",
    unit: "g",
    required: false,
  },
  { key: "sat_fat", label: "Saturated fat", unit: "g", required: false },
  { key: "sugar", label: "Sugar", unit: "g", required: false },
  { key: "sodium", label: "Sodium", unit: "mg", required: false },
] as const
type NumKey = (typeof NUTRIENT_FIELDS)[number]["key"] | "unit_grams"

export function FoodEdit({ id }: { id: string }) {
  const t = useTheme(),
    query = useFood(id, liveMode)
  if (!liveMode)
    return (
      <Screen title="Edit food">
        <Copy size={14} muted>
          Sign in to edit your own foods.
        </Copy>
      </Screen>
    )
  if (query.data) {
    if (!query.data.can_edit)
      return (
        <Screen title="Edit food">
          <Line style={{ gap: 8 }}>
            <Lock size={16} color={t.muted} />
            <Copy size={14} muted style={{ flex: 1 }}>
              {query.data.is_global
                ? "Built-in foods are everyone's and can't be changed. Copy it to your foods to make your own."
                : "Only the member who saved this food can edit it."}
            </Copy>
          </Line>
        </Screen>
      )
    return (
      <Screen title="Edit food">
        <EditForm key={query.data.id} food={query.data} />
      </Screen>
    )
  }
  if (query.isError)
    return (
      <Screen title="Edit food">
        <FoodLoadError query={query} />
      </Screen>
    )
  return (
    <Screen title="Edit food">
      <DetailSkeleton />
    </Screen>
  )
}

type Draft = {
  name: string
  basis: string
  unit_grams: string
  state: LibraryFood["state"] | null
  aliases: string
  notes: string
} & Record<(typeof NUTRIENT_FIELDS)[number]["key"], string>

const toText = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : fmt(v)
/** A typed number: blank is null, anything unreadable is NaN. */
const parse = (s: string): number | null => {
  const clean = s.replace(/,/g, "").trim()
  if (!clean) return null
  const n = Number(clean)
  return Number.isFinite(n) ? n : Number.NaN
}
const splitAliases = (s: string) =>
  s
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean)

function draftOf(f: LibraryFood): Draft {
  return {
    name: f.name,
    basis: f.basis,
    unit_grams: toText(f.unit_grams),
    state: f.state ?? null,
    aliases: f.aliases.join(", "),
    notes: f.notes ?? "",
    kcal: toText(f.kcal),
    protein: toText(f.protein),
    carbs: toText(f.carbs),
    fat: toText(f.fat),
    fiber: toText(f.fiber),
    fiber_soluble: toText(f.fiber_soluble),
    fiber_insoluble: toText(f.fiber_insoluble),
    sat_fat: toText(f.sat_fat),
    sugar: toText(f.sugar),
    sodium: toText(f.sodium),
  }
}

/** Each field's problem, by key; empty when the draft can be saved. */
function problems(d: Draft): Partial<Record<keyof Draft, string>> {
  const out: Partial<Record<keyof Draft, string>> = {}
  if (!d.name.trim()) out.name = "Give the food a name"
  for (const f of NUTRIENT_FIELDS) {
    const v = parse(d[f.key])
    if (v === null) {
      if (f.required) out[f.key] = "Required"
    } else if (Number.isNaN(v) || v < 0) out[f.key] = "Enter a number"
  }
  const g = parse(d.unit_grams)
  if (g !== null && (Number.isNaN(g) || g <= 0))
    out.unit_grams = "Enter grams above 0, or leave it blank"
  return out
}

/** The PATCH body: only what differs from ``food``. */
export function changedFields(food: LibraryFood, d: Draft): FoodPatch {
  const body: FoodPatch = {}
  if (d.name.trim() !== food.name) body.name = d.name.trim()
  if (d.basis !== food.basis) body.basis = d.basis
  if ((d.state ?? null) !== (food.state ?? null)) body.state = d.state
  const aliases = splitAliases(d.aliases)
  if (aliases.join("\n") !== food.aliases.join("\n")) body.aliases = aliases
  const notes = d.notes.trim() || null
  if (notes !== (food.notes ?? null)) body.notes = notes
  const nums: NumKey[] = [...NUTRIENT_FIELDS.map((f) => f.key), "unit_grams"]
  for (const k of nums) {
    const v = parse(d[k])
    if (v !== (food[k] ?? null)) (body as Record<string, unknown>)[k] = v
  }
  return body
}

function EditForm({ food }: { food: LibraryFood }) {
  const t = useTheme(),
    edits = useFoodEdits(food.id),
    [draft, setDraft] = useState(() => draftOf(food)),
    [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(
      null,
    ),
    [localPhoto, setLocalPhoto] = useState<string | undefined>()
  const set = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch })
    setOutcome(null)
  }
  const errs = problems(draft),
    body = changedFields(food, draft),
    dirty = Object.keys(body).length > 0,
    valid = Object.keys(errs).length === 0
  const save = () =>
    edits.save.mutate(body, {
      onSuccess: () => setOutcome({ ok: true, text: "Saved" }),
      onError: (e) => {
        const text = foodEditError(e)
        setOutcome({ ok: false, text })
        toast.error(text)
      },
    })
  const changePhoto = async () => {
    const uri = await pickPhoto()
    if (!uri) return
    setLocalPhoto(uri)
    edits.photo.mutate(uri, {
      onSuccess: () => setLocalPhoto(undefined),
      onError: (e) => {
        setLocalPhoto(undefined)
        const text = foodEditError(e)
        setOutcome({ ok: false, text: `Photo not saved. ${text}` })
        toast.error(text)
      },
    })
  }
  const uploading = edits.photo.isPending
  const chip = (label: string, active: boolean, press: () => void) => (
    <Tap
      key={label}
      label={label}
      role="radio"
      selected={active}
      onPress={press}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 99,
        borderWidth: 1,
        borderColor: active ? t.nut : t.line,
        backgroundColor: active ? t.nut : t.card,
      }}
    >
      <Copy size={14} weight="medium" style={{ color: active ? t.bg : t.text }}>
        {label}
      </Copy>
    </Tap>
  )
  return (
    <>
      <Tap
        label={food.photo_url ? "Change food photo" : "Add food photo"}
        onPress={() => {
          if (!uploading) void changePhoto()
        }}
        style={{ alignSelf: "center" }}
      >
        <View style={{ alignItems: "center", gap: 6 }}>
          <View>
            <FoodThumb food={food} size={96} uri={localPhoto} />
            {uploading && (
              <View
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 16,
                  backgroundColor: "#00000066",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ActivityIndicator color="#ffffff" />
              </View>
            )}
          </View>
          <Copy size={12} style={{ color: uploading ? t.muted : t.nut }}>
            {uploading
              ? "Uploading photo…"
              : food.photo_url
                ? "Change photo"
                : "Add a photo"}
          </Copy>
        </View>
      </Tap>
      <Field
        label="Name"
        value={draft.name}
        onChangeText={(name) => set({ name })}
        error={errs.name}
      />
      <View style={{ gap: 6 }}>
        <Copy size={12} muted>
          Amounts are
        </Copy>
        <Line style={{ gap: 8, flexWrap: "wrap" }}>
          {Object.entries(BASIS_LABEL).map(([v, label]) =>
            chip(label, draft.basis === v, () => set({ basis: v })),
          )}
        </Line>
      </View>
      <Field
        label={
          draft.basis === "100g"
            ? "Grams in one piece (optional)"
            : `Grams in one ${draft.basis} (optional)`
        }
        value={draft.unit_grams}
        onChangeText={(unit_grams) => set({ unit_grams })}
        keyboardType="decimal-pad"
        error={errs.unit_grams}
      />
      <View style={{ gap: 6 }}>
        <Copy size={12} muted>
          State
        </Copy>
        <Line style={{ gap: 8, flexWrap: "wrap" }}>
          {Object.entries(STATE_LABEL).map(([v, label]) =>
            chip(label, draft.state === v, () =>
              set({
                state: draft.state === v ? null : (v as LibraryFood["state"]),
              }),
            ),
          )}
        </Line>
      </View>
      <SectionHeading>{`Nutrition ${BASIS_LABEL[draft.basis] ?? ""}`}</SectionHeading>
      <Frame style={{ padding: 16, gap: 4 }}>
        {NUTRIENT_FIELDS.map((f) => (
          <Field
            key={f.key}
            label={`${f.label} (${f.unit})${f.required ? "" : " — optional"}`}
            value={draft[f.key]}
            onChangeText={(v) => set({ [f.key]: v } as Partial<Draft>)}
            keyboardType="decimal-pad"
            error={errs[f.key]}
          />
        ))}
      </Frame>
      <Field
        label="Also called (comma separated)"
        value={draft.aliases}
        onChangeText={(aliases) => set({ aliases })}
        autoCapitalize="none"
      />
      <Field
        label="About this food"
        placeholder="What it is, where it's from, how you have it"
        value={draft.notes}
        onChangeText={(notes) => set({ notes })}
        multiline
      />
      {outcome && (
        <Copy size={12} style={{ color: outcome.ok ? t.good : t.bad }}>
          {outcome.text}
        </Copy>
      )}
      {/* A shared-library edit stays one deliberate save, kept on screen. */}
      <PinnedFooter>
        <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
          <Button
            disabled={!dirty || !valid || edits.save.isPending}
            onPress={save}
          >
            {edits.save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </View>
      </PinnedFooter>
    </>
  )
}
