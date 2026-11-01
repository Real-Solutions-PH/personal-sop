// A request, a reply stream or a dictation that never answers must fail as
// a network error in bounded time, so the app treats it as offline (queue,
// retry later) instead of waiting forever. And a Wi-Fi without internet is
// offline.
import { seed as captureSeed } from "@domain/capture/data"
import { captureStore } from "@domain/capture/store"
import { configureNotifications } from "@domain/lib/platform"
import {
  CONTACT_GRACE_MS,
  noteServerContact,
  reachable,
} from "@/prototype/connectivity"
import { createLiveCapture, STREAM_GAP_MS } from "../capture"
import { DICTATE_TIMEOUT_MS, dictate } from "../dictate"
import {
  createHttp,
  type Fetch,
  fetchWithTimeout,
  NetworkError,
  REQUEST_TIMEOUT_MS,
} from "../http"
import { categoryIds } from "../mappers/finance"

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }))
jest.mock("../auth", () => ({
  tokens: { current: async () => "t", refresh: async () => "t" },
}))

const tokens = { current: async () => "t", refresh: async () => "t" }
const never = () => new Promise<never>(() => {})

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

test("a request that never answers fails as a network error and aborts the fetch", async () => {
  let signal: AbortSignal | null | undefined
  const fetchImpl: Fetch = (_url, init) => {
    signal = init.signal
    return never()
  }
  const http = createHttp(tokens, fetchImpl)
  const pending = http.request("POST", "/sync/push", { ops: [] })
  const caught = expect(pending).rejects.toBeInstanceOf(NetworkError)
  await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
  await caught
  expect(signal?.aborted).toBe(true)
})

test("a response whose body stalls also times out", async () => {
  const fetchImpl: Fetch = async () =>
    ({ ok: true, status: 200, text: never }) as unknown as Response
  const http = createHttp(tokens, fetchImpl)
  const caught = expect(
    http.request("GET", "/sync/pull?cursor=0"),
  ).rejects.toBeInstanceOf(NetworkError)
  await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
  await caught
})

test("a slow call can ask for more time", async () => {
  let answer: (r: Response) => void = () => {}
  const fetchImpl: Fetch = () =>
    new Promise<Response>((done) => {
      answer = done
    })
  const http = createHttp(tokens, fetchImpl)
  const pending = http.request(
    "POST",
    "/finance/imports/x/commit",
    {},
    {
      timeoutMs: 60_000,
    },
  )
  await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1)
  answer({
    ok: true,
    status: 200,
    text: async () => '{"ok":true}',
  } as unknown as Response)
  await expect(pending).resolves.toEqual({ ok: true })
})

test("the auth client's fetch times out (a refresh can't hold sign-in)", async () => {
  const timedFetch = fetchWithTimeout(never as unknown as typeof fetch)
  const caught = expect(timedFetch("https://auth.test/token")).rejects.toThrow()
  await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
  await caught
})

test("dictation that never answers reports a network failure", async () => {
  const fetchImpl = jest.fn(async (url: string) =>
    url.startsWith("file:")
      ? ({ arrayBuffer: async () => new ArrayBuffer(4) } as Response)
      : never(),
  ) as unknown as typeof fetch
  const caught = expect(
    dictate("file:///rec.m4a", 5, fetchImpl),
  ).rejects.toMatchObject({ code: "network" })
  await jest.advanceTimersByTimeAsync(DICTATE_TIMEOUT_MS)
  await caught
})

test("a reply stream that goes quiet is dropped and the capture queued", async () => {
  configureNotifications(() => {})
  captureStore.set({ ...captureSeed(), captures: [], journal: [] })
  const res = {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        // The server accepted the capture, then went quiet.
        read: never,
        cancel: async () => {},
      }),
    },
  } as unknown as Response
  const live = createLiveCapture({
    http: {
      request: async () => ({ spend_minor: 0, calls: 0 }) as never,
      raw: async () => {
        throw new Error("unused")
      },
    },
    post: async () => res,
    fetch: async () => {
      throw new Error("unused")
    },
    online: () => true,
    kick: () => {},
    cats: categoryIds("8a1f6a52-2c36-4b8f-9d34-3b1f5f0f2a11"),
  })
  const id = live.backend.send({ source: "text", text: "coffee 165" })
  await jest.advanceTimersByTimeAsync(STREAM_GAP_MS + 1)
  expect(captureStore.get().captures.find((c) => c.id === id)?.status).toBe(
    "queued",
  )
})

test("a network without internet is offline; an unchecked one is not", () => {
  noteServerContact(0) // never heard from the server
  expect(reachable({ isConnected: true, isInternetReachable: false })).toBe(
    false,
  )
  expect(reachable({ isConnected: false, isInternetReachable: null })).toBe(
    false,
  )
  expect(reachable({ isConnected: true, isInternetReachable: null })).toBe(true)
  expect(reachable({ isConnected: true, isInternetReachable: true })).toBe(true)
})

test("a failed probe right after the server answered is not offline", () => {
  const now = 1_000_000
  noteServerContact(now)
  const noProbe = { isConnected: true, isInternetReachable: false }
  // A reply streaming in proves the link works, whatever the probe says.
  expect(reachable(noProbe, now + CONTACT_GRACE_MS - 1)).toBe(true)
  // Once the grace runs out, the probe decides.
  expect(reachable(noProbe, now + CONTACT_GRACE_MS)).toBe(false)
  // No network at all is offline, however recent the last answer.
  expect(reachable({ isConnected: false }, now + 1)).toBe(false)
  noteServerContact(0)
})
