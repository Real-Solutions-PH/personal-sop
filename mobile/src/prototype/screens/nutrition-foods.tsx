// The food library: the foods Fern has saved (read from a label, or what
// someone said), shared by every member and most used first, then the
// built-in foods the estimator knows. Meal logging checks the library
// before it estimates, so a saved food gives the same numbers every time.
// A saved food opens its own page (its photo, and every number).
import { FOODS } from "@domain/fitness/data"
import { openCapture } from "@domain/lib/capture"
import { BadgeCheck, Camera, ChevronRight, CloudOff } from "lucide-react-native"
import { useEffect, useState } from "react"
import { View } from "react-native"
import { liveMode } from "@/live/config"
import { type LibraryFood, useFoods } from "@/live/nutrition-foods"
import { Copy, Frame, Line, SectionHeading, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Button, Field, Screen } from "../ui"
import { LockedPreview } from "./locked-preview"
import { BASIS_LABEL, FoodThumb, SAMPLE_FOODS } from "./nutrition-food-detail"

const n = (v: number) => Math.round(v).toLocaleString("en-US")

type Load =
  | { state: "loading" }
  | { state: "error"; retrying: boolean }
  | { state: "ready"; foods: LibraryFood[]; count: number }

export function FoodLibrary() {
  const t = useTheme(),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    foods = useFoods(search, liveMode)
  // Typing waits for a pause before it searches; clearing is immediate.
  useEffect(() => {
    const id = setTimeout(() => setSearch(q.trim()), q.trim() ? 300 : 0)
    return () => clearTimeout(id)
  }, [q])
  const load: Load = !liveMode
    ? { state: "ready", foods: [], count: 0 }
    : foods.data
      ? { state: "ready", foods: foods.data.data, count: foods.data.count }
      : foods.isError
        ? { state: "error", retrying: foods.isFetching }
        : { state: "loading" }
  const needle = q.trim().toLowerCase()
  const builtIn = FOODS.filter(
    (f) =>
      !needle ||
      f.name.toLowerCase().includes(needle) ||
      f.aliases.some((a) => a.includes(needle)),
  )
  return (
    <Screen title="Food library">
      <Field
        label="Search foods"
        hideLabel
        placeholder="Search foods (adobo, rice, egg…)"
        value={q}
        onChangeText={setQ}
        autoCapitalize="none"
      />
      <SectionHeading
        action={
          load.state === "ready" && load.count ? (
            <Copy size={12} muted>
              {n(load.count)} saved
            </Copy>
          ) : undefined
        }
      >
        Your foods
      </SectionHeading>
      {load.state === "loading" ? (
        <Frame style={{ padding: 4 }}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={{ padding: 12, gap: 8, opacity: 0.5 }}
              accessibilityLabel="Loading foods"
            >
              <View
                style={{
                  height: 14,
                  width: "55%",
                  borderRadius: 4,
                  backgroundColor: t.soft,
                }}
              />
              <View
                style={{
                  height: 10,
                  width: "80%",
                  borderRadius: 4,
                  backgroundColor: t.soft,
                }}
              />
            </View>
          ))}
        </Frame>
      ) : load.state === "error" ? (
        <Frame style={{ padding: 16, gap: 8 }}>
          <Line style={{ gap: 10 }}>
            <CloudOff size={18} color={t.bad} />
            <Copy weight="medium" style={{ flex: 1 }}>
              Couldn’t load your foods
            </Copy>
          </Line>
          <Copy size={14} muted>
            The server didn’t answer. Your meals and saved foods are unaffected.
          </Copy>
          <Button
            small
            tone="quiet"
            disabled={load.retrying}
            onPress={() => foods.refetch()}
          >
            {load.retrying ? "Trying again…" : "Try again"}
          </Button>
        </Frame>
      ) : (
        <LockedPreview
          locked={!load.foods.length}
          title={
            needle && liveMode ? "No saved food matches" : "No saved foods yet"
          }
          detail={
            liveMode
              ? "Snap a nutrition label and tell Fern to save it. Next time you log that food, it uses the label's numbers."
              : "Sign in and snap a nutrition label: Fern saves the food here, and logging it again uses the label's numbers."
          }
          action={{
            label: "Snap a label",
            onPress: () => openCapture({ mode: "photo", hint: "meal" }),
          }}
          color={t.nut}
          icon={Camera}
        >
          <Frame style={{ padding: 4 }}>
            {(load.foods.length ? load.foods : SAMPLE_FOODS).map((f, i) => (
              <FoodRow key={f.id} food={f} first={i === 0} />
            ))}
          </Frame>
        </LockedPreview>
      )}
      <SectionHeading
        action={
          <Copy size={12} muted>
            {n(builtIn.length)}
          </Copy>
        }
      >
        Built-in foods
      </SectionHeading>
      <Copy size={12} muted>
        Typical servings the estimator starts from when a food is not in your
        library.
      </Copy>
      <Frame style={{ padding: 4 }}>
        {builtIn.map((f, i) => (
          <View
            key={f.key}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderTopWidth: i ? 1 : 0,
              borderColor: t.line,
            }}
          >
            <Line style={{ justifyContent: "space-between", gap: 8 }}>
              <Copy size={14} weight="medium" lines={1} style={{ flex: 1 }}>
                {f.name}
              </Copy>
              <Copy size={14} weight="semibold">
                {n(f.kcal)}
                <Copy size={12} muted>
                  {" "}
                  kcal
                </Copy>
              </Copy>
            </Line>
            <Copy size={12} muted lines={1}>
              {f.qty} {f.unit} · P {n(f.protein)} g · C {n(f.carbs)} g · F{" "}
              {n(f.fat)} g
            </Copy>
          </View>
        ))}
        {!builtIn.length && (
          <Copy size={14} muted style={{ padding: 12 }}>
            No built-in food matches “{q.trim()}”.
          </Copy>
        )}
      </Frame>
    </Screen>
  )
}

function FoodRow({ food: f, first }: { food: LibraryFood; first: boolean }) {
  const t = useTheme()
  return (
    <Tap
      label={`Open ${f.name}`}
      onPress={() => go(`/nutrition/foods/${encodeURIComponent(f.id)}`)}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderTopWidth: first ? 0 : 1,
        borderColor: t.line,
      }}
    >
      <Line style={{ gap: 10 }}>
        <FoodThumb food={f} />
        <View style={{ flex: 1, gap: 2 }}>
          <Line style={{ justifyContent: "space-between", gap: 8 }}>
            <Line style={{ gap: 6, flex: 1 }}>
              <Copy
                size={14}
                weight="medium"
                lines={1}
                style={{ flexShrink: 1 }}
              >
                {f.name}
              </Copy>
              {f.verified && (
                <BadgeCheck
                  size={14}
                  color={t.good}
                  accessibilityLabel="Read from a label"
                />
              )}
            </Line>
            <Copy size={14} weight="semibold">
              {n(f.kcal)}
              <Copy size={12} muted>
                {" "}
                kcal
              </Copy>
            </Copy>
          </Line>
          <Copy size={12} muted lines={1}>
            {BASIS_LABEL[f.basis] ?? f.basis}
            {f.unit_grams ? ` (${n(f.unit_grams)} g)` : ""} · P {n(f.protein)} g
            · C {n(f.carbs)} g · F {n(f.fat)} g
            {f.sodium !== null ? ` · Na ${n(f.sodium)} mg` : ""}
          </Copy>
          {f.use_count > 0 && (
            <Copy size={11} muted>
              Logged {n(f.use_count)} time{f.use_count === 1 ? "" : "s"}
            </Copy>
          )}
        </View>
        <ChevronRight size={16} color={t.muted} />
      </Line>
    </Tap>
  )
}
