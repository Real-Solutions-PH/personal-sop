import { useMemo } from "react"
import type { ShareTemplate } from "./data"
import { useFacets } from "./facets"
import {
  levelFor,
  useAllMetrics,
  useEnabled,
  useGoals,
  useLifeScore,
  useOnTarget,
  useTrophies,
} from "./hooks"
import { dashStore } from "./store"

type Format = "9:16" | "4:5" | "1:1"
export interface Field {
  key: string
  label: string
  on: boolean
  sensitive?: string
}

export const COMMON: Field[] = [
  { key: "mark", label: "App mark", on: true },
  { key: "handle", label: "Handle", on: false, sensitive: "Identifies you" },
  { key: "dates", label: "Date range", on: true },
]

export const TEMPLATES: {
  key: ShareTemplate
  label: string
  formats: Format[]
  fields: Field[]
}[] = [
  {
    key: "life",
    label: "Life Score",
    formats: ["9:16", "4:5", "1:1"],
    fields: [
      { key: "level", label: "Level", on: true },
      { key: "hexagon", label: "Area hexagon", on: true },
      { key: "areas", label: "Area bars (when hexagon is off)", on: false },
      { key: "delta", label: "Change vs last month", on: true },
    ],
  },
  {
    key: "weekly",
    label: "Weekly recap",
    formats: ["9:16", "4:5", "1:1"],
    fields: [
      { key: "hexagon", label: "Area hexagon", on: true },
      { key: "onTarget", label: "On-target rate", on: true },
      { key: "habits", label: "Habit %", on: true },
      { key: "training", label: "Training days", on: true },
      { key: "savings", label: "Savings rate %", on: true },
      { key: "deltas", label: "▲▼ vs last week", on: true },
      { key: "trophy", label: "Top achievement", on: true },
    ],
  },
  {
    key: "monthly",
    label: "Monthly recap",
    formats: ["9:16", "4:5", "1:1"],
    fields: [
      { key: "hexagon", label: "Area hexagon", on: true },
      { key: "hero", label: "4 hero stats", on: true },
      { key: "prs", label: "PR count", on: true },
      { key: "streak", label: "Best streak", on: true },
      { key: "highlight", label: "Month highlight", on: true },
    ],
  },
  {
    key: "streak",
    label: "Streak",
    formats: ["9:16", "4:5", "1:1"],
    fields: [
      { key: "grid", label: "30-day grid", on: true },
      { key: "best", label: "Best streak", on: true },
    ],
  },
  {
    key: "finance",
    label: "Finance %",
    formats: ["9:16", "4:5", "1:1"],
    fields: [
      { key: "savings", label: "Savings rate", on: true },
      { key: "spend", label: "Spending vs last month %", on: true },
      { key: "budgets", label: "Budgets kept", on: true },
      { key: "nospend", label: "No-spend days", on: true },
    ],
  },
  {
    key: "profile",
    label: "Profile card",
    formats: ["9:16"],
    fields: [
      { key: "hexagon", label: "Area hexagon", on: true },
      {
        key: "photo",
        label: "Profile photo",
        on: false,
        sensitive: "Shows your face",
      },
      { key: "records", label: "Personal bests", on: true },
      {
        key: "identity",
        label: "Identity statements",
        on: false,
        sensitive: "Personal text",
      },
    ],
  },
  {
    key: "goal",
    label: "Goal hit",
    formats: ["9:16", "4:5", "1:1"],
    fields: [{ key: "target", label: "Target", on: true }],
  },
]

export function useCardData(goalId: string | null) {
  const p = dashStore.use((s) => s.profile)
  const enabled = useEnabled()
  const l30 = useLifeScore(30)
  const w7 = useOnTarget(7)
  const w30 = useOnTarget(30)
  const m7 = useAllMetrics(7)
  const m30 = useAllMetrics(30)
  const trophies = useTrophies()
  const goals = useGoals()
  const facets7 = useFacets(7)
  const facets30 = useFacets(30)
  return useMemo(() => {
    const get = (list: typeof m7, k: keyof typeof list, key: string) =>
      list[k].find((m) => m.key === key)
    const goal =
      goals.find((g) => g.goal.id === goalId) ??
      goals.find((g) => g.goal.status === "active" && g.hit) ??
      goals.find((g) => g.goal.status === "active")
    const budgets = get(m30, "finance", "budgets")?.value ?? ""
    const bm = budgets.match(/(\d+)\s*\/\s*(\d+)/)
    return {
      name: p.name,
      handle: p.handle,
      photo: p.photo,
      identities: p.identities.map((i) => i.text),
      enabled,
      life: l30,
      level: levelFor(l30.score).name,
      w7,
      w30,
      habits7: get(m7, "habits", "habits.rate"),
      training7: get(m7, "fitness", "sessions"),
      savings7: get(m7, "finance", "savings-rate"),
      habits30: get(m30, "habits", "habits.rate"),
      training30: get(m30, "fitness", "sessions"),
      savings30: get(m30, "finance", "savings-rate"),
      prs30: get(m30, "fitness", "prs"),
      spend30: get(m30, "finance", "spend-vs"),
      nospend30: get(m30, "finance", "no-spend"),
      budgetsPct: bm
        ? Math.round((Number(bm[1]) / Math.max(1, Number(bm[2]))) * 100)
        : null,
      trophy: trophies[0],
      trophies: trophies.slice(0, 3),
      goal,
      facets7,
      facets30,
    }
  }, [
    p,
    enabled,
    l30,
    w7,
    w30,
    m7,
    m30,
    trophies,
    goals,
    goalId,
    facets7,
    facets30,
  ])
}
export type CardData = ReturnType<typeof useCardData>
