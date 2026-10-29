// The per-user server-sent event stream (GET /events/stream, ADR-0013).
//
// Chat messages, typing, activity, notifications and "another device
// changed something" arrive here while the app is in the foreground. The
// stream reconnects with backoff and resumes from Last-Event-ID; every
// event is only a nudge, so a missed one costs a refresh, never data.

export interface ServerEvent {
  id: string
  type: string
  data: unknown
}

/** Incremental SSE parser: feed chunks, get complete events. */
export function createSseParser(onEvent: (e: ServerEvent) => void) {
  let buffer = ""
  let id = ""
  let type = "message"
  let data: string[] = []
  const dispatch = () => {
    if (data.length) {
      const text = data.join("\n")
      let parsed: unknown = text
      try {
        parsed = JSON.parse(text)
      } catch {
        // a non-JSON payload is delivered as text
      }
      onEvent({ id, type, data: parsed })
    }
    type = "message"
    data = []
  }
  return (chunk: string) => {
    buffer += chunk
    const lines = buffer.split(/\r\n|\r|\n/)
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (line === "") {
        dispatch()
        continue
      }
      if (line.startsWith(":")) continue // comment / heartbeat
      const colon = line.indexOf(":")
      const field = colon === -1 ? line : line.slice(0, colon)
      let value = colon === -1 ? "" : line.slice(colon + 1)
      if (value.startsWith(" ")) value = value.slice(1)
      if (field === "id") id = value
      else if (field === "event") type = value
      else if (field === "data") data.push(value)
    }
  }
}

export interface StreamDeps {
  open(
    lastEventId: string | null,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array> | null>
  online(): boolean
  onEvent(e: ServerEvent): void
  sleep?(ms: number): Promise<void>
}

/** Keep one stream open until ``stop`` is called. */
export function runEventStream(deps: StreamDeps) {
  const controller = new AbortController()
  let lastId: string | null = null
  let delay = 1000
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const loop = async () => {
    while (!controller.signal.aborted) {
      if (!deps.online()) {
        await sleep(5000)
        continue
      }
      try {
        const body = await deps.open(lastId, controller.signal)
        if (body) {
          delay = 1000
          const reader = body.getReader()
          const decoder = new TextDecoder()
          const feed = createSseParser((e) => {
            if (e.id) lastId = e.id
            deps.onEvent(e)
          })
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            feed(decoder.decode(value, { stream: true }))
          }
        }
      } catch {
        // dropped connection: fall through to the backoff
      }
      if (controller.signal.aborted) return
      await sleep(delay)
      delay = Math.min(30_000, delay * 2)
    }
  }
  const done = loop()
  return {
    stop() {
      controller.abort()
      return done
    },
  }
}

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
