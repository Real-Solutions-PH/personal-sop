// Live dictation with the phone's own recogniser (ADR-0016): words appear in
// the box while the person speaks. Finished phrases are kept; the phrase in
// progress is shown as it is recognised and replaced as recognition refines
// it. Nothing is sent: the person reviews the text and taps send.
//
// The phone's recogniser is quick but mishears names, food and amounts
// ("Fern" as "friend", "whey" as "weight"). In live mode the same audio is
// kept and, when the person stops, transcribed again on the server (Deepgram
// with their own habit, food and account names as key terms), and that text
// replaces the phone's. On 350 test clips the server made 15% word errors
// and kept 88% of names and numbers; the phone 23% and 71%.
import { useEffect, useRef, useState } from "react"
import { create } from "zustand"
import { liveMode } from "@/live/config"
import { recognitionModule, stopSpeech } from "@/live/speech"
import { releaseWake } from "./wake-word"

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
    const m = recognitionModule()
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

/** A recording to text on the server, or null where there is no server. */
export type Refine = (uri: string, seconds: number) => Promise<string>

function serverRefine(): Refine | null {
  if (!liveMode) return null
  const d = require("@/live/dictate") as typeof import("@/live/dictate")
  return (uri, seconds) => d.dictate(uri, seconds)
}

function removeFile(uri: string) {
  try {
    const { File } =
      require("expo-file-system") as typeof import("expo-file-system")
    const f = new File(uri)
    if (f.exists) f.delete()
  } catch {
    // a leftover file in the cache is harmless
  }
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

function fresh(before: string) {
  return {
    before,
    kept: "",
    /** What dictation last put in the box. */
    shown: "",
    /** The server's words are in: later phone results are ignored. */
    refined: false,
    startedAt: Date.now(),
  }
}

export type LiveDictation = {
  listening: boolean
  /** 0..1, for the level meter. */
  level: number
  start(before: string): Promise<boolean>
  stop(): void
}

type SetText = (text: string | ((current: string) => string)) => void

/** Drives ``setText`` live from the recogniser. ``start`` resolves false
 * when live dictation can't run (no module, no permission), so the caller
 * can fall back to recording. ``onError`` hears a failure after start.
 * ``refine`` (the server, in live mode) re-transcribes the recording when
 * the person stops; its words replace the phone's unless the box was edited
 * meanwhile, and a failure keeps the phone's words. */
export function useLiveDictation(
  setText: SetText,
  onError: (code: string) => void,
  lang = "en-US",
  refine: Refine | null = serverRefine(),
): LiveDictation {
  const [listening, setListening] = useState(false)
  const [level, setLevel] = useState(0)
  const subs = useRef<Sub[]>([])
  const state = useRef(fresh(""))
  const cb = useRef({ setText, onError, refine })
  cb.current = { setText, onError, refine }

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
    // The person is about to talk: Fern stops reading aloud, and "Hey Fern"
    // lets go of the recogniser before dictation takes it (one tap, not two).
    stopSpeech()
    await releaseWake()
    detach()
    const s = fresh(before)
    state.current = s
    const show = (text: string) => {
      s.shown = text
      cb.current.setText(text)
    }
    const keep = cb.current.refine !== null
    subs.current = [
      m.addListener("result", (e) => {
        if (s.refined) return
        const said = e.results[0]?.transcript ?? ""
        if (e.isFinal) {
          s.kept = composeDictation("", s.kept, said)
          show(composeDictation(s.before, s.kept, ""))
        } else show(composeDictation(s.before, s.kept, said))
      }),
      m.addListener("audioend", (e) => {
        const r = cb.current.refine
        if (!e.uri || !r) return
        const uri = e.uri
        const seconds = (Date.now() - s.startedAt) / 1000
        r(uri, seconds)
          .then((said) => {
            if (!said.trim()) return
            const text = composeDictation(s.before, said, "")
            // Only over the words dictation put there: an edit wins.
            cb.current.setText((cur) => {
              if (cur !== s.shown) return cur
              s.refined = true
              s.shown = text
              return text
            })
          })
          .catch(() => {
            // The phone's words stay.
          })
          .finally(() => removeFile(uri))
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
      // The audio the server re-transcribes: 16 kHz 16-bit mono WAV (32 KB
      // a second), which Deepgram reads as well as the phone's 44.1 kHz.
      ...(keep && {
        recordingOptions: {
          persist: true,
          outputSampleRate: 16_000,
          outputEncoding: "pcmFormatInt16" as const,
        },
      }),
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
