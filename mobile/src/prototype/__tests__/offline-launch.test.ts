// Offline cold start in live mode: the persisted session says signed in and
// the device already syncs an account, but GoTrue cannot refresh the token
// without a network. Sync must start for that account (so edits queue) and
// the person must not be sent to Welcome.
jest.mock("@/live/config", () => ({
  liveMode: true,
  API_URL: "http://api.test",
  API_PREFIX: "/api/v1",
}))
const mockGetSession = jest.fn()
jest.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ auth: { getSession: mockGetSession } }),
}))
const mockStartLive = jest.fn()
jest.mock("@/live/runtime", () => ({
  startLive: (...a: unknown[]) => mockStartLive(...a),
  stopLive: () => {},
  engine: () => null,
}))
const mockKeys = new Map<string, string>()
jest.mock("../storage", () => ({
  prototypeStorage: () => ({
    getItem: (k: string) => mockKeys.get(k) ?? null,
    setItem: (k: string, v: string) => void mockKeys.set(k, v),
    removeItem: (k: string) => void mockKeys.delete(k),
  }),
}))

const { sessionStore, startLiveSession } =
  require("../session") as typeof import("../session")

const offline = {
  data: { session: null },
  error: { name: "AuthRetryableFetchError", message: "Network request failed" },
}

beforeEach(() => {
  mockKeys.clear()
  mockStartLive.mockReset()
  mockGetSession.mockReset()
})

test("starts sync for the device's account when the refresh fails offline", async () => {
  mockKeys.set("sop-live:owner", "u1")
  sessionStore.set((s) => ({ ...s, signedIn: true }))
  mockGetSession.mockResolvedValueOnce(offline)
  await expect(startLiveSession()).resolves.toBe("u1")
  expect(mockStartLive).toHaveBeenCalledWith("u1", expect.anything())
})

test("a person who was signed out is not signed back in offline", async () => {
  mockKeys.set("sop-live:owner", "u1")
  sessionStore.set((s) => ({ ...s, signedIn: false }))
  mockGetSession.mockResolvedValueOnce(offline)
  await expect(startLiveSession()).resolves.toBeNull()
  expect(mockStartLive).not.toHaveBeenCalled()
})
