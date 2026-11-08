import * as A from "@domain/habits/actions"
import type { Habit } from "@domain/habits/data"
import * as L from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Plus,
  Repeat,
} from "lucide-react-native"
import { memo, useCallback, useState } from "react"
import { View } from "react-native"
import { feel, StreakChip } from "../motion"
import {
  Copy,
  chosen,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  Segmented,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { streakMiss, streakNote } from "../rewards"
import { useTheme } from "../theme"
import { Button, Choices, confirm, Empty, Field, Screen, Sheet } from "../ui"
import { HabitActions } from "./habit-actions"
import { HabitRow } from "./habits"

type Filters = {
  q: string
  status: string
  type: string
  tod: string
  sort: string
}
const defaults: Filters = {
  q: "",
  status: "all",
  type: "all",
  tod: "all",
  sort: "manual",
}
/** One row of the All view. Memoised on plain props (the week as a string),
 * so ticking one habit re-renders that row, not every row. */
const AllRow = memo(function AllRow({
  h,
  st,
  streak,
  miss,
  note,
  rate,
  week,
  reorder,
  first,
  last,
  onActions,
}: {
  h: Habit
  st: string
  streak: number
  miss: { missed: number; run: number } | null
  note: string | null
  rate: number
  week: string
  reorder: boolean
  first: boolean
  last: boolean
  onActions: (h: Habit) => void
}) {
  const t = useTheme()
  return (
    <Line style={{ gap: 0 }}>
      <Tap
        onPress={() => go(`/habits/${h.id}`)}
        onLongPress={() => {
          feel.tap()
          onActions(h)
        }}
        hint="Long press for actions"
        longPressLabel="Habit actions"
        style={{
          flex: 1,
          padding: 10,
          opacity: st === "paused" ? 0.6 : 1,
        }}
      >
        <Line>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 16,
              backgroundColor: `${t.hab}1f`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Copy size={20}>{h.icon}</Copy>
          </View>
          <View style={{ flex: 1 }}>
            <Line style={{ gap: 6 }}>
              <Copy weight="medium" style={{ flexShrink: 1 }}>
                {h.name}
              </Copy>
              {st === "paused" && (
                <Copy size={12} muted>
                  PAUSED
                </Copy>
              )}
            </Line>
            <Copy size={12} muted lines={1}>
              {L.scheduleLabel(h.schedule)}
            </Copy>
            <Line style={{ gap: 8, marginTop: 4 }}>
              <Line style={{ gap: 4 }}>
                {week.split(",").map((c, i) => {
                  return (
                    <View
                      key={i}
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor:
                          c === "done"
                            ? t.hab
                            : c === "missed"
                              ? `${t.bad}66`
                              : c === "partial"
                                ? `${t.hab}73`
                                : c === "skipped"
                                  ? `${t.warn}59`
                                  : t.soft,
                      }}
                    />
                  )
                })}
              </Line>
              <Copy size={12} muted>
                {Math.round(rate * 100)}%
              </Copy>
              <StreakChip streak={streak} miss={miss} note={note} />
            </Line>
          </View>
          {!reorder && <ChevronRight size={16} color={t.muted} />}
        </Line>
      </Tap>
      {reorder && (
        <View>
          <IconTap
            size={32}
            icon={ArrowUp}
            label={`Move ${h.name} up`}
            onPress={() => !first && A.reorderHabit(h.id, -1)}
          />
          <IconTap
            size={32}
            icon={ArrowDown}
            label={`Move ${h.name} down`}
            onPress={() => !last && A.reorderHabit(h.id, 1)}
          />
        </View>
      )}
    </Line>
  )
})
export function HabitsList() {
  const t = useTheme(),
    s = habitsStore.use((s) => s),
    [mode, setMode] = useState("all"),
    [f, setF] = useState(defaults),
    [draft, setDraft] = useState(defaults),
    [filterOpen, setFilterOpen] = useState(false),
    [reorder, setReorder] = useState(false),
    [actionsFor, setActionsFor] = useState<Habit | null>(null),
    [actionsOpen, setActionsOpen] = useState(false),
    openActions = useCallback((h: Habit) => {
      setActionsFor(h)
      setActionsOpen(true)
    }, []),
    today = dayKey(),
    idx = L.logIndex(s.logs),
    all = s.habits.filter((h) => h.status !== "archived"),
    paused = all.filter((h) => L.effectiveStatus(h, today) === "paused").length,
    filtered = JSON.stringify(f) !== JSON.stringify(defaults)
  const rows = all
    .map((h) => ({
      h,
      st: L.effectiveStatus(h, today),
      ...(() => {
        const x = L.streaks(h, idx, today)
        return {
          streak: x.current,
          miss: streakMiss(h, idx, x, today),
          note: streakNote(h, idx, x, today),
        }
      })(),
      rate: L.habitStats(h, idx, dayOffset(-29), today, today).rate,
      time: L.slotFor(h.schedule, today)?.time ?? h.schedule[0]?.time,
    }))
    .filter(
      (r) =>
        (mode !== "today" || L.isDue(r.h, today)) &&
        r.h.name.toLowerCase().includes(f.q.toLowerCase()) &&
        (f.status === "all" || r.st === f.status) &&
        (f.type === "all" || r.h.type === f.type) &&
        (f.tod === "all" ||
          (r.time
            ? f.tod === "morning"
              ? L.toMin(r.time) < 720
              : f.tod === "afternoon"
                ? L.toMin(r.time) >= 720 && L.toMin(r.time) < 1080
                : f.tod === "evening" && L.toMin(r.time) >= 1080
            : f.tod === "anytime")),
    )
    .sort((a, b) =>
      f.sort === "name"
        ? a.h.name.localeCompare(b.h.name)
        : f.sort === "time"
          ? L.toMin(a.time ?? "99:99") - L.toMin(b.time ?? "99:99")
          : f.sort === "streak"
            ? b.streak - a.streak
            : f.sort === "rate"
              ? b.rate - a.rate
              : a.h.sortOrder - b.h.sortOrder,
    )
  const chip = (label: string, on: boolean, press: () => void) => (
    <Tap
      key={label}
      onPress={press}
      style={{
        height: 32,
        paddingHorizontal: 12,
        borderRadius: 99,
        ...chosen(t, on),
        justifyContent: "center",
      }}
    >
      <Copy size={12} weight="medium" style={{ color: on ? t.text : t.muted }}>
        {label}
      </Copy>
    </Tap>
  )
  return (
    <Screen
      prototypeLayout
      title="Habits"
      actions={
        <Line style={{ gap: 0 }}>
          <IconTap
            size={40}
            icon={Archive}
            label="Archived habits"
            color={t.text}
            onPress={() => go("/habits/manage/archived")}
          />
          <IconTap
            size={40}
            icon={Plus}
            label="New habit"
            background={t.primary}
            color={t.onPrimary}
            onPress={() => go("/habits/new")}
          />
        </Line>
      }
    >
      <View style={{ gap: 12, paddingTop: 4 }}>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "today", label: "Today" },
            { value: "all", label: `All · ${all.length}` },
          ]}
        />
        <Line style={{ gap: 8 }}>
          {chip(filtered ? "Filtered" : "Filter & sort", filtered, () => {
            setDraft(f)
            setFilterOpen(true)
          })}
          {paused > 0 &&
            chip(`Paused · ${paused}`, f.status === "paused", () =>
              setF({ ...f, status: f.status === "paused" ? "all" : "paused" }),
            )}
          {mode === "all" &&
            f.sort === "manual" &&
            chip(reorder ? "Done reordering" : "Reorder", reorder, () =>
              setReorder(!reorder),
            )}
        </Line>
        <Frame style={{ padding: mode === "today" ? 16 : 4 }}>
          {!rows.length && (
            <Copy size={14} muted style={{ padding: 20, textAlign: "center" }}>
              {mode === "today"
                ? "Nothing scheduled today — rest day."
                : "No habits match."}
            </Copy>
          )}
          {rows.map(({ h, st, streak, miss, note, rate }, i) =>
            mode === "today" ? (
              <HabitRow key={h.id} habit={h} />
            ) : (
              <AllRow
                key={h.id}
                h={h}
                st={st}
                streak={streak}
                miss={miss}
                note={note}
                rate={rate}
                week={Array.from({ length: 7 }, (_, i) =>
                  L.cellFor(h, dayOffset(i - 6), idx, today),
                ).join(",")}
                reorder={reorder}
                first={i === 0}
                last={i === rows.length - 1}
                onActions={openActions}
              />
            ),
          )}
        </Frame>
      </View>
      <View style={{ marginTop: -12 }}>
        <SectionHeading>Routines</SectionHeading>
        <Frame>
          <Tap onPress={() => go("/habits/routines")} style={{ padding: 16 }}>
            <Line>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 16,
                  backgroundColor: `${t.hab}1f`,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Repeat size={20} color={t.hab} />
              </View>
              <View style={{ flex: 1 }}>
                <Copy weight="medium">
                  {s.routines.filter((r) => r.status === "active").length}{" "}
                  routines
                </Copy>
                <Copy size={12} muted>
                  Stack habits into one guided flow
                </Copy>
              </View>
              <ChevronRight size={16} color={t.muted} />
            </Line>
          </Tap>
        </Frame>
      </View>
      <Sheet
        title="Filter & sort"
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
      >
        <Field
          label="Search habits"
          value={draft.q}
          onChangeText={(q) => setDraft({ ...draft, q })}
        />
        {(
          [
            {
              key: "status",
              label: "Status",
              options: ["all", "active", "paused"],
            },
            {
              key: "type",
              label: "Type",
              options: ["all", "check", "duration", "count"],
            },
            {
              key: "tod",
              label: "Time of day",
              options: ["all", "morning", "afternoon", "evening", "anytime"],
            },
            {
              key: "sort",
              label: "Sort by",
              options: ["manual", "time", "streak", "rate", "name"],
            },
          ] as const
        ).map((g) => (
          <Choices
            key={g.key}
            label={g.label}
            value={draft[g.key]}
            onChange={(v) => setDraft({ ...draft, [g.key]: v })}
            options={g.options.map((value) => ({
              value,
              label:
                value === "manual"
                  ? "My order"
                  : value === "duration"
                    ? "Timed"
                    : value[0].toUpperCase() + value.slice(1),
            }))}
          />
        ))}
        <Line>
          <Button
            tone="quiet"
            onPress={() => {
              setF(defaults)
              setFilterOpen(false)
            }}
          >
            Reset
          </Button>
          <View style={{ flex: 1 }}>
            <Button
              onPress={() => {
                setF(draft)
                setFilterOpen(false)
              }}
            >
              Apply
            </Button>
          </View>
        </Line>
      </Sheet>
      {actionsFor && (
        <HabitActions
          habit={actionsFor}
          open={actionsOpen}
          onClose={() => setActionsOpen(false)}
        />
      )}
    </Screen>
  )
}
export function ArchivedHabits() {
  const t = useTheme(),
    s = habitsStore.use((s) => s),
    rows = s.habits.filter((h) => h.status === "archived"),
    routines = s.routines.filter((r) => r.status === "archived"),
    idx = L.logIndex(s.logs)
  return (
    <Screen prototypeLayout title="Archived">
      {!rows.length && !routines.length ? (
        <Empty title="Nothing archived" />
      ) : (
        <View style={{ paddingTop: 4, gap: 12 }}>
          {!!rows.length && <SectionHeading>Habits</SectionHeading>}
          {rows.map((h) => {
            const count = s.logs.filter((l) => l.habitId === h.id).length
            return (
              <Frame key={h.id} style={{ padding: 16 }}>
                <Line>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 16,
                      backgroundColor: `${t.hab}1f`,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Copy size={20}>{h.icon}</Copy>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Copy weight="medium">{h.name}</Copy>
                    <Copy size={12} muted>
                      {new Date(`${h.createdAt}T12:00:00`).toLocaleDateString(
                        "en-US",
                        { month: "short", day: "numeric" },
                      )}{" "}
                      –{" "}
                      {h.archivedAt
                        ? new Date(
                            `${h.archivedAt}T12:00:00`,
                          ).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        : "?"}{" "}
                      ·{" "}
                      {L.pct(
                        L.habitStats(
                          h,
                          idx,
                          h.createdAt,
                          h.archivedAt ?? h.createdAt,
                        ).rate,
                      )}{" "}
                      · best {L.streaks(h, idx).best}-day streak · {count} logs
                    </Copy>
                  </View>
                </Line>
                <Line style={{ marginTop: 12, gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Button tone="quiet" onPress={() => A.restoreHabit(h.id)}>
                      Restore
                    </Button>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      tone="danger"
                      onPress={() =>
                        confirm(
                          `Delete ${h.name} forever?`,
                          `Deletes ${count} logs and removes it from every routine. Stats and streaks are lost. This can't be undone.`,
                          () => A.deleteHabit(h.id),
                        )
                      }
                    >
                      Delete
                    </Button>
                  </View>
                </Line>
              </Frame>
            )
          })}
          {!!routines.length && <SectionHeading>Routines</SectionHeading>}
          {routines.map((r) => (
            <Frame key={r.id} style={{ padding: 16 }}>
              <Line>
                <Copy size={20}>{r.icon}</Copy>
                <Copy weight="medium" style={{ flex: 1 }}>
                  {r.name}
                </Copy>
                <Button tone="quiet" onPress={() => A.restoreRoutine(r.id)}>
                  Restore
                </Button>
                <Button
                  tone="danger"
                  onPress={() =>
                    confirm(
                      `Delete ${r.name}?`,
                      "Its history will be removed.",
                      () => A.deleteRoutine(r.id),
                    )
                  }
                >
                  Delete
                </Button>
              </Line>
            </Frame>
          ))}
        </View>
      )}
    </Screen>
  )
}
