import { fmtHm } from "@domain/focus/logic"
import { useFocusState } from "@domain/focus/store"
import { dayKey } from "@domain/lib/day"
import { addDays } from "@domain/tasks/logic"
import { useLocalSearchParams } from "expo-router"
import { ShieldCheck } from "lucide-react-native"
import { type ReactNode, useState } from "react"
import { Copy, Frame, Line, SectionHeading, Segmented } from "../native-kit"
import { type FocusDay, focusDay } from "../productivity-share-calc"
import { fmt } from "../share-format"
import {
  Body,
  CardFrame,
  type CardLook,
  Change,
  ChartNote,
  cardInk,
  dayName,
  Hero,
  Optional,
  ShareComposer,
  Sub,
  Title,
  Win,
  XBars,
} from "../share-kit"
import { DayLine, PartLine } from "../share-viz"
import { useTheme } from "../theme"
import { Screen, Toggle } from "../ui"

export type FocusLayout = "pomodoro" | "stopwatch"
/** What a Focus card shows: one day of one timer mode, already counted. */
export type FocusCardData = { pomodoro: FocusDay; stopwatch: FocusDay }

const plural = (n: number, one: string, many = `${one}s`) =>
  `${fmt(n)} ${n === 1 ? one : many}`

/** The daily goal is for the whole day (both timer modes): met is a win
 * line; short is a cost beside the hero, which the fit rule never drops.
 * Nothing when the goal is off or the day had no focus at all. */
const goalMet = (d: FocusDay) =>
  d.goalSec > 0 && d.focusSec > 0 && d.dayFocusSec >= d.goalSec
function goalShort(d: FocusDay) {
  if (d.goalSec <= 0 || d.focusSec <= 0 || d.dayFocusSec >= d.goalSec)
    return undefined
  return (
    <Change good={false}>
      {`${fmtHm(d.goalSec - d.dayFocusSec)} short of the day's goal`}
    </Change>
  )
}
function GoalWin({ d }: { d: FocusDay }) {
  return goalMet(d) ? (
    <Win>{`Daily goal of ${fmtHm(d.goalSec)} met`}</Win>
  ) : null
}

export function FocusCard({
  kind,
  width,
  look,
  data,
}: {
  kind: FocusLayout
  width: number
  look: CardLook
  data: FocusCardData
}) {
  const c = cardInk(look),
    tall = look.format === "9:16",
    sq = look.format === "1:1",
    ink = c.area("foc"),
    d = data[kind]
  let body: ReactNode
  if (kind === "pomodoro") {
    body = (
      <>
        <Title>Pomodoro day</Title>
        <Hero
          value={fmt(d.sets)}
          unit={d.sets === 1 ? "Pomodoro" : "Pomodoros"}
          delta={goalShort(d)}
        />
        {d.sessions === 0 ? (
          <Sub bad>No Pomodoro session on this day.</Sub>
        ) : (
          <GoalWin d={d} />
        )}
        <Body end>
          <DayLine
            spans={d.spans}
            color={ink}
            height={tall ? 64 : sq ? 46 : 56}
            label="Focus, breaks and pauses through the day"
          />
          <Optional>
            <PartLine
              label={`${fmtHm(d.focusSec)} focus, ${fmtHm(d.breakSec)} break, ${fmtHm(d.pauseSec)} paused`}
              parts={[
                {
                  key: "focus",
                  label: "Focus",
                  value: d.focusSec,
                  shown: fmtHm(d.focusSec),
                  color: ink,
                },
                {
                  key: "break",
                  label: "Breaks",
                  value: d.breakSec,
                  shown: fmtHm(d.breakSec),
                  color: c.mark,
                  open: true,
                },
                ...(d.pauseSec >= 60
                  ? [
                      {
                        key: "pause",
                        label: "Paused",
                        value: d.pauseSec,
                        shown: fmtHm(d.pauseSec),
                        color: c.bad,
                        open: true,
                      },
                    ]
                  : []),
              ]}
            />
          </Optional>
          <ChartNote
            left={plural(d.sessions, "session")}
            right={
              d.focusSec + d.breakSec > 0
                ? `${fmt(Math.round((d.focusSec / (d.focusSec + d.breakSec + d.pauseSec)) * 100))}% of the time focused`
                : undefined
            }
          />
        </Body>
      </>
    )
  } else {
    body = (
      <>
        <Title>Stopwatch focus</Title>
        <Hero value={fmtHm(d.focusSec)} unit="focused" delta={goalShort(d)} />
        {d.sessions === 0 ? (
          <Sub bad>No stopwatch session on this day.</Sub>
        ) : (
          <GoalWin d={d} />
        )}
        <Body>
          <DayLine
            spans={d.spans}
            color={ink}
            height={tall ? 64 : sq ? 46 : 56}
            label="Stopwatch sessions through the day"
            leaves={false}
          />
          {d.sessions > 0 && (
            <ChartNote
              left={plural(d.sessions, "session")}
              right={`Longest ${fmtHm(d.longestSec)}`}
            />
          )}
          <XBars
            color={ink}
            rows={d.items.map((x, i) => ({
              key: `${x.name}-${i}`,
              name: x.name || "Nothing picked",
              value: x.sec,
              label: fmtHm(x.sec),
            }))}
          />
        </Body>
      </>
    )
  }
  return (
    <CardFrame
      width={width}
      look={look}
      accent="foc"
      date={dayName(d.day)}
      foot="Focus time only"
    >
      {body}
    </CardFrame>
  )
}

export function FocusShare() {
  const p = useLocalSearchParams<{ day?: string; t?: FocusLayout }>(),
    s = useFocusState(),
    t = useTheme(),
    today = dayKey(),
    yesterday = addDays(today, -1),
    [day, setDay] = useState(
      p.day && /^\d{4}-\d{2}-\d{2}$/.test(p.day) && p.day <= today
        ? p.day
        : today,
    ),
    [layout, setLayout] = useState<FocusLayout>(
      p.t === "stopwatch" ? "stopwatch" : "pomodoro",
    ),
    [names, setNames] = useState(true)
  const stopwatch = focusDay(s, day, "stopwatch"),
    data: FocusCardData = {
      pomodoro: focusDay(s, day, "pomodoro"),
      stopwatch: names
        ? stopwatch
        : {
            ...stopwatch,
            items: stopwatch.items.map((x, i) => ({
              ...x,
              name: `Item ${i + 1}`,
            })),
          },
    }
  const caption =
    layout === "pomodoro"
      ? `${plural(data.pomodoro.sets, "Pomodoro")}, ${fmtHm(data.pomodoro.focusSec)} focused · Unfurl`
      : `${fmtHm(data.stopwatch.focusSec)} of stopwatch focus · Unfurl`
  const days = [today, yesterday].includes(day)
    ? [today, yesterday]
    : [day, today]
  return (
    <Screen title="Share card">
      <ShareComposer
        value={layout}
        onChange={setLayout}
        caption={caption}
        items={(
          [
            { key: "pomodoro", label: "Pomodoro day" },
            { key: "stopwatch", label: "Stopwatch" },
          ] as const
        ).map((item) => ({
          ...item,
          render: (width: number, look: CardLook) => (
            <FocusCard kind={item.key} width={width} look={look} data={data} />
          ),
        }))}
      >
        <SectionHeading>Day</SectionHeading>
        <Segmented
          value={day}
          onChange={setDay}
          options={days.map((d) => ({
            value: d,
            label:
              d === today
                ? "Today"
                : d === yesterday
                  ? "Yesterday"
                  : dayName(d),
          }))}
        />
        {layout === "stopwatch" && (
          <Frame style={{ padding: 16 }}>
            <Toggle
              label="Show what you worked on"
              value={names}
              onChange={setNames}
            />
          </Frame>
        )}
        <Line style={{ marginTop: 16, gap: 6 }}>
          <ShieldCheck size={14} color={t.muted} />
          <Copy size={12} muted style={{ flex: 1 }}>
            {layout === "stopwatch" && names
              ? "Task and habit names show on the Stopwatch card. Turn them off above."
              : "Only focus time reaches this card."}
          </Copy>
        </Line>
      </ShareComposer>
    </Screen>
  )
}
