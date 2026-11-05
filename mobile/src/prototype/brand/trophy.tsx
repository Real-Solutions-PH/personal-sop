// Trophies in the brand's line (card library, Me · Trophy case): an earned
// trophy is a card with its wreath badge, a locked one a dashed outline with
// a padlock and the hand-drawn progress line, and the counts a plain strip.
// Shared by the Trophy case, Stats' personal bests and social profiles.
import type { TrophyType } from "@domain/dash/hooks"
import { Lock } from "lucide-react-native"
import { Fragment, type ReactNode } from "react"
import { View } from "react-native"
import Animated from "react-native-reanimated"
import { usePopIn } from "../motion"
import { Bar, border, Copy, Line } from "../native-kit"
import { type Accent, useTheme } from "../theme"
import { TrophyBadge } from "./badge"
import { CornerMotif } from "./corner"

/** Each trophy type's emblem colour, on data only (the badge). */
export const TROPHY_COLOR: Record<TrophyType, Accent> = {
  pr: "fit",
  streak: "life",
  best: "hab",
  goal: "fin",
  first: "tsk",
}

/** "New" is information, so it is drawn in blue, not as an alarm. */
export function NewChip() {
  const t = useTheme()
  return (
    <View
      style={{
        alignSelf: "flex-start",
        borderRadius: 99,
        paddingHorizontal: 8,
        paddingVertical: 2,
        backgroundColor: border(t.tsk, 0.14),
      }}
    >
      <Copy size={12} weight="medium" style={{ color: t.tsk }}>
        New
      </Copy>
    </View>
  )
}

/** An earned trophy: wreath badge, the figure, what it is and when. A new
 * one says so and its badge lands with a small spring. */
export function TrophyCard({
  type,
  value,
  title,
  date,
  fresh = false,
  compact = false,
}: {
  type: TrophyType
  value: string
  title: string
  date?: string
  fresh?: boolean
  /** Stats' horizontal row: a smaller badge and a one-line title. */
  compact?: boolean
}) {
  const t = useTheme(),
    popIn = usePopIn(),
    size = compact ? 40 : 52
  return (
    <View
      testID={`trophy-card-${type}`}
      style={{
        padding: 12,
        gap: 2,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border(t.line, 0.6),
        backgroundColor: t.card,
        overflow: "hidden",
      }}
    >
      <CornerMotif kind="vine" seed={title.length + 3} size={96} />
      <Line style={{ justifyContent: "space-between", alignItems: "center" }}>
        <Animated.View entering={fresh ? popIn() : undefined}>
          <TrophyBadge type={type} size={size} color={t[TROPHY_COLOR[type]]} />
        </Animated.View>
        {fresh && <NewChip />}
      </Line>
      <Copy
        size={compact ? 20 : 24}
        weight="semibold"
        lines={1}
        style={{ fontVariant: ["tabular-nums"], marginTop: 2 }}
      >
        {value}
      </Copy>
      <Copy size={13} weight="medium" lines={compact ? 1 : 2}>
        {title}
      </Copy>
      {date ? (
        <Copy size={12} muted>
          {date}
        </Copy>
      ) : null}
    </View>
  )
}

/** A trophy not yet earned: a dashed outline (nothing filled in yet), the
 * padlock, what earns it, and how far along it is on the hand-drawn line. */
export function LockedTrophy({
  title,
  requirement,
  pct,
  progress,
}: {
  title: string
  requirement: string
  pct: number
  progress: string
}) {
  const t = useTheme()
  return (
    <View
      testID="trophy-locked"
      style={{
        padding: 12,
        gap: 4,
        borderRadius: 16,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: t.input,
      }}
    >
      <Lock size={16} color={t.muted} />
      <Copy size={13} weight="semibold" lines={2} style={{ marginTop: 2 }}>
        {title}
      </Copy>
      <Copy size={12} muted lines={3}>
        {requirement}
      </Copy>
      <View style={{ marginTop: 6 }}>
        <Bar value={pct} color={t.primary} />
      </View>
      <Copy size={12} weight="medium" style={{ fontVariant: ["tabular-nums"] }}>
        {progress}
      </Copy>
    </View>
  )
}

/** The counts per kind as one strip, figures over labels with hairline
 * dividers (no tiles); three to a row so every label stays whole. */
export function TrophyCounts({
  items,
}: {
  items: { key: string; earned: number; total: number; label: string }[]
}) {
  const t = useTheme(),
    rows: (typeof items)[] = []
  for (let i = 0; i < items.length; i += 3) rows.push(items.slice(i, i + 3))
  return (
    <View style={{ gap: 12 }}>
      {rows.map((row) => (
        <Line key={row[0].key} style={{ gap: 0, alignItems: "stretch" }}>
          {[0, 1, 2].map((k) => {
            const x = row[k]
            return (
              <Fragment key={x?.key ?? k}>
                <View
                  style={{
                    flex: 1,
                    paddingLeft: k ? 12 : 0,
                    borderLeftWidth: k && x ? 1 : 0,
                    borderColor: t.line,
                  }}
                >
                  {x && (
                    <>
                      <Copy
                        size={20}
                        weight="semibold"
                        style={{ fontVariant: ["tabular-nums"] }}
                      >
                        {x.earned}
                        <Copy size={13} muted>
                          /{x.total}
                        </Copy>
                      </Copy>
                      <Copy size={12} muted lines={1}>
                        {x.label}
                      </Copy>
                    </>
                  )}
                </View>
              </Fragment>
            )
          })}
        </Line>
      ))}
    </View>
  )
}

/** Two cards to a row with a gap, for the Trophy case grid. */
export function TrophyGrid({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {children}
    </View>
  )
}
