// Connecting Apple Health: whether its sheet was answered, the Connect card
// the activity and steps cards show until then, and Fitness settings' row,
// with the switch that saves finished workouts to Health.
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useSyncExternalStore,
} from "react"
import { AppState, Linking, type ViewStyle } from "react-native"
import { toast } from "sonner-native"
import {
  canOfferWorkoutWrite,
  canWriteWorkouts,
  connectHealth,
  connectWorkoutWrite,
  healthAsked,
  healthAvailable,
} from "../health"
import { healthWorkoutsStore } from "../health-workouts"
import { Copy, Frame, SectionHeading } from "../native-kit"
import { Button, Toggle } from "../ui"

// One answer for every card and screen, so connecting in Settings updates
// the Fitness card still mounted under it.
let asked: boolean | undefined
const listeners = new Set<() => void>()
async function recheck() {
  asked = await healthAsked()
  for (const l of listeners) l()
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** undefined while checking (or with no Health here); re-checked when the
 * app comes back, so answering the sheet or Settings is picked up. */
export function useHealthAsked() {
  const available = healthAvailable(),
    value = useSyncExternalStore(subscribe, () => asked)
  useEffect(() => {
    if (!available) return
    void recheck()
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void recheck()
    })
    return () => sub.remove()
  }, [available])
  const connect = useCallback(async () => {
    await connectHealth()
    await recheck()
  }, [])
  return { asked: available ? value : undefined, connect }
}

export function ConnectHealthCard({
  onConnect,
  style,
}: {
  onConnect: () => void | Promise<void>
  style?: ViewStyle
}) {
  return (
    <Frame style={{ padding: 16, gap: 8, ...style }}>
      <Copy weight="semibold">Activity</Copy>
      <Copy size={13} muted>
        See your steps and the calories you burn, and add them to your budget
        when you choose.
      </Copy>
      <Button small onPress={onConnect}>
        Connect Apple Health
      </Button>
    </Frame>
  )
}

/** The Health app holds per-app sharing (Sharing → Apps → Unfurl); this
 * app's own Settings page is the fallback. */
const openHealth = () =>
  Linking.openURL("x-apple-health://").catch(() => Linking.openSettings())

/** Off by default. Turning it on asks Health to allow writing workouts;
 * turning it off stops saving and leaves what was saved in Health. */
function SaveWorkoutsRow({ onAnswered }: { onAnswered: () => Promise<void> }) {
  const enabled = healthWorkoutsStore.use((s) => s.enabled),
    busy = useRef(false),
    [, refresh] = useReducer((n: number) => n + 1, 0)
  // Write permission can change in the Health app: read it again on return.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh()
    })
    return () => sub.remove()
  }, [])
  const change = async (on: boolean) => {
    if (!on) {
      healthWorkoutsStore.set((s) => ({ ...s, enabled: false }))
      toast.success("Workouts won't be saved to Apple Health")
      return
    }
    if (busy.current) return
    busy.current = true
    const allowed = await connectWorkoutWrite()
    busy.current = false
    await onAnswered()
    if (allowed) {
      healthWorkoutsStore.set((s) => ({
        ...s,
        enabled: true,
        enabledAt: new Date().toISOString(),
      }))
      toast.success("Workouts will be saved to Apple Health")
    } else
      toast.error(
        "Allow Unfurl to write Workouts in the Health app: Sharing → Apps → Unfurl",
      )
  }
  return (
    <>
      <Toggle
        label="Save workouts to Apple Health"
        value={enabled}
        onChange={(on) => void change(on)}
      />
      <Copy size={13} muted>
        {enabled && !canWriteWorkouts()
          ? "Not allowed in the Health app. Allow Unfurl to write Workouts there: Sharing → Apps → Unfurl."
          : "Finished workouts appear in the Health app with their start and end time. Unfurl doesn't add calories."}
      </Copy>
    </>
  )
}

export function HealthSettings() {
  const { asked, connect } = useHealthAsked()
  if (asked === undefined) return null
  return (
    <>
      <SectionHeading>Apple Health</SectionHeading>
      <Frame style={{ padding: 16, gap: 12 }}>
        <Copy size={13} muted>
          {asked
            ? "Unfurl reads steps, active calories, distance, workouts and sleep, and can save your workouts. To change what it can read or write, open the Health app: Sharing → Apps → Unfurl."
            : "Connect to see your steps and burned calories on Fitness and Nutrition."}
        </Copy>
        {canOfferWorkoutWrite() && <SaveWorkoutsRow onAnswered={recheck} />}
        {asked ? (
          <Button small onPress={() => void openHealth()}>
            Manage in the Health app
          </Button>
        ) : (
          <Button small onPress={connect}>
            Connect Apple Health
          </Button>
        )}
      </Frame>
    </>
  )
}
