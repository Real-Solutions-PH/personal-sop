// Starts and stops live mode's background machinery for a signed-in user:
// the sync engine (outbox push, cursor pull) and the event stream. Called
// from the session when it signs in, and again at launch when a session is
// restored. Everything here is silent: the UI only ever reads its stores.

import { getConnectivity } from "@domain/lib/platform"
import type { StorageAdapter } from "@domain/lib/store"
import { fetch as expoFetch } from "expo/fetch"
import { AppState } from "react-native"
import { http, tokens } from "./auth"
import { clearToBlank } from "./blank"
import { API_PREFIX, API_URL } from "./config"
import { SyncEngine } from "./engine"
import { runEventStream, type ServerEvent } from "./events"
import type { AnyMapper } from "./mapper"
import { financeMappers } from "./mappers/finance"
import { habitsMappers } from "./mappers/habits"
import { modulePrefMapper, weatherPrefMapper } from "./mappers/reference"
import { tasksMappers } from "./mappers/tasks"
import { createOutbox } from "./outbox"
import { startSocialLive } from "./social"

export type MapperFactory = (userId: string) => AnyMapper[]

// Module mapper factories register here (one per domain module).
const factories: MapperFactory[] = [
  (uid) => [weatherPrefMapper(uid), modulePrefMapper(uid)],
  financeMappers,
  habitsMappers,
  tasksMappers,
]
export const registerMappers = (f: MapperFactory) => void factories.push(f)

type Listener = (e: ServerEvent) => void
const listeners = new Set<Listener>()
/** Social, notifications and capture subscribe to live events here. */
export function onServerEvent(l: Listener) {
  listeners.add(l)
  return () => void listeners.delete(l)
}

let active: { engine: SyncEngine; stop: () => void } | null = null

export function engine() {
  return active?.engine ?? null
}

const OWNER_KEY = "sop-live:owner"

export function startLive(userId: string, storage: StorageAdapter) {
  stopLive()
  if (storage.getItem(OWNER_KEY) !== userId) {
    // First run of this account on this device: no demo data, no other
    // account's leftovers, no stale cursor.
    for (const key of [
      "sop-live:outbox",
      "sop-live:snapshot",
      "sop-live:cursor",
    ])
      storage.removeItem(key)
    clearToBlank()
    storage.setItem(OWNER_KEY, userId)
  }
  const engine = new SyncEngine({
    http,
    storage,
    outbox: createOutbox(storage),
    mappers: factories.flatMap((f) => f(userId)),
    online: getConnectivity,
  })
  engine.start((m, onChange) => {
    let last = m.store.get()
    return m.store.subscribe(() => {
      const next = m.store.get()
      if (next !== last) {
        last = next
        onChange()
      }
    })
  })
  const appState = AppState.addEventListener("change", (s) => {
    if (s === "active") void engine.sync()
  })
  const stream = runEventStream({
    online: getConnectivity,
    open: async (lastId, signal) => {
      const token = await tokens.current()
      const res = await expoFetch(`${API_URL}${API_PREFIX}/events/stream`, {
        headers: {
          Authorization: `Bearer ${token ?? ""}`,
          Accept: "text/event-stream",
          ...(lastId ? { "Last-Event-ID": lastId } : {}),
        },
        signal,
      })
      if (res.status === 401) await tokens.refresh()
      return res.ok ? (res.body as ReadableStream<Uint8Array>) : null
    },
    onEvent: (e) => {
      if (e.type === "sync.changed") void engine.sync()
      for (const l of listeners) l(e)
    },
  })
  const interval = setInterval(() => void engine.sync(), 60_000)
  const stopSocial = startSocialLive(userId, onServerEvent)
  void engine.sync()
  active = {
    engine,
    stop: () => {
      engine.stop()
      appState.remove()
      clearInterval(interval)
      void stream.stop()
      stopSocial()
    },
  }
  return engine
}

export function stopLive() {
  active?.stop()
  active = null
}

/** Push now (connectivity regained). */
export function syncNow() {
  void active?.engine.sync()
}
