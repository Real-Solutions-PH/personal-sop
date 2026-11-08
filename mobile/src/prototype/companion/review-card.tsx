// Fern's review card: wins first, then at most two gaps, each saying how
// to improve it with one tap to make the suggestion a habit or a task. A
// made item confirms inline and links to itself (toasts are kept for habit
// and task ticks); a dismissed one is not offered again for 30 days.
import {
  daysForWeek,
  dismissedTitles,
  dismissSuggestion,
  type ReviewGap,
  type ReviewKind,
  type ReviewOut,
  reviewHabits,
  reviewRules,
} from "@domain/companion/review-rules"
import * as D from "@domain/dash/hooks"
import { createHabit } from "@domain/habits/actions"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { createTask } from "@domain/tasks/actions"
import { tasksStore } from "@domain/tasks/store"
import { useQueryClient } from "@tanstack/react-query"
import {
  Check,
  CircleCheck,
  CloudOff,
  ListPlus,
  Repeat,
  RotateCcw,
  X,
} from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { liveMode } from "@/live/config"
import { reviewKey, useFernReview } from "@/live/review"
import { Copy, Frame, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Button } from "../ui"
import { FernSprite } from "./fern-sprite"

export type ReviewState =
  | { state: "loading" }
  | { state: "error"; retrying: boolean }
  | { state: "ready"; review: ReviewOut }

/** The review for ``[fromDay, toDay]``: the server's in live mode, the
 * rules review of this phone's data in prototype mode. */
export function FernReviewCard({
  kind,
  fromDay,
  toDay,
}: {
  kind: ReviewKind
  fromDay: string
  toDay: string
}) {
  const client = useQueryClient()
  const [dismissed] = useState(() => dismissedTitles())
  const q = useFernReview({ kind, fromDay, toDay, dismissed }, liveMode)
  const local = useLocalReview(kind, fromDay, toDay, dismissed)
  const state: ReviewState = !liveMode
    ? { state: "ready", review: local }
    : q.data
      ? { state: "ready", review: q.data }
      : q.isError
        ? { state: "error", retrying: q.isFetching }
        : { state: "loading" }
  return (
    <FernReviewView
      state={state}
      onRetry={() =>
        client.refetchQueries({ queryKey: reviewKey(kind, fromDay, toDay) })
      }
    />
  )
}

function useLocalReview(
  kind: ReviewKind,
  fromDay: string,
  toDay: string,
  dismissed: string[],
): ReviewOut {
  const s = habitsStore.use((x) => x)
  const events = tasksStore.use((x) => x.events)
  const series = D.useOnTarget(31).series
  const today = dayKey()
  const habits = reviewHabits(s.habits, s.logs, fromDay, toDay, today)
  const tasksDone = events.filter((e) => {
    const d = dayKey(new Date(e.at))
    return e.type === "completed" && d >= fromDay && d <= toDay
  }).length
  return reviewRules({
    kind,
    days: series.filter((d) => d.day >= fromDay && d.day <= toDay),
    habits,
    tasksDone,
    dismissed,
  })
}

export function FernReviewView({
  state,
  onRetry,
}: {
  state: ReviewState
  onRetry: () => void
}) {
  const t = useTheme()
  const [hidden, setHidden] = useState<string[]>([])
  if (state.state === "loading")
    return (
      <Frame
        style={{ padding: 16, flexDirection: "row", gap: 12 }}
        testID="fern-review-loading"
      >
        <FernSprite size={40} state="thinking" decorative />
        <View
          style={{ flex: 1, gap: 10, paddingTop: 4 }}
          accessible
          accessibilityLabel="Fern is putting your review together"
        >
          {["88%", "70%", "92%", "64%"].map((w) => (
            <View
              key={w}
              style={{
                height: 12,
                width: w as `${number}%`,
                borderRadius: 4,
                backgroundColor: t.soft,
              }}
            />
          ))}
        </View>
      </Frame>
    )
  if (state.state === "error")
    return (
      <Frame style={{ padding: 16, gap: 8 }} testID="fern-review-error">
        <Line style={{ gap: 10 }}>
          <CloudOff size={18} color={t.bad} />
          <Copy weight="medium" style={{ flex: 1 }}>
            Fern couldn’t put your review together
          </Copy>
        </Line>
        <Copy size={14} muted>
          The server didn’t answer. Nothing you logged is affected.
        </Copy>
        <Button
          small
          tone="quiet"
          icon={RotateCcw}
          disabled={state.retrying}
          onPress={onRetry}
        >
          {state.retrying ? "Trying again…" : "Try again"}
        </Button>
      </Frame>
    )
  const { review } = state
  const gaps = review.gaps.filter((g) => !hidden.includes(g.suggestion.title))
  return (
    <Frame style={{ padding: 16, gap: 14 }} testID="fern-review">
      <Line style={{ gap: 12, alignItems: "flex-start" }}>
        <FernSprite size={40} state="celebrating" decorative />
        <View style={{ flex: 1, gap: 8 }}>
          {review.wins.map((w) => (
            <Line key={w.text} style={{ gap: 8, alignItems: "flex-start" }}>
              <View style={{ marginTop: 2 }}>
                <CircleCheck size={16} color={t.good} />
              </View>
              <Copy size={14} style={{ flex: 1 }}>
                {w.text}
              </Copy>
            </Line>
          ))}
        </View>
      </Line>
      {gaps.map((g) => (
        <GapRow
          key={g.suggestion.title}
          gap={g}
          onDismiss={() => {
            dismissSuggestion(g.suggestion.title)
            setHidden((h) => [...h, g.suggestion.title])
          }}
        />
      ))}
      {review.source === "rules" && (
        <Copy size={12} muted>
          {liveMode
            ? "AI is off, so this is a quick read of your data."
            : "A quick read of your data. Sign in for Fern’s full review."}
        </Copy>
      )}
    </Frame>
  )
}

function GapRow({ gap, onDismiss }: { gap: ReviewGap; onDismiss: () => void }) {
  const t = useTheme()
  const [made, setMade] = useState<string | null>(null)
  const s = gap.suggestion
  const habit = s.kind === "habit"
  const make = () => {
    if (habit) {
      const h = createHabit({
        name: s.title,
        schedule: [{ days: daysForWeek(s.days_per_week) }],
      })
      setMade(`/habits/${h.id}`)
    } else {
      const task = createTask({ title: s.title })
      setMade(`/tasks/task/${task.id}`)
    }
  }
  return (
    <View
      style={{
        gap: 8,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: t.line,
      }}
    >
      <Line style={{ gap: 8, alignItems: "flex-start" }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Copy size={14} weight="medium">
            {gap.text}
          </Copy>
          <Copy size={14} muted>
            {gap.how}
          </Copy>
        </View>
        {!made && (
          <Tap
            onPress={onDismiss}
            label="Dismiss suggestion"
            style={{ padding: 4 }}
          >
            <X size={16} color={t.muted} />
          </Tap>
        )}
      </Line>
      <View style={{ gap: 2 }}>
        <Copy size={14} weight="semibold">
          {s.title}
        </Copy>
        {habit && !!s.days_per_week && (
          <Copy size={12} muted>
            {s.days_per_week} days a week
          </Copy>
        )}
      </View>
      {made ? (
        <Tap onPress={() => go(made)} label="Open it">
          <Line style={{ gap: 6 }}>
            <Check size={16} color={t.good} />
            <Copy size={14} weight="medium" style={{ color: t.good }}>
              {habit ? "Added to habits" : "Added to tasks"}
            </Copy>
          </Line>
        </Tap>
      ) : (
        <Button small icon={habit ? Repeat : ListPlus} onPress={make}>
          {habit ? "Make it a habit" : "Make it a task"}
        </Button>
      )}
    </View>
  )
}
