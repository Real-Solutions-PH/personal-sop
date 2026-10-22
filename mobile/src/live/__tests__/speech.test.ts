// Fern's replies read aloud: one at a time, fetched once, play/pause on the
// same button, and the state clears when the audio ends.
import type { Http } from "../http"
import { SpeechError, speaking, stopSpeech, toggleSpeech } from "../speech"

jest.mock("expo-audio", () => ({}))
jest.mock("expo-file-system", () => ({}))

function harness(status = 200) {
  const posts: string[] = []
  const files = new Map<string, string>()
  const players: { uri: string; calls: string[]; finish: () => void }[] = []
  const http: Http = {
    request: async () => {
      throw new Error("unused")
    },
    raw: async (path: string) => {
      posts.push(path)
      return {
        ok: status === 200,
        status,
        arrayBuffer: async () => new Uint8Array([73, 68, 51]).buffer,
      } as unknown as Response
    },
  }
  const deps = {
    http,
    cached: (id: string) => files.get(id) ?? null,
    save: async (id: string) => {
      files.set(id, `file:///cache/${id}.mp3`)
      return `file:///cache/${id}.mp3`
    },
    prepare: async () => {},
    createPlayer: (uri: string) => {
      const p = {
        uri,
        calls: [] as string[],
        finish: () => {},
      }
      players.push(p)
      return {
        play: () => p.calls.push("play"),
        pause: () => p.calls.push("pause"),
        remove: () => p.calls.push("remove"),
        addListener: (
          _: string,
          cb: (s: { didJustFinish?: boolean }) => void,
        ) => {
          p.finish = () => cb({ didJustFinish: true })
          return { remove: () => {} }
        },
      }
    },
  }
  return { deps, posts, players }
}

beforeEach(() => stopSpeech())

test("tap plays, tap again pauses, again resumes; audio is fetched once", async () => {
  const { deps, posts, players } = harness()
  await toggleSpeech("r1", deps)
  expect(posts).toEqual(["/companion/messages/r1/speech"])
  expect(speaking.getState()).toEqual({ id: "r1", state: "playing" })
  await toggleSpeech("r1", deps)
  expect(speaking.getState().state).toBe("paused")
  await toggleSpeech("r1", deps)
  expect(players[0].calls).toEqual(["play", "pause", "play"])
  // Finished: idle again; playing it later reuses the saved file.
  players[0].finish()
  expect(speaking.getState()).toEqual({ id: null, state: "idle" })
  await toggleSpeech("r1", deps)
  expect(posts).toHaveLength(1)
  expect(players[1].uri).toBe("file:///cache/r1.mp3")
})

test("starting another reply stops the one playing", async () => {
  const { deps, players } = harness()
  await toggleSpeech("r1", deps)
  await toggleSpeech("r2", deps)
  expect(players[0].calls).toContain("remove")
  expect(speaking.getState()).toEqual({ id: "r2", state: "playing" })
})

test("no voice on the server is a clear error, and nothing stays loading", async () => {
  const { deps } = harness(503)
  await expect(toggleSpeech("r1", deps)).rejects.toEqual(
    new SpeechError("unavailable"),
  )
  expect(speaking.getState()).toEqual({ id: null, state: "idle" })
})
