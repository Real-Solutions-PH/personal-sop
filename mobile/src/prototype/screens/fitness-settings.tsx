import * as A from "@domain/fitness/actions"
import { kg } from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import {
  Dumbbell,
  LayoutList,
  Minus,
  Plus,
  RotateCcw,
  Target,
} from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { liveMode } from "@/live/config"
import {
  Copy,
  Frame,
  IconTap,
  Line,
  LinkRow,
  SectionHeading,
  Segmented,
  Tap,
} from "../native-kit"
import { useTheme } from "../theme"
import { TimeInput } from "../time-input"
import { Screen } from "../ui"
import { GoalSheet } from "./fitness-body"
export function FitnessSettings() {
  const s = fitStore.use((s) => s),
    st = s.settings,
    t = useTheme(),
    [goal, setGoal] = useState(false)
  return (
    <Screen title="Fitness settings">
      <View style={{ marginTop: -12 }}>
        <SectionHeading>Training</SectionHeading>
        <Frame style={{ padding: 16, gap: 16 }}>
          <View style={{ gap: 6 }}>
            <Copy size={14}>Units</Copy>
            <Segmented
              value={st.units}
              onChange={(units) => A.updateSettings({ units })}
              options={[
                { value: "kg", label: "kg" },
                { value: "lb", label: "lb" },
              ]}
            />
            {st.units === "lb" && (
              <Copy size={12} muted>
                Stored in kg; the prototype still displays kg.
              </Copy>
            )}
          </View>
          <View style={{ gap: 6 }}>
            <Copy size={14}>Default rest</Copy>
            <Line style={{ gap: 8, flexWrap: "wrap" }}>
              {[60, 90, 120, 150, 180].map((n) => (
                <Tap
                  key={n}
                  onPress={() => A.updateSettings({ restSec: n })}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 99,
                    borderWidth: 1,
                    borderColor: st.restSec === n ? t.fit : t.line,
                    backgroundColor: st.restSec === n ? t.fit : t.card,
                  }}
                >
                  <Copy
                    size={14}
                    weight="medium"
                    style={{ color: st.restSec === n ? t.bg : t.text }}
                  >
                    {n < 120 ? `${n}s` : `${n / 60}m`.replace(".5m", "m30")}
                  </Copy>
                </Tap>
              ))}
            </Line>
          </View>
          <Line style={{ justifyContent: "space-between", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Copy size={14}>Weekly session target</Copy>
              <Copy size={12} muted>
                Missed sessions = target − done
              </Copy>
            </View>
            <Line style={{ gap: 8 }}>
              <IconTap
                size={36}
                icon={Minus}
                label="Fewer"
                background={t.soft}
                onPress={() =>
                  A.updateSettings({
                    weeklyTarget: Math.max(1, st.weeklyTarget - 1),
                  })
                }
              />
              <Copy
                weight="semibold"
                style={{ width: 24, textAlign: "center" }}
              >
                {st.weeklyTarget}
              </Copy>
              <IconTap
                size={36}
                icon={Plus}
                label="More"
                background={t.soft}
                onPress={() =>
                  A.updateSettings({
                    weeklyTarget: Math.min(7, st.weeklyTarget + 1),
                  })
                }
              />
            </Line>
          </Line>
          <View style={{ gap: 6 }}>
            <Copy size={14}>How weight goes up</Copy>
            <Segmented
              value={st.progression}
              onChange={(progression) => A.updateSettings({ progression })}
              options={[
                { value: "double", label: "Reps, then weight" },
                { value: "linear", label: "Weight every session" },
              ]}
            />
            <Copy size={12} muted>
              {st.progression === "double"
                ? "Hit the top of the rep range on every set → add weight. Otherwise add a rep."
                : "Add one increment every session."}
            </Copy>
          </View>
        </Frame>
      </View>
      <View style={{ marginTop: -12 }}>
        <SectionHeading>Body</SectionHeading>
        <Frame style={{ padding: 16, gap: 12 }}>
          <Tap onPress={() => setGoal(true)}>
            <Line style={{ justifyContent: "space-between" }}>
              <View>
                <Copy weight="medium">Goal</Copy>
                <Copy size={14} muted style={{ textTransform: "capitalize" }}>
                  {
                    {
                      cut: "lose weight",
                      maintain: "maintain",
                      bulk: "gain weight",
                    }[st.goalDirection]
                  }
                  {st.goalWeight ? ` → ${kg(st.goalWeight)}` : ""}
                </Copy>
              </View>
              <Copy
                size={11}
                style={{
                  color: t.fit,
                  backgroundColor: `${t.fit}1a`,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 99,
                  textTransform: "capitalize",
                }}
              >
                {
                  {
                    cut: "lose weight",
                    maintain: "maintain",
                    bulk: "gain weight",
                  }[st.goalDirection]
                }
              </Copy>
            </Line>
          </Tap>
          <Line style={{ gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Copy size={14}>Weigh-in reminder</Copy>
              <Copy size={12} muted>
                A notification on this phone every morning at this time
              </Copy>
            </View>
            <View style={{ width: 112 }}>
              <TimeInput
                label="Reminder time"
                value={st.weighInReminder}
                onChange={(weighInReminder) =>
                  A.updateSettings({ weighInReminder })
                }
              />
            </View>
          </Line>
        </Frame>
      </View>
      <View style={{ marginTop: -12 }}>
        <SectionHeading>AI for meals</SectionHeading>
        <Frame style={{ padding: 16, gap: 12 }}>
          <Segmented
            value={st.aiSource}
            onChange={(aiSource) => A.updateSettings({ aiSource })}
            options={[
              { value: "builtin", label: "Built-in AI" },
              { value: "connector", label: "Claude connector" },
            ]}
          />
          <Copy size={12} muted>
            {st.aiSource === "builtin"
              ? "Photos and descriptions are estimated in-app. You confirm every estimate."
              : "Claude connector · Coming soon. Add this app as a custom connector in Claude; meals you log there land here as ‘via Claude’."}
          </Copy>
        </Frame>
      </View>
      <View style={{ marginTop: -12 }}>
        <SectionHeading>Library</SectionHeading>
        <Frame style={{ padding: 8 }}>
          <LinkRow
            icon={Dumbbell}
            title="Exercises"
            detail={`${s.exercises.filter((e) => !e.archived).length} active`}
            href="/fitness/exercises"
            accent="fit"
          />
          <LinkRow
            icon={LayoutList}
            title="Templates"
            detail={s.templates.map((x) => x.name).join(" · ")}
            href="/fitness/templates"
            accent="fit"
          />
          <LinkRow
            icon={Target}
            title="Macro targets"
            detail="Calories, protein, carbs, fat"
            href="/fitness/nutrition/targets"
            accent="fit"
          />
        </Frame>
      </View>
      {/* Demo-only, as on Me: a live account's data is real and synced, so
          it is never replaced by samples from here. */}
      {!liveMode && (
        <Tap
          onPress={() => {
            A.resetFitness()
            toast.success("Fitness demo data restored")
          }}
          style={{ paddingVertical: 16, alignItems: "center" }}
        >
          <Line style={{ gap: 8 }}>
            <RotateCcw size={16} color={t.muted} />
            <Copy size={14} muted>
              Reset fitness demo data
            </Copy>
          </Line>
        </Tap>
      )}
      {goal && <GoalSheet open={goal} onClose={() => setGoal(false)} />}
    </Screen>
  )
}
