// Starts and stops live mode's background machinery for a signed-in user:
// the sync engine (outbox push, cursor pull) and the event stream. Called
// from the session when it signs in, and again at launch when a session is
// restored. Everything here is silent: the UI only ever reads its stores.

import { setFxSource } from "@domain/finance/fx"
import { installStarter } from "@domain/fitness/actions"
import { getConnectivity } from "@domain/lib/platform"
import type { StorageAdapter } from "@domain/lib/store"
import { fetch as expoFetch } from "expo/fetch"
import { AppState } from "react-native"
import { http, tokens } from "./auth"
import { clearToBlank } from "./blank"
import { captureMappers } from "./capture"
import { API_PREFIX, API_URL } from "./config"
import { SyncEngine } from "./engine"
import { runEventStream, type ServerEvent } from "./events"
import { foregroundStream } from "./foreground-stream"
import { transcribePending } from "./journal-audio"
import type { AnyMapper } from "./mapper"
import { companionMappers } from "./mappers/companion"
import { dashMappers } from "./mappers/dash"
import { financeMappers } from "./mappers/finance"
import { fitnessMappers } from "./mappers/fitness"
import { focusMappers } from "./mappers/focus"
import { habitsMappers } from "./mappers/habits"
import { modulePrefMapper, weatherPrefMapper } from "./mappers/reference"
import { screenMappers } from "./mappers/screen"
import { tasksMappers } from "./mappers/tasks"
import { createOutbox } from "./outbox"
import { registerPushDevice } from "./push"
import { syncReady } from "./ready"
import { startSocialLive } from "./social"
import { createStats, type LiveStats } from "./stats"

export type MapperFactory = (userId: string) => AnyMapper[]

// Module mapper factories register here (one per domain module).
const factories: MapperFactory[] = [
  (uid) => [weatherPrefMapper(uid), modulePrefMapper(uid)],
  dashMappers,
  financeMappers,
  fitnessMappers,
  // Before habits: a habit's screen-time rule names a group.
  screenMappers,
  habitsMappers,
  tasksMappers,
  // After tasks and habits: a session names one of them.
  focusMappers,
  captureMappers,
  companionMappers,
]
export const registerMappers = (f: MapperFactory) => void factories.push(f)

type Listener = (e: ServerEvent) => void
const listeners = new Set<Listener>()
/** Social, notifications and capture subscribe to live events here. */
export function onServerEvent(l: Listener) {
  listeners.add(l)
  return () => void listeners.delete(l)
}

let active: {
  engine: SyncEngine
  stats: LiveStats
  stop: () => void
} | null = null

export function engine() {
  return active?.engine ?? null
}

/** The server statistics source (live mode, signed in). */
export function liveStats() {
  return active?.stats ?? null
}

// Events that mean "pull now": another device changed something, or the
// server put a notice in the inbox.
const PULL_EVENTS = new Set(["sync.changed", "dashboard.notification"])

const OWNER_KEY = "sop-live:owner"

/** `isNew`: an account created just now, so its state is already known
 * (blank, not onboarded) without waiting for the first pull. */
export function startLive(
  userId: string,
  storage: StorageAdapter,
  isNew = false,
) {
  stopLive()
  if (storage.getItem(OWNER_KEY) !== userId) {
    // First run of this account on this device: no demo data, no other
    // account's leftovers, no stale cursor.
    for (const key of [
      "sop-live:outbox",
      "sop-live:snapshot",
      "sop-live:cursor",
      "sop-live:deleted",
      "sop-live:dead-letter",
      "sop-live:previous",
      "sop-live:deferred",
    ])
      storage.removeItem(key)
    clearToBlank()
    storage.setItem(OWNER_KEY, userId)
  }
  // A device that has pulled before already holds this account's state.
  syncReady.setState({
    ready: isNew || Number(storage.getItem("sop-live:cursor") ?? 0) > 0,
  })
  let syncing: SyncEngine | null = null
  const stats = createStats({
    http,
    online: getConnectivity,
    settled: () => syncing?.settled() ?? true,
  })
  stats.start(userId)
  setFxSource(async (base) => {
    const r = await http.request<{
      rate: string
      as_of: string
      quote: string
    }>("GET", `/finance/fx?base=${encodeURIComponent(base)}`)
    return { rate: Number(r.rate), asOf: r.as_of, quote: r.quote }
  })
  const engine = new SyncEngine({
    http,
    storage,
    outbox: createOutbox(storage),
    mappers: factories.flatMap((f) => f(userId)),
    online: getConnectivity,
    onSynced: () => {
      // Once per account on this device, after a pull really reached the
      // server (a new account's first pull can be empty): the gym library
      // and splits, measured against the account's own rows.
      const starter = `sop-live:starter:${userId}`
      if (!storage.getItem(starter)) {
        installStarter(userId)
        storage.setItem(starter, "1")
      }
      void stats.refreshAll()
      // The server is reachable: voice entries saved offline get their words.
      void transcribePending()
    },
  })
  syncing = engine
  engine.start((m, onChange) => {
    let last = m.store.get()
    return m.store.subscribe(() => {
      const next = m.store.get()
      if (next !== last) {
        last = next
        stats.markEdited()
        onChange()
      }
    })
  })
  // Web: a reload or a closed tab never reaches the debounce either.
  const onPageHide = () => engine.flush()
  const page = typeof window !== "undefined" ? window : null
  page?.addEventListener?.("pagehide", onPageHide)
  // Open only while the app is in the foreground (see foregroundStream).
  const stream = foregroundStream(() =>
    runEventStream({
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
        if (PULL_EVENTS.has(e.type)) void engine.sync()
        for (const l of listeners) l(e)
      },
    }),
  )
  const appState = AppState.addEventListener("change", (s) => {
    stream.onAppState(s)
    if (s === "active") void engine.sync()
    // Leaving the foreground: an edit still in the debounce window would be
    // lost if the OS kills the app, so queue it now.
    else engine.flush()
  })
  const interval = setInterval(() => void engine.sync(), 60_000)
  const stopSocial = startSocialLive(userId, onServerEvent)
  void engine.sync().finally(() => syncReady.setState({ ready: true }))
  void registerPushDevice({ http })
  active = {
    engine,
    stats,
    stop: () => {
      engine.stop()
      stats.stop()
      appState.remove()
      page?.removeEventListener?.("pagehide", onPageHide)
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
  setFxSource(null)
}

/** Re-send everything this device holds to the server (it lost its copy).
 * Returns how many changes were queued, or null when not signed in live. */
export function reuploadAll(): number | null {
  return active ? active.engine.reupload() : null
}

/** Queue a domain action through the outbox. False when live sync is not
 * running (the caller falls back to calling the API directly). */
export function queueAction(name: string, data: Record<string, unknown>) {
  if (!active) return false
  active.engine.act(name, data)
  return true
}

/** Push now (connectivity regained). */
export function syncNow() {
  void active?.engine.sync()
}
