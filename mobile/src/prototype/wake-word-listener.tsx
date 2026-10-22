// Runs the "Hey Fern" listener for the signed-in app: on while the switch
// in Fern's settings is on and the app is on screen, off while anything
// else needs the microphone or the speaker.
import { captureUi, openCapture } from "@domain/lib/capture"
import { useEffect, useRef, useState } from "react"
import { AppState } from "react-native"
import { speaking } from "@/live/speech"
import { companionStore } from "./companion/store"
import { dictating } from "./live-dictation"
import { feel } from "./motion"
import { createWakeListener, wake, wakePrefs } from "./wake-word"

/** Lead time between the chime and dictation starting, so the chime is not
 * cut off when the recogniser takes the microphone. */
const CHIME_MS = 300

type Chime = { seekTo(s: number): Promise<void> | void; play(): void }
let chimePlayer: Chime | null = null
function chime() {
  try {
    const audio = require("expo-audio") as typeof import("expo-audio")
    chimePlayer ??= audio.createAudioPlayer(
      require("./sounds/wake.wav"),
    ) as unknown as Chime
    void Promise.resolve(chimePlayer.seekTo(0)).catch(() => {})
    chimePlayer.play()
  } catch {
    // No audio module in this build: the haptic still answers.
  }
}

/** Mount once inside the signed-in layout. ``onChatPage``: the full chat
 * page is showing, so a wake dictates there instead of opening the drawer. */
export function WakeWordListener({ onChatPage }: { onChatPage: boolean }) {
  const enabled = wakePrefs.use((s) => s.enabled)
  const busy = dictating((s) => s.on)
  const reading = speaking((s) => s.state !== "idle")
  const [active, setActive] = useState(AppState.currentState === "active")
  const page = useRef(onChatPage)
  page.current = onChatPage
  const listener = useRef<ReturnType<typeof createWakeListener> | null>(null)

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) =>
      setActive(s === "active"),
    )
    return () => sub.remove()
  }, [])

  useEffect(() => {
    const l = createWakeListener({
      getName: () => companionStore.get().name,
      onWake: (rest) => {
        feel.success()
        chime()
        if (!page.current && !captureUi.get().open) openCapture()
        setTimeout(
          () => wake.setState({ pending: { at: Date.now(), rest } }),
          CHIME_MS,
        )
      },
    })
    listener.current = l
    return () => {
      l.dispose()
      listener.current = null
    }
  }, [])

  useEffect(() => {
    listener.current?.setWanted(enabled && active && !busy && !reading)
  }, [enabled, active, busy, reading])

  return null
}
