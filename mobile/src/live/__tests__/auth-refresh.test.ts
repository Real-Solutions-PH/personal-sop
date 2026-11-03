// An expired access token must never surface as a failure the app can fix
// itself: a 401 refreshes the session once (one refresh shared by every
// request that came back 401 together) and replays the request, streams
// included; and a refresh attempt that hangs gives up fast enough for the
// auth client's own retries to still run.
import {
  ApiError,
  AUTH_TIMEOUT_MS,
  createHttp,
  type Fetch,
  REQUEST_TIMEOUT_MS,
  type TokenSource,
  withFreshToken,
} from "../http"

const res = (status: number, body: unknown = {}) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

/** A session whose access token expired: the server refuses "old" and
 * accepts what a refresh returns. */
function expiredSession(fresh: string | null = "new") {
  let refreshes = 0
  let release: () => void = () => {}
  const gate = new Promise<void>((done) => {
    release = done
  })
  const tokens: TokenSource = {
    current: async () => "old",
    refresh: async () => {
      refreshes++
      await gate
      return fresh
    },
  }
  const seen: (string | null)[] = []
  const fetchImpl: Fetch = async (_url, init) => {
    const auth = new Headers(init.headers).get("Authorization")
    seen.push(auth)
    return auth === "Bearer new" ? res(200, { ok: true }) : res(401)
  }
  return {
    tokens,
    fetchImpl,
    seen,
    release,
    refreshes: () => refreshes,
  }
}

test("an expired token refreshes and the request is replayed", async () => {
  const s = expiredSession()
  s.release()
  const http = createHttp(s.tokens, s.fetchImpl)
  await expect(
    http.request("GET", "/nutrition/foods?limit=100"),
  ).resolves.toEqual({
    ok: true,
  })
  expect(s.seen).toEqual(["Bearer old", "Bearer new"])
  expect(s.refreshes()).toBe(1)
})

test("requests that all come back 401 together share one refresh", async () => {
  const s = expiredSession()
  const http = createHttp(s.tokens, s.fetchImpl)
  const burst = [
    http.request("GET", "/sync/pull?cursor=0"),
    http.request("POST", "/sync/push", { ops: [] }),
    http.request("GET", "/nutrition/foods?limit=100"),
    http.request("GET", "/dashboard/today"),
  ]
  await new Promise((r) => setImmediate(r))
  s.release()
  await expect(Promise.all(burst)).resolves.toHaveLength(4)
  expect(s.refreshes()).toBe(1)
  // A later expiry refreshes again: the shared refresh is not kept.
  await http.request("GET", "/dashboard/today")
  expect(s.refreshes()).toBe(2)
})

test("a 401 the refresh cannot fix is reported once, not retried in a loop", async () => {
  const s = expiredSession(null)
  s.release()
  const http = createHttp(s.tokens, s.fetchImpl)
  await expect(http.request("GET", "/dashboard/today")).rejects.toMatchObject({
    status: 401,
  })
  await expect(http.request("GET", "/dashboard/today")).rejects.toBeInstanceOf(
    ApiError,
  )
  expect(s.seen).toEqual(["Bearer old", "Bearer old"])
})

test("a streamed ask with an expired token refreshes and opens with the new one", async () => {
  const s = expiredSession()
  s.release()
  const sent: (string | null)[] = []
  const opened = await withFreshToken(s.tokens, async (token) => {
    sent.push(token)
    return token === "new" ? res(200) : res(401)
  })
  expect(opened.status).toBe(200)
  expect(sent).toEqual(["old", "new"])
})

test("the auth client's refresh attempts time out at the auth timeout", async () => {
  jest.useFakeTimers()
  const realFetch = global.fetch
  try {
    global.fetch = (() => new Promise(() => {})) as unknown as typeof fetch
    process.env.EXPO_PUBLIC_SUPABASE_URL = "https://auth.test"
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "anon"
    let options: { global?: { fetch?: typeof fetch } } = {}
    jest.isolateModules(() => {
      jest.doMock("@supabase/supabase-js", () => ({
        createClient: (_url: string, _key: string, o: typeof options) => {
          options = o
          return { auth: { startAutoRefresh: () => {} } }
        },
      }))
      jest.doMock("@/lib/storage", () => ({}))
      ;(
        require("@/lib/supabase") as typeof import("@/lib/supabase")
      ).getSupabase()
    })
    let failed = false
    options.global?.fetch?.("https://auth.test/token").catch(() => {
      failed = true
    })
    await jest.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS - 1)
    expect(failed).toBe(false)
    await jest.advanceTimersByTimeAsync(1)
    expect(failed).toBe(true)
    // GoTrue retries a refresh that failed on the network only while the
    // next try starts within 30 s: at least three tries now fit (two did
    // at the request timeout, and a hung one took the whole budget).
    expect(3 * AUTH_TIMEOUT_MS + 600).toBeLessThan(30_000)
    expect(2 * REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000)
  } finally {
    global.fetch = realFetch
    jest.useRealTimers()
  }
})
