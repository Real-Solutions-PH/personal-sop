// Fern's replies read aloud (POST /companion/messages/{id}/speech, MP3).
// One reply plays at a time; a reply's audio is fetched once and kept as a
// file, so playing it again costs nothing. ``speaking`` drives the play /
// pause button under each reply.

import { create } from "zustand"
import type { Http } from "./http"

type Player = {
  play(): void
  pause(): void
  remove(): void
  addListener(
    event: "playbackStatusUpdate",
    cb: (s: { didJustFinish?: boolean }) => void,
  ): { remove(): void }
}
export interface SpeechDeps {
  http: Http
  /** Overridable for tests. */
  createPlayer?: (uri: string) => Player
  save?: (id: string, bytes: Uint8Array) => Promise<string>
  cached?: (id: string) => string | null
  prepare?: () => Promise<void>
}

export const speaking = create<{
  id: string | null
  state: "idle" | "loading" | "playing" | "paused"
}>(() => ({ id: null, state: "idle" }))

let player: Player | null = null
let finished: { remove(): void } | null = null

const fileName = (id: string) => `fern-reply-${id}.mp3`

function defaults(): Required<Omit<SpeechDeps, "http">> {
  const audio = require("expo-audio") as typeof import("expo-audio")
  const fs = require("expo-file-system") as typeof import("expo-file-system")
  return {
    createPlayer: (uri) =>
      audio.createAudioPlayer({ uri }) as unknown as Player,
    save: async (id, bytes) => {
      const f = new fs.File(fs.Paths.cache, fileName(id))
      f.write(bytes)
      return f.uri
    },
    cached: (id) => {
      const f = new fs.File(fs.Paths.cache, fileName(id))
      return f.exists ? f.uri : null
    },
    // Read aloud even with the phone's silent switch on, like other apps.
    prepare: () => audio.setAudioModeAsync({ playsInSilentMode: true }),
  }
}

function stop() {
  finished?.remove()
  finished = null
  player?.remove()
  player = null
}

/** Play, pause or resume one reply. Returns once playback has started. */
export async function toggleSpeech(id: string, deps: SpeechDeps) {
  const d = { ...defaults(), ...deps }
  const now = speaking.getState()
  if (now.id === id && player) {
    if (now.state === "playing") {
      player.pause()
      speaking.setState({ state: "paused" })
    } else if (now.state === "paused") {
      player.play()
      speaking.setState({ state: "playing" })
    }
    return
  }
  stop()
  speaking.setState({ id, state: "loading" })
  let uri = d.cached(id)
  if (!uri) {
    const res = await d.http.raw(`/companion/messages/${id}/speech`, {
      method: "POST",
    })
    if (!res.ok) {
      speaking.setState({ id: null, state: "idle" })
      throw new SpeechError(res.status === 503 ? "unavailable" : "failed")
    }
    uri = await d.save(id, new Uint8Array(await res.arrayBuffer()))
  }
  // Another reply was tapped while this one loaded: it wins.
  if (speaking.getState().id !== id) return
  await d.prepare().catch(() => {})
  player = d.createPlayer(uri)
  finished = player.addListener("playbackStatusUpdate", (s) => {
    if (s.didJustFinish && speaking.getState().id === id) {
      stop()
      speaking.setState({ id: null, state: "idle" })
    }
  })
  player.play()
  speaking.setState({ id, state: "playing" })
}

export function stopSpeech() {
  stop()
  speaking.setState({ id: null, state: "idle" })
}

export class SpeechError extends Error {
  constructor(readonly code: "unavailable" | "failed") {
    super(code)
  }
}
