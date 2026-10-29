/** Hold the stream only while the app is in the foreground. The server
 * reads an open stream as "in the app" (realtime presence) and pushes
 * Fern's replies, and social nudges, only to people who are not; a stream
 * left open by a suspended app would read as present for minutes. A glance
 * at Control Center ("inactive") keeps it. */
export function foregroundStream(start: () => { stop(): Promise<void> }) {
  let open: { stop(): Promise<void> } | null = start()
  let stopped = false
  return {
    onAppState(state: string) {
      if (stopped) return
      if (state === "active") open ??= start()
      else if (state === "background") {
        void open?.stop()
        open = null
      }
    },
    stop() {
      stopped = true
      const s = open
      open = null
      return s?.stop() ?? Promise.resolve()
    },
  }
}
