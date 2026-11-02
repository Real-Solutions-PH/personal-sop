// The day's big wins, over whatever screen is open: the moment today's ring
// reaches the person's target ("On target"), the stronger moment when
// everything due is done ("Perfect day"), and the very first log ("Day 1 is
// lit"), which onboarding promised. Each plays once (a day, or once ever for
// the first log) and only right after a completion on this phone, so a pull
// from another device or simply opening the app never plays one.
import * as D from "@domain/dash/hooks"
import { dashStore } from "@domain/dash/store"
import { habitsStore } from "@domain/habits/store"
import { createStore } from "@domain/lib/store"
import { usePathname } from "expo-router"
import { Flame, Sparkles, Sprout, Stamp, Target } from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import { View } from "react-native"
import { MomentCard, momentSlot } from "./moment"
import { Burst, claimDayMoment, completedAgo, feel, StreakChip } from "./motion"
import { Copy, Line } from "./native-kit"
import { go } from "./navigation"
import {
  causedHere,
  claimDay,
  dayStanding,
  rewardStore,
  standingMoment,
} from "./rewards"
import { useTheme } from "./theme"

export const DAY_MS = 4200
/** The key Today's all-habits banner plays under (``useDayMoment``). */
export const HABITS_KEY = "sop:celebrated:habits"
const RANK = { perfect: 0, target: 1, habits: 2, first: 3, sealed: 4 } as const

/** A moment a screen hands over as it navigates away (sealing the day
 * goes straight back to Today, so its stamp lands here). */
const handed = createStore(
  "day-moment-handed",
  () => ({
    sealed: null as { done: number; due: number; onTarget: boolean } | null,
  }),
  { persist: false },
)
export const announceSealed = (x: {
  done: number
  due: number
  onTarget: boolean
}) => handed.set({ sealed: x })
/** A completion this recent caused the change (the check commits ~0.5 s
 * after the tap, and the ring follows it). */
const CAUSED_MS = 4000
type Moment = {
  kind: "target" | "perfect" | "first" | "habits" | "sealed"
  /** Sealed only: whether the day ended on target. */
  onTarget?: boolean
  done: number
  due: number
}

/** Mounted once at the shell. */
export function DayMomentWatcher({ hidden = false }: { hidden?: boolean }) {
  const ring = D.useTodayRing()
  const threshold = dashStore.use((s) => s.targetThreshold)
  const target = D.useOnTarget(7)
  const logged = target.logged
  const other = momentSlot.use((s) => s.holder !== null && s.holder !== "day")
  const path = usePathname()
  // The newest habit log's stamp: a widget or lock-screen tap logs through
  // the in-app action, so it counts as a completion here too.
  // (A re-log replaces its row in place, so take the newest, not the last;
  // a stamp ahead of this clock, from a device running fast, is skipped so
  // it cannot hide a tap made here.)
  const lastLogAt = habitsStore.use((s) => {
    const now = Date.now()
    let at: string | undefined
    for (const l of s.logs)
      if (
        l.loggedAt &&
        (!at || l.loggedAt > at) &&
        Date.parse(l.loggedAt) <= now
      )
        at = l.loggedAt
    return at
  })
  const habits = ring.per.habits
  const allHabits = habits.due > 0 && habits.done >= habits.due
  const standing = dayStanding(ring, threshold)
  const was = useRef({ standing, logged, allHabits })
  const [moment, setMoment] = useState<Moment | null>(null)
  useEffect(() => {
    const before = was.current
    was.current = { standing, logged, allHabits }
    if (!causedHere(completedAgo(), lastLogAt, CAUSED_MS)) return
    const step = standingMoment(before.standing, standing)
    const habitsNow = !before.allHabits && allHabits
    const firstNow = before.logged === 0 && logged > 0
    // Several at once (the last habit puts the day on target): the biggest
    // plays, and the others are used up so none follows it.
    const won: Moment["kind"][] = []
    if (step === "perfect" && claimDay("day-perfect")) won.push("perfect")
    if (step && claimDay("day-target")) won.push("target")
    // Today shows its own all-habits banner under the same once-a-day key.
    if (habitsNow && path !== "/today" && claimDayMoment(HABITS_KEY))
      won.push("habits")
    if (firstNow && !rewardStore.get().days["first-log"]) {
      claimDay("first-log")
      won.push("first")
    }
    const kind = won[0]
    if (!kind) return
    setMoment((m) =>
      m && RANK[m.kind] <= RANK[kind]
        ? m
        : kind === "habits"
          ? { kind, done: habits.done, due: habits.due }
          : { kind, done: ring.done, due: ring.due },
    )
  }, [
    standing,
    logged,
    allHabits,
    path,
    ring.done,
    ring.due,
    habits,
    lastLogAt,
  ])
  const sealed = handed.use((s) => s.sealed)
  useEffect(() => {
    if (!sealed) return
    handed.set({ sealed: null })
    setMoment({ kind: "sealed", ...sealed })
  }, [sealed])
  const suppressed = hidden || other
  useEffect(() => {
    if (!moment || suppressed) return
    const id = setTimeout(() => setMoment(null), DAY_MS)
    return () => clearTimeout(id)
  }, [moment, suppressed])
  if (!moment || suppressed) return null
  return (
    <DayMomentCard
      moment={moment}
      streak={Math.max(1, target.current)}
      onOpen={() => {
        setMoment(null)
        go("/stats")
      }}
      onClose={() => setMoment(null)}
    />
  )
}

export function DayMomentCard({
  moment,
  streak,
  onOpen,
  onClose,
}: {
  moment: Moment
  streak: number
  onOpen: () => void
  onClose: () => void
}) {
  const t = useTheme()
  const [fire, setFire] = useState(0)
  const short = moment.kind === "sealed" && !moment.onTarget
  const perfect = moment.kind === "perfect"
  useEffect(() => {
    // The burst follows the card in; the impact lands after the success.
    // A day sealed below target lands in the bad colour with a warning
    // and no burst; a
    // perfect day bursts twice with a second impact.
    if (short) {
      const id = setTimeout(feel.warning, 140)
      return () => clearTimeout(id)
    }
    setFire(1)
    const ids = [setTimeout(feel.impact, 140)]
    if (perfect)
      ids.push(
        setTimeout(() => {
          setFire(2)
          feel.impact()
        }, 420),
      )
    return () => {
      for (const id of ids) clearTimeout(id)
    }
  }, [short, perfect])
  const copy =
    moment.kind === "sealed"
      ? {
          label: moment.onTarget ? "Day sealed" : "Day sealed · off target",
          title: moment.onTarget ? "Sealed on target" : "Sealed below target",
          line: `${moment.done} of ${moment.due} done`,
          icon: Stamp,
        }
      : moment.kind === "first"
        ? {
            label: "Day 1",
            title: "Your first log — day 1 is lit",
            line: "Six more days to light up your first week.",
            icon: Sprout,
          }
        : moment.kind === "habits"
          ? {
              label: "All habits done",
              title: "Every habit done today",
              line: `${moment.done} of ${moment.due} done today`,
              icon: Target,
            }
          : moment.kind === "perfect"
            ? {
                label: "Perfect day",
                title: "Everything due today is done",
                line: `${moment.done} of ${moment.due} done`,
                icon: Sparkles,
              }
            : {
                label: "On target",
                title: "Today is on target",
                line: `${moment.done} of ${moment.due} done`,
                icon: Flame,
              }
  const Icon = copy.icon
  return (
    <MomentCard
      kind="day"
      testID="day-moment"
      label={copy.label}
      title={copy.title}
      detail={
        <Line style={{ gap: 6, flexWrap: "wrap" }}>
          <Copy size={13} muted>
            {copy.line}
          </Copy>
          {moment.kind !== "first" &&
            (moment.kind !== "sealed" || moment.onTarget) && (
              <StreakChip streak={streak} from={streak - 1} />
            )}
        </Line>
      }
      badge={
        <View>
          <Icon size={22} color={t.onPrimary} strokeWidth={2.2} />
          <Burst fire={fire} color={t.life} size={perfect ? 64 : 44} />
        </View>
      }
      tint={short ? t.bad : t.life}
      say={`${copy.label}. ${copy.title}. ${copy.line}${moment.kind === "first" ? "" : `. ${streak}-day on-target streak`}`}
      hint="Opens Stats"
      onOpen={onOpen}
      onClose={onClose}
    />
  )
}
