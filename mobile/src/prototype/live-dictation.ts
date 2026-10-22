// Live dictation with the phone's own recogniser (ADR-0016): words appear in
// the box while the person speaks. Finished phrases are kept; the phrase in
// progress is shown as it is recognised and replaced as recognition refines
// it. Nothing is sent: the person reviews the text and taps send.
import { useEffect, useRef, useState } from "react"
import { create } from "zustand"

/** Whether any composer is dictating right now. The phone has one
 * recogniser, so the "Hey Fern" listener stands down while this is on. */
export const dictating = create<{ on: boolean }>(() => ({ on: false }))

type Module =
  typeof import("expo-speech-recognition").ExpoSpeechRecognitionModule
type Sub = { remove(): void }

// Loaded lazily: the native module is absent in tests and older builds, and
// the composer must still work without it (it falls back to recording).
function speech(): Module | null {
  try {
    const m = (
      require("expo-speech-recognition") as typeof import("expo-speech-recognition")
    ).ExpoSpeechRecognitionModule
    return m?.isRecognitionAvailable?.() ? m : null
  } catch {
    return null
  }
}

/** Stop listening at once (the chat closed): nothing more is recognised. */
export function stopDictation() {
  try {
    speech()?.abort()
  } catch {
    // Nothing was listening.
  }
}

/** Whether this device can dictate live. */
export function canDictateLive(): boolean {
  return speech() !== null
}

/** ``before`` + kept phrases + the phrase in progress, spaced once. */
export function composeDictation(
  before: string,
  kept: string,
  partial: string,
): string {
  return [before.trimEnd(), kept.trim(), partial.trim()]
    .filter(Boolean)
    .join(" ")
}

export type LiveDictation = {
  listening: boolean
  /** 0..1, for the level meter. */
  level: number
  start(before: string): Promise<boolean>
  stop(): void
}

/** Drives ``setText`` live from the recogniser. ``start`` resolves false
 * when live dictation can't run (no module, no permission), so the caller
 * can fall back to recording. ``onError`` hears a failure after start. */
export function useLiveDictation(
  setText: (text: string) => void,
  onError: (code: string) => void,
  lang = "en-US",
): LiveDictation {
  const [listening, setListening] = useState(false)
  const [level, setLevel] = useState(0)
  const subs = useRef<Sub[]>([])
  const state = useRef({ before: "", kept: "" })
  const cb = useRef({ setText, onError })
  cb.current = { setText, onError }

  const detach = () => {
    for (const s of subs.current) s.remove()
    subs.current = []
  }
  // Unmount only: detach reads refs, so it never goes stale.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cleanup on unmount
  useEffect(
    () => () => {
      // Only a composer that was dictating hands the recogniser back.
      if (subs.current.length) dictating.setState({ on: false })
      detach()
      speech()?.abort()
    },
    [],
  )

  async function start(before: string): Promise<boolean> {
    const m = speech()
    if (!m) return false
    const perm = await m.requestPermissionsAsync().catch(() => null)
    if (!perm?.granted) return false
    detach()
    state.current = { before, kept: "" }
    subs.current = [
      m.addListener("result", (e) => {
        const said = e.results[0]?.transcript ?? ""
        const s = state.current
        if (e.isFinal) {
          s.kept = composeDictation("", s.kept, said)
          cb.current.setText(composeDictation(s.before, s.kept, ""))
        } else cb.current.setText(composeDictation(s.before, s.kept, said))
      }),
      m.addListener("volumechange", (e) =>
        // iOS reports -2..10; map to 0..1 for the meter.
        setLevel(Math.max(0, Math.min(1, (e.value + 2) / 12))),
      ),
      m.addListener("error", (e) => {
        // "aborted" is our own stop; "no-speech" just means silence.
        if (e.error !== "aborted" && e.error !== "no-speech")
          cb.current.onError(e.error)
      }),
      m.addListener("end", () => {
        setListening(false)
        setLevel(0)
        detach()
        dictating.setState({ on: false })
      }),
    ]
    dictating.setState({ on: true })
    m.start({
      lang,
      interimResults: true,
      continuous: true,
      addsPunctuation: true,
      volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
      // The recogniser's own default is the "measurement" mode, which turns
      // the phone's output right down and stays set after dictation ends,
      // so Fern's read-aloud reply came out barely audible. The default mode
      // records just as well and leaves playback at full volume.
      iosCategory: {
        category: "playAndRecord",
        categoryOptions: ["defaultToSpeaker", "allowBluetooth"],
        mode: "default",
      },
    })
    setListening(true)
    return true
  }

  return {
    listening,
    level,
    start,
    stop: () => speech()?.stop(),
  }
}
