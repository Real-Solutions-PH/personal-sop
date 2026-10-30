// Screen time's pieces outside its settings screen (spec
// 2026-10-29-screen-time-design, "Mobile surfaces"): the ring, label and
// "auto" mark a habit driven by screen time shows instead of a check, and
// the Screen time section on Stats. Every minute is a lower bound (the
// highest threshold crossed), so it always reads "≥ N min".

import { dashStore } from "@domain/dash/store"
import type { Habit, HabitLog } from "@domain/habits/data"
import { progressOf } from "@domain/habits/logic"
import { DAY_START_HOUR, dayKey, dayOffset } from "@domain/lib/day"
import type { ScreenDay, ScreenGroup } from "@domain/screen/data"
import { type RuleState, ruleState } from "@domain/screen/logic"
import { useScreen } from "@domain/screen/store"
import { Smartphone } from "lucide-react-native"
import { View } from "react-native"
import { AnimatedCheck, GrowBar } from "../motion"
import {
  border,
  Copy,
  Frame,
  Line,
  LinkRow,
  SectionHeading,
} from "../native-kit"
import { fonts, useTheme } from "../theme"
import { useNow } from "../ui"
import { LockedPreview } from "./locked-preview"

export const AUTO_LABEL = "Completes automatically from screen time"

/** A rule habit's state on `day`, from that day's row for its group: no
 * row means the day wasn't observed. */
export function ruleStateFor(
  habit: Habit,
  days: ScreenDay[],
  day: string,
  nowMs: number,
): RuleState | null {
  const rule = habit.rule
  if (!rule) return null
  const row = days.find((d) => d.groupId === rule.groupId && d.day === day)
  return ruleState(
    rule,
    {
      day,
      groupId: rule.groupId,
      observed: !!row,
      usedMin: row?.usedMin ?? 0,
      closed: row?.closed ?? false,
    },
    nowMs,
    DAY_START_HOUR,
  )
}

/** "≥ 15 of 30 min", "None yet", "Over by ≥ 5 min" or "Not tracked". */
export function ruleLabel(state: RuleState, maxMin: number): string {
  if (state.kind === "untracked") return "Not tracked"
  if (state.kind === "broken") return `Over by ≥ ${state.overMin} min`
  if (maxMin === 0 && state.usedMin === 0) return "None yet"
  return `≥ ${state.usedMin} of ${maxMin} min`
}

/** The live state of a rule habit, re-read as the day goes by so the ring
 * fills with the share of the app day gone. */
export function useRuleState(habit: Habit, day = dayKey()) {
  const now = useNow(),
    days = useScreen().days
  return ruleStateFor(habit, days, day, now)
}

/** The habit's ring, filled by the rule (or checked once the day closed
 * within the limit), drawn but not pressable. */
export function RuleRing({
  habit,
  log,
  state,
  size,
  ring,
}: {
  habit: Habit
  log?: HabitLog
  state: RuleState | null
  size: number
  ring?: number
}) {
  const t = useTheme(),
    done = log?.status === "done",
    broken = state?.kind === "broken"
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <AnimatedCheck
        checked={done}
        onToggle={() => {}}
        label={habit.name}
        color={t.hab}
        idle={broken ? t.bad : border(t.muted, 0.3)}
        size={size}
        ring={ring}
        checkColor={t.onPrimary}
        progress={state ? progressOf(habit, log, state) : 0}
      />
    </View>
  )
}

/** Whether screen time drives this habit right now: it has a rule and
 * Screen time is switched on. Off, it is logged by hand like any habit. */
export function useAutoRule(habit: Habit): boolean {
  const on = dashStore.use((s) => s.enabled.screen)
  return !!habit.rule && on
}

export const SCREEN_OFF_LABEL = "Screen Time off · log it yourself"

/** Beside a rule habit's name while Screen time is off. */
export function ScreenOffMark() {
  return (
    <Copy size={12} muted lines={1}>
      {SCREEN_OFF_LABEL}
    </Copy>
  )
}

/** The small "auto" mark beside a rule habit's name. */
export function AutoMark() {
  const t = useTheme()
  return (
    <View
      accessible
      accessibilityLabel={AUTO_LABEL}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        borderRadius: 12,
        backgroundColor: t.soft,
        paddingHorizontal: 6,
        paddingVertical: 1,
      }}
    >
      <Smartphone size={12} color={t.muted} />
      <Copy size={12} muted style={{ lineHeight: 15 }}>
        auto
      </Copy>
    </View>
  )
}

/** The rule's label, in the miss colour once broken. */
export function RuleText({
  state,
  maxMin,
  done,
}: {
  state: RuleState | null
  maxMin: number
  done?: boolean
}) {
  const t = useTheme()
  if (!state) return null
  return (
    <Copy
      size={12}
      muted={state.kind !== "broken"}
      style={state.kind === "broken" && !done ? { color: t.bad } : undefined}
    >
      {ruleLabel(state, maxMin)}
    </Copy>
  )
}

const narrowDay = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-PH", { weekday: "narrow" })

/** The group whose minutes lead: All apps when kept, else the first. */
export function mainGroup(groups: ScreenGroup[]) {
  const live = groups
    .filter((g) => !g.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  return live.find((g) => g.kind === "all") ?? live[0]
}

const SAMPLE_DAYS = [150, 120, 165, 135, 105, 180, 45]

/** Stats' Screen time section: today's minutes per group and the last
 * seven days of the main group, all lower bounds. */
export function ScreenTimeCard() {
  const t = useTheme(),
    s = useScreen(),
    today = dayKey(),
    week = Array.from({ length: 7 }, (_, i) => dayOffset(i - 6)),
    groups = s.groups
      .filter((g) => !g.archivedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    main = mainGroup(s.groups),
    used = (groupId: string, day: string) =>
      s.days.find((d) => d.groupId === groupId && d.day === day)?.usedMin,
    real = main ? week.map((d) => used(main.id, d)) : [],
    empty = !groups.length || real.every((v) => v === undefined),
    bars = empty ? SAMPLE_DAYS : real.map((v) => v ?? 0),
    top = Math.max(60, ...bars)
  return (
    <>
      <SectionHeading>Screen time</SectionHeading>
      <LockedPreview
        locked={empty}
        title="Screen time isn't connected"
        detail="Connect Screen Time and pick the apps to count. Minutes show here from the day you connect."
        action={{ label: "Set up Screen time", href: "/screen" }}
        color={t.scr}
        icon={Smartphone}
      >
        <Frame style={{ padding: 16, gap: 12 }}>
          <Line style={{ gap: 16, flexWrap: "wrap" }}>
            {(empty
              ? [
                  { id: "a", name: "All apps" },
                  { id: "s", name: "Social" },
                ]
              : groups
            ).map((g, i) => {
              const v = empty ? [45, 15][i] : used(g.id, today)
              return (
                <View key={g.id} style={{ minWidth: 88 }}>
                  <Copy size={20} style={{ fontFamily: fonts.mono }}>
                    {v === undefined ? "—" : `≥ ${v}`}
                    <Copy size={12} muted>
                      {v === undefined ? "" : " min"}
                    </Copy>
                  </Copy>
                  <Copy size={12} muted lines={1}>
                    {g.name} today
                  </Copy>
                </View>
              )
            })}
          </Line>
          <View>
            <Line style={{ alignItems: "flex-end", height: 72, gap: 4 }}>
              {bars.map((v, i) => (
                <View
                  key={week[i]}
                  style={{
                    flex: 1,
                    height: "100%",
                    justifyContent: "flex-end",
                  }}
                >
                  <Copy
                    size={12}
                    muted
                    style={{ textAlign: "center", fontFamily: fonts.mono }}
                  >
                    ≥{v}
                  </Copy>
                  <GrowBar
                    height={`${Math.max(2, (v / top) * 70)}%`}
                    index={i}
                    style={{
                      borderTopLeftRadius: 6,
                      borderTopRightRadius: 6,
                      backgroundColor: t.scr,
                      opacity: i === bars.length - 1 ? 1 : 0.45,
                    }}
                  />
                </View>
              ))}
            </Line>
            <Line style={{ gap: 4, marginTop: 4 }}>
              {week.map((d) => (
                <Copy
                  key={d}
                  size={12}
                  muted
                  style={{ flex: 1, textAlign: "center" }}
                >
                  {narrowDay(d)}
                </Copy>
              ))}
            </Line>
          </View>
          <Copy size={12} muted>
            At least this many minutes a day on {main?.name ?? "All apps"}. iOS
            reports use in steps, so the true figure can be a little higher.
          </Copy>
          <LinkRow title="Screen time settings" href="/screen" />
        </Frame>
      </LockedPreview>
    </>
  )
}
