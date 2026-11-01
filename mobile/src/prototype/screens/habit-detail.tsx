import { dashStore } from "@domain/dash/store"
import { startFocus } from "@domain/focus/actions"
import * as A from "@domain/habits/actions"
import type { Habit, HabitLog as LogRow } from "@domain/habits/data"
import * as L from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import { useScreen } from "@domain/screen/store"
import { useLocalSearchParams } from "expo-router"
import {
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Flame,
  Pencil,
} from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { FocusTimeCard } from "../focus-kit"
import { Cheer, feel, markCompletion } from "../motion"
import { Copy, Frame, IconTap, Line, SectionHeading, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Button, confirm, DateField, Empty, Field, Screen, Sheet } from "../ui"
import { HabitLog } from "./habits"
import {
  AutoMark,
  RuleRing,
  RuleText,
  ScreenOffMark,
  useRuleState,
} from "./screen-card"

function fmt(day: string) {
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}
function Month({ habit }: { habit: Habit }) {
  const t = useTheme(),
    s = habitsStore.use((s) => s),
    [offset, setOffset] = useState(0),
    today = dayKey(),
    base = new Date(`${today}T12:00:00`)
  base.setDate(1)
  base.setMonth(base.getMonth() + offset)
  const y = base.getFullYear(),
    m = base.getMonth(),
    n = new Date(y, m + 1, 0).getDate(),
    lead = (base.getDay() - s.settings.weekStart + 7) % 7,
    idx = L.logIndex(s.logs)
  return (
    <View>
      <Line style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <IconTap
          size={32}
          icon={ChevronLeft}
          label="Previous month"
          onPress={() => setOffset(Math.max(-3, offset - 1))}
        />
        <Copy size={14} weight="medium">
          {base.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </Copy>
        <IconTap
          size={32}
          icon={ChevronRight}
          label="Next month"
          onPress={() => setOffset(Math.min(0, offset + 1))}
        />
      </Line>
      <View
        style={{
          width: "100%",
          maxWidth: 280,
          alignSelf: "center",
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        {Array.from({ length: 7 }, (_, i) => (
          <Copy
            key={`h${i}`}
            size={10}
            muted
            style={{ width: 244 / 7, textAlign: "center" }}
          >
            {
              ["S", "M", "T", "W", "T", "F", "S"][
                (i + s.settings.weekStart) % 7
              ]
            }
          </Copy>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <View key={`l${i}`} style={{ width: 244 / 7, height: 34 }} />
        ))}
        {Array.from({ length: n }, (_, i) => {
          const d = `${y}-${String(m + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`,
            c = L.cellFor(habit, d, idx, today),
            bg =
              c === "done"
                ? t.hab
                : c === "partial"
                  ? `${t.hab}73`
                  : c === "skipped"
                    ? `${t.warn}59`
                    : c === "missed"
                      ? `${t.bad}66`
                      : c === "none"
                        ? `${t.soft}40`
                        : "transparent"
          return (
            <Tap
              key={d}
              label={`${d}: ${c}`}
              onPress={() =>
                d <= today && d >= habit.createdAt && go(`/habits/day/${d}`)
              }
              style={{
                width: 244 / 7,
                height: 244 / 7,
                borderRadius: 8,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: bg,
                borderWidth:
                  d === today || c === "bonus" || c === "pending"
                    ? 2
                    : c === "future"
                      ? 1
                      : 0,
                borderColor:
                  d === today ? t.text : c === "future" ? t.line : t.hab,
                borderStyle: c === "pending" ? "dashed" : "solid",
                opacity: d > today ? 0.6 : 1,
              }}
            >
              <Copy size={11} style={{ color: c === "done" ? t.bg : t.text }}>
                {i + 1}
              </Copy>
            </Tap>
          )
        })}
      </View>
      <Line style={{ flexWrap: "wrap", gap: 12, marginTop: 12 }}>
        {[
          ["done", t.hab],
          ["partial", `${t.hab}73`],
          ["skipped", `${t.warn}59`],
          ["missed", `${t.bad}66`],
          ["paused", t.soft],
          ["bonus", "transparent"],
        ].map(([label, color]) => (
          <Line key={label} style={{ gap: 4 }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                backgroundColor: color,
                borderWidth: label === "bonus" ? 1 : 0,
                borderColor: t.hab,
              }}
            />
            <Copy size={11} muted>
              {label}
            </Copy>
          </Line>
        ))}
      </Line>
    </View>
  )
}
/** Today for a habit screen time completes: the ring and what's used. */
function RuleToday({ habit, log }: { habit: Habit; log?: LogRow }) {
  const state = useRuleState(habit),
    group = useScreen().groups.find((g) => g.id === habit.rule?.groupId),
    max = habit.rule?.maxMin ?? 0
  return (
    <Frame style={{ padding: 12 }}>
      <Line style={{ gap: 12 }}>
        <RuleRing habit={habit} log={log} state={state} size={37} ring={3} />
        <View style={{ flex: 1, gap: 2 }}>
          <Copy size={14} weight="medium">
            {max === 0
              ? `No ${group?.name ?? "screen time"} today`
              : `At most ${max} min of ${group?.name ?? "screen time"}`}
          </Copy>
          <Line style={{ gap: 6 }}>
            <RuleText
              state={state}
              maxMin={max}
              done={log?.status === "done"}
            />
            <AutoMark />
          </Line>
          <Copy size={12} muted>
            Completes itself when the day ends within the limit.
          </Copy>
        </View>
      </Line>
    </Frame>
  )
}

export function HabitDetail({ id }: { id: string }) {
  const t = useTheme(),
    s = habitsStore.use((s) => s),
    h = s.habits.find((h) => h.id === id),
    [logDay, setLogDay] = useState<string | null>(null),
    [more, setMore] = useState(false),
    // `?pause=1`: arrived from a row's actions sheet to pause this habit.
    params = useLocalSearchParams<{ pause?: string }>(),
    [marked, setMarked] = useState(0),
    [pausing, setPausing] = useState(params.pause === "1"),
    [until, setUntil] = useState(dayOffset(7)),
    [reason, setReason] = useState(""),
    screenOn = dashStore.use((s) => s.enabled.screen)
  if (!h)
    return (
      <Screen prototypeLayout title="Habit">
        <Empty title="Habit not found" />
      </Screen>
    )
  // Screen time drives it only while Screen time is on; off, it is a
  // habit logged by hand.
  const auto = !!h.rule && screenOn
  const today = dayKey(),
    idx = L.logIndex(s.logs),
    a = L.habitStats(h, idx, dayOffset(-29), today, today),
    prev = L.habitStats(h, idx, dayOffset(-59), dayOffset(-30), today),
    long = L.habitStats(h, idx, dayOffset(-89), today, today),
    st = L.streaks(h, idx, today),
    log = idx.get(L.lk(id, today)),
    pause = L.currentPause(h, today),
    routines = s.routines.filter(
      (r) => r.status === "active" && r.steps.some((x) => x.habitId === id),
    ),
    recent = s.logs
      .filter((l) => l.habitId === id)
      .sort((a, b) => b.day.localeCompare(a.day))
      .slice(0, 10),
    weekly = Array.from({ length: 12 }, (_, i) => {
      const to = dayOffset(-(11 - i) * 7)
      return L.habitStats(h, idx, L.addDays(to, -6), to, today).rate
    })
  const cells = [
    { label: "Current streak", value: `${st.current}-day` },
    { label: "Best streak", value: st.best },
    {
      label: "30-day rate",
      value: L.pct(a.rate),
      delta: Math.round((a.rate - prev.rate) * 100),
    },
    { label: "Skip rate", value: L.pct(a.skipRate) },
    { label: "Missed (30d)", value: a.missed },
    {
      label: h.schedule.some((s) => s.time) ? "On time" : "Done (30d)",
      value: h.schedule.some((s) => s.time) ? L.pct(a.onTime) : a.done,
    },
    ...(h.type === "duration"
      ? [{ label: "Time (90d)", value: L.fmtMinutes(long.minutes) }]
      : h.type === "count"
        ? [
            {
              label: `${h.unit ?? "total"} (90d)`,
              value: long.countTotal.toLocaleString(),
            },
          ]
        : []),
  ]
  return (
    <Screen
      prototypeLayout
      title={h.name}
      actions={
        <Line style={{ gap: 0 }}>
          <IconTap
            size={40}
            icon={Pencil}
            label="Edit habit"
            color={t.text}
            onPress={() => go(`/habits/${id}/edit`)}
          />
          <IconTap
            size={40}
            icon={Ellipsis}
            label="More"
            color={t.text}
            onPress={() => setMore(true)}
          />
        </Line>
      }
    >
      <View style={{ gap: 12, paddingTop: 4 }}>
        <Line style={{ gap: 16 }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              backgroundColor: `${t.hab}1f`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Copy size={28}>{h.icon}</Copy>
          </View>
          <View style={{ flex: 1 }}>
            <Copy size={14} muted>
              {L.scheduleLabel(h.schedule)}
            </Copy>
            {!auto && (
              <Copy size={14} muted>
                Target · {L.targetLabel(h)}
              </Copy>
            )}
            {h.rule && !auto && <ScreenOffMark />}
            {h.linkWorkout && (
              <Copy size={12} style={{ color: t.fit }}>
                Auto-checks when a workout is logged
              </Copy>
            )}
          </View>
        </Line>
        {pause ? (
          <Frame style={{ padding: 16, backgroundColor: `${t.warn}1a` }}>
            <Copy size={14}>
              Paused{pause.to ? ` until ${fmt(L.addDays(pause.to, 1))}` : ""}
              {pause.reason ? ` · ${pause.reason}` : ""}
            </Copy>
            <Button tone="quiet" onPress={() => A.resumeHabit(id)}>
              Resume
            </Button>
          </Frame>
        ) : auto ? (
          <RuleToday habit={h} log={log} />
        ) : (
          <Line style={{ gap: 8 }}>
            <Cheer fire={marked} color={t.hab} style={{ flex: 1 }}>
              <Button
                tone={
                  h.type === "check" && log?.status === "done"
                    ? "quiet"
                    : "primary"
                }
                onPress={() => {
                  if (h.type === "duration") return go(`/habits/${id}/timer`)
                  if (h.type === "check" && log?.status === "done")
                    return A.clearLog(id)
                  if (h.type === "count") A.incrementCount(id)
                  else A.checkHabit(id)
                  const now = L.logIndex(habitsStore.get().logs).get(
                    L.lk(id, today),
                  )
                  // Done, or a count that just reached its target.
                  if (
                    now?.status === "done" &&
                    (h.type === "check" || L.progressOf(h, log) < 1)
                  ) {
                    feel.success()
                    markCompletion()
                    setMarked((n) => n + 1)
                  }
                }}
              >
                {h.type === "duration"
                  ? "◉ Start timer"
                  : h.type === "count"
                    ? `+ ${h.step ?? 1} ${h.unit ?? ""}${log?.value !== undefined ? ` · ${log.value}/${h.target}` : ""}`
                    : log?.status === "done"
                      ? "✓ Done today — undo"
                      : "Mark done today"}
              </Button>
            </Cheer>
            <Button tone="quiet" onPress={() => setLogDay(today)}>
              Log…
            </Button>
          </Line>
        )}
        <Frame style={{ padding: 16 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 12 }}>
            {cells.map((c, i) => (
              <View key={c.label} style={{ width: "33.333%", paddingRight: 8 }}>
                <Line style={{ gap: 4 }}>
                  {i === 0 && <Flame size={20} color={t.warn} />}
                  <Copy
                    size={30}
                    weight="displayMedium"
                    style={{ color: i === 0 ? t.hab : t.text }}
                  >
                    {c.value}
                  </Copy>
                </Line>
                <Line style={{ gap: 4 }}>
                  <Copy size={12} muted>
                    {c.label}
                  </Copy>
                  {c.delta !== undefined && (
                    <Copy
                      size={12}
                      style={{ color: c.delta >= 0 ? t.good : t.bad }}
                    >
                      {c.delta >= 0 ? "▲" : "▼"}
                      {Math.abs(c.delta)}
                    </Copy>
                  )}
                </Line>
              </View>
            ))}
          </View>
        </Frame>
        {st.current > 0 && st.current >= st.best && (
          <Copy
            size={14}
            style={{
              color: t.hab,
              backgroundColor: `${t.hab}1a`,
              padding: 12,
              borderRadius: 12,
            }}
          >
            🏆 New best — this is your longest streak yet.
          </Copy>
        )}
      </View>
      <FocusTimeCard
        item={{ kind: "habit", id: h.id, title: h.name }}
        estimateMin={h.type === "duration" ? h.target : undefined}
        estimateLabel="daily target"
        against="today"
        onStart={() => {
          startFocus({ item: { kind: "habit", id: h.id, title: h.name } })
          go("/focus")
        }}
      />
      <View style={{ marginTop: -12 }}>
        <SectionHeading>Calendar</SectionHeading>
        <Frame style={{ padding: 16 }}>
          <Month habit={h} />
        </Frame>
      </View>
      <View style={{ marginTop: -12 }}>
        <SectionHeading>Weekly completion · 12 weeks</SectionHeading>
        <Frame style={{ padding: 16 }}>
          <Line style={{ height: 72, gap: 4, alignItems: "flex-end" }}>
            {weekly.map((v, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: Math.max(2, v * 72),
                  borderRadius: 4,
                  backgroundColor: t.hab,
                  opacity: i === 11 ? 1 : 0.45,
                }}
              />
            ))}
          </Line>
          <Line style={{ justifyContent: "space-between", marginTop: 4 }}>
            <Copy size={10} muted>
              12w ago
            </Copy>
            <Copy size={10} muted>
              this week
            </Copy>
          </Line>
        </Frame>
      </View>
      {!!st.broken.length && (
        <View style={{ marginTop: -12 }}>
          <SectionHeading>Broken streaks</SectionHeading>
          <Frame style={{ padding: 16, gap: 4 }}>
            {st.broken
              .slice(-3)
              .reverse()
              .map((b) => (
                <Line key={b.day} style={{ justifyContent: "space-between" }}>
                  <Copy size={14}>Lost a {b.length}-day streak</Copy>
                  <Copy size={14} muted>
                    {fmt(b.day)}
                  </Copy>
                </Line>
              ))}
          </Frame>
        </View>
      )}
      {!!routines.length && (
        <View style={{ marginTop: -12 }}>
          <SectionHeading>In routines</SectionHeading>
          <Line style={{ flexWrap: "wrap", gap: 8 }}>
            {routines.map((r) => (
              <Tap
                key={r.id}
                onPress={() => go(`/habits/routines/${r.id}`)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderWidth: 1,
                  borderColor: t.line,
                  borderRadius: 99,
                }}
              >
                <Copy size={14}>
                  {r.icon} {r.name}
                </Copy>
              </Tap>
            ))}
          </Line>
        </View>
      )}
      <View style={{ marginTop: -12 }}>
        <SectionHeading>Recent logs</SectionHeading>
        <Frame style={{ padding: 4 }}>
          {recent.map((l) => (
            <Tap
              key={l.id}
              onPress={() => {
                if (!auto) setLogDay(l.day)
              }}
              style={{ paddingHorizontal: 12, paddingVertical: 10 }}
            >
              <Line>
                <Copy
                  style={{
                    color:
                      l.status === "done"
                        ? t.hab
                        : l.status === "skipped"
                          ? t.warn
                          : t.muted,
                  }}
                >
                  {l.status === "done"
                    ? "✓"
                    : l.status === "skipped"
                      ? "–"
                      : "◐"}
                </Copy>
                <View style={{ flex: 1 }}>
                  <Copy size={14}>
                    {fmt(l.day)}
                    {l.value !== undefined && (
                      <Copy size={14} muted>
                        {" "}
                        · {L.valueLabel(h, l.value)}
                      </Copy>
                    )}
                  </Copy>
                  <Copy size={12} muted lines={1}>
                    {new Date(l.loggedAt).toLocaleTimeString("en-PH", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    · via {l.source}
                    {l.note ? ` · “${l.note}”` : ""}
                  </Copy>
                </View>
                <Copy size={12} muted style={{ textTransform: "capitalize" }}>
                  {l.status}
                </Copy>
              </Line>
            </Tap>
          ))}
          {!recent.length && (
            <Copy size={14} muted style={{ padding: 24 }}>
              No logs yet — check it off from Today or tell Capture.
            </Copy>
          )}
        </Frame>
      </View>
      <Sheet title="Habit actions" open={more} onClose={() => setMore(false)}>
        <Button tone="quiet" href={`/habits/share?t=streak&habit=${id}`}>
          Share
        </Button>
        <Button
          tone="quiet"
          onPress={() => {
            setMore(false)
            if (pause) A.resumeHabit(id)
            else setPausing(true)
          }}
        >
          {pause ? "Resume now" : "Pause…"}
        </Button>
        <Button
          tone="danger"
          onPress={() => {
            setMore(false)
            confirm(
              `Archive ${h.name}?`,
              "History and stats are kept, and you can restore it from Archived.",
              () => {
                A.archiveHabit(id)
                go("/habits/manage")
              },
            )
          }}
        >
          Archive
        </Button>
      </Sheet>
      <Sheet
        title={`Pause ${h.name}`}
        open={pausing}
        onClose={() => setPausing(false)}
      >
        <Copy size={14} muted>
          Paused days leave Today and never count against your rate or streak.
        </Copy>
        <Line style={{ flexWrap: "wrap" }}>
          {[
            ["3 days", 3],
            ["1 week", 7],
            ["2 weeks", 14],
            ["Until I resume", 0],
          ].map(([label, n]) => (
            <Tap
              key={label}
              onPress={() => setUntil(n ? dayOffset(Number(n)) : "")}
            >
              <Copy size={14} style={{ color: t.hab }}>
                {label}
              </Copy>
            </Tap>
          ))}
        </Line>
        <DateField label="Resume on" value={until} onChangeText={setUntil} />
        <Field
          label="Reason (optional)"
          value={reason}
          onChangeText={setReason}
        />
        <Button
          onPress={() => {
            A.pauseHabit(id, until || undefined, reason || undefined)
            setPausing(false)
          }}
        >
          {until ? `Pause until ${fmt(until)}` : "Pause until I resume"}
        </Button>
      </Sheet>
      <HabitLog
        key={logDay ?? "closed"}
        habit={h}
        day={logDay ?? today}
        open={!!logDay}
        onClose={() => setLogDay(null)}
      />
    </Screen>
  )
}
