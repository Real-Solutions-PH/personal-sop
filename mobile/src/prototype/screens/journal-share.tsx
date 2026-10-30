import { captureStore } from "@domain/capture/store"
import { dayKey } from "@domain/lib/day"
import { BookOpen, ShieldCheck, Trophy } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { Copy, Line } from "../native-kit"
import { fmt } from "../share-format"
import {
  CardFrame,
  type CardLook,
  CardRing,
  Chip,
  cardInk,
  type Dot,
  Dots,
  Label,
  Num,
  ShareComposer,
  Stats,
  Words,
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
  /** The last 35 days, oldest first: on = wrote that day. */
  grid: Dot[]
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
    q = width / 100,
    tall = look.format === "9:16",
    sq = look.format === "1:1",
    ink = c.area("life"),
    record = d.current > 0 && d.current >= d.best
  return (
    <CardFrame
      width={width}
      look={look}
      accent="life"
      kicker="Journal"
      date={kind === "month" ? "Last 30 days" : ""}
      foot="Counts only. What you wrote stays private."
    >
      {kind === "streak" ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 3 * q,
          }}
        >
          <CardRing
            value={d.best ? d.current / d.best : 0}
            size={tall ? 56 : 42}
            color={ink}
          >
            <BookOpen size={6.5 * q} color={ink} strokeWidth={2} />
            <Num size={tall ? 17 : 13} align="center">
              {fmt(d.current)}
            </Num>
            <Label align="center">{d.current === 1 ? "day" : "days"}</Label>
          </CardRing>
          <Words size={5.4} weight="semibold" align="center">
            Writing every day
          </Words>
          <Chip icon={record ? Trophy : undefined} tone={ink}>
            {record ? "Longest streak yet" : `Best ${fmt(d.best)} days`}
          </Chip>
          {tall && (
            <View
              style={{ alignSelf: "stretch", gap: 1.4 * q, marginTop: 2 * q }}
            >
              <Label>Last 5 weeks</Label>
              <Dots cells={d.grid} cols={7} color={ink} />
            </View>
          )}
        </View>
      ) : (
        <View style={{ flex: 1, justifyContent: "center", gap: 4 * q }}>
          <Words size={tall ? 9 : 7} weight="semibold">
            {`Wrote on ${fmt(d.days30)} of 30 days`}
          </Words>
          <Dots
            cells={d.grid}
            cols={7}
            color={ink}
            width={tall ? "100%" : sq ? "40%" : "58%"}
          />
          <Stats
            items={[
              { label: "Entries", value: fmt(d.entries30) },
              { label: "Streak", value: fmt(d.current), unit: "d" },
              { label: "Best", value: fmt(d.best), unit: "d" },
            ]}
            size={sq ? 7 : 8}
          />
        </View>
      )}
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
    from = addDays(today, -29)
  const data: JournalCardData = {
    ...stats,
    entries30: entries.filter((e) => e.day >= from && e.day <= today).length,
    days30: [...written].filter((d) => d >= from && d <= today).length,
    grid: Array.from({ length: 35 }, (_, i) =>
      written.has(addDays(today, i - 34)) ? "on" : "off",
    ),
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
