import type { ModuleKey } from "../contract"
import type { Goal, MetricRef } from "./data"

/** A goal a person can take in one tap: a metric the app already computes
 * (the server's statistics and the device's own, under the same key), a
 * sensible target and a period. Each ``metric`` is a metric-book reference
 * (``<module>:<key>``, or ``life`` / ``onTarget``) whose value reads as a
 * plain number, so progress is always computable. Time values ("3h 20m")
 * and fractions ("4/5") are not goal metrics: their value is not a number. */
export interface GoalIdea {
  metric: MetricRef
  label: string
  target: number
  unit: "" | "%"
  comparator: Goal["comparator"]
  period: Goal["period"]
  /** What the number means, in a few words. */
  hint: string
  area: ModuleKey | "life"
}

export const GOAL_IDEAS: readonly GoalIdea[] = [
  // Life
  {
    metric: "life",
    label: "Life Score",
    target: 75,
    unit: "",
    comparator: "gte",
    period: "month",
    hint: "your score across every part",
    area: "life",
  },
  {
    metric: "onTarget",
    label: "On-target rate",
    target: 80,
    unit: "%",
    comparator: "gte",
    period: "week",
    hint: "of days you hit your plan",
    area: "life",
  },
  // Habits
  {
    metric: "habits:habits.rate",
    label: "Habit completion",
    target: 85,
    unit: "%",
    comparator: "gte",
    period: "week",
    hint: "of scheduled habits done",
    area: "habits",
  },
  {
    metric: "habits:habits.perfect",
    label: "Perfect days",
    target: 4,
    unit: "",
    comparator: "gte",
    period: "week",
    hint: "days with every habit done",
    area: "habits",
  },
  {
    metric: "habits:habits.skip",
    label: "Skip rate",
    target: 10,
    unit: "%",
    comparator: "lte",
    period: "month",
    hint: "of habits skipped, at most",
    area: "habits",
  },
  {
    metric: "habits:habits.streak",
    label: "Top streak",
    target: 21,
    unit: "",
    comparator: "gte",
    period: "month",
    hint: "days in a row on your best habit",
    area: "habits",
  },
  // Tasks
  {
    metric: "tasks:tasks.onTime",
    label: "On-time rate",
    target: 85,
    unit: "%",
    comparator: "gte",
    period: "week",
    hint: "tasks done by their due date",
    area: "tasks",
  },
  {
    metric: "tasks:tasks.done",
    label: "Tasks done",
    target: 20,
    unit: "",
    comparator: "gte",
    period: "week",
    hint: "tasks finished",
    area: "tasks",
  },
  {
    metric: "tasks:tasks.overdue",
    label: "Overdue now",
    target: 2,
    unit: "",
    comparator: "lte",
    period: "week",
    hint: "tasks past due, at most",
    area: "tasks",
  },
  {
    metric: "tasks:tasks.streak",
    label: "Done streak",
    target: 7,
    unit: "",
    comparator: "gte",
    period: "week",
    hint: "days in a row with a task done",
    area: "tasks",
  },
  // Focus
  {
    metric: "focus:goalDays",
    label: "Days on focus goal",
    target: 5,
    unit: "",
    comparator: "gte",
    period: "week",
    hint: "days you reach your focus goal",
    area: "focus",
  },
  {
    metric: "focus:sessions",
    label: "Focus sessions",
    target: 10,
    unit: "",
    comparator: "gte",
    period: "week",
    hint: "focus sessions finished",
    area: "focus",
  },
  {
    metric: "focus:pomodoros",
    label: "Pomodoros",
    target: 60,
    unit: "",
    comparator: "gte",
    period: "month",
    hint: "pomodoro rounds finished",
    area: "focus",
  },
  // Training
  {
    metric: "fitness:sessions",
    label: "Workouts",
    target: 4,
    unit: "",
    comparator: "gte",
    period: "week",
    hint: "sessions per week",
    area: "fitness",
  },
  {
    metric: "fitness:prs",
    label: "Personal records",
    target: 3,
    unit: "",
    comparator: "gte",
    period: "month",
    hint: "new bests in a month",
    area: "fitness",
  },
  {
    metric: "fitness:overload",
    label: "Progress rate",
    target: 50,
    unit: "%",
    comparator: "gte",
    period: "month",
    hint: "of lifts that moved up",
    area: "fitness",
  },
  // Food
  {
    metric: "nutrition:protein",
    label: "Protein hit rate",
    target: 75,
    unit: "%",
    comparator: "gte",
    period: "week",
    hint: "of logged days at your protein target",
    area: "nutrition",
  },
  {
    metric: "nutrition:calories",
    label: "Calories on target",
    target: 80,
    unit: "%",
    comparator: "gte",
    period: "week",
    hint: "of logged days within your calories",
    area: "nutrition",
  },
  {
    metric: "nutrition:logged",
    label: "Days logged",
    target: 6,
    unit: "",
    comparator: "gte",
    period: "week",
    hint: "days with your meals logged",
    area: "nutrition",
  },
  // Money (percentages and counts only: no amounts)
  {
    metric: "finance:savings-rate",
    label: "Savings rate",
    target: 25,
    unit: "%",
    comparator: "gte",
    period: "month",
    hint: "of income kept",
    area: "finance",
  },
  {
    metric: "finance:no-spend",
    label: "No-spend days",
    target: 8,
    unit: "",
    comparator: "gte",
    period: "month",
    hint: "days without spending",
    area: "finance",
  },
  {
    metric: "finance:spend-vs",
    label: "Spending vs last period",
    target: 0,
    unit: "%",
    comparator: "lte",
    period: "month",
    hint: "no more than last month",
    area: "finance",
  },
  {
    metric: "finance:runway",
    label: "Months you could cover",
    target: 6,
    unit: "",
    comparator: "gte",
    period: "month",
    hint: "months your savings would last",
    area: "finance",
  },
]

/** The ideas worth offering: parts the person has on, and not already an
 * active goal on the same metric and period. */
export function goalIdeas(
  goals: readonly Goal[],
  enabled: Record<ModuleKey, boolean>,
): GoalIdea[] {
  const taken = new Set(
    goals
      .filter((g) => g.status === "active")
      .map((g) => `${g.metric}|${g.period}`),
  )
  return GOAL_IDEAS.filter(
    (i) =>
      (i.area === "life" || enabled[i.area]) &&
      !taken.has(`${i.metric}|${i.period}`),
  )
}

/** What ``saveGoal`` takes to make an idea a goal. */
export const ideaGoal = (i: GoalIdea) => ({
  metric: i.metric,
  label: i.label,
  target: i.target,
  unit: i.unit,
  comparator: i.comparator,
  period: i.period,
  via: "manual" as const,
})
