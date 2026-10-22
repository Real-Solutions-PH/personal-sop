import * as A from "@domain/habits/actions"
import type { Habit, LogStatus } from "@domain/habits/data"
import * as L from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { DAY_START_HOUR, dayKey } from "@domain/lib/day"
import { resetAll } from "@domain/lib/store"
import { useLocalSearchParams } from "expo-router"
import { BellOff, ChevronLeft, ChevronRight } from "lucide-react-native"
import { useState } from "react"
import { TextInput, View } from "react-native"
import { toast } from "sonner-native"
import { liveMode } from "@/live/config"
import {
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  Segmented,
  Tap,
} from "../native-kit"
import { enableReminders } from "../reminders"
import { Switch } from "../switch"
import { fonts, useTheme } from "../theme"
import { Button, Empty, Screen, Sheet, undo } from "../ui"
import { isDay } from "../validation"

export function HabitSettings() {
  const t = useTheme(),
    s = habitsStore.use((s) => s.settings),
    p = useLocalSearchParams<{ notify?: string }>(),
    [notify, setNotify] = useState(p.notify === "1")
  return (
    <Screen prototypeLayout title="Habit settings">
      <View style={{ paddingTop: 4 }}>
        <Frame style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
          <Line style={{ paddingVertical: 12 }}>
            <View style={{ flex: 1 }}>
              <Copy size={14} weight="medium">
                Day starts at
              </Copy>
              <Copy size={12} muted>
                A 01:30 log still counts for the previous day. Applies app-wide.
              </Copy>
            </View>
            <Copy
              size={14}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 8,
                backgroundColor: t.soft,
              }}
            >
              {String(DAY_START_HOUR).padStart(2, "0")}:00
            </Copy>
          </Line>
          <View
            style={{
              paddingVertical: 12,
              borderTopWidth: 1,
              borderTopColor: border(t.line, 0.5),
              gap: 8,
            }}
          >
            <Copy size={14} weight="medium">
              Week starts on
            </Copy>
            <Segmented
              value={String(s.weekStart)}
              onChange={(v) =>
                A.updateSettings({ weekStart: Number(v) as 0 | 1 })
              }
              options={[
                { value: "1", label: "Monday" },
                { value: "0", label: "Sunday" },
              ]}
            />
          </View>
          {[
            {
              label: "Reminders on for new habits",
              sub: "Push at each habit's scheduled time",
              name: "Default reminder",
              value: s.defaultReminder,
              onChange: (v: boolean) =>
                A.updateSettings({ defaultReminder: v }),
            },
            {
              label: "Streak-at-risk nudge",
              sub: "One push at 21:00 when a 3+ day streak would break today",
              name: "Streak nudge",
              value: s.streakNudge,
              onChange: (v: boolean) => A.updateSettings({ streakNudge: v }),
            },
          ].map((x) => (
            <Line
              key={x.name}
              style={{
                paddingVertical: 12,
                borderTopWidth: 1,
                borderTopColor: border(t.line, 0.5),
              }}
            >
              <View style={{ flex: 1 }}>
                <Copy size={14} weight="medium">
                  {x.label}
                </Copy>
                <Copy size={12} muted>
                  {x.sub}
                </Copy>
              </View>
              <Switch
                label={x.name}
                value={x.value}
                onChange={x.onChange}
                accent="hab"
              />
            </Line>
          ))}
        </Frame>
        <SectionHeading>Notifications</SectionHeading>
        <Frame style={{ padding: 16 }}>
          <Line>
            <BellOff size={20} color={t.warn} />
            <View style={{ flex: 1 }}>
              <Copy size={14} weight="medium">
                Notifications not set up
              </Copy>
              <Copy size={12} muted>
                Reminders won't reach you yet.
              </Copy>
            </View>
            <Button small onPress={() => setNotify(true)}>
              Enable
            </Button>
          </Line>
        </Frame>
        {/* Demo-only: a live account's habits are real and synced, so the
            demo resets would delete them on the server. */}
        {!liveMode && (
          <>
            <SectionHeading>Prototype</SectionHeading>
            <Frame style={{ padding: 16, gap: 8 }}>
              <Button
                tone="danger"
                onPress={() => {
                  habitsStore.reset()
                  toast("Habits data reset to the demo seed")
                }}
              >
                Reset habits demo data
              </Button>
              <Tap
                onPress={() => {
                  resetAll()
                  toast("All sections reset")
                }}
              >
                <Copy size={12} muted style={{ textAlign: "center" }}>
                  Reset every section
                </Copy>
              </Tap>
            </Frame>
          </>
        )}
      </View>
      <Sheet
        title="Turn on reminders"
        open={notify}
        onClose={() => setNotify(false)}
      >
        <Copy size={14} muted>
          Habit reminders arrive at their scheduled time. Today stays the source
          of truth either way.
        </Copy>
        <Copy size={14}>
          They arrive as notifications on this phone, even offline.
        </Copy>
        <Button
          onPress={() => {
            setNotify(false)
            void enableReminders()
          }}
        >
          Turn on
        </Button>
        <Button tone="quiet" onPress={() => setNotify(false)}>
          Not now
        </Button>
      </Sheet>
    </Screen>
  )
}
function DayRow({ habit: h, day }: { habit: Habit; day: string }) {
  const t = useTheme(),
    logs = habitsStore.use((s) => s.logs),
    log = logs.find((l) => l.habitId === h.id && l.day === day),
    cell = L.cellFor(h, day, L.logIndex(logs)),
    [v, setV] = useState(log?.value !== undefined ? String(log.value) : ""),
    slot = L.slotFor(h.schedule, day)
  const set = (status: LogStatus | "clear") => {
    if (status === "clear") {
      const old = A.clearLog(h.id, day)
      if (old) undo(`Cleared ${h.name}`, () => A.restoreLog(old))
      return
    }
    const next = A.logHabit({
      habitId: h.id,
      day,
      status,
      value:
        h.type !== "check" && status !== "skipped"
          ? Number(v || h.target || 1)
          : undefined,
    })
    if (next)
      undo(`${h.name} → ${status}`, () =>
        log ? A.restoreLog(log) : A.deleteLog(next.id),
      )
  }
  return (
    <View
      style={{
        padding: 12,
        gap: 8,
        borderBottomWidth: 1,
        borderBottomColor: border(t.line, 0.5),
      }}
    >
      <Line style={{ gap: 8 }}>
        <Copy style={{ color: cell === "done" ? t.hab : t.muted }}>
          {cell === "done"
            ? "✓"
            : cell === "skipped"
              ? "–"
              : cell === "partial"
                ? "◐"
                : "○"}
        </Copy>
        <Copy>{h.icon}</Copy>
        <View style={{ flex: 1 }}>
          <Copy size={14} weight="medium" lines={1}>
            {h.name}
          </Copy>
          <Copy size={12} muted>
            {cell === "none"
              ? "not scheduled"
              : cell === "bonus"
                ? "bonus (unscheduled)"
                : cell}
            {log?.value !== undefined ? ` · ${L.valueLabel(h, log.value)}` : ""}
            {slot?.time ? ` · ${slot.time}` : ""}
          </Copy>
        </View>
        {h.type !== "check" && (
          <TextInput
            accessibilityLabel={`${h.name} value`}
            value={v}
            onChangeText={(v) => setV(v.replace(/\D/g, ""))}
            placeholder={String(h.target ?? "")}
            placeholderTextColor={t.muted}
            keyboardType="numeric"
            onBlur={() => {
              if (v && ["done", "partial", "bonus"].includes(cell))
                A.logHabit({ habitId: h.id, day, value: Number(v) })
            }}
            style={{
              height: 36,
              width: 64,
              borderWidth: 1,
              borderColor: t.line,
              borderRadius: 8,
              textAlign: "center",
              color: t.text,
              fontFamily: fonts.body,
              fontSize: 14,
            }}
          />
        )}
      </Line>
      {cell !== "paused" && (
        <Line style={{ gap: 6 }}>
          {[
            {
              label: "Done",
              status: "done",
              on: cell === "done" || cell === "bonus",
            },
            { label: "Partial", status: "partial", on: cell === "partial" },
            { label: "Skip", status: "skipped", on: cell === "skipped" },
            {
              label: cell === "pending" ? "Not yet" : "Missed",
              status: "clear",
              on: cell === "missed" || cell === "pending",
            },
          ].map((x) => (
            <Tap
              key={x.status}
              onPress={() => set(x.status as LogStatus | "clear")}
              style={{
                height: 32,
                paddingHorizontal: 12,
                borderRadius: 99,
                backgroundColor: x.on ? `${t.hab}26` : t.soft,
                justifyContent: "center",
              }}
            >
              <Copy
                size={12}
                weight="medium"
                style={{ color: x.on ? t.hab : t.muted }}
              >
                {x.label}
              </Copy>
            </Tap>
          ))}
        </Line>
      )}
    </View>
  )
}
export function HabitDay({ day: initial = dayKey() }: { day?: string }) {
  const t = useTheme(),
    s = habitsStore.use((s) => s),
    [day, setDay] = useState(initial),
    [all, setAll] = useState(false),
    idx = L.logIndex(s.logs),
    today = dayKey(),
    valid = isDay(day),
    rows = L.sortedHabits(
      s.habits.filter((h) => h.status !== "archived" && day >= h.createdAt),
    ).filter((h) => all || L.cellFor(h, day, idx, today) !== "none"),
    scheduled = rows.filter(
      (h) =>
        !["none", "bonus", "paused"].includes(L.cellFor(h, day, idx, today)),
    ),
    done = scheduled.filter(
      (h) => L.cellFor(h, day, idx, today) === "done",
    ).length
  return (
    <Screen
      prototypeLayout
      title={
        valid
          ? new Date(`${day}T12:00:00`).toLocaleDateString("en-US", {
              weekday: "long",
              month: "short",
              day: "numeric",
            })
          : "Day"
      }
    >
      {!valid ? (
        <Empty title="Not a valid day" />
      ) : (
        <View style={{ gap: 12, paddingTop: 4 }}>
          <Line style={{ justifyContent: "space-between" }}>
            <IconTap
              size={40}
              icon={ChevronLeft}
              label="Previous day"
              onPress={() => setDay(L.addDays(day, -1))}
            />
            <View>
              <Copy size={24} weight="semibold" style={{ textAlign: "center" }}>
                {done}/{scheduled.length}
              </Copy>
              <Copy size={12} muted style={{ textAlign: "center" }}>
                {day === today ? "today" : "done that day"}
              </Copy>
            </View>
            <IconTap
              size={40}
              icon={ChevronRight}
              label="Next day"
              color={day >= today ? `${t.muted}4d` : t.muted}
              onPress={() => day < today && setDay(L.addDays(day, 1))}
            />
          </Line>
          {day > today ? (
            <Empty title="That day hasn't happened yet" />
          ) : (
            <>
              <Frame>
                {rows.map((h) => (
                  <DayRow key={`${h.id}-${day}`} habit={h} day={day} />
                ))}
                {!rows.length && (
                  <Copy
                    size={14}
                    muted
                    style={{ padding: 24, textAlign: "center" }}
                  >
                    Nothing scheduled — rest day.
                  </Copy>
                )}
              </Frame>
              <Tap onPress={() => setAll(!all)} style={{ paddingVertical: 8 }}>
                <Copy size={12} muted style={{ textAlign: "center" }}>
                  {all
                    ? "Only scheduled habits"
                    : "Show unscheduled habits too (log a bonus)"}
                </Copy>
              </Tap>
            </>
          )}
        </View>
      )}
    </Screen>
  )
}
