import { addDaysKey, reviewCardShown, weekStartKey } from "@domain/dash/data"
import { dashStore, markReviewOpened } from "@domain/dash/store"
import { Check, ChevronRight, Sparkles, Trophy, X } from "lucide-react-native"
import { View } from "react-native"
import { border, Copy, Line, Tap } from "./native-kit"
import { go } from "./navigation"
import { useReviewDigest } from "./screens/dash-reviews"
import { useTheme } from "./theme"

const day = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
  })

/**
 * Last week's review, pinned to the top of Today: the verdict, wins and
 * misses, and the AI's read in a few lines. The whole card opens the review.
 * It stays until the review is opened (here or anywhere else) and leaves a
 * day after; ``openedAt`` syncs, so every device agrees.
 */
export function WeeklyReviewCard({ now }: { now: number }) {
  const id = `w-${weekStartKey(1)}`,
    r = dashStore.use((s) => s.reviews[id]),
    since = dashStore.use((s) => s.profile.since)
  const to = addDaysKey(weekStartKey(1), 6)
  // Nothing to review for a week that ended before the account began.
  if (/^\d{4}-\d{2}-\d{2}$/.test(since ?? "") && since > to) return null
  if (!reviewCardShown(r, now)) return null
  return <ReviewCardBody id={id} opened={Boolean(r?.openedAt ?? r?.doneAt)} />
}

function ReviewCardBody({ id, opened }: { id: string; opened: boolean }) {
  const t = useTheme(),
    d = useReviewDigest(id),
    threshold = dashStore.use((s) => s.targetThreshold)
  if (!d) return null
  const { p, cur, targetDelta, wins, misses, best, summary } = d
  const won = wins.length + (best ? 1 : 0)
  // The verdict's colour: the change on the week before when there is one,
  // else whether the week cleared the on-target bar.
  const verdict =
    targetDelta !== null && targetDelta !== 0
      ? targetDelta > 0
        ? t.good
        : t.bad
      : cur.rate !== null && cur.rate >= threshold
        ? t.good
        : t.muted
  const rate = cur.rate === null ? "—" : `${Math.round(cur.rate * 100)}%`
  const label = [
    `Weekly review, ${day(p.from)} to ${day(p.to)}`,
    `${rate} on target`,
    targetDelta
      ? `${targetDelta > 0 ? "up" : "down"} ${Math.abs(targetDelta)} points`
      : "",
    won ? `${won} ${won === 1 ? "win" : "wins"}` : "",
    misses.length ? `${misses.length} missed` : "",
    summary,
  ]
    .filter(Boolean)
    .join(". ")
  return (
    <Tap
      label={label}
      hint="Opens the review"
      onPress={() => {
        markReviewOpened(id)
        go(`/stats/reviews/${id}`)
      }}
      style={{
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border(verdict === t.muted ? t.primary : verdict, 0.35),
        backgroundColor: t.card,
        gap: 10,
      }}
    >
      <Line style={{ gap: 6 }}>
        <Sparkles size={14} color={t.primary} />
        <Copy size={12} weight="medium" style={{ color: t.primary, flex: 1 }}>
          Weekly review · {day(p.from)} – {day(p.to)}
        </Copy>
        {opened && <Check size={14} color={t.muted} />}
        <ChevronRight size={16} color={t.muted} />
      </Line>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          columnGap: 8,
          rowGap: 6,
        }}
      >
        <Copy size={28} weight="display" style={{ color: t.text }}>
          {rate}
        </Copy>
        <Copy size={14} muted>
          on target
        </Copy>
        {!!targetDelta && (
          <View
            style={{
              borderRadius: 10,
              paddingHorizontal: 8,
              paddingVertical: 2,
              backgroundColor: border(verdict, 0.15),
            }}
          >
            <Copy size={12} weight="semibold" style={{ color: verdict }}>
              {targetDelta > 0 ? "▲" : "▼"} {Math.abs(targetDelta)} pt
            </Copy>
          </View>
        )}
        <View style={{ flex: 1 }} />
        {won > 0 && (
          <Line style={{ gap: 4 }}>
            <Trophy size={14} color={t.good} />
            <Copy size={12} weight="medium" style={{ color: t.good }}>
              {won} {won === 1 ? "win" : "wins"}
            </Copy>
          </Line>
        )}
        {misses.length > 0 && (
          <Line style={{ gap: 4 }}>
            <X size={14} color={t.bad} />
            <Copy size={12} weight="medium" style={{ color: t.bad }}>
              {misses.length} missed
            </Copy>
          </Line>
        )}
      </View>
      <Copy size={14} muted lines={3}>
        {summary}
      </Copy>
    </Tap>
  )
}
