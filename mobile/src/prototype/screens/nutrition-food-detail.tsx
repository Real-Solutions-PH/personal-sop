// One food in the shared library: its photo, name, basis, state, the eight
// nutrients, other names and notes. Its author (or an admin) edits it here
// and Save sends only what changed; everyone else reads it. Every save and
// photo change reports how it went.
import { Image } from "expo-image"
import { BadgeCheck, BookOpen, CloudOff } from "lucide-react-native"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { toast } from "sonner-native"
import { liveMode } from "@/live/config"
import { ApiError } from "@/live/http"
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
import { Button, Empty, Field, Screen } from "../ui"

/** A number with thousands separators, one decimal at most. */
export const fmt = (v: number) =>
  v.toLocaleString("en-US", { maximumFractionDigits: 1 })

export const BASIS_LABEL: Record<string, string> = {
  "100g": "per 100 g",
  piece: "per piece",
  serving: "per serving",
}
const STATE_LABEL: Record<string, string> = {
  raw: "Raw",
  cooked: "Cooked",
  as_sold: "As sold",
}

/** Shown while signed out, and as the dimmed preview of an empty library. */
export const SAMPLE_FOODS: LibraryFood[] = [
  {
    id: "sample-1",
    name: "Chicken breast, grilled",
    aliases: [],
    basis: "100g",
    unit_grams: null,
    state: "cooked",
    kcal: 165,
    protein: 31,
    carbs: 0,
    fat: 3.6,
    fiber: 0,
    sat_fat: 1,
    sugar: 0,
    sodium: 74,
    notes: null,
    source: "label",
    verified: true,
    use_count: 12,
    last_used_at: null,
    photo_media_id: null,
    photo_url: null,
    can_edit: false,
  },
  {
    id: "sample-2",
    name: "Greek yogurt, plain",
    aliases: [],
    basis: "serving",
    unit_grams: 170,
    state: "as_sold",
    kcal: 100,
    protein: 17,
    carbs: 6,
    fat: 0.7,
    fiber: 0,
    sat_fat: 0.2,
    sugar: 0,
    sodium: 61,
    notes: null,
    source: "label",
    verified: false,
    use_count: 4,
    last_used_at: null,
    photo_media_id: null,
    photo_url: null,
    can_edit: false,
  },
]

const NUTRIENT_FIELDS = [
  { key: "kcal", label: "Calories", unit: "kcal", required: true },
  { key: "protein", label: "Protein", unit: "g", required: true },
  { key: "carbs", label: "Carbs", unit: "g", required: true },
  { key: "fat", label: "Fat", unit: "g", required: true },
  { key: "fiber", label: "Fiber", unit: "g", required: false },
  { key: "sat_fat", label: "Saturated fat", unit: "g", required: false },
  { key: "sugar", label: "Sugar", unit: "g", required: false },
  { key: "sodium", label: "Sodium", unit: "mg", required: false },
] as const
type NumKey = (typeof NUTRIENT_FIELDS)[number]["key"] | "unit_grams"

/** A food's photo, or the library's book icon when it has none. */
export function FoodThumb({
  food,
  size = 36,
  uri,
}: {
  food: Pick<LibraryFood, "photo_url" | "photo_media_id" | "name">
  size?: number
  /** A local photo shown in place of the server's (an upload in flight). */
  uri?: string
}) {
  const t = useTheme(),
    src = uri ?? food.photo_url
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size >= 64 ? 16 : 8,
        backgroundColor: `${t.nut}26`,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {src ? (
        <Image
          source={
            uri || !food.photo_media_id
              ? { uri: src }
              : { uri: src, cacheKey: food.photo_media_id }
          }
          style={{ width: size, height: size }}
          contentFit="cover"
          accessibilityLabel={`Photo of ${food.name}`}
        />
      ) : (
        <BookOpen size={Math.round(size / 2.4)} color={t.nut} />
      )}
    </View>
  )
}

export function FoodDetail({ id }: { id: string }) {
  const t = useTheme(),
    query = useFood(id, liveMode)
  if (!liveMode) {
    const food = SAMPLE_FOODS.find((f) => f.id === id) ?? SAMPLE_FOODS[0]
    return (
      <Screen title={food.name}>
        <Copy size={12} muted>
          A sample food. Sign in to see and edit the shared food library.
        </Copy>
        <FoodBody food={food} />
      </Screen>
    )
  }
  if (query.data)
    return (
      <Screen title={query.data.name}>
        <FoodBody key={query.data.id} food={query.data} />
      </Screen>
    )
  if (query.isError) {
    const missing =
      query.error instanceof ApiError && query.error.status === 404
    return (
      <Screen title="Food">
        {missing ? (
          <Empty
            title="Food not found"
            detail="It may have been merged into another food or removed."
          />
        ) : (
          <Frame style={{ padding: 16, gap: 8 }}>
            <Line style={{ gap: 10 }}>
              <CloudOff size={18} color={t.bad} />
              <Copy weight="medium" style={{ flex: 1 }}>
                Couldn’t load this food
              </Copy>
            </Line>
            <Copy size={14} muted>
              The server didn’t answer. Nothing has changed.
            </Copy>
            <Button
              small
              tone="quiet"
              disabled={query.isFetching}
              onPress={() => query.refetch()}
            >
              {query.isFetching ? "Trying again…" : "Try again"}
            </Button>
          </Frame>
        )}
      </Screen>
    )
  }
  return (
    <Screen title="Food">
      <DetailSkeleton />
    </Screen>
  )
}

function DetailSkeleton() {
  const t = useTheme()
  return (
    <View style={{ gap: 12 }} accessibilityLabel="Loading food">
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: 16,
          backgroundColor: t.soft,
          alignSelf: "center",
        }}
      />
      {[0, 1, 2].map((i) => (
        <Frame key={i} style={{ padding: 16, gap: 8, opacity: 0.5 }}>
          <View
            style={{
              height: 14,
              width: "45%",
              borderRadius: 4,
              backgroundColor: t.soft,
            }}
          />
          <View
            style={{
              height: 10,
              width: "75%",
              borderRadius: 4,
              backgroundColor: t.soft,
            }}
          />
        </Frame>
      ))}
    </View>
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

function FoodBody({ food }: { food: LibraryFood }) {
  const t = useTheme(),
    editable = liveMode && !!food.can_edit,
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
  const photo = (
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
      {editable && (
        <Copy size={12} style={{ color: uploading ? t.muted : t.nut }}>
          {uploading
            ? "Uploading photo…"
            : food.photo_url
              ? "Change photo"
              : "Add a photo"}
        </Copy>
      )}
    </View>
  )
  return (
    <>
      {editable ? (
        <Tap
          label={food.photo_url ? "Change food photo" : "Add food photo"}
          onPress={() => {
            if (!uploading) void changePhoto()
          }}
          style={{ alignSelf: "center" }}
        >
          {photo}
        </Tap>
      ) : (
        photo
      )}
      <Line style={{ gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
        {food.verified && (
          <Line style={{ gap: 4 }}>
            <BadgeCheck size={14} color={t.good} />
            <Copy size={12} muted>
              Read from a label
            </Copy>
          </Line>
        )}
        {food.use_count > 0 && (
          <Copy size={12} muted>
            Logged {fmt(food.use_count)} time{food.use_count === 1 ? "" : "s"}
          </Copy>
        )}
      </Line>
      {liveMode && !editable && (
        <Copy size={12} muted style={{ textAlign: "center" }}>
          Added by another member — only they can edit it.
        </Copy>
      )}
      {editable ? (
        <>
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
                    state:
                      draft.state === v ? null : (v as LibraryFood["state"]),
                  }),
                ),
              )}
            </Line>
          </View>
          <SectionHeading>
            {`Nutrition ${BASIS_LABEL[draft.basis] ?? ""}`}
          </SectionHeading>
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
            label="Notes"
            value={draft.notes}
            onChangeText={(notes) => set({ notes })}
            multiline
          />
          {outcome && (
            <Copy size={12} style={{ color: outcome.ok ? t.good : t.bad }}>
              {outcome.text}
            </Copy>
          )}
          <Button
            disabled={!dirty || !valid || edits.save.isPending}
            onPress={save}
          >
            {edits.save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </>
      ) : (
        <ReadOnly food={food} outcome={outcome?.text} />
      )}
    </>
  )
}

function ReadOnly({ food, outcome }: { food: LibraryFood; outcome?: string }) {
  const t = useTheme()
  const row = (label: string, value: string, first = false) => (
    <Line
      key={label}
      style={{
        justifyContent: "space-between",
        gap: 8,
        paddingVertical: 10,
        borderTopWidth: first ? 0 : 1,
        borderColor: t.line,
      }}
    >
      <Copy size={14} muted>
        {label}
      </Copy>
      <Copy size={14} weight="medium" style={{ flexShrink: 1 }}>
        {value}
      </Copy>
    </Line>
  )
  return (
    <>
      <Frame style={{ paddingHorizontal: 16 }}>
        {row("Name", food.name, true)}
        {row(
          "Amounts are",
          `${BASIS_LABEL[food.basis] ?? food.basis}${
            food.unit_grams ? ` (${fmt(food.unit_grams)} g)` : ""
          }`,
        )}
        {row("State", food.state ? STATE_LABEL[food.state] : "Not set")}
      </Frame>
      <SectionHeading>
        {`Nutrition ${BASIS_LABEL[food.basis] ?? ""}`}
      </SectionHeading>
      <Frame style={{ paddingHorizontal: 16 }}>
        {NUTRIENT_FIELDS.map((f, i) => {
          const v = food[f.key]
          return row(
            f.label,
            v === null || v === undefined ? "—" : `${fmt(v)} ${f.unit}`,
            i === 0,
          )
        })}
      </Frame>
      {(food.aliases.length > 0 || !!food.notes) && (
        <Frame style={{ paddingHorizontal: 16 }}>
          {food.aliases.length > 0 &&
            row("Also called", food.aliases.join(", "), true)}
          {!!food.notes && row("Notes", food.notes, !food.aliases.length)}
        </Frame>
      )}
      {outcome && (
        <Copy size={12} style={{ color: t.bad }}>
          {outcome}
        </Copy>
      )}
    </>
  )
}
