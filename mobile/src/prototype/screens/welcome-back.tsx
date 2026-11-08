// The way back: someone returns after two or more days with nothing logged.
// Fern opens with a catch-up instead of a scorecard. One sentence or voice
// note fills in the gap (a catch_up capture bounded to the gap's days),
// streaks are paused across the gap (once per 30 days), then three plain
// lines of where they are, Fern's review of the gap, and the daily check-in
// offered once. "Back to today" (``onDone``) is where the paywall goes later.
import { sendCapture } from "@domain/capture/actions"
import { captureStore } from "@domain/capture/store"
import * as D from "@domain/dash/hooks"
import { dashStore, setPush } from "@domain/dash/store"
import { isDue } from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { tasksStore } from "@domain/tasks/store"
import { applyWayBack, type WayBackGap, wayBackLines } from "@domain/way-back"
import { ArrowRight } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { FernSprite } from "../companion/fern-sprite"
import { FernReviewCard } from "../companion/review-card"
import { Copy, Frame, Line, SectionHeading } from "../native-kit"
import { replace } from "../navigation"
import { Switch } from "../switch"
import { Button, Screen } from "../ui"
import { wayBackNow } from "../way-back-open"
import { Exchange, ThreadComposer } from "./capture-thread"

export { maybeOpenWayBack, wayBackNow } from "../way-back-open"

export function WelcomeBack({
  onDone = () => replace("/today"),
}: {
  onDone?: () => void
}) {
  // Frozen on open: what the catch-up logs moves the last active day.
  const [w] = useState(() => wayBackNow())
  const [capId, setCapId] = useState<string | null>(null)
  if (!w.gap || !w.last)
    return (
      <Screen title="Welcome back">
        <Copy>Nothing to catch up on — you’re all logged.</Copy>
        <Button onPress={onDone}>Back to today</Button>
      </Screen>
    )
  const { gap, last } = w
  const catchUp = (text: string) => {
    applyWayBack(gap, last)
    setCapId(
      sendCapture({
        text,
        source: "text",
        hint: "catch_up",
        rangeFrom: gap.from,
      }),
    )
  }
  return (
    <Screen title="Welcome back">
      <Line style={{ gap: 12, alignItems: "flex-start" }}>
        <FernSprite size={56} state="idle" decorative />
        <View style={{ flex: 1, gap: 6 }}>
          <Copy size={22} weight="semibold">
            Welcome back.
          </Copy>
          <Copy muted>
            {`You were away ${gap.days} days. Tell me roughly how they went and I'll fill them in — or skip and start from today.`}
          </Copy>
        </View>
      </Line>
      {capId ? (
        <AfterCatchUp capId={capId} gap={gap} onDone={onDone} />
      ) : (
        <View style={{ gap: 12 }}>
          <ThreadComposer
            hints={false}
            placeholder="e.g. skipped gym, takeaway most nights"
            onText={(text) => text && catchUp(text)}
          />
          <Button
            tone="quiet"
            icon={ArrowRight}
            onPress={() => {
              applyWayBack(gap, last)
              onDone()
            }}
          >
            Start from today
          </Button>
        </View>
      )}
    </Screen>
  )
}

function AfterCatchUp({
  capId,
  gap,
  onDone,
}: {
  capId: string
  gap: WayBackGap
  onDone: () => void
}) {
  const today = dayKey()
  const cap = captureStore.use((s) => s.captures.find((c) => c.id === capId))
  const hs = habitsStore.use((s) => s.habits)
  const logs = habitsStore.use((s) => s.logs)
  const tasks = tasksStore.use((s) => s.tasks)
  const push = dashStore.use((s) => s.push)
  const series = D.useOnTarget(30).series
  const lastOnTarget =
    [...series].reverse().find((d) => d.day < gap.from && d.onTarget)?.day ??
    null
  const lines = wayBackLines({
    habits: hs,
    logs,
    today,
    gap,
    due: {
      habits: hs.filter((h) => isDue(h, today)).length,
      tasks: tasks.filter((t) => t.status === "open" && t.dueDate === today)
        .length,
    },
    lastOnTarget,
  })
  const settled =
    !!cap && cap.status !== "processing" && cap.status !== "queued"
  return (
    <View style={{ gap: 12 }}>
      {cap && <Exchange cap={cap} />}
      {settled && (
        <>
          <SectionHeading>Here's where you are</SectionHeading>
          <Frame style={{ padding: 16, gap: 8 }}>
            {lines.map((l) => (
              <Copy key={l} size={15}>
                {l}
              </Copy>
            ))}
          </Frame>
          <SectionHeading>Fern’s review</SectionHeading>
          <FernReviewCard kind="way_back" fromDay={gap.from} toDay={gap.to} />
        </>
      )}
      <Frame style={{ padding: 12 }}>
        <Line style={{ gap: 12 }}>
          <Copy size={15} style={{ flex: 1 }}>
            Want Fern to ask each evening?
          </Copy>
          <Switch
            label="Want Fern to ask each evening?"
            value={!!push.checkin}
            onChange={(on) =>
              setPush({ checkin: on ? push.evening || "21:00" : "" })
            }
          />
        </Line>
      </Frame>
      <Button onPress={onDone}>Back to today</Button>
    </View>
  )
}
