import * as A from "@domain/habits/actions"
import {
  EVERY_DAY,
  type HabitType,
  ICONS,
  type ScheduleSlot,
} from "@domain/habits/data"
import { scheduleLabel } from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { useLocalSearchParams } from "expo-router"
import { CalendarClock, ChevronRight } from "lucide-react-native"
import { useState } from "react"
import { ScrollView, TextInput, View } from "react-native"
import { toast } from "sonner-native"
import { Copy, Frame, Line, Segmented, Tap } from "../native-kit"
import { back, go } from "../navigation"
import { askForReminders } from "../reminders"
import { Switch } from "../switch"
import { fonts, useTheme } from "../theme"
import { Button, confirm, Empty, Screen, Sheet } from "../ui"
import { Schedule, validSchedule } from "./habits"

export function HabitForm({
  id,
  routine = false,
}: {
  id?: string
  routine?: boolean
}) {
  const t = useTheme(),
    s = habitsStore.use((s) => s),
    p = useLocalSearchParams<Record<string, string>>(),
    h = routine ? undefined : s.habits.find((h) => h.id === id),
    r = routine ? s.routines.find((r) => r.id === id) : undefined,
    old = r ?? h
  const [name, setName] = useState(old?.name ?? p.name ?? ""),
    [icon, setIcon] = useState(old?.icon ?? p.icon ?? (routine ? "🌅" : "✅")),
    [type, setType] = useState<HabitType>(
      h?.type ??
        (["check", "duration", "count"].includes(p.type)
          ? (p.type as HabitType)
          : "check"),
    ),
    [target, setTarget] = useState(String(h?.target ?? p.target ?? 1)),
    [unit, setUnit] = useState(h?.unit ?? p.unit ?? ""),
    [step, setStep] = useState(String(h?.step ?? 1)),
    [schedule, setSchedule] = useState<ScheduleSlot[]>(
      old?.schedule ?? [
        { days: EVERY_DAY, ...(routine ? { time: "06:00" } : {}) },
      ],
    ),
    [reminder, setReminder] = useState(
      old?.reminder ?? s.settings.defaultReminder,
    ),
    [linked, setLinked] = useState(h?.linkWorkout ?? false),
    [scheduleOpen, setScheduleOpen] = useState(false),
    [tried, setTried] = useState(false),
    [failed, setFailed] = useState(p.state === "save-error")
  if (id && !old)
    return (
      <Screen prototypeLayout title={routine ? "Routine" : "Habit"}>
        <Empty title={`${routine ? "Routine" : "Habit"} not found`} />
      </Screen>
    )
  const inputStyle = {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.line,
    paddingHorizontal: 12,
    color: t.text,
    fontFamily: fonts.body,
    fontSize: 16,
  }
  const toggle = (
    label: string,
    detail: string,
    value: boolean,
    onChange: (v: boolean) => void,
  ) => (
    <Line>
      <View style={{ flex: 1 }}>
        <Copy size={14} weight="medium">
          {label}
        </Copy>
        <Copy size={12} muted>
          {detail}
        </Copy>
      </View>
      <Switch label={label} value={value} onChange={onChange} accent="hab" />
    </Line>
  )
  const save = () => {
    setTried(true)
    if (
      !name.trim() ||
      !validSchedule(schedule) ||
      (!routine && type !== "check" && !(Number(target) > 0))
    )
      return
    if (failed) {
      setFailed(false)
      toast.error("Couldn't save — your changes are kept. Tap Save to retry.")
      return
    }
    const common = {
      name: name.trim(),
      icon,
      schedule: schedule.filter((s) => s.days.length),
      reminder,
    }
    if (routine) {
      if (r) {
        A.updateRoutine(r.id, common)
        back()
      } else {
        const created = A.createRoutine(common)
        go(`/habits/routines/${created.id}?add=1`)
      }
      return
    }
    const data = {
      ...common,
      type,
      target: type === "check" ? undefined : Number(target),
      unit: type === "count" ? unit || undefined : undefined,
      step: type === "count" ? Number(step) || 1 : undefined,
      linkWorkout: linked,
    }
    if (h) {
      A.updateHabit(h.id, data)
      back()
      return
    }
    const created = A.createHabit(data),
      parent = s.routines.find((r) => r.id === p.addToRoutine)
    if (parent) {
      A.setRoutineSteps(parent.id, [
        ...parent.steps,
        {
          habitId: created.id,
          minutes: type === "duration" ? Number(target) : 5,
        },
      ])
      go(`/habits/routines/${parent.id}`)
    } else go(`/habits/${created.id}`)
  }
  return (
    <Screen
      prototypeLayout
      title={`${id ? "Edit" : "New"} ${routine ? "routine" : "habit"}`}
    >
      <View style={{ gap: 20, paddingTop: 8 }}>
        {failed && (
          <Copy size={12} style={{ color: t.bad }}>
            Walkthrough: the next save will fail to show the error state.
          </Copy>
        )}
        <View style={{ gap: 6 }}>
          <Copy size={12} muted>
            Name
          </Copy>
          <Line style={{ gap: 8 }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                backgroundColor: `${t.hab}1f`,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Copy size={24}>{icon}</Copy>
            </View>
            <TextInput
              accessibilityLabel="Name"
              value={name}
              onChangeText={setName}
              placeholder={routine ? "e.g. Morning routine" : "e.g. Stretch"}
              placeholderTextColor={t.muted}
              style={{
                ...inputStyle,
                flex: 1,
                borderColor: tried && !name.trim() ? t.bad : t.line,
              }}
            />
          </Line>
          {tried && !name.trim() && (
            <Copy size={12} style={{ color: t.bad }}>
              Give it a name.
            </Copy>
          )}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -16 }}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingVertical: 2,
            gap: 8,
          }}
        >
          {ICONS.map((i) => (
            <Tap
              key={i}
              label={`Choose ${i}`}
              onPress={() => setIcon(i)}
              style={{
                width: 44,
                height: 44,
                borderRadius: 16,
                backgroundColor: i === icon ? `${t.hab}40` : t.soft,
                borderWidth: i === icon ? 2 : 0,
                borderColor: t.hab,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Copy size={20}>{i}</Copy>
            </Tap>
          ))}
        </ScrollView>
        {!routine && (
          <View style={{ gap: 6 }}>
            <Copy size={12} muted>
              Type
            </Copy>
            <Segmented
              value={type}
              onChange={(v) => {
                setType(v)
                if (!h)
                  setTarget(v === "duration" ? "30" : v === "count" ? "8" : "1")
              }}
              options={[
                { value: "check", label: "✓ Check" },
                { value: "duration", label: "◷ Timed" },
                { value: "count", label: "# Count" },
              ]}
            />
          </View>
        )}
        {!routine && type !== "check" && (
          <Line style={{ gap: 8, alignItems: "flex-start" }}>
            {[
              {
                label: type === "duration" ? "Target (min)" : "Target",
                value: target,
                set: setTarget,
              },
              ...(type === "count"
                ? [
                    { label: "Unit", value: unit, set: setUnit },
                    { label: "“+” adds", value: step, set: setStep },
                  ]
                : []),
            ].map((f) => (
              <View key={f.label} style={{ flex: 1, gap: 6 }}>
                <Copy size={12} muted>
                  {f.label}
                </Copy>
                <TextInput
                  accessibilityLabel={f.label}
                  value={f.value}
                  onChangeText={f.set}
                  keyboardType={f.label === "Unit" ? "default" : "numeric"}
                  style={inputStyle}
                />
              </View>
            ))}
          </Line>
        )}
        <View style={{ gap: 6 }}>
          <Copy size={12} muted>
            Schedule
          </Copy>
          <Tap
            label="Schedule"
            onPress={() => setScheduleOpen(true)}
            style={{ ...inputStyle, justifyContent: "center" }}
          >
            <Line>
              <CalendarClock size={16} color={t.hab} />
              <Copy size={14} style={{ flex: 1 }} lines={1}>
                {scheduleLabel(schedule) || "Pick days"}
              </Copy>
              <ChevronRight size={16} color={t.muted} />
            </Line>
          </Tap>
          {tried && schedule.every((s) => !s.days.length) && (
            <Copy size={12} style={{ color: t.bad }}>
              Pick at least one day.
            </Copy>
          )}
        </View>
        <Frame style={{ padding: 16, gap: 16 }}>
          {toggle(
            "Reminder",
            routine
              ? "Opens the player ready to start"
              : "Push at the scheduled time",
            reminder,
            (on: boolean) => {
              setReminder(on)
              if (on) void askForReminders()
            },
          )}
          {reminder && (
            <Copy size={12} muted>
              Arrives as a notification on this phone at the scheduled time,
              even offline.
            </Copy>
          )}
          {!routine &&
            toggle(
              "Link to workouts",
              "Auto-check when any workout is logged in Fitness",
              linked,
              setLinked,
            )}
        </Frame>
        <Button onPress={save}>
          {old
            ? "Save changes"
            : routine
              ? "Create & add steps"
              : "Create habit"}
        </Button>
        {h && (
          <Line>
            <View style={{ flex: 1 }}>
              <Button
                tone="quiet"
                onPress={() =>
                  h.status === "paused"
                    ? A.resumeHabit(h.id)
                    : A.pauseHabit(h.id)
                }
              >
                {h.status === "paused" ? "Resume" : "Pause"}
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button
                tone="danger"
                onPress={() =>
                  confirm(
                    `Archive ${h.name}?`,
                    "It leaves Today and your lists. History and stats are kept, and you can restore it.",
                    () => {
                      A.archiveHabit(h.id)
                      go("/habits/manage")
                    },
                  )
                }
              >
                Archive
              </Button>
            </View>
          </Line>
        )}
      </View>
      <Sheet
        title="Schedule"
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
      >
        <Schedule value={schedule} onChange={setSchedule} />
        <Button onPress={() => setScheduleOpen(false)}>Done</Button>
      </Sheet>
    </Screen>
  )
}
export function RoutineForm({ id }: { id?: string }) {
  return <HabitForm id={id} routine />
}
