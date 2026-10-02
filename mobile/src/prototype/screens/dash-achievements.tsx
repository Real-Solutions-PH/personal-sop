import { AREA, MODULE_KEYS } from "@domain/dash/data"
import {
  TROPHY_LABEL,
  type TrophyType,
  useAchievements,
  useAllMisses,
  useEnabled,
} from "@domain/dash/hooks"
import { dashStore, markTrophiesSeen, noteMiss } from "@domain/dash/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import { rescheduleBy } from "@domain/tasks/actions"
import { LinearGradient } from "expo-linear-gradient"
import { useLocalSearchParams } from "expo-router"
import { Award, Lock, Trophy } from "lucide-react-native"
import { useEffect, useState } from "react"
import { ScrollView, View } from "react-native"
import { toast } from "sonner-native"
import {
  Bar,
  border,
  Copy,
  Frame,
  Line,
  SectionHeading,
  Segmented,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Button, Field, Screen, Sheet } from "../ui"

const moduleColor = {
  habits: "hab",
  tasks: "tsk",
  fitness: "fit",
  finance: "fin",
} as const
const fmt = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
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
    [text, setText] = useState("")
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
              <Copy size={10} muted>
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
                        chip("→ Today", false, () => {
                          rescheduleBy(m.id.slice(13), 0)
                          toast("Moved to today")
                        })}
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
const order: TrophyType[] = ["pr", "streak", "best", "goal", "first"],
  colors = {
    pr: "fit",
    streak: "life",
    best: "hab",
    goal: "fin",
    first: "tsk",
  } as const
export function Trophies() {
  const t = useTheme(),
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
    selected = trophies.find((x) => x.id === open)
  useEffect(() => {
    const unseen = trophies.filter(
      (x) => !dashStore.get().seenTrophies.includes(x.id),
    )
    if (unseen.length) markTrophiesSeen(unseen.map((x) => x.id))
  }, [trophies])
  return (
    <Screen title="Trophy case">
      <Line style={{ gap: 6 }}>
        {order.map((type) => {
          const all = catalog.filter((a) => a.type === type)
          return (
            <View
              key={type}
              style={{
                flex: 1,
                padding: 8,
                borderRadius: 12,
                backgroundColor: border(t.soft, 0.5),
                alignItems: "center",
              }}
            >
              <Copy size={18} weight="semibold">
                {all.filter((x) => x.trophy).length}
                <Copy size={12} muted>
                  /{all.length}
                </Copy>
              </Copy>
              <Copy size={9} muted>
                {TROPHY_LABEL[type].split(" ").at(-1)?.toUpperCase()}
              </Copy>
            </View>
          )
        })}
      </Line>
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
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {items.map((a) =>
                a.trophy ? (
                  <Tap
                    key={a.id}
                    onPress={() => setOpen(a.trophy!.id)}
                    style={{ width: "48%" }}
                  >
                    <LinearGradient
                      colors={[border(t[colors[type]], 0.25), "transparent"]}
                      style={{
                        padding: 12,
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: border(t.line, 0.6),
                      }}
                    >
                      {fresh.has(a.trophy.id) && (
                        <View
                          style={{
                            position: "absolute",
                            right: 8,
                            top: 8,
                            borderRadius: 12,
                            backgroundColor: t.bad,
                            paddingHorizontal: 6,
                          }}
                        >
                          <Copy size={9} style={{ color: t.bg }}>
                            NEW
                          </Copy>
                        </View>
                      )}
                      <Award size={20} color={t[colors[type]]} />
                      <Copy
                        size={24}
                        style={{ fontFamily: fonts.displayBlack, marginTop: 4 }}
                      >
                        {a.trophy.value}
                      </Copy>
                      <Copy size={12} weight="medium" lines={2}>
                        {a.trophy.title}
                      </Copy>
                      <Copy size={10} muted style={{ marginTop: 2 }}>
                        {fmt(a.trophy.day)}
                      </Copy>
                    </LinearGradient>
                  </Tap>
                ) : (
                  <View
                    key={a.id}
                    style={{
                      width: "48%",
                      padding: 12,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderStyle: "dashed",
                      borderColor: border(t.line, 0.6),
                      backgroundColor: border(t.card, 0.4),
                    }}
                  >
                    <Line style={{ gap: 6 }}>
                      <Lock size={16} color={t.muted} />
                      <Copy
                        size={12}
                        weight="medium"
                        lines={1}
                        style={{ flex: 1 }}
                      >
                        {a.title}
                      </Copy>
                    </Line>
                    <Copy size={11} muted lines={2} style={{ marginTop: 4 }}>
                      {a.requirement}
                    </Copy>
                    <View style={{ marginTop: 8 }}>
                      <Bar value={a.progress.pct} color={t.primary} />
                    </View>
                    <Copy size={10} muted style={{ marginTop: 4 }}>
                      {a.progress.text}
                    </Copy>
                  </View>
                ),
              )}
            </View>
          </View>
        )
      })}
      <Sheet
        title="Achievement unlocked"
        open={!!selected}
        onClose={() => setOpen("")}
      >
        {selected && (
          <View style={{ alignItems: "center" }}>
            <LinearGradient
              colors={[border(t[colors[selected.type]], 0.25), "transparent"]}
              style={{
                width: 96,
                height: 96,
                borderRadius: 48,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Trophy size={40} color={t[colors[selected.type]]} />
            </LinearGradient>
            <Copy
              size={48}
              style={{ fontFamily: fonts.displayBlack, marginTop: 12 }}
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
                <Button tone="quiet" href={selected.href}>
                  View metric ›
                </Button>
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  href={`/stats/share?t=${selected.shareRef ?? "profile"}`}
                >
                  Share
                </Button>
              </View>
            </Line>
            <Frame style={{ padding: 16, marginTop: 12 }}>
              <Copy size={12} muted>
                Trophies are created by rules from your real data. An edit that
                breaks the record revokes it quietly.
              </Copy>
            </Frame>
          </View>
        )}
      </Sheet>
    </Screen>
  )
}
