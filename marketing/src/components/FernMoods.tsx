"use client"

import {
  Ear,
  Leaf,
  MessageCircle,
  Sparkles,
  Sprout,
  Trophy,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { Fern, type FernMood } from "./Fern"

type Mood = {
  id: FernMood
  tab: string
  icon: ReactNode
  when: string
  line: string
}

// Fern's moods, each tied to the moment it appears in the app. The lines are
// written in Fern's voice rules (docs/brand/fern.md): calm, plain, specific,
// kind about misses.
const MOODS: Mood[] = [
  {
    id: "listening",
    tab: "Listening",
    icon: <Ear aria-hidden />,
    when: "While you talk",
    line: "Go on. I'm getting all of it.",
  },
  {
    id: "thinking",
    tab: "Filing",
    icon: <Sprout aria-hidden />,
    when: "While it sorts what you said",
    line: "Lunch to money, bench to today's workout, the draft to tasks.",
  },
  {
    id: "speaking",
    tab: "Answering",
    icon: <MessageCircle aria-hidden />,
    when: "When you ask about your week",
    line: "$86 on food since Monday, $14 more than last week. Wednesday was the biggest day.",
  },
  {
    id: "celebrating",
    tab: "A win",
    icon: <Trophy aria-hidden />,
    when: "When you finish something",
    line: "Today's plan is done. Twelve days in a row.",
  },
  {
    id: "consoling",
    tab: "A miss",
    icon: <Leaf aria-hidden />,
    when: "When a day slips",
    line: "Missed yesterday. Your grace day covered it, so the run of 12 is still going.",
  },
]

export function FernMoods() {
  const [active, setActive] = useState<FernMood>("listening")
  const mood = MOODS.find((m) => m.id === active) ?? MOODS[0]

  return (
    <div className="moods-grid">
      <div className="mood-stage">
        {MOODS.map((m) => (
          <Fern
            key={m.id}
            mood={m.id}
            className={m.id === active ? "on" : ""}
          />
        ))}
      </div>
      <div>
        <span className="eyebrow">
          <Sparkles aria-hidden /> Meet Fern
        </span>
        <h2 className="h2">A companion that notices, and never nags.</h2>
        <p className="lede">
          Fern is the one moving, colourful thing in a calm app. Its face tells
          you what just happened before you read a word.
        </p>
        <div className="mood-tabs" role="tablist" aria-label="Fern's moods">
          {MOODS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              id={`mood-${m.id}`}
              aria-selected={m.id === active}
              aria-controls="mood-panel"
              onClick={() => setActive(m.id)}
            >
              {m.icon}
              {m.tab}
            </button>
          ))}
        </div>
        <div
          className="mood-line"
          id="mood-panel"
          role="tabpanel"
          aria-labelledby={`mood-${mood.id}`}
          aria-live="polite"
        >
          <small>{mood.when}</small>
          {mood.line}
        </div>
      </div>
    </div>
  )
}
