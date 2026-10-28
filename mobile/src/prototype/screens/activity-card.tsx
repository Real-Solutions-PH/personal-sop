// Today's (or yesterday's) Apple Health activity, with the opt-in eat-back:
// the burned kcal reach the day's budget only when the user taps.
import { setBurnAdjustment } from "@domain/fitness/actions"
import { adjustmentOn } from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import { useCallback, useEffect, useState } from "react"
import { View } from "react-native"
import {
  type Activity,
  connectHealth,
  healthAvailable,
  readActivity,
} from "../health"
import { Copy, Frame, Line } from "../native-kit"
import { Button } from "../ui"

/** What the button offers: nothing added yet, more once the burn has grown
 * by 50 kcal since the last tap, else already added. */
export function eatBackOffer(
  burned: number,
  added: number,
): { kind: "add" | "more" | "added"; kcal: number } {
  if (added === 0 && burned > 0) return { kind: "add", kcal: burned }
  if (added > 0 && burned - added >= 50)
    return { kind: "more", kcal: burned - added }
  return { kind: "added", kcal: 0 }
}

const n = (v: number) => v.toLocaleString("en-US")

export function ActivityCard({ day }: { day: string }) {
  const today = dayKey(),
    yesterday = dayOffset(-1),
    shown = day === today || day === yesterday,
    available = shown && healthAvailable(),
    added = fitStore.use((s) => adjustmentOn(s, day)),
    addedYesterday = fitStore.use((s) => adjustmentOn(s, yesterday)),
    [activity, setActivity] = useState<Activity | null | undefined>(),
    [prev, setPrev] = useState<Activity | null>(null)
  const load = useCallback(async () => {
    const [a, p] = await Promise.all([
      readActivity(day),
      day === today ? readActivity(yesterday) : Promise.resolve(null),
    ])
    setActivity(a)
    setPrev(p)
  }, [day, today, yesterday])
  useEffect(() => {
    if (available) void load()
  }, [available, load])
  if (!available || activity === undefined) return null
  if (activity === null)
    return (
      <Frame style={{ padding: 16, gap: 8 }}>
        <Copy weight="semibold">Activity</Copy>
        <Copy size={13} muted>
          See your steps and the calories you burn, and add them to your budget
          when you choose.
        </Copy>
        <Button
          small
          onPress={async () => {
            await connectHealth()
            await load()
          }}
        >
          Connect Apple Health
        </Button>
      </Frame>
    )
  const offer = eatBackOffer(activity.activeKcal, added),
    late =
      prev && eatBackOffer(prev.activeKcal, addedYesterday).kind !== "added"
        ? prev.activeKcal
        : 0
  return (
    <Frame style={{ padding: 16, gap: 12 }}>
      <Line style={{ justifyContent: "space-between" }}>
        <Copy weight="semibold">Activity</Copy>
        <Copy size={12} muted>
          Apple Health
        </Copy>
      </Line>
      <Line style={{ justifyContent: "space-between" }}>
        {[
          [n(activity.steps), "steps"],
          [`${n(activity.activeKcal)}`, "kcal burned"],
          [`${activity.distanceKm} km`, "distance"],
          [
            `${activity.workouts} workout${activity.workouts === 1 ? "" : "s"}`,
            "logged in Health",
          ],
        ].map(([value, label]) => (
          <View key={label}>
            <Copy weight="medium">{value}</Copy>
            <Copy size={11} muted>
              {label}
            </Copy>
          </View>
        ))}
      </Line>
      {offer.kind === "added" ? (
        added > 0 && (
          <Copy size={12} muted>
            Added to budget ✓
          </Copy>
        )
      ) : (
        <Button
          small
          onPress={() => setBurnAdjustment(day, activity.activeKcal)}
        >
          {offer.kind === "add"
            ? `Add ${n(offer.kcal)} kcal to budget`
            : `Add ${n(offer.kcal)} more kcal`}
        </Button>
      )}
      {late > 0 && (
        <Button small onPress={() => setBurnAdjustment(yesterday, late)}>
          {`Add yesterday's ${n(late)} kcal`}
        </Button>
      )}
    </Frame>
  )
}
