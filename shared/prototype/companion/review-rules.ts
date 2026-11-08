// Fern's review, the parts that live on the phone: the response shape
// (POST /companion/review), the rules review for prototype mode (a port
// of the server's rules fallback), the days a "N days a week" habit lands
// on, and the suggestions the person dismissed (kept 30 days, this device).
import { createStore } from "../lib/store"

export interface ReviewSuggestion {
  kind: "habit" | "task"
  title: string
  days_per_week?: number | null
}
export interface ReviewGap {
  text: string
  how: string
  suggestion: ReviewSuggestion
}
export interface ReviewOut {
  wins: { text: string }[]
  gaps: ReviewGap[]
  source: "ai" | "rules"
}
export type ReviewKind = "way_back" | "weekly"

const MAX_WINS = 3
const MAX_GAPS = 2
const DISMISS_DAYS = 30

/** Weekdays (0 = Sunday) for a habit done ``n`` days a week, spread out. */
export function daysForWeek(n: number | null | undefined): number[] {
  const spread: Record<number, number[]> = {
    1: [1],
    2: [1, 4],
    3: [1, 3, 5],
    4: [1, 2, 4, 5],
    5: [1, 2, 3, 4, 5],
    6: [1, 2, 3, 4, 5, 6],
  }
  return (n && spread[n]) || [0, 1, 2, 3, 4, 5, 6]
}

export interface ReviewRulesInput {
  kind: ReviewKind
  days: { day: string; onTarget: boolean | null }[]
  habits: { name: string; done: number; missed: number; streak: number }[]
  tasksDone: number
  dismissed: string[]
}

/** Wins and gaps from the data alone (the server's rules review). */
export function reviewRules(i: ReviewRulesInput): ReviewOut {
  const scored = i.days.filter((d) => d.onTarget !== null)
  const hits = scored.filter((d) => d.onTarget).length
  const wins: { text: string }[] = []
  if (hits)
    wins.push({
      text: `You hit your target on ${hits} of ${scored.length} days.`,
    })
  const top = [...i.habits].sort((a, b) => b.streak - a.streak)[0]
  if (top && top.streak >= 2)
    wins.push({ text: `${top.name}: ${top.streak} days in a row.` })
  if (i.tasksDone)
    wins.push({
      text: `You finished ${i.tasksDone} task${i.tasksDone === 1 ? "" : "s"}.`,
    })
  if (!wins.length)
    wins.push({
      text:
        i.kind === "way_back"
          ? "You came back. That's the step that counts."
          : "You kept tracking this week.",
    })
  const banned = new Set(i.dismissed.map((d) => d.trim().toLowerCase()))
  const gaps = i.habits
    .filter((h) => h.missed > 0)
    .sort((a, b) => b.missed - a.missed || a.name.localeCompare(b.name))
    .slice(0, MAX_GAPS)
    .map((h): ReviewGap => {
      const n = Math.max(2, h.done + 1)
      return {
        text: `${h.name} slipped on ${h.missed} day${h.missed === 1 ? "" : "s"}.`,
        how: `Start with ${n} days a week — a smaller target you can hit.`,
        suggestion: {
          kind: "task",
          title: `Plan when to do ${h.name} this week`.slice(0, 60),
        },
      }
    })
    .filter((g) => !banned.has(g.suggestion.title.toLowerCase()))
  return { wins: wins.slice(0, MAX_WINS), gaps, source: "rules" }
}

/** Suggestions the person waved away, so Fern does not offer them again. */
export const reviewDismissStore = createStore("fern-review", () => ({
  dismissed: [] as { title: string; at: string }[],
}))

export function dismissSuggestion(title: string, now = new Date()) {
  reviewDismissStore.set((s) => ({
    dismissed: [
      ...s.dismissed.filter((d) => d.title !== title),
      { title, at: now.toISOString() },
    ],
  }))
}

/** Titles dismissed in the last ``DISMISS_DAYS`` days. */
export function dismissedTitles(now = new Date()): string[] {
  const since = now.getTime() - DISMISS_DAYS * 86_400_000
  return reviewDismissStore
    .get()
    .dismissed.filter((d) => Date.parse(d.at) >= since)
    .map((d) => d.title)
}
