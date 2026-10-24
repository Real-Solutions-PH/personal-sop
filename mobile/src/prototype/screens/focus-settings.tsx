// The focus goal and the timer's defaults (ADR-0025).

import { saveFocusSettings } from "@domain/focus/actions"
import { PRESETS, type PresetKey } from "@domain/focus/data"
import { useFocusState } from "@domain/focus/store"
import { View } from "react-native"
import { Stepper } from "../fitness-controls"
import { Copy, Frame, Segmented } from "../native-kit"
import { Screen, Toggle } from "../ui"

type Choice = PresetKey | "custom"

export function FocusSettings() {
  const st = useFocusState().settings
  const pick = (p: Choice) => {
    if (p === "custom") return saveFocusSettings({ preset: "custom" })
    const [f, sb, lb, n] = PRESETS[p].lengths
    saveFocusSettings({
      preset: p,
      focusMin: f,
      shortBreakMin: sb,
      longBreakMin: lb,
      setsBeforeLong: n,
    })
  }
  const custom = (patch: Parameters<typeof saveFocusSettings>[0]) =>
    saveFocusSettings({ ...patch, preset: "custom" })
  return (
    <Screen title="Focus settings">
      <View style={{ gap: 16 }}>
        <Frame style={{ padding: 16, gap: 8 }}>
          <Copy weight="semibold">Daily goal</Copy>
          <Stepper
            label="Deep work a day"
            unit="h"
            value={st.dailyGoalMin / 60}
            onChange={(h) =>
              saveFocusSettings({ dailyGoalMin: Math.round(h * 60) })
            }
            step={0.5}
            min={0}
            max={12}
            decimals={1}
          />
          <Copy size={12} muted>
            A day counts toward your focus streak and Life Score once it reaches
            this. 0 turns the goal off.
          </Copy>
        </Frame>
        <Frame style={{ padding: 16, gap: 12 }}>
          <Copy weight="semibold">Timer</Copy>
          <Segmented
            value={st.mode}
            onChange={(mode) => saveFocusSettings({ mode })}
            options={[
              { value: "pomodoro", label: "Pomodoro" },
              { value: "stopwatch", label: "Stopwatch" },
            ]}
          />
          <Segmented
            value={st.preset as Choice}
            onChange={pick}
            options={[
              ...(Object.keys(PRESETS) as PresetKey[]).map((k) => ({
                value: k as Choice,
                label: `${PRESETS[k].lengths[0]}/${PRESETS[k].lengths[1]}`,
              })),
              { value: "custom" as Choice, label: "Custom" },
            ]}
          />
          <Stepper
            label="Focus"
            unit="min"
            value={st.focusMin}
            onChange={(v) => custom({ focusMin: v })}
            step={5}
            min={5}
            max={240}
            decimals={0}
          />
          <Stepper
            label="Short break"
            unit="min"
            value={st.shortBreakMin}
            onChange={(v) => custom({ shortBreakMin: v })}
            step={1}
            min={1}
            max={60}
            decimals={0}
          />
          <Stepper
            label="Long break"
            unit="min"
            value={st.longBreakMin}
            onChange={(v) => custom({ longBreakMin: v })}
            step={5}
            min={5}
            max={120}
            decimals={0}
          />
          <Stepper
            label="Sets before a long break"
            value={st.setsBeforeLong}
            onChange={(v) => custom({ setsBeforeLong: v })}
            step={1}
            min={1}
            max={12}
            decimals={0}
          />
        </Frame>
        <Frame style={{ paddingHorizontal: 16 }}>
          <Toggle
            label="Start breaks by themselves"
            value={st.autoStartBreaks}
            onChange={(v) => saveFocusSettings({ autoStartBreaks: v })}
          />
          <Toggle
            label="Start the next set after a short break"
            value={st.autoStartFocus}
            onChange={(v) => saveFocusSettings({ autoStartFocus: v })}
          />
          <Toggle
            label="Notify me when a set or break ends"
            value={st.notify}
            onChange={(v) => saveFocusSettings({ notify: v })}
          />
        </Frame>
        <Copy size={12} muted>
          Auto-start stops at a long break, so a session left running never runs
          more than one round on its own.
        </Copy>
      </View>
    </Screen>
  )
}
