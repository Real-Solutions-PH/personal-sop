import * as A from "@domain/capture/actions"
import { dashStore } from "@domain/dash/store"
import {
  addMessage,
  addTracker,
  type Block,
  companionStore,
  liveAsk,
  type Metric,
  remember,
  thinking,
} from "./store"

const METRICS: { metric: Metric; label: string; words: RegExp }[] = [
  {
    metric: "spendCats",
    label: "Where your money went",
    words: /categor|where.*(money|spend)|breakdown/,
  },
  {
    metric: "netWorth",
    label: "Net worth",
    words: /net ?worth|savings|saved|wealth/,
  },
  {
    metric: "spend",
    label: "Daily spending",
    words: /spend|money|expense|bought|budget|gastos/,
  },
  { metric: "weight", label: "Weight", words: /weigh|kg|body/ },
  {
    metric: "workouts",
    label: "Workouts",
    words: /workout|training|gym|lift|run|exercise/,
  },
  {
    metric: "nutrition",
    label: "Calories",
    words: /calor|protein|food|eat|meal|nutrition|macro/,
  },
  {
    metric: "habits",
    label: "Habit completion",
    words: /habit|routine|streak/,
  },
  { metric: "tasks", label: "Tasks done", words: /task|todo|to-do|productiv/ },
  {
    metric: "life",
    label: "Life score",
    words: /score|life|overall|progress|everything|balance/,
  },
]
export const metricLabel = (m: Metric) =>
  METRICS.find((x) => x.metric === m)?.label ?? m

const findMetric = (q: string) => METRICS.find((m) => m.words.test(q))?.metric
const findDays = (q: string) =>
  /year|12 months/.test(q)
    ? 365
    : /quarter|3 months|90/.test(q)
      ? 90
      : /week|7 days/.test(q)
        ? 7
        : /today/.test(q)
          ? 7
          : 30

export type Route =
  | { kind: "reply"; text: string; blocks?: Block[] }
  | { kind: "capture" }

const first = () => dashStore.get().profile.name.split(/\s+/)[0] || "friend"
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]

/** Decide how to answer. Pure apart from trackers/memories it records. */
export function route(raw: string): Route {
  const q = raw.toLowerCase().trim()
  const name = first()

  if (
    /^(hi|hey|hello|yo|good (morning|afternoon|evening)|kumusta|musta)\b/.test(
      q,
    )
  )
    return {
      kind: "reply",
      text: pick([
        `Hey ${name}! I'm here. Want a quick read on how today's going?`,
        `Hi ${name} 👋 What's on your mind — log something, check progress, or just talk?`,
      ]),
      blocks: [
        {
          t: "chips",
          prompts: [
            "How am I doing?",
            "Plan my day",
            "Show my spending this week",
          ],
        },
      ],
    }

  if (/\b(thanks|thank you|salamat|ty)\b/.test(q))
    return {
      kind: "reply",
      text: pick([
        "Anytime. I've got your back.",
        "Always. Proud of the work you're putting in.",
      ]),
    }

  if (
    /(stress|tired|exhaust|sad|anxious|overwhelm|burn(ed|t) ?out|unmotivat|lazy|down|can't focus|cant focus)/.test(
      q,
    )
  )
    return {
      kind: "reply",
      text: `That sounds heavy, ${name}. Let's make today smaller, not harder. Here's what I'm seeing, gently:`,
      blocks: [
        { t: "coach", mood: "low" },
        {
          t: "chips",
          prompts: ["Just one thing for today", "Log how I feel in my journal"],
        },
      ],
    }

  if (/^remember( that)? /.test(q)) {
    const fact = raw.replace(/^remember( that)?\s*/i, "").trim()
    if (fact) remember(fact)
    return {
      kind: "reply",
      text: `Got it — I'll remember that ${fact.replace(/\.$/, "")}.`,
      blocks: [{ t: "memory" }],
    }
  }
  if (/(what do you know|about me|remember about me|my memories)/.test(q))
    return {
      kind: "reply",
      text: "Here's what I know about you so far — tap one to forget it.",
      blocks: [{ t: "memory" }],
    }

  if (/(track|keep an eye|monitor|watch|alert me|notify me)/.test(q)) {
    const metric = findMetric(q) ?? "life"
    const goal = Number(
      q
        .match(
          /(?:under|below|less than|max|at most|over|above|at least)\s*₱?\s*([\d,.]+)/,
        )?.[1]
        ?.replace(/,/g, ""),
    )
    const direction = /(over|above|at least)/.test(q) ? "above" : "below"
    const id = addTracker({
      metric,
      label: metricLabel(metric),
      goal: Number.isFinite(goal) && goal > 0 ? goal : undefined,
      direction: Number.isFinite(goal) && goal > 0 ? direction : undefined,
    })
    return {
      kind: "reply",
      text: `Tracking ${metricLabel(metric).toLowerCase()} for you. I'll flag it on Today when it drifts.`,
      blocks: [{ t: "tracker", id }],
    }
  }

  if (
    /(chart|graph|plot|visuali[sz]e|trend|over time|\bshow\b|breakdown|compare)/.test(
      q,
    )
  ) {
    const metric = findMetric(q) ?? "life"
    return {
      kind: "reply",
      text: `Here's your ${metricLabel(metric).toLowerCase()} for the last ${findDays(q) === 365 ? "year" : `${findDays(q)} days`}.`,
      blocks: [
        { t: "chart", metric, days: findDays(q) },
        {
          t: "chips",
          prompts: [
            `Track ${metricLabel(metric).toLowerCase()}`,
            "What does this mean?",
          ],
        },
      ],
    }
  }

  if (
    /(plan my day|what should i do|what's next|whats next|priorit|today's plan|todays plan|focus today)/.test(
      q,
    )
  )
    return {
      kind: "reply",
      text: `Here's how I'd run today, ${name}:`,
      blocks: [{ t: "plan" }],
    }

  if (
    /(coach|feedback|evaluate|advice|improve|motivat|honest|what should i focus|tips|be better|level up)/.test(
      q,
    )
  )
    return {
      kind: "reply",
      text: "Honest read, coach hat on:",
      blocks: [{ t: "coach" }],
    }

  if (
    /(insight|pattern|notice|analy[sz]e|how am i doing|how'?s my|how is my|review|recap|summary|this mean)/.test(
      q,
    )
  )
    return {
      kind: "reply",
      text: "Here's what stands out from your records:",
      blocks: [
        { t: "insights" },
        {
          t: "chips",
          prompts: ["Coach me on this", "Show my life score this month"],
        },
      ],
    }

  if (/(who are you|what can you do|help$|^help)/.test(q))
    return {
      kind: "reply",
      text: `I'm ${companionStore.get().name}, your companion inside Personal SOP. I know your habits, tasks, training, food, money and journal — and I remember what you tell me. I can log things for you, spot patterns, chart anything, coach you, and keep an eye on what matters.`,
      blocks: [
        {
          t: "chips",
          prompts: [
            "How am I doing?",
            "Chart my workouts",
            "Track spending under 1500",
            "Coach me",
          ],
        },
      ],
    }

  // Logging and specific questions go through the capture engine.
  return { kind: "capture" }
}

/** Send a message to the companion; replies arrive after a short beat. */
export function ask(text: string, hint?: string) {
  const v = text.trim()
  if (!v) return
  const r = route(v)
  const live = liveAsk()
  if (live) return live(v, hint, r.kind === "capture")
  if (r.kind === "capture") {
    A.sendCapture({ text: v, source: "text", hint })
    return
  }
  addMessage({ role: "me", text: v })
  thinking.setState({ on: true })
  setTimeout(
    () => {
      thinking.setState({ on: false })
      addMessage({ role: "sol", text: r.text, blocks: r.blocks })
    },
    650 + Math.random() * 500,
  )
}
