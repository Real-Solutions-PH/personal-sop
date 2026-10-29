import * as A from "@domain/fitness/actions"
import { fitStore } from "@domain/fitness/store"
import { Check, LayoutList, Moon } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { border, Copy, Frame, Line, SectionHeading, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Screen, Sheet } from "../ui"

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
]

/** Set a repeating weekly routine: each weekday is a workout template or a
 * rest day. The Fitness home reads today's slot from here. */
export function FitnessRoutine() {
  const t = useTheme()
  const s = fitStore.use((s) => s)
  // Which day's picker is open (0 = Mon … 6 = Sun), or null.
  const [editing, setEditing] = useState<number | null>(null)
  const nameOf = (id: string | null) =>
    id === null ? "Rest" : (s.templates.find((x) => x.id === id)?.name ?? "—")
  const trainingDays = s.schedule.filter((d) => d !== null).length

  return (
    <Screen title="Weekly routine">
      <View style={{ marginTop: -4, marginBottom: 8 }}>
        <Copy size={14} muted>
          Set it once — it repeats every week. {trainingDays} training day
          {trainingDays === 1 ? "" : "s"}, {7 - trainingDays} rest.
        </Copy>
      </View>
      <Frame style={{ padding: 4 }}>
        {DAYS.map((day, i) => {
          const id = s.schedule[i]
          const rest = id === null
          return (
            <Tap
              key={day}
              label={`${day}: ${nameOf(id)}. Change`}
              onPress={() => setEditing(i)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 12,
                paddingVertical: 14,
                borderTopWidth: i ? 1 : 0,
                borderColor: border(t.line, 0.6),
              }}
            >
              <Copy weight="medium" style={{ width: 96 }}>
                {day}
              </Copy>
              <Line style={{ gap: 8 }}>
                <View
                  style={{
                    borderRadius: 12,
                    borderWidth: 1,
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderColor: rest ? t.line : t.fit,
                    backgroundColor: rest ? t.card : `${t.fit}12`,
                  }}
                >
                  <Copy
                    size={14}
                    weight={rest ? "body" : "semibold"}
                    style={{ color: rest ? t.muted : t.fit }}
                  >
                    {nameOf(id)}
                  </Copy>
                </View>
              </Line>
            </Tap>
          )
        })}
      </Frame>
      <SectionHeading
        action={
          <Tap onPress={() => go("/fitness/templates")}>
            <Copy size={12} style={{ color: t.fit }}>
              Manage
            </Copy>
          </Tap>
        }
      >
        Workouts
      </SectionHeading>
      <Copy size={12} muted style={{ paddingHorizontal: 4 }}>
        A day points at one of your templates. Edit a template and every day
        that uses it follows.
      </Copy>

      {editing !== null && (
        <Sheet
          title={`${DAYS[editing]} — pick a workout`}
          open={editing !== null}
          onClose={() => setEditing(null)}
        >
          <PickRow
            icon={<Moon size={18} color={t.muted} />}
            label="Rest day"
            selected={s.schedule[editing] === null}
            onPress={() => {
              A.setScheduleDay(editing, null)
              setEditing(null)
            }}
          />
          {s.templates.map((tpl) => (
            <PickRow
              key={tpl.id}
              icon={<LayoutList size={18} color={t.fit} />}
              label={tpl.name}
              detail={`${tpl.items.length} exercise${tpl.items.length === 1 ? "" : "s"}`}
              selected={s.schedule[editing] === tpl.id}
              onPress={() => {
                A.setScheduleDay(editing, tpl.id)
                setEditing(null)
              }}
            />
          ))}
          <Tap
            onPress={() => {
              setEditing(null)
              go("/fitness/templates")
            }}
            style={{ paddingVertical: 14, alignItems: "center" }}
          >
            <Copy size={14} style={{ color: t.fit }}>
              + New template
            </Copy>
          </Tap>
        </Sheet>
      )}
    </Screen>
  )
}

function PickRow({
  icon,
  label,
  detail,
  selected,
  onPress,
}: {
  icon: React.ReactNode
  label: string
  detail?: string
  selected: boolean
  onPress: () => void
}) {
  const t = useTheme()
  return (
    <Tap
      label={`${label}${selected ? ", selected" : ""}`}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 12,
      }}
    >
      {icon}
      <View style={{ flex: 1 }}>
        <Copy weight="medium">{label}</Copy>
        {detail ? (
          <Copy size={12} muted>
            {detail}
          </Copy>
        ) : null}
      </View>
      {selected && <Check size={18} color={t.fit} />}
    </Tap>
  )
}
