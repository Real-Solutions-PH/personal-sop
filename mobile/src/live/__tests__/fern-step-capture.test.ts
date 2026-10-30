// A step's card arrives with the finished reply's capture; when that frame
// never reaches the device, the step names its capture and the app fetches it.
import { captureStore } from "@domain/capture/store"
import type { StorageAdapter } from "@domain/lib/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { companionStore } from "@/prototype/companion/store"
import { createLiveCapture, type LiveCaptureDeps } from "../capture"
import { ApiError, NetworkError } from "../http"
import { categoryIds } from "../mappers/finance"

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }))
jest.mock("../events", () => ({
  ...jest.requireActual("../events"),
  runEventStream: () => ({ stop: async () => {} }),
}))

const USER = "8a1f6a52-2c36-4b8f-9d34-3b1f5f0f2a11"
const CAP = "5d4f3b2a-1c0e-4f9a-8b7c-6d5e4f3a2b1c"
type Row = Record<string, unknown>

const memory: StorageAdapter = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
}

beforeEach(() => {
  configureStorage(memory)
  resetAll()
})

function sse(events: Row[]): Response {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")
  const enc = new TextEncoder()
  let sent = false
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { value: undefined, done: true }
          sent = true
          return { value: enc.encode(text), done: false }
        },
      }),
    },
    text: async () => text,
  } as unknown as Response
}

function deps(over: Partial<LiveCaptureDeps> = {}): LiveCaptureDeps {
  return {
    http: {
      request: jest.fn(async () => {
        throw new Error("no REST call expected")
      }),
      raw: async () => {
        throw new Error("unused")
      },
    },
    post: async () => sse([]),
    fetch: async () => {
      throw new Error("no fetch expected")
    },
    online: () => true,
    kick: () => {},
    cats: categoryIds(USER),
    ...over,
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

test("a tool result's capture id is kept on its step", async () => {
  const live = createLiveCapture(
    deps({
      post: async () =>
        sse([
          { type: "RUN_STARTED" },
          {
            type: "TOOL_CALL_START",
            toolCallId: "t1",
            toolCallName: "log_meal",
          },
          {
            type: "TOOL_CALL_RESULT",
            toolCallId: "t1",
            content: JSON.stringify({
              ok: true,
              summary: "Logged meal: Matcha (waiting for your OK)",
              card_id: "card-1",
              state: "proposed",
              capture_id: CAP,
            }),
          },
        ]),
    }),
  )
  live.ask("log this matcha", undefined, false, undefined)
  for (let i = 0; i < 5; i++) await settle()
  const sol = companionStore.get().messages.find((m) => m.role === "sol")
  const steps = sol?.blocks?.find((b) => b.t === "steps")
  expect(steps?.t === "steps" && steps.items[0]).toMatchObject({
    card_id: "card-1",
    state: "proposed",
    capture_id: CAP,
  })
})

describe("ensure", () => {
  const detail = {
    id: CAP,
    client_uuid: CAP,
    at: "2026-10-30T06:00:00Z",
    source: "chat",
    text: "log this matcha",
    status: "needs_input",
    cards: [],
  }

  test("asks for a missing capture once while the request is out", async () => {
    let resolve: (v: Row) => void = () => {}
    const request = jest.fn(
      () =>
        new Promise<Row>((r) => {
          resolve = r
        }),
    )
    const live = createLiveCapture(
      deps({ http: { request, raw: jest.fn() } as never }),
    )
    live.backend.ensure(CAP)
    live.backend.ensure(CAP)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith("GET", `/capture/${CAP}`)
    resolve(detail)
    await settle()
    expect(captureStore.get().captures.some((c) => c.id === CAP)).toBe(true)
    // On the device now: nothing more to fetch.
    live.backend.ensure(CAP)
    expect(request).toHaveBeenCalledTimes(1)
  })

  test("does nothing offline", () => {
    const request = jest.fn()
    const live = createLiveCapture(
      deps({ http: { request, raw: jest.fn() } as never, online: () => false }),
    )
    live.backend.ensure(CAP)
    expect(request).not.toHaveBeenCalled()
  })

  test("tries again after a failure, but not after the capture is gone", async () => {
    const request = jest
      .fn()
      .mockRejectedValueOnce(new NetworkError("dropped"))
      .mockRejectedValueOnce(new ApiError(404, "not_found", "gone"))
    const live = createLiveCapture(
      deps({ http: { request, raw: jest.fn() } as never }),
    )
    live.backend.ensure(CAP)
    await settle()
    live.backend.ensure(CAP)
    await settle()
    expect(request).toHaveBeenCalledTimes(2)
    live.backend.ensure(CAP)
    expect(request).toHaveBeenCalledTimes(2)
  })
})
