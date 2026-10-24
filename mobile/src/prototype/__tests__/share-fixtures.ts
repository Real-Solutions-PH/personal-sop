// Share-card data for render tests: a normal week and a stress case with
// the long values that broke card layouts (seven-digit counts, 4-digit
// streaks, long names and titles, money in a metric string).
import type { CardData } from "@domain/dash/share-data"
import type { WorkoutCardData } from "../screens/fitness-share"
import type { HabitCardData } from "../screens/habit-share"
import type { JournalCardData } from "../screens/journal-share"
import type { FoodCardData } from "../screens/nutrition-share"
import type { TaskCardData } from "../screens/task-share"
import type { Dot } from "../share-kit"

const days = (n: number, end = "2026-10-24") =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${end}T12:00:00`)
    d.setDate(d.getDate() - (n - 1 - i))
    return d.toISOString().slice(0, 10)
  })
const dots = (n: number, every = 3): Dot[] =>
  Array.from({ length: n }, (_, i) => (i % every === 0 ? "off" : "on"))

export const LONG_NAME = "Maximiliana Concepcion Dela Cruz-Villanueva Santiago"
export const LONG_TITLE =
  "Read twenty pages of a book before bed without the phone in the room"

function series(n: number, current: number, best: number, rate: number) {
  const range = days(n).map((day, i) => ({
    day,
    onTarget: i % 4 === 0 ? false : i % 9 === 0 ? null : true,
    done: 3,
    due: 4,
  }))
  return {
    series: range,
    range,
    rate,
    prevRate: rate - 0.08,
    onTarget: Math.round(n * rate),
    scored: n,
    current,
    best,
    logged: n,
    source: "local" as const,
  }
}
const facets = (v: number) =>
  ["Habits", "Routines", "Tasks", "Training", "Food", "Money"].map(
    (label, i) => ({
      key: label.toLowerCase(),
      label,
      module: (
        ["habits", "habits", "tasks", "fitness", "fitness", "finance"] as const
      )[i],
      value: Math.min(1, v + i * 0.05),
      prev: Math.max(0, v - 0.1),
      off: false,
      href: "/",
    }),
  )
const metric = (key: string, value: string, delta?: number) => ({
  key,
  label: key,
  value,
  delta,
  shareable: true,
})
export function dashData(long = false): CardData {
  const goal = {
    id: "g1",
    metric: long ? "fitness:volume" : "habits:habits.rate",
    label: long ? LONG_TITLE : "Habits 80% this week",
    target: long ? 1234567 : 80,
    unit: long ? "kg" : "%",
    comparator: "gte",
    period: "week",
    createdAt: "2026-10-01",
    status: "active",
    via: "manual",
  }
  return {
    name: long ? LONG_NAME : "Kai Tecson",
    handle: long ? "@maximiliana.concepcion.delacruz" : "@kai",
    photo: undefined,
    identities: long
      ? [LONG_TITLE, LONG_TITLE, LONG_TITLE]
      : ["I train four times a week"],
    enabled: { habits: true, tasks: true, fitness: true, finance: true },
    life: {
      score: long ? 100 : 74,
      prev: 70,
      delta: long ? 1234 : 4,
      rates: {
        habits: 0.86,
        tasks: 0.71,
        fitness: 0.9,
        finance: long ? 12.34 : 0.55,
      },
      prevRates: { habits: 0.8, tasks: 0.7, fitness: 0.8, finance: 0.5 },
      source: "local",
    },
    level: long ? "Grandmaster of consistency and calm" : "Locked in",
    w7: series(7, long ? 1234 : 5, long ? 1234 : 9, 0.86),
    w30: series(30, long ? 1234 : 5, long ? 4321 : 12, 0.77),
    habits7: metric("habits.rate", "86%", 6),
    training7: metric("sessions", long ? "1234567" : "4", long ? 1234 : 1),
    savings7: metric("savings-rate", long ? "₱12,345,678.90" : "23%", -2),
    habits30: metric("habits.rate", "81%"),
    training30: metric("sessions", long ? "1,234,567" : "16"),
    savings30: metric("savings-rate", long ? "1234%" : "23%"),
    prs30: metric("prs", long ? "1234567" : "3"),
    spend30: metric("spend-vs", long ? "+1,234%" : "−8%"),
    nospend30: metric("no-spend", long ? "1234567" : "6"),
    budgetsPct: long ? 1234 : 83,
    trophy: {
      id: "t1",
      type: "pr",
      title: long ? LONG_TITLE : "Bench PR",
      value: long ? "₱12,345,678.90" : "100 kg",
      detail: "",
      day: "2026-10-20",
      href: "/",
    },
    trophies: [1, 2, 3].map((i) => ({
      id: `t${i}`,
      type: "pr" as const,
      title: long ? LONG_TITLE : `Record ${i}`,
      value: long ? "1234567" : `${i * 10} kg`,
      detail: "",
      day: "2026-10-20",
      href: "/",
    })),
    goal: {
      goal,
      entry: {
        n: long ? 12345678 : 72,
        label: goal.label,
        value: long ? "12,345,678" : "72%",
      },
      pct: long ? 10 : 0.9,
      hit: long,
      current: long ? 12345678 : 72,
    },
    facets7: facets(0.6),
    facets30: facets(0.7),
  } as unknown as CardData
}
export function habitData(long = false): HabitCardData {
  return {
    showRate: true,
    habit: {
      name: long ? LONG_TITLE : "Read 20 pages",
      current: long ? 1234 : 12,
      best: long ? 4321 : 30,
      rate30: long ? 1 : 0.83,
      last14: dots(14),
      last35: dots(35),
    },
    routine: {
      name: long ? LONG_TITLE : "Morning routine",
      day: "2026-10-24",
      durationSec: long ? 1234567 : 1520,
      done: long ? 1234 : 6,
      total: long ? 1234 : 7,
    },
    board: {
      rate: 0.81,
      prevRate: 0.7,
      top: [1, 2, 3, 4, 5].map((i) => ({
        name: long ? `${LONG_TITLE} ${i}` : `Habit ${i}`,
        streak: long ? 1234567 - i : 20 - i * 3,
      })),
      perfect: long ? 1234567 : 9,
      checkins: long ? 1234567 : 112,
    },
  }
}
export function taskData(long = false): TaskCardData {
  return {
    done: long ? 1234567 : 34,
    prevDone: long ? 1 : 29,
    onTimeRate: long ? 1 : 0.82,
    streak: long ? 1234 : 6,
    bestStreak: long ? 1234 : 11,
    clearDays: long ? 1234 : 4,
    dueDays: long ? 4321 : 7,
    followThrough: long ? 1234.5 : 3.2,
    from: "2026-10-18",
    to: "2026-10-24",
    perDay: days(7).map((day, i) => ({ day, done: long ? 123456 * i : i + 2 })),
    range: "7",
    shown: { streak: true, clear: true, followThrough: true },
  }
}
export function workoutData(long = false): WorkoutCardData {
  return {
    name: long ? LONG_TITLE : "Push day",
    date: "Fri 24 Oct",
    durationSec: long ? 1234567 : 3900,
    volume: long ? 1234567890 : 8450,
    sets: long ? 1234 : 18,
    prs: [1, 2, 3].map((i) => ({
      exercise: long ? "Supercalifragilisticexpialidocious" : `Lift${i}`,
      label: "Heaviest",
      value: long ? 12345.6 : 100 + i,
      volume: false,
    })),
    lines: [1, 2, 3, 4, 5, 6].map((i) => ({
      id: `e${i}`,
      name: long ? `${LONG_TITLE} ${i}` : `Exercise ${i}`,
      weight: long ? 12345.5 : 60 + i * 5,
      reps: long ? 1234 : 8,
    })),
    focus: {
      name: long ? LONG_TITLE : "Bench press",
      pr: "Est. 1-rep max",
      e1rm: long ? 1234567.8 : 112.5,
      gain: long ? 12345 : 2.5,
      series: [90, 95, 100, 104, 108, 112.5],
    },
    week: long ? 1234 : 3,
    weeklyTarget: long ? 1234 : 4,
    streak: long ? 1234 : 6,
    bodyweight: 72.4,
    macros: { kcal: long ? 1234567 : 2150, protein: long ? 12345 : 140 },
  }
}
export function foodData(long = false): FoodCardData {
  return {
    date: "Fri 24 Oct",
    meals: long ? 1234 : 3,
    totals: long
      ? { kcal: 1234567, protein: 12345, carbs: 123456, fat: 9999 }
      : { kcal: 1980, protein: 138, carbs: 210, fat: 64 },
    target: { kcal: 2100, protein: 140, carbs: 230, fat: 70 },
    week: ["on", "off", "on", "on", "none", "on", "on"],
    calorieDays: 5,
    proteinDays: 6,
    logged: 6,
    proteinStreak: long ? 1234 : 4,
    amounts: long,
  }
}
export function journalData(long = false): JournalCardData {
  return {
    current: long ? 1234 : 9,
    best: long ? 1234 : 21,
    entries30: long ? 1234567 : 26,
    days30: long ? 30 : 22,
    grid: dots(35, 4),
  }
}
