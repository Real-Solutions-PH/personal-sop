// When live sync pulls on its own, and when the server statistics follow.
// Each request wakes the radio, and a cellular radio stays in its
// high-power state for several seconds after each one, so a quiet minute
// should cost nothing.
//
// - The safety pull runs only in the foreground (a run recording its route
//   keeps JS alive in the background): every minute while the event stream
//   is down; every five while it is up, since its events say when to pull.
// - Statistics are refetched after a sync that moved rows, a server event
//   or a return to the foreground. A quiet poll leaves them until they are
//   STATS_QUIET_MS old (they follow the clock too: a new day, a grace day).

export const POLL_MS = 60_000
export const POLL_STREAM_MS = 5 * 60_000
export const STATS_QUIET_MS = 15 * 60_000

export interface SyncScheduleDeps {
  sync(): void
  refreshStats(): void
  appState(): string
  now?: () => number
}

export function createSyncSchedule(deps: SyncScheduleDeps) {
  const now = deps.now ?? Date.now
  let statsDue = true
  let statsAt = 0
  let syncedAt = 0
  let streamOpen = false
  let interval: ReturnType<typeof setInterval> | null = null

  const poll = () => {
    // The stream is up and a sync ran lately: its events cover the gap.
    if (streamOpen && now() - syncedAt < POLL_STREAM_MS - 1_000) return
    deps.sync()
  }
  const startPoll = () => {
    interval ??= setInterval(poll, POLL_MS)
  }
  const stopPoll = () => {
    if (interval) clearInterval(interval)
    interval = null
  }

  return {
    start() {
      if (deps.appState() !== "background") startPoll()
    },
    stop: stopPoll,
    /** A push + pull finished; ``changed``: it moved rows either way. */
    onSynced(changed: boolean) {
      syncedAt = now()
      if (changed || statsDue || syncedAt - statsAt >= STATS_QUIET_MS) {
        statsDue = false
        statsAt = syncedAt
        deps.refreshStats()
      }
    },
    /** A server event that means "pull now". */
    onPullEvent() {
      statsDue = true
      deps.sync()
    },
    onStreamOpen(open: boolean) {
      streamOpen = open
    },
    /** The app moved between foreground and background. */
    onAppState(state: string) {
      if (state === "active") {
        statsDue = true
        startPoll()
        deps.sync()
      } else if (state === "background") stopPoll()
    },
  }
}
