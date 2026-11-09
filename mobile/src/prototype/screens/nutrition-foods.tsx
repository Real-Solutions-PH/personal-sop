// The food library: every food this person can log, and where each came
// from, said on every row with a fixed icon and word. "You": foods they
// logged by hand or imported themselves. "Fern": foods Fern saved (read from
// a label, or what it was told) and foods it logged from the chat.
// "USDA" (and the other public databases the server holds): lab or label
// data imported in bulk. A filter keeps one source; a search reaches all
// three, needs every word typed (any order), shows the words it matched,
// and puts this person's own and recent foods first. A saved food opens its
// page; a food only in their meal history opens the day they ate it.
import { relDay } from "@domain/fitness/calc"
import { FOODS } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { openCapture } from "@domain/lib/capture"
import { dayKey } from "@domain/lib/day"
import {
  BadgeCheck,
  Camera,
  Check,
  ChevronRight,
  CloudOff,
  Database,
  type LucideIcon,
  PencilLine,
  Search,
  SearchX,
  UserRound,
  Utensils,
  X,
} from "lucide-react-native"
import { useEffect, useMemo, useState } from "react"
import { ScrollView, TextInput, View } from "react-native"
import { liveMode } from "@/live/config"
import {
  type LibraryFood,
  useFoods,
  verifiedLabel,
} from "@/live/nutrition-foods"
import { FernSprite } from "../companion/fern-sprite"
import {
  type FoodEntry,
  highlight,
  historyEntries,
  lastAte,
  libraryEntry,
  type Origin,
  rank,
  words,
} from "../food-search"
import {
  border,
  Copy,
  chosen,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Button, Screen } from "../ui"
import { BuiltInMark } from "./fitness-exercises"
import { LockedPreview } from "./locked-preview"
import { BASIS_LABEL, FoodThumb, SAMPLE_FOODS } from "./nutrition-food-detail"

const n = (v: number) => Math.round(v).toLocaleString("en-US")

type Filter = "all" | Origin

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "you", label: "You" },
  { value: "fern", label: "Fern" },
  { value: "database", label: "USDA" },
]

/** The fixed mark of each source: the person, Fern, a database. */
export function OriginIcon({
  origin,
  size = 14,
}: {
  origin: Origin
  size?: number
}) {
  const t = useTheme()
  if (origin === "fern")
    return <FernSprite size={size + 4} state="idle" still decorative />
  const Icon: LucideIcon = origin === "you" ? UserRound : Database
  return <Icon size={size} color={t.muted} />
}

/** A food's amount line: what its numbers are per. */
function amountOf(f: LibraryFood) {
  return `${BASIS_LABEL[f.basis] ?? f.basis}${f.unit_grams ? ` (${n(f.unit_grams)} g)` : ""}`
}

export function FoodLibrary() {
  const t = useTheme(),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState<Filter>("all"),
    origin = filter === "all" ? undefined : filter,
    // The server is asked only for what it holds that this filter shows:
    // "You" foods mostly live in the meal history, but imports are saved.
    foods = useFoods(search, liveMode, origin),
    meals = fitStore.use((s) => s.meals)
  // Typing waits for a pause before it searches; clearing is immediate.
  useEffect(() => {
    const id = setTimeout(() => setSearch(q.trim()), q.trim() ? 300 : 0)
    return () => clearTimeout(id)
  }, [q])
  const data = foods.data?.data
  const library = useMemo<LibraryFood[]>(
    () => (liveMode && data ? data : []),
    [data],
  )
  const ws = words(q)
  const entries = useMemo(() => {
    const ate = lastAte(meals)
    const all = [
      ...library.map((f) => libraryEntry(f, ate, amountOf(f))),
      ...historyEntries(meals, library),
    ]
    return rank(
      all.filter((e) => !origin || e.origin === origin),
      q,
    )
  }, [library, meals, origin, q])
  const own = entries.filter((e) => e.origin !== "database")
  const db = entries.filter((e) => e.origin === "database")
  const loading = liveMode && !foods.data && !foods.isError
  const failed = liveMode && foods.isError && !foods.data
  const total = foods.data?.count ?? 0
  const dbMore = liveMode && total > library.length && filter !== "you"
  const builtIn =
    filter === "all"
      ? FOODS.filter(
          (f) =>
            !ws.length ||
            ws.every(
              (w) =>
                f.name.toLowerCase().includes(w) ||
                f.aliases.some((a) => a.includes(w)),
            ),
        )
      : []
  return (
    <Screen title="Food library">
      <Line
        style={{
          borderWidth: 1,
          borderColor: border(t.line, 0.6),
          borderRadius: 16,
          backgroundColor: t.card,
          paddingHorizontal: 12,
          gap: 8,
        }}
      >
        <Search size={16} color={t.muted} />
        <TextInput
          accessibilityLabel="Search foods"
          placeholder="Search your foods, Fern's and USDA"
          placeholderTextColor={t.muted}
          value={q}
          onChangeText={setQ}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={{
            height: 48,
            flex: 1,
            fontFamily: fonts.body,
            fontSize: 16,
            color: t.text,
          }}
        />
        {!!q && (
          <IconTap icon={X} label="Clear search" onPress={() => setQ("")} />
        )}
      </Line>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Line style={{ gap: 8, paddingVertical: 2 }}>
          {FILTERS.map((f) => (
            <FilterChip
              key={f.value}
              filter={f.value}
              label={f.label}
              active={filter === f.value}
              onPress={() => setFilter(f.value)}
            />
          ))}
        </Line>
      </ScrollView>
      {failed && (
        <Frame style={{ padding: 16, gap: 8 }}>
          <Line style={{ gap: 10 }}>
            <CloudOff size={18} color={t.bad} />
            <Copy weight="medium" style={{ flex: 1 }}>
              Couldn’t reach the food library
            </Copy>
          </Line>
          <Copy size={14} muted>
            Saved and USDA foods need the server. Foods from your own meals
            still show below.
          </Copy>
          <Button
            small
            tone="quiet"
            disabled={foods.isFetching}
            onPress={() => foods.refetch()}
          >
            {foods.isFetching ? "Trying again…" : "Try again"}
          </Button>
        </Frame>
      )}
      {loading && !entries.length ? (
        <Skeleton />
      ) : !entries.length ? (
        q.trim() ? (
          <NoMatch
            q={q.trim()}
            filter={filter}
            onClear={() => setQ("")}
            onAll={() => setFilter("all")}
          />
        ) : (
          <EmptyLibrary filter={filter} />
        )
      ) : (
        <>
          {own.length > 0 && (
            <>
              <SectionHeading
                action={
                  <Copy size={12} muted>
                    {n(own.length)}
                  </Copy>
                }
              >
                {filter === "you"
                  ? "Logged by you"
                  : filter === "fern"
                    ? "Saved and logged by Fern"
                    : ws.length
                      ? "Yours and Fern’s"
                      : "Recent and yours"}
              </SectionHeading>
              <Rows entries={own} ws={ws} />
            </>
          )}
          {loading && <Skeleton rows={2} />}
          {db.length > 0 && (
            <>
              <SectionHeading
                action={
                  <Copy size={12} muted>
                    {dbMore && filter === "database"
                      ? `${n(db.length)} of ${n(total)}`
                      : n(db.length)}
                  </Copy>
                }
              >
                {ws.length || filter === "database"
                  ? "Food databases"
                  : "Database foods you ate"}
              </SectionHeading>
              <Rows entries={db} ws={ws} />
              {dbMore && filter === "database" && (
                <Copy size={12} muted>
                  Showing the first {n(db.length)}. Type a food to narrow the
                  list.
                </Copy>
              )}
            </>
          )}
          {!ws.length && filter === "all" && liveMode && (
            <Tap
              label="Browse USDA foods"
              onPress={() => setFilter("database")}
              style={{ paddingVertical: 4 }}
            >
              <Line style={{ gap: 8 }}>
                <Database size={14} color={t.muted} />
                <Copy size={13} muted style={{ flex: 1 }}>
                  Search or browse USDA’s lab-analysed foods
                </Copy>
                <ChevronRight size={14} color={t.muted} />
              </Line>
            </Tap>
          )}
        </>
      )}
      {builtIn.length > 0 && <BuiltIn foods={builtIn} />}
    </Screen>
  )
}

function FilterChip({
  filter,
  label,
  active,
  onPress,
}: {
  filter: Filter
  label: string
  active: boolean
  onPress: () => void
}) {
  const t = useTheme()
  return (
    <Tap
      label={`Show ${filter === "all" ? "every source" : `foods from ${label}`}`}
      selected={active}
      onPress={onPress}
      style={{
        minHeight: 36,
        paddingHorizontal: 12,
        borderRadius: 18,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        ...chosen(t, active),
      }}
    >
      {active && <Check size={13} color={t.text} />}
      {filter !== "all" && <OriginIcon origin={filter} size={13} />}
      <Copy size={13} weight="medium">
        {label}
      </Copy>
    </Tap>
  )
}

function Rows({ entries, ws }: { entries: FoodEntry[]; ws: string[] }) {
  return (
    <Frame style={{ padding: 4 }}>
      {entries.map((e, i) => (
        <FoodRow key={e.key} entry={e} ws={ws} first={i === 0} />
      ))}
    </Frame>
  )
}

/** The name with the words it matched drawn stronger, on a tint. */
function Name({ name, ws }: { name: string; ws: string[] }) {
  const t = useTheme()
  return (
    <Copy size={14} weight="medium" style={{ flexShrink: 1 }}>
      {highlight(name, ws).map((p, i) =>
        p.hit ? (
          <Copy
            key={i}
            size={14}
            weight="semibold"
            style={{ backgroundColor: `${t.nut}38`, color: t.text }}
          >
            {p.text}
          </Copy>
        ) : (
          p.text
        ),
      )}
    </Copy>
  )
}

function FoodRow({
  entry: e,
  ws,
  first,
}: {
  entry: FoodEntry
  ws: string[]
  first: boolean
}) {
  const t = useTheme()
  const f = e.food
  const ateLine = e.at
    ? `Last eaten: ${relDay(new Date(e.at).toISOString())}`
    : e.uses > 0
      ? `Logged ${n(e.uses)} time${e.uses === 1 ? "" : "s"}`
      : null
  return (
    <Tap
      label={
        f
          ? `Open ${e.name}, from ${e.label}`
          : `Open the day you ate ${e.name}, logged by ${e.label}`
      }
      onPress={() =>
        f
          ? go(`/nutrition/foods/${encodeURIComponent(f.id)}`)
          : go(`/nutrition?day=${dayKey(new Date(e.day ?? Date.now()))}`)
      }
      style={{
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderTopWidth: first ? 0 : 1,
        borderColor: t.line,
      }}
    >
      <Line style={{ gap: 10, alignItems: "flex-start" }}>
        {f ? (
          <FoodThumb food={f} />
        ) : (
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              backgroundColor: `${t.nut}26`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Utensils size={16} color={t.nut} />
          </View>
        )}
        <View style={{ flex: 1, gap: 3 }}>
          <Line style={{ justifyContent: "space-between", gap: 8 }}>
            <Line style={{ gap: 6, flex: 1 }}>
              <Name name={e.name} ws={ws} />
              {f?.verified && (
                <BadgeCheck
                  size={14}
                  color={t.good}
                  accessibilityLabel={verifiedLabel(f)}
                />
              )}
            </Line>
            <Copy size={14} weight="semibold">
              {n(e.kcal)}
              <Copy size={12} muted>
                {" "}
                kcal
              </Copy>
            </Copy>
          </Line>
          <Line style={{ gap: 6, flexWrap: "wrap" }}>
            <SourceBadge origin={e.origin} label={e.label} />
            {f?.is_global && <BuiltInMark />}
            <Copy size={12} muted>
              {e.amount} · P {n(e.protein)} · C {n(e.carbs)} · F {n(e.fat)} g
            </Copy>
          </Line>
          {ateLine && (
            <Copy size={11} muted>
              {ateLine}
            </Copy>
          )}
        </View>
        <ChevronRight size={16} color={t.muted} style={{ marginTop: 10 }} />
      </Line>
    </Tap>
  )
}

/** The fixed icon and word of a row's source, on a neutral tile. */
function SourceBadge({ origin, label }: { origin: Origin; label: string }) {
  const t = useTheme()
  return (
    <Line
      style={{
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
        backgroundColor: t.soft,
      }}
    >
      <OriginIcon origin={origin} size={11} />
      <Copy size={11} weight="medium">
        {label}
      </Copy>
    </Line>
  )
}

function Skeleton({ rows = 3 }: { rows?: number }) {
  const t = useTheme()
  return (
    <Frame style={{ padding: 4 }}>
      {Array.from({ length: rows }, (_, i) => (
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
  )
}

/** A search that found nothing: say what was searched where, and the way
 * on (another source, fewer words, or Fern adding it). */
function NoMatch({
  q,
  filter,
  onClear,
  onAll,
}: {
  q: string
  filter: Filter
  onClear: () => void
  onAll: () => void
}) {
  const t = useTheme()
  const where = FILTERS.find((f) => f.value === filter)?.label ?? "All"
  return (
    <Frame style={{ padding: 16, gap: 10 }}>
      <Line style={{ gap: 10 }}>
        <SearchX size={18} color={t.muted} />
        <Copy weight="medium" style={{ flex: 1 }}>
          No food matches “{q}”{filter === "all" ? "" : ` in ${where}`}
        </Copy>
      </Line>
      <Copy size={14} muted>
        Every word has to be in the name. Try fewer words, or another spelling
        (“itlog” or “egg”).
      </Copy>
      <Line style={{ gap: 8, flexWrap: "wrap" }}>
        {filter !== "all" && (
          <Button small tone="quiet" onPress={onAll}>
            Search every source
          </Button>
        )}
        <Button
          small
          tone="quiet"
          onPress={() => openCapture({ mode: "photo", hint: "meal" })}
        >
          Snap its label
        </Button>
        <Button small tone="quiet" onPress={onClear}>
          Clear search
        </Button>
      </Line>
    </Frame>
  )
}

const EMPTY: Record<
  Filter,
  {
    title: string
    detail: string
    action: { label: string; onPress?: () => void; href?: string }
    icon: LucideIcon
  }
> = {
  all: {
    title: "Your library fills as you log",
    detail:
      "Every food you or Fern log shows here, with where it came from. Snap a nutrition label and Fern saves its exact numbers.",
    action: {
      label: "Snap a label",
      onPress: () => openCapture({ mode: "photo", hint: "meal" }),
    },
    icon: Camera,
  },
  you: {
    title: "Nothing logged by hand yet",
    detail:
      "Foods you add by hand show here, marked You, so you can find and log them again.",
    action: { label: "Add a meal by hand", href: "/nutrition/new" },
    icon: PencilLine,
  },
  fern: {
    title: "Fern hasn’t saved a food yet",
    detail:
      "Tell Fern what you ate, or snap a label: what Fern logs and saves shows here, marked Fern.",
    action: {
      label: "Snap a label",
      onPress: () => openCapture({ mode: "photo", hint: "meal" }),
    },
    icon: Camera,
  },
  database: {
    title: "USDA foods need the server",
    detail:
      "Sign in to search USDA’s lab-analysed foods and the other public databases.",
    action: { label: "Sign in", href: "/welcome" },
    icon: Database,
  },
}

/** Nothing to show for this filter: the real rows, dimmed, behind the step
 * that fills them. */
function EmptyLibrary({ filter }: { filter: Filter }) {
  const t = useTheme()
  const e = EMPTY[filter]
  const sample = SAMPLE_FOODS.map((f, i) => {
    const entry = libraryEntry(f, new Map(), amountOf(f))
    const origin: Origin =
      filter === "all" ? (["fern", "you", "database"] as const)[i % 3] : filter
    return {
      ...entry,
      origin,
      label: origin === "database" ? "USDA" : origin === "you" ? "You" : "Fern",
    }
  })
  return (
    <LockedPreview
      locked
      title={e.title}
      detail={e.detail}
      action={e.action}
      color={t.nut}
      icon={e.icon}
    >
      <Rows entries={sample} ws={[]} />
    </LockedPreview>
  )
}

function BuiltIn({ foods }: { foods: typeof FOODS }) {
  const t = useTheme()
  return (
    <>
      <SectionHeading
        action={
          <Copy size={12} muted>
            {n(foods.length)}
          </Copy>
        }
      >
        Built-in estimates
      </SectionHeading>
      <Copy size={12} muted>
        Typical servings Fern starts from when a food is in none of the sources
        above.
      </Copy>
      <Frame style={{ padding: 4 }}>
        {foods.map((f, i) => (
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
              <Copy size={14} weight="medium" style={{ flex: 1 }}>
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
            <Copy size={12} muted>
              {f.qty} {f.unit} · P {n(f.protein)} · C {n(f.carbs)} · F{" "}
              {n(f.fat)} g
            </Copy>
          </View>
        ))}
      </Frame>
    </>
  )
}
