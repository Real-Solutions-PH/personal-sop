// Patterns on Stats: up to three things that go together in the last 60
// days (sleep, workouts, steps against mood and habits). Hidden until one
// qualifies. Everything is read on the phone; nothing new is stored.
import type { JournalEntry } from "@domain/capture/data"
import { captureStore } from "@domain/capture/store"
import * as F from "@domain/fitness/calc"
import type { FitnessState } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import type { HabitsState } from "@domain/habits/data"
import * as H from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { useMemo } from "react"
import type { DayActivity } from "../health"
import { findInsights, type InsightDay } from "../insights"
import { Copy, Frame, SectionHeading } from "../native-kit"
import { useHealthAsked } from "./health-connect"
import { useNights } from "./sleep-card"
import { calDay, lastDays, useDays } from "./steps-card"

const SPAN = lastDays(60)

/** One row per day, oldest first. Health reads are by calendar day and the
 * rest by the app's day; the two differ only between midnight and 04:00. */
export function insightDays(
  days: readonly string[],
  nights: readonly (number | null)[] | undefined,
  activity: readonly (DayActivity | null)[] | undefined,
  fit: FitnessState,
  habits: HabitsState,
  journal: readonly JournalEntry[],
): InsightDay[] {
  const worked = new Set(
      F.finished(fit).map((w) => dayKey(new Date(w.startedAt))),
    ),
    first = days[0] ?? dayKey(),
    last = days.at(-1) ?? dayKey(),
    rates = new Map(
      H.overallDays(
        habits.habits.filter((h) => h.status !== "archived"),
        H.logIndex(habits.logs),
        first,
        last,
      ).map((d) => [d.day, d.rate]),
    ),
    moods = new Map<string, number[]>()
  for (const j of journal)
    if (j.mood) moods.set(j.day, [...(moods.get(j.day) ?? []), j.mood])
  return days.map((day, i) => {
    const m = moods.get(day)
    return {
      day,
      sleepMin: nights?.[i] ?? null,
      workout: worked.has(day),
      steps: activity?.[i]?.steps ?? null,
      mood: m ? m.reduce((a, b) => a + b, 0) / m.length : undefined,
      habits: rates.get(day) ?? null,
    }
  })
}

export function PatternsCard() {
  const { asked } = useHealthAsked(),
    nights = useNights(SPAN, asked),
    activity = useDays(SPAN, asked),
    fit = fitStore.use((s) => s),
    habits = habitsStore.use((s) => s),
    journal = captureStore.use((s) => s.journal),
    found = useMemo(
      () =>
        findInsights(
          insightDays(SPAN.map(calDay), nights, activity, fit, habits, journal),
        ),
      [nights, activity, fit, habits, journal],
    )
  if (!found.length) return null
  return (
    <>
      <SectionHeading>Patterns</SectionHeading>
      <Frame style={{ padding: 16, gap: 10 }}>
        {found.map((x) => (
          <Copy key={x.id}>{x.text}</Copy>
        ))}
        <Copy size={12} muted>
          From your last 60 days. Things that go together, not proof one causes
          the other.
        </Copy>
      </Frame>
    </>
  )
}
