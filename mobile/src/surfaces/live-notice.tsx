import { BellOff, Settings } from "lucide-react-native"
import { useEffect, useState } from "react"
import { AppState, Linking, Platform, View } from "react-native"
import { Copy, SmallButton } from "@/prototype/native-kit"
import { type Accent, useTheme } from "@/prototype/theme"
import { type LiveStatus, liveStatus } from "./native"

// The routine player, workout logger and habit timer say so when the
// running activity cannot reach the lock screen (ADR-0020). Without this a
// person who once answered "Don't Allow" to iOS's Live Activities prompt, or
// switched notifications off on Android, sees nothing and no reason why.

/** The native start runs after the write returns; its failure is known
 * a moment later. */
const SETTLE_MS = 1500

/** The activity's status while `active`, read once it has had time to
 * start and again each time the app returns (from Settings, say). */
export function useLiveStatus(active: boolean): LiveStatus | null {
  const [status, setStatus] = useState<LiveStatus | null>(null)
  useEffect(() => {
    if (!active) {
      setStatus(null)
      return
    }
    const timers: ReturnType<typeof setTimeout>[] = []
    const read = () => {
      setStatus(liveStatus())
      timers.push(setTimeout(() => setStatus(liveStatus()), SETTLE_MS))
    }
    read()
    const app = AppState.addEventListener("change", (s) => {
      if (s === "active") read()
    })
    return () => {
      app.remove()
      for (const id of timers) clearTimeout(id)
    }
  }, [active])
  return status
}

// One row, so the player keeps its room on a small phone.
const OFF =
  Platform.OS === "android"
    ? "Notifications are off, so this won't show in your notifications."
    : "Live Activities are off, so this won't show on your Lock Screen."
const FAILED =
  Platform.OS === "android"
    ? "Couldn't show this in your notifications. Trying again when you're back."
    : "Couldn't show this on your Lock Screen. Trying again when you're back."

export function LiveNotice({
  active,
  accent,
  inset = true,
}: {
  active: boolean
  accent: Accent
  /** Off inside a Screen, whose content is already padded. */
  inset?: boolean
}) {
  const t = useTheme()
  const status = useLiveStatus(active)
  if (!status || (status.enabled && !status.error)) return null
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: "row",
        alignItems: "center",
        marginHorizontal: inset ? 16 : 0,
        marginBottom: inset ? 8 : 0,
        paddingVertical: 8,
        paddingLeft: 12,
        paddingRight: 8,
        gap: 8,
        borderRadius: 14,
        backgroundColor: t.soft,
      }}
    >
      <BellOff size={18} color={t.warn} />
      <Copy size={13} style={{ flex: 1 }}>
        {status.enabled ? FAILED : OFF}
      </Copy>
      {!status.enabled && (
        <SmallButton
          small
          accent={accent}
          icon={Settings}
          onPress={() => void Linking.openSettings().catch(() => {})}
        >
          Turn on
        </SmallButton>
      )}
    </View>
  )
}
