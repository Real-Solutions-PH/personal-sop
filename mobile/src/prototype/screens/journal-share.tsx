import { captureStore } from "@domain/capture/store"
import { dayKey } from "@domain/lib/day"
import { ShieldCheck } from "lucide-react-native"
import { useState } from "react"
import { Copy, Line } from "../native-kit"
import { fmt } from "../share-format"
import {
  Body,
  CardFrame,
  type CardLook,
  Change,
  ChartNote,
  cardInk,
  type Dot,
  dayName,
  endedRun,
  Figures,
  Hero,
  LeafCal,
  ShareComposer,
  Sub,
  shiftDay,
  Title,
  Win,
} from "../share-kit"
import { useTheme } from "../theme"
import { Screen } from "../ui"

export type JournalLayout = "streak" | "month"
/** How often the person wrote: counts only. Journal text never reaches a
 * card (IA §8: journal text is never renderable). */
export type JournalCardData = {
  current: number
  best: number
  entries30: number
  days30: number
  /** The last 42 days, oldest first, ending today: on = wrote that day,
   * off = did not, none = before the first entry. */
  grid: Dot[]
  /** The day of the first cell (YYYY-MM-DD). */
  start: string
}
/** ``day`` (YYYY-MM-DD) moved by ``n`` calendar days, at local noon so a
 * DST change never skips or repeats a day. */
export function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + n)
  const two = (v: number) => String(v).padStart(2, "0")
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}
/** Streaks over a set of days written, counted back from ``today``: a
 * streak still counts on a day not yet written. */
export function journalStats(days: Set<string>, today = dayKey()) {
  const key = (n: number) => addDays(today, n)
  let current = 0,
    i = days.has(today) ? 0 : -1
  while (days.has(key(i))) {
    current += 1
    i -= 1
  }
  let best = 0,
    run = 0,
    prev: string | null = null
  for (const d of [...days].sort()) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1
    best = Math.max(best, run)
    prev = d
  }
  return { current, best: Math.max(best, current) }
}
const plural = (n: number, one: string, many = `${one}s`) =>
  `${fmt(n)} ${n === 1 ? one : many}`
export function JournalCard({
  kind,
  width,
  look,
  data: d,
}: {
  kind: JournalLayout
  width: number
  look: CardLook
  data: JournalCardData
}) {
  const c = cardInk(look),
    tall = look.format === "9:16",
    sq = look.format === "1:1",
    ink = c.area("life"),
    record = d.current > 0 && d.current >= d.best,
    rowH = tall ? 25 : sq ? 15 : 22
  if (kind === "streak") {
    const ended = endedRun(d.grid, ["off"])
    return (
      <CardFrame
        width={width}
        look={look}
        accent="life"
        deco="vine"
        date={dayName(shiftDay(d.start, d.grid.length - 1))}
        foot="Counts only. What you wrote stays private."
      >
        <Title>Writing every day</Title>
        <Hero
          value={fmt(d.current)}
          unit={d.current === 1 ? "day" : "days"}
          delta={
            ended ? (
              <Change
                good={false}
              >{`${plural(ended.lost, "day")} lost`}</Change>
            ) : undefined
          }
        />
        {ended ? (
          <Sub bad>
            {`No entry on ${dayName(shiftDay(d.start, ended.at))}; the ${fmt(ended.lost)}-day run ended.`}
          </Sub>
        ) : record ? (
          <Win>Longest streak yet</Win>
        ) : (
          <Sub>{`Best ${plural(d.best, "day")}`}</Sub>
        )}
        <Body end>
          <LeafCal
            cells={d.grid}
            start={d.start}
            weeks={sq ? 3 : 4}
            rowH={rowH}
            color={ink}
          />
          <ChartNote
            left={ended ? `Best ${plural(d.best, "day")}` : undefined}
            right={
              ended
                ? `New count since ${dayName(shiftDay(d.start, ended.at + 1))}`
                : undefined
            }
          />
        </Body>
      </CardFrame>
    )
  }
  const low = d.days30 < 15
  return (
    <CardFrame
      width={width}
      look={look}
      accent="life"
      deco="vine"
      date="Last 30 days"
      foot="Counts only. What you wrote stays private."
    >
      <Hero
        value={fmt(d.days30)}
        unit="of 30 days written"
        small
        delta={
          low ? (
            <Change
              good={false}
            >{`${plural(30 - d.days30, "day")} without an entry`}</Change>
          ) : undefined
        }
      />
      <Body end>
        <LeafCal
          cells={low ? d.grid.map((x) => (x === "off" ? "miss" : x)) : d.grid}
          start={d.start}
          weeks={5}
          rowH={rowH}
          color={ink}
        />
      </Body>
      <Figures
        items={[
          { label: "Entries", value: fmt(d.entries30) },
          { label: "Streak", value: fmt(d.current), unit: "days" },
          { label: "Best", value: fmt(d.best), unit: "days" },
        ]}
      />
    </CardFrame>
  )
}
export function JournalShare() {
  const entries = captureStore.use((s) => s.journal),
    t = useTheme(),
    [layout, setLayout] = useState<JournalLayout>("streak")
  const today = dayKey(),
    written = new Set(entries.map((e) => e.day)),
    stats = journalStats(written, today),
    from = addDays(today, -29),
    first = [...written].sort()[0] ?? today
  const data: JournalCardData = {
    ...stats,
    entries30: entries.filter((e) => e.day >= from && e.day <= today).length,
    days30: [...written].filter((d) => d >= from && d <= today).length,
    grid: Array.from({ length: 42 }, (_, i) => {
      const day = addDays(today, i - 41)
      return written.has(day) ? "on" : day < first ? "none" : "off"
    }),
    start: addDays(today, -41),
  }
  return (
    <Screen title="Share card">
      <ShareComposer
        value={layout}
        onChange={setLayout}
        caption={
          layout === "streak"
            ? `${fmt(data.current)}-day journal streak · Unfurl`
            : `Journaled on ${fmt(data.days30)} of the last 30 days · Unfurl`
        }
        items={(
          [
            { key: "streak", label: "Streak" },
            { key: "month", label: "Month" },
          ] as const
        ).map((item) => ({
          ...item,
          render: (width: number, look: CardLook) => (
            <JournalCard
              kind={item.key}
              width={width}
              look={look}
              data={data}
            />
          ),
        }))}
      >
        <Line style={{ gap: 6, paddingHorizontal: 4 }}>
          <ShieldCheck size={14} color={t.muted} />
          <Copy size={12} muted style={{ flex: 1 }}>
            Journal text, moods and tags never appear on a card.
          </Copy>
        </Line>
      </ShareComposer>
    </Screen>
  )
}
