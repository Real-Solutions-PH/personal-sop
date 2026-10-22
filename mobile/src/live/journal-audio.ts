// Voice journal entries are saved before they are transcribed: the
// recording is copied into app storage and the entry shows "transcription
// pending" at once. Its words are filled in as soon as the server can
// transcribe it, then, or after the next successful sync.

import type { JournalEntry } from "@domain/capture/data"
import { addJournalEntry, updateJournalEntry } from "@domain/capture/engine"
import { journalDraft } from "@domain/capture/parse"
import { captureStore } from "@domain/capture/store"
import { getConnectivity } from "@domain/lib/platform"
import { DictationError, dictate } from "./dictate"
import { keepFile, releaseFile } from "./keep-file"

export interface JournalAudioDeps {
  online(): boolean
  transcribe(uri: string, durationSec: number): Promise<string>
  keep(uri: string): Promise<string>
  release(uri: string | undefined): void
}

const defaults: JournalAudioDeps = {
  online: getConnectivity,
  transcribe: (uri, sec) => dictate(uri, sec),
  keep: keepFile,
  release: releaseFile,
}

/** Save a recording as a journal entry now; its words come later. */
export async function saveVoiceEntry(
  uri: string,
  durationSec: number,
  deps: JournalAudioDeps = defaults,
): Promise<JournalEntry> {
  const audioUri = await deps.keep(uri)
  const e = addJournalEntry({ body: "", source: "voice" })
  const pending = {
    audioUri,
    durationSec,
    transcription: "pending" as const,
  }
  updateJournalEntry(e.id, pending)
  return { ...e, ...pending }
}

/** Fill in the words of an entry from what was said, keeping anything the
 * person wrote or chose in the meantime. */
function fill(id: string, text: string) {
  const e = captureStore.get().journal.find((j) => j.id === id)
  if (!e) return
  const d = journalDraft(text, "voice")
  if (d.payload.kind !== "journal") return
  const words = d.payload.body
  updateJournalEntry(id, {
    body: e.body.trim() ? `${e.body.trim()}\n\n${words}` : words,
    mood: e.mood ?? d.payload.mood,
    area: e.area ?? d.payload.area,
    tags: [...new Set([...e.tags, ...d.payload.tags])],
    transcript: text,
    audioUri: undefined,
    durationSec: undefined,
    transcription: undefined,
    transcriptionError: undefined,
  })
}

let running: Promise<number> | null = null

/** Transcribe every pending voice entry, oldest first (single-flight).
 * Stops at the first network failure (they stay pending); any other
 * failure marks that entry failed so it is not retried in a loop.
 * Resolves to how many entries were filled in. */
export function transcribePending(
  deps: JournalAudioDeps = defaults,
): Promise<number> {
  if (running) return running
  running = (async () => {
    let done = 0
    for (;;) {
      if (!deps.online()) return done
      const next = captureStore
        .get()
        .journal.filter((j) => j.transcription === "pending" && j.audioUri)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
      if (!next?.audioUri) return done
      try {
        const text = await deps.transcribe(next.audioUri, next.durationSec ?? 0)
        fill(next.id, text)
        deps.release(next.audioUri)
        done++
      } catch (error) {
        const code = error instanceof DictationError ? error.code : "failed"
        if (code === "network") return done
        updateJournalEntry(next.id, {
          transcription: "failed",
          transcriptionError: code,
        })
      }
    }
  })().finally(() => {
    running = null
  })
  return running
}

/** Try a failed entry again. */
export function retryTranscription(
  id: string,
  deps: JournalAudioDeps = defaults,
) {
  updateJournalEntry(id, {
    transcription: "pending",
    transcriptionError: undefined,
  })
  return transcribePending(deps)
}
