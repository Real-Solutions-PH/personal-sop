import { AREA, MODULE_KEYS } from "@domain/dash/data"
import {
  TROPHY_LABEL,
  type TrophyType,
  useAchievements,
  useAllMisses,
  useEnabled,
  useGoals,
} from "@domain/dash/hooks"
import { dashStore, markTrophiesSeen, noteMiss } from "@domain/dash/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import { moveToToday } from "@domain/tasks/actions"
import { useFocusEffect, useLocalSearchParams, usePathname } from "expo-router"
import { useCallback, useEffect, useRef, useState } from "react"
import { ScrollView, View } from "react-native"
import Animated, { useReducedMotion, ZoomIn } from "react-native-reanimated"
import { TrophyBadge } from "../brand/badge"
import {
  LockedTrophy,
  TROPHY_COLOR,
  TrophyCard,
  TrophyCounts,
  TrophyGrid,
} from "../brand/trophy"
import { FernCelebrates } from "../companion/fern-celebrates"
import { useNoteGoals } from "../goal-ledger"
import { MissedGoals } from "../missed-goals"
import {
  border,
  Copy,
  Frame,
  Line,
  SectionHeading,
  Segmented,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Button, Field, Screen, Sheet } from "../ui"

const moduleColor = {
  habits: "hab",
  tasks: "tsk",
  fitness: "fit",
  nutrition: "nut",
  focus: "foc",
  screen: "scr",
  finance: "fin",
} as const
const fmt = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
/** First letter up, the rest as written: "records" → "Records". */
const sentence = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)

export function Misses() {
  const p = useLocalSearchParams<{ range?: string }>(),
    [range, setRange] = useState(p.range?.replace("d", "") || "7"),
    days = Number(range),
    t = useTheme(),
    cur = useAllMisses(dayOffset(-(days - 1)), dayKey()),
    prev = useAllMisses(dayOffset(-(days * 2 - 1)), dayOffset(-days)),
    notes = dashStore.use((s) => s.missNotes),
    enabled = useEnabled(),
    keys = MODULE_KEYS.filter((k) => enabled[k]),
    [filter, setFilter] = useState("all"),
    [noting, setNoting] = useState<(typeof cur)[number] | null>(null),
    [text, setText] = useState(""),
    goals = useGoals()
  useNoteGoals(goals)
  const count = (l: typeof cur, k?: string) =>
    l.filter((m) => (!k || m.module === k) && !notes[m.id]).length
  const delta = (n: number) => (
    <Copy size={12} style={{ color: n <= 0 ? t.good : t.bad }}>
      {n > 0 ? "+" : ""}
      {n === 0 ? "—" : n}
    </Copy>
  )
  const chip = (label: string, active: boolean, press: () => void) => (
    <Tap
      key={label}
      onPress={press}
      style={{
        height: 44,
        justifyContent: "center",
        borderRadius: 22,
        paddingHorizontal: 12,
        backgroundColor: active ? t.primary : t.soft,
      }}
    >
      <Copy size={12} style={{ color: active ? t.onPrimary : t.text }}>
        {label}
      </Copy>
    </Tap>
  )
  return (
    <Screen title="Misses & leaks">
      <Segmented
        value={range}
        onChange={setRange}
        options={[
          ["7", "7d"],
          ["30", "30d"],
          ["90", "90d"],
          ["365", "1y"],
        ].map(([value, label]) => ({ value, label }))}
      />
      <Frame style={{ padding: 16 }}>
        <Line style={{ alignItems: "baseline", gap: 8 }}>
          <Copy size={36} weight="display">
            {count(cur)}
          </Copy>
          <Copy size={14} muted style={{ flex: 1 }}>
            misses · last {days}d
          </Copy>
          {delta(count(cur) - count(prev))}
          <Copy size={12} muted>
            vs prior
          </Copy>
        </Line>
        <Line style={{ marginTop: 12, gap: 8 }}>
          {keys.map((k) => (
            <View
              key={k}
              style={{
                flex: 1,
                padding: 8,
                borderRadius: 12,
                backgroundColor: border(t.soft, 0.5),
                alignItems: "center",
              }}
            >
              <Copy size={18} weight="semibold">
                {count(cur, k)}
              </Copy>
              <Copy size={12} muted>
                {AREA[k].label}
              </Copy>
              {delta(count(cur, k) - count(prev, k))}
            </View>
          ))}
        </Line>
        <Copy size={12} muted style={{ marginTop: 12 }}>
          Noted misses drop out of the count but stay listed. They still count
          against on-target rate.
        </Copy>
      </Frame>
      <MissedGoals goals={goals.map((g) => g.goal)} link />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ gap: 8 }}
      >
        {chip("All", filter === "all", () => setFilter("all"))}
        {keys.map((k) => chip(AREA[k].label, filter === k, () => setFilter(k)))}
      </ScrollView>
      {keys
        .filter((k) => filter === "all" || filter === k)
        .map((k) => {
          const ms = cur.filter((m) => m.module === k)
          return !ms.length ? null : (
            <View key={k}>
              <SectionHeading>
                {AREA[k].label} · {ms.length}
              </SectionHeading>
              <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
                {ms.map((m, i) => (
                  <View
                    key={m.id}
                    style={{
                      paddingVertical: 10,
                      borderBottomWidth: i < ms.length - 1 ? 1 : 0,
                      borderBottomColor: border(t.line, 0.5),
                    }}
                  >
                    <Line style={{ gap: 8, alignItems: "flex-start" }}>
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          marginTop: 6,
                          backgroundColor: t[moduleColor[k]],
                        }}
                      />
                      <View style={{ flex: 1 }}>
                        <Copy size={14} muted={!!notes[m.id]}>
                          {m.title}
                        </Copy>
                        <Copy size={12} muted>
                          {fmt(m.day)}
                          {notes[m.id] ? ` · ${notes[m.id]}` : ""}
                        </Copy>
                      </View>
                    </Line>
                    <Line style={{ paddingLeft: 16, marginTop: 6, gap: 6 }}>
                      {m.id.startsWith("task-overdue:") &&
                        chip("→ Today", false, () =>
                          moveToToday(m.id.slice(13)),
                        )}
                      {chip(notes[m.id] ? "Edit note" : "Note", false, () => {
                        setText(notes[m.id] ?? "")
                        setNoting(m)
                      })}
                      {chip("Open ›", false, () => go(m.href))}
                    </Line>
                  </View>
                ))}
              </Frame>
            </View>
          )
        })}
      {!cur.length && (
        <Frame style={{ padding: 24, gap: 12, alignItems: "center" }}>
          <Copy weight="semibold">No misses in this range</Copy>
          <Copy muted>Nothing slipped. Enjoy it — then raise a target.</Copy>
          <Button href="/stats/goals">Raise a goal</Button>
        </Frame>
      )}
      <Sheet title="Add a note" open={!!noting} onClose={() => setNoting(null)}>
        <Copy muted>{noting?.title}</Copy>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {["Sick", "Rest day", "Travel", "Work ran late", "Chose not to"].map(
            (q) => chip(q, text === q, () => setText(q)),
          )}
        </View>
        <Field
          label="Note"
          placeholder="Or say why in a few words"
          maxLength={80}
          value={text}
          onChangeText={setText}
        />
        <Line>
          {noting && notes[noting.id] && (
            <Button
              tone="quiet"
              onPress={() => {
                noteMiss(noting.id, "")
                setNoting(null)
              }}
            >
              Clear
            </Button>
          )}
          <View style={{ flex: 1 }}>
            <Button
              onPress={() => {
                if (noting) noteMiss(noting.id, text)
                setNoting(null)
              }}
            >
              Save note
            </Button>
          </View>
        </Line>
      </Sheet>
    </Screen>
  )
}
const order: TrophyType[] = ["pr", "streak", "best", "goal", "first"]
export function Trophies() {
  const t = useTheme(),
    reduced = useReducedMotion(),
    p = useLocalSearchParams<{ open?: string }>(),
    catalog = useAchievements(),
    trophies = catalog.flatMap((a) => (a.trophy ? [a.trophy] : [])),
    [fresh] = useState(
      () =>
        new Set(
          trophies
            .filter((x) => !dashStore.get().seenTrophies.includes(x.id))
            .map((x) => x.id),
        ),
    ),
    [open, setOpen] = useState(p.open ?? ""),
    selected = trophies.find((x) => x.id === open),
    path = usePathname(),
    // What a sheet button does once the sheet has left: a screen pushed
    // while its modal is still up lands underneath it.
    after = useRef<string | null>(null)
  // Leaving the Trophy case by any route closes the sheet with it.
  useFocusEffect(useCallback(() => () => setOpen(""), []))
  const leave = (href: string, id: string) => {
    markTrophiesSeen([id])
    after.current = href.split("?")[0] === path ? null : href
    setOpen("")
  }
  useEffect(() => {
    const unseen = trophies.filter(
      (x) => !dashStore.get().seenTrophies.includes(x.id),
    )
    if (unseen.length) markTrophiesSeen(unseen.map((x) => x.id))
  }, [trophies])
  return (
    <Screen title="Trophy case">
      <TrophyCounts
        items={order.map((type) => {
          const all = catalog.filter((a) => a.type === type)
          return {
            key: type,
            earned: all.filter((x) => x.trophy).length,
            total: all.length,
            label: sentence(TROPHY_LABEL[type].split(" ").at(-1) ?? ""),
          }
        })}
      />
      {order.map((type) => {
        const items = catalog
          .filter((a) => a.type === type)
          .sort((a, b) =>
            a.trophy && b.trophy
              ? b.trophy.day.localeCompare(a.trophy.day)
              : a.trophy
                ? -1
                : b.trophy
                  ? 1
                  : b.progress.pct - a.progress.pct,
          )
        return !items.length ? null : (
          <View key={type}>
            <SectionHeading>
              {TROPHY_LABEL[type]} · {items.filter((a) => a.trophy).length} /{" "}
              {items.length}
            </SectionHeading>
            <TrophyGrid>
              {items.map((a) =>
                a.trophy ? (
                  <Tap
                    key={a.id}
                    label={`${a.trophy.title}, ${a.trophy.value}, earned ${fmt(a.trophy.day)}`}
                    onPress={() => setOpen(a.trophy!.id)}
                    style={{ width: "48%" }}
                  >
                    <TrophyCard
                      type={type}
                      value={a.trophy.value}
                      title={a.trophy.title}
                      date={fmt(a.trophy.day)}
                      fresh={fresh.has(a.trophy.id)}
                    />
                  </Tap>
                ) : (
                  <View key={a.id} style={{ width: "48%" }}>
                    <LockedTrophy
                      title={a.title}
                      requirement={a.requirement}
                      pct={a.progress.pct}
                      progress={a.progress.text}
                    />
                  </View>
                ),
              )}
            </TrophyGrid>
          </View>
        )
      })}
      <Sheet
        title="Achievement unlocked"
        open={!!selected}
        onClose={() => setOpen("")}
        onClosed={() => {
          const href = after.current
          after.current = null
          if (href) go(href)
        }}
      >
        {selected && (
          <View style={{ alignItems: "center" }}>
            {/* The badge lands with a spring: the unlock is celebrated. */}
            <Animated.View
              entering={reduced ? undefined : ZoomIn.springify().damping(11)}
            >
              <TrophyBadge
                type={selected.type}
                size={128}
                color={t[TROPHY_COLOR[selected.type]]}
              />
              {/* Fern celebrates the unlock, at the badge's side. */}
              <View style={{ position: "absolute", right: -40, bottom: -6 }}>
                <FernCelebrates size={64} />
              </View>
            </Animated.View>
            <Copy
              size={44}
              weight="semibold"
              style={{ marginTop: 8, fontVariant: ["tabular-nums"] }}
            >
              {selected.value}
            </Copy>
            <Copy size={18} weight="semibold" style={{ marginTop: 4 }}>
              {selected.title}
            </Copy>
            <Copy size={14} muted>
              {selected.detail}
            </Copy>
            <Copy size={12} muted style={{ marginTop: 4 }}>
              {TROPHY_LABEL[selected.type]} · {fmt(selected.day)}
            </Copy>
            <Line style={{ marginTop: 20, gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button
                  tone="quiet"
                  onPress={() => leave(selected.href, selected.id)}
                >
                  View metric ›
                </Button>
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  onPress={() =>
                    leave(
                      `/stats/share?t=${selected.shareRef ?? "profile"}`,
                      selected.id,
                    )
                  }
                >
                  Share
                </Button>
              </View>
            </Line>
            <Copy
              size={12}
              muted
              style={{ marginTop: 16, textAlign: "center" }}
            >
              Trophies are created by rules from your real data. An edit that
              breaks the record revokes it quietly.
            </Copy>
          </View>
        )}
      </Sheet>
    </Screen>
  )
}
