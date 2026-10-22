// Voice recordings are never thrown away for want of a network. A journal
// recording is saved as an entry at once ("transcription pending") with its
// audio copied out of the OS cache, and transcribed when the server can be
// reached. A queued voice capture's recording is copied out of the cache
// too, so a purge while offline cannot lose it.
import { seed as captureSeed } from "@domain/capture/data"
import { captureStore } from "@domain/capture/store"
import { configureNotifications } from "@domain/lib/platform"
import { configureStorage } from "@domain/lib/store"
import { createLiveCapture, type LiveCaptureDeps } from "../capture"
import { DictationError } from "../dictate"
import {
  type JournalAudioDeps,
  retryTranscription,
  saveVoiceEntry,
  transcribePending,
} from "../journal-audio"
import { journalMapper } from "../mappers/capture"
import { categoryIds } from "../mappers/finance"

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }))

const USER = "8a1f6a52-2c36-4b8f-9d34-3b1f5f0f2a11"
const CACHE = "file:///cache/Audio/recording-1.m4a"
const KEPT = "file:///documents/pending-media/recording-1.m4a"

configureNotifications(() => {})
beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  captureStore.set({ ...captureSeed(), captures: [], journal: [] })
})

function audioDeps(online: () => boolean, transcribe: jest.Mock) {
  const release = jest.fn()
  const deps: JournalAudioDeps = {
    online,
    transcribe,
    keep: async (uri) => (uri === CACHE ? KEPT : uri),
    release,
  }
  return { deps, release }
}

test("offline: the recording is kept and saved as a pending entry, not synced", async () => {
  const transcribe = jest.fn()
  const { deps } = audioDeps(() => false, transcribe)
  const e = await saveVoiceEntry(CACHE, 42, deps)
  await transcribePending(deps)
  expect(transcribe).not.toHaveBeenCalled()
  const [entry] = captureStore.get().journal
  expect(entry).toMatchObject({
    id: e.id,
    source: "voice",
    body: "",
    audioUri: KEPT,
    durationSec: 42,
    transcription: "pending",
  })
  // Nothing to sync until the words are in.
  expect(journalMapper().list(captureStore.get())).toEqual([])
})

test("back online: the entry gets its words, syncs, and the copy is released", async () => {
  let online = false
  const transcribe = jest.fn(async () => "Long day at work, but I'm proud.")
  const { deps, release } = audioDeps(() => online, transcribe)
  const e = await saveVoiceEntry(CACHE, 42, deps)
  online = true
  await expect(transcribePending(deps)).resolves.toBe(1)
  expect(transcribe).toHaveBeenCalledWith(KEPT, 42)
  const [entry] = captureStore.get().journal
  expect(entry.body).toMatch(/proud/)
  expect(entry.transcript).toBe("Long day at work, but I'm proud.")
  expect(entry.transcription).toBeUndefined()
  expect(entry.audioUri).toBeUndefined()
  expect(release).toHaveBeenCalledWith(KEPT)
  expect(
    journalMapper()
      .list(captureStore.get())
      .map((j) => j.id),
  ).toEqual([e.id])
})

test("words typed while it was pending are kept above the transcript", async () => {
  const transcribe = jest.fn(async () => "Ran in the rain.")
  const { deps } = audioDeps(() => false, transcribe)
  const e = await saveVoiceEntry(CACHE, 5, deps)
  captureStore.set((s) => ({
    ...s,
    journal: s.journal.map((j) =>
      j.id === e.id ? { ...j, body: "Morning:", mood: 3 as const } : j,
    ),
  }))
  await transcribePending({ ...deps, online: () => true })
  const [entry] = captureStore.get().journal
  expect(entry.body).toBe("Morning:\n\nRan in the rain.")
  expect(entry.mood).toBe(3)
})

test("a network failure leaves it pending; another failure marks it, Retry tries again", async () => {
  const transcribe = jest
    .fn()
    .mockRejectedValueOnce(new DictationError("network"))
    .mockRejectedValueOnce(new DictationError("spend_cap_reached"))
    .mockResolvedValueOnce("Grateful today.")
  const { deps } = audioDeps(() => true, transcribe)
  const e = await saveVoiceEntry(CACHE, 5, deps)
  await transcribePending(deps)
  expect(captureStore.get().journal[0].transcription).toBe("pending")
  await transcribePending(deps)
  expect(captureStore.get().journal[0]).toMatchObject({
    transcription: "failed",
    transcriptionError: "spend_cap_reached",
    audioUri: KEPT,
  })
  // A failed entry is not retried on its own.
  await transcribePending(deps)
  expect(transcribe).toHaveBeenCalledTimes(2)
  await retryTranscription(e.id, deps)
  expect(captureStore.get().journal[0]).toMatchObject({
    body: "Grateful today.",
    transcription: undefined,
  })
})

test("a queued voice capture's recording is copied out of the cache", async () => {
  const keep = jest.fn(async () => KEPT)
  const deps: LiveCaptureDeps = {
    http: {
      request: async () => ({ spend_minor: 0, calls: 0 }) as never,
      raw: async () => {
        throw new Error("unused")
      },
    },
    post: async () => {
      throw new Error("offline")
    },
    fetch: async () => {
      throw new Error("offline")
    },
    online: () => false,
    kick: () => {},
    cats: categoryIds(USER),
    keep,
  }
  const live = createLiveCapture(deps)
  const id = live.backend.send({
    source: "voice",
    text: "",
    audio: CACHE,
    durationSec: 9,
  })
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r))
  expect(keep).toHaveBeenCalledWith(CACHE)
  const cap = captureStore.get().captures.find((c) => c.id === id) as {
    audioUri?: string
    status: string
  }
  expect(cap).toMatchObject({ status: "queued", audioUri: KEPT })
})
