// "Hey Fern": say the companion's name and the chat opens, already
// dictating. Opt-in, and only while the app is open on screen: iOS does not
// let an app listen in the background or when the phone is locked.
//
// How it listens: the phone's own speech recogniser (the one live dictation
// uses, ADR-0016) runs continuously, on the device where the phone supports
// it, and every partial transcript is checked for the phrase. A dedicated
// wake-word engine (Picovoice Porcupine) was the other option; it needs an
// account key checked at start-up and its free tier was withdrawn, so the
// recogniser the app already ships wins. Recognition tasks are recycled
// every 50 seconds, which keeps each transcript short and stays clear of
// the one-minute cap iOS puts on server-backed recognition.
//
// There is one recogniser, so the listener stands down while a composer is
// dictating, while a reply is read aloud, and when the app leaves the
// screen; the caller decides that and calls ``setWanted``.
import { createStore } from "@domain/lib/store"
import { create } from "zustand"

type Module =
  typeof import("expo-speech-recognition").ExpoSpeechRecognitionModule
type Sub = { remove(): void }

/** The person's choice, kept on this phone. Off until they turn it on. */
export const wakePrefs = createStore("wake-word", () => ({ enabled: false }))

/** What the listener is doing. ``armed``: it is meant to be listening (the
 * indicator shows this; ``listening`` blinks off between recognition tasks).
 * ``pending``: the latest wake, waiting for a composer to start dictating;
 * ``rest`` is anything said after the name. */
export const wake = create<{
  armed: boolean
  listening: boolean
  pending: { at: number; rest: string } | null
  /** The last few words the recogniser heard, shown in settings so a
   * person can see what their "Hey Fern" comes out as. Never stored. */
  heard: string
  /** Why the last recognition task failed (the recogniser's error code),
   * cleared once a task runs. */
  trouble: string | null
}>(() => ({
  armed: false,
  listening: false,
  pending: null,
  heard: "",
  trouble: null,
}))

/** Names the recogniser commonly hears for "Fern", including the P and B
 * forms an F often comes out as in Filipino English ("Hey Pern"). */
const FERN_SOUNDALIKES = [
  "fern",
  "ferne",
  "ferns",
  "firn",
  "fearn",
  "vern",
  "verne",
  "fren",
  "firm",
  "pern",
  "perm",
  "bern",
  "burn",
]
const GREETINGS = "hey|hay|hei|hi|ok|okay"

const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()

/**
 * If ``said`` contains "Hey <name>", what came after it ("" when nothing
 * did); otherwise null. Punctuation and case are ignored.
 */
export function wakeCommand(said: string, name = "Fern"): string | null {
  const own = plain(name).split(" ")[0] || "fern"
  const names = new Set([own, ...(own === "fern" ? FERN_SOUNDALIKES : [])])
  const text = plain(said)
  // "A Fern" is how a quick "Hey Fern" often comes out, but "a" is too
  // common a word to count anywhere but the start of what was heard.
  const m = new RegExp(
    `(?:(?:^| )(?:${GREETINGS})|^a) (?:${[...names].join("|")})(?= |$)(.*)$`,
  ).exec(text)
  if (!m) return null
  // Keep the words as said, not lower-cased: find where the tail starts.
  const tail = m[1].trim()
  if (!tail) return ""
  // Match on the plain form, since "what's" is two plain words.
  const words = said.trim().split(/\s+/)
  for (let i = words.length - 1; i >= 0; i--) {
    const end = words.slice(i).join(" ")
    if (plain(end) === tail) return end
  }
  return tail
}

function recogniser(): Module | null {
  try {
    const m = (
      require("expo-speech-recognition") as typeof import("expo-speech-recognition")
    ).ExpoSpeechRecognitionModule
    return m?.isRecognitionAvailable?.() ? m : null
  } catch {
    return null
  }
}

/** Whether this build and phone can listen for the phrase. */
export function canListenForWake(): boolean {
  return recogniser() !== null
}

/** Ask for the microphone and speech recognition. */
export async function allowWakeListening(): Promise<boolean> {
  const m = recogniser()
  if (!m) return false
  const perm = await m.requestPermissionsAsync().catch(() => null)
  return Boolean(perm?.granted)
}

const RECYCLE_MS = 50_000
/** After a wake, give the composer this long to take the recogniser. */
const HANDOFF_MS = 4_000

export interface WakeListener {
  setWanted(on: boolean): void
  dispose(): void
}

/**
 * The listening loop. ``onWake`` runs once the recogniser has fully let go,
 * so dictation can start on it straight away. ``getName`` is read at each
 * start, so a renamed companion is heard by its new name.
 */
export function createWakeListener(opts: {
  onWake: (rest: string) => void
  getName: () => string
  module?: () => Module | null
  lang?: string
}): WakeListener {
  const mod = opts.module ?? recogniser
  let wanted = false
  let running = false
  let subs: Sub[] = []
  let heard: string | null = null
  let failures = 0
  let restart: ReturnType<typeof setTimeout> | null = null
  let recycle: ReturnType<typeof setTimeout> | null = null
  let handoffUntil = 0

  const clearTimers = () => {
    if (restart) clearTimeout(restart)
    if (recycle) clearTimeout(recycle)
    restart = recycle = null
  }
  const detach = () => {
    for (const s of subs) s.remove()
    subs = []
  }
  const schedule = (ms: number) => {
    if (restart) clearTimeout(restart)
    restart = setTimeout(() => {
      restart = null
      start()
    }, ms)
  }

  function start() {
    if (!wanted || running) return
    const wait = handoffUntil - Date.now()
    if (wait > 0) return schedule(wait)
    const m = mod()
    if (!m) return
    const name = opts.getName()
    heard = null
    running = true
    const began = Date.now()
    subs = [
      m.addListener("result", (e) => {
        if (heard !== null) return
        const said = e.results[0]?.transcript ?? ""
        wake.setState({
          heard: said.trim().split(/\s+/).slice(-6).join(" "),
          trouble: null,
        })
        const rest = wakeCommand(said, name)
        if (rest === null) return
        heard = rest
        m.abort()
      }),
      m.addListener("error", (e) => {
        // Silence, our own abort, a busy recogniser: the "end" that follows
        // decides what happens next. Only real trouble is shown.
        const code = (e as { error?: string }).error ?? ""
        if (code && code !== "aborted" && code !== "no-speech")
          wake.setState({ trouble: code })
      }),
      m.addListener("end", () => {
        detach()
        clearTimers()
        running = false
        wake.setState({ listening: false })
        if (heard !== null) {
          const rest = heard
          heard = null
          failures = 0
          handoffUntil = Date.now() + HANDOFF_MS
          opts.onWake(rest)
          schedule(HANDOFF_MS)
          return
        }
        // A task that ends at once is failing (no speech service, the mic
        // held elsewhere): back off rather than spin. One that ran a while
        // just ended or was recycled: start the next one now.
        failures = Date.now() - began < 2_000 ? failures + 1 : 0
        if (wanted)
          schedule(failures ? Math.min(30_000, 500 * 2 ** failures) : 150)
      }),
    ]
    let onDevice = false
    try {
      onDevice = m.supportsOnDeviceRecognition()
    } catch {
      onDevice = false
    }
    try {
      m.start({
        lang: opts.lang ?? "en-US",
        interimResults: true,
        continuous: true,
        requiresOnDeviceRecognition: onDevice,
        addsPunctuation: false,
        contextualStrings: [`Hey ${name}`, name],
        // Same session as dictation, so handing over changes nothing and
        // playback stays at full volume (see live-dictation.ts).
        iosCategory: {
          category: "playAndRecord",
          categoryOptions: ["defaultToSpeaker", "allowBluetooth"],
          mode: "default",
        },
      })
    } catch {
      detach()
      running = false
      failures += 1
      schedule(Math.min(30_000, 500 * 2 ** failures))
      return
    }
    wake.setState({ listening: true })
    recycle = setTimeout(() => {
      recycle = null
      if (running && heard === null) m.abort()
    }, RECYCLE_MS)
  }

  function stopNow() {
    clearTimers()
    if (!running) return
    heard = null
    try {
      mod()?.abort()
    } catch {
      // Already stopped.
    }
  }

  return {
    setWanted(on) {
      if (on === wanted) return
      wanted = on
      wake.setState({ armed: on })
      if (on) {
        // Dictation took over and finished: no need to wait out the handoff.
        handoffUntil = 0
        failures = 0
        start()
      } else stopNow()
    },
    dispose() {
      wanted = false
      stopNow()
      detach()
      running = false
      wake.setState({ armed: false, listening: false })
    },
  }
}
