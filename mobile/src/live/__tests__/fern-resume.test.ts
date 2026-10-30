// Fern's reply stream through long thinking: pings keep it open, a "thinking"
// event turns into "still thinking…", and a stream that drops while the
// device is online is read back from the server instead of reading as
// offline.
import type { StorageAdapter } from "@domain/lib/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { companionStore, replying, thinking } from "@/prototype/companion/store"
import {
  createLiveCapture,
  type LiveCaptureDeps,
  RESUME_CAP_MS,
  STREAM_GAP_MS,
  THINKING_LONG_MS,
} from "../capture"
import type { ServerEvent } from "../events"
import { ApiError, NetworkError } from "../http"
import { categoryIds } from "../mappers/finance"

const mockToast = jest.fn()
// A getter: the factory runs before this file's constants are set.
jest.mock("@domain/capture/toast", () => ({
  get toast() {
    return Object.assign(mockToast, { success: mockToast, error: mockToast })
  },
}))
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }))
jest.mock("../events", () => ({
  ...jest.requireActual("../events"),
  runEventStream: () => ({ stop: async () => {} }),
}))

const USER = "8a1f6a52-2c36-4b8f-9d34-3b1f5f0f2a11"
type Row = Record<string, unknown>
const memory: StorageAdapter = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
}

beforeEach(() => {
  jest.useFakeTimers()
  configureStorage(memory)
  resetAll()
  mockToast.mockReset()
  thinking.setState({ on: false, long: false })
  replying.setState({ id: null })
})
afterEach(() => jest.useRealTimers())

/** A stream the test feeds: ``push`` sends text, ``fail`` drops it. */
function controlled() {
  const enc = new TextEncoder()
  const queue: string[] = []
  let wake: (() => void) | null = null
  let broken: Error | null = null
  let ended = false
  const res = {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          for (;;) {
            if (broken) throw broken
            const next = queue.shift()
            if (next !== undefined)
              return { value: enc.encode(next), done: false }
            if (ended) return { value: undefined, done: true }
            await new Promise<void>((r) => {
              wake = r
            })
          }
        },
        cancel: async () => {},
      }),
    },
  } as unknown as Response
  const poke = () => {
    const w = wake
    wake = null
    w?.()
  }
  return {
    res,
    push: (text: string) => {
      queue.push(text)
      poke()
    },
    event: (e: Row) => {
      queue.push(`data: ${JSON.stringify(e)}\n\n`)
      poke()
    },
    fail: (e: Error) => {
      broken = e
      poke()
    },
    end: () => {
      ended = true
      poke()
    },
  }
}

const sol = (meId: string, text: string): Row => ({
  id: `${meId}-sol`,
  role: "sol",
  text,
  blocks: [],
  created_at: "2026-10-30T06:00:00Z",
})
const me = (meId: string): Row => ({
  id: meId,
  role: "me",
  text: "hi",
  blocks: [],
  created_at: "2026-10-30T06:00:00Z",
})

function setup(over: {
  stream: ReturnType<typeof controlled>
  reply?: (path: string) => Promise<Row>
  online?: () => boolean
}) {
  let emit: (e: ServerEvent) => void = () => {}
  const request = jest.fn(async (_m: string, path: string) => {
    if (path.startsWith("/companion/messages/") && over.reply)
      return over.reply(path)
    return { spend_minor: 0, calls: 0 }
  })
  const deps: LiveCaptureDeps = {
    http: { request, raw: jest.fn() } as never,
    post: async () => over.stream.res,
    fetch: async () => {
      throw new Error("unused")
    },
    online: over.online ?? (() => true),
    kick: () => {},
    cats: categoryIds(USER),
    listen: (l) => {
      emit = l
      return () => {
        emit = () => {}
      }
    },
  }
  const live = createLiveCapture(deps)
  const reads = () =>
    request.mock.calls.filter(([, p]) => String(p).endsWith("/reply")).length
  return { live, request, reads, emit: (e: ServerEvent) => emit(e) }
}

const msgs = () => companionStore.get().messages
const ask = (live: ReturnType<typeof createLiveCapture>) =>
  live.ask("hi", undefined, false, undefined)
const question = () => msgs().find((m) => m.role === "me")

test("pings keep a silent reply open; silence past the gap drops it", async () => {
  const s = controlled()
  const { live } = setup({
    stream: s,
    reply: async () => ({ status: "running" }),
  })
  ask(live)
  await jest.advanceTimersByTimeAsync(0)
  for (let i = 0; i < 6; i++) {
    await jest.advanceTimersByTimeAsync(15_000)
    s.push(": ping\n\n")
  }
  // 90 s of thinking, never more than 15 s apart: still the same stream.
  expect(question()?.status).toBe("sending")
  await jest.advanceTimersByTimeAsync(STREAM_GAP_MS + 1)
  // Online: not failed, but read back.
  expect(question()?.status).toBe("resuming")
})

test("a thinking event reads still thinking after a while with nothing to show", async () => {
  const s = controlled()
  const { live } = setup({ stream: s })
  ask(live)
  await jest.advanceTimersByTimeAsync(0)
  s.event({ type: "CUSTOM", name: "thinking", value: { turn: 1 } })
  await jest.advanceTimersByTimeAsync(THINKING_LONG_MS - 1000)
  expect(thinking.getState().long).toBeFalsy()
  await jest.advanceTimersByTimeAsync(1001)
  expect(thinking.getState().long).toBe(true)
  // The next model call starts over; text before 10 s keeps "thinking…".
  s.event({ type: "CUSTOM", name: "thinking", value: { turn: 2 } })
  await jest.advanceTimersByTimeAsync(0)
  expect(thinking.getState().long).toBe(false)
  await jest.advanceTimersByTimeAsync(5000)
  s.event({ type: "TEXT_MESSAGE_START", messageId: "t" })
  s.event({ type: "TEXT_MESSAGE_CONTENT", messageId: "t", delta: "Hi" })
  await jest.advanceTimersByTimeAsync(THINKING_LONG_MS)
  expect(thinking.getState().long).toBe(false)
})

test("a drop before the echo is read back: no offline toast, the reply shows", async () => {
  const s = controlled()
  let meId = ""
  let calls = 0
  const { live } = setup({
    stream: s,
    reply: async (path) => {
      meId = path.split("/")[3]
      calls++
      return calls < 2
        ? { status: "running" }
        : { status: "done", messages: [me(meId), sol(meId, "Here it is.")] }
    },
  })
  ask(live)
  await jest.advanceTimersByTimeAsync(0)
  s.fail(new NetworkError("dropped"))
  await jest.advanceTimersByTimeAsync(0)
  expect(question()?.status).toBe("resuming")
  expect(thinking.getState().on).toBe(true)
  expect(replying.getState().id).not.toBeNull()
  await jest.advanceTimersByTimeAsync(2000 + 4000)
  expect(msgs().find((m) => m.role === "sol")?.text).toBe("Here it is.")
  expect(question()?.status).toBeUndefined()
  expect(mockToast).not.toHaveBeenCalled()
  expect(thinking.getState().on).toBe(false)
  expect(replying.getState().id).toBeNull()
})

test("a companion.reply event fetches the reply at once", async () => {
  const s = controlled()
  let stored = false
  const { live, reads, emit } = setup({
    stream: s,
    reply: async (path) => {
      const id = path.split("/")[3]
      return stored
        ? { status: "done", messages: [me(id), sol(id, "Done.")] }
        : { status: "running" }
    },
  })
  ask(live)
  await jest.advanceTimersByTimeAsync(0)
  const meId = String(question()?.id)
  s.event({ type: "CUSTOM", name: "message", value: me(meId) })
  await jest.advanceTimersByTimeAsync(0)
  s.fail(new NetworkError("dropped"))
  await jest.advanceTimersByTimeAsync(0)
  expect(reads()).toBe(0)
  stored = true
  emit({ type: "companion.reply", data: { message_id: meId } } as ServerEvent)
  await jest.advanceTimersByTimeAsync(0)
  expect(reads()).toBe(1)
  expect(msgs().find((m) => m.role === "sol")?.text).toBe("Done.")
})

test("offline, a dropped stream keeps the offline toast and queues", async () => {
  const s = controlled()
  let online = true
  const { live, reads } = setup({ stream: s, online: () => online })
  ask(live)
  await jest.advanceTimersByTimeAsync(0)
  online = false
  s.fail(new NetworkError("dropped"))
  await jest.advanceTimersByTimeAsync(0)
  expect(mockToast).toHaveBeenCalledWith(
    "You're offline — try again when you're connected",
  )
  expect(question()?.status).toBe("queued")
  expect(reads()).toBe(0)
})

test("running for longer than the cap keeps reading", async () => {
  const s = controlled()
  const { live, reads } = setup({
    stream: s,
    reply: async () => ({ status: "running" }),
  })
  ask(live)
  await jest.advanceTimersByTimeAsync(0)
  s.fail(new NetworkError("dropped"))
  await jest.advanceTimersByTimeAsync(7 * 60_000)
  expect(question()?.status).toBe("resuming")
  expect(reads()).toBeGreaterThan(30)
})

test("five minutes of failed reads give up with 'taking too long'", async () => {
  const s = controlled()
  const { live } = setup({
    stream: s,
    reply: async () => {
      throw new NetworkError("down")
    },
  })
  ask(live)
  await jest.advanceTimersByTimeAsync(0)
  s.fail(new ApiError(524, "timeout", "gateway"))
  await jest.advanceTimersByTimeAsync(RESUME_CAP_MS + 10_000)
  expect(question()?.status).toBe("failed")
  expect(mockToast).toHaveBeenCalledWith(
    "Fern is taking too long. Tap Retry to ask again.",
  )
})

test("a reply the server says failed reads Not sent", async () => {
  const s = controlled()
  const { live } = setup({
    stream: s,
    reply: async () => ({ status: "failed" }),
  })
  ask(live)
  await jest.advanceTimersByTimeAsync(0)
  s.fail(new NetworkError("dropped"))
  await jest.advanceTimersByTimeAsync(2000)
  expect(question()?.status).toBe("failed")
  expect(mockToast).toHaveBeenCalledWith(
    "Fern couldn't finish that reply. Tap Retry to ask again.",
  )
})

describe("relaunch with a reply still being read back", () => {
  const seedResuming = (id: string) =>
    companionStore.set((s) => ({
      ...s,
      messages: [
        { id, role: "me", at: Date.now(), text: "hi", status: "resuming" },
      ],
    }))

  test("shows the reply once the server has it", async () => {
    const id = "5d4f3b2a-1c0e-4f9a-8b7c-6d5e4f3a2b1c"
    seedResuming(id)
    setup({
      stream: controlled(),
      reply: async () => ({
        status: "done",
        messages: [me(id), sol(id, "Back.")],
      }),
    })
    await jest.advanceTimersByTimeAsync(2000)
    expect(msgs().find((m) => m.role === "sol")?.text).toBe("Back.")
  })

  test("is Not sent when the server is not running it", async () => {
    const id = "5d4f3b2a-1c0e-4f9a-8b7c-6d5e4f3a2b1d"
    seedResuming(id)
    setup({
      stream: controlled(),
      reply: async () => {
        throw new ApiError(404, "not_found", "Message not found")
      },
    })
    await jest.advanceTimersByTimeAsync(2000)
    expect(msgs()[0].status).toBe("failed")
  })
})
