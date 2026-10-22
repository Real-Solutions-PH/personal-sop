// An offline launch with an expired access token: GoTrue's refresh fails on
// the network and getSession() reports no session, although the stored one
// is still valid. The app must stay signed in and start syncing (ops queue
// locally); only a refusal from the auth server signs the person out.
const mockGetSession = jest.fn()
jest.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ auth: { getSession: mockGetSession } }),
}))

const auth = require("../auth") as typeof import("../auth")

const offline = {
  data: { session: null },
  error: { name: "AuthRetryableFetchError", message: "Network request failed" },
}

beforeEach(() => mockGetSession.mockReset())

test("a network-failed refresh keeps the device's account", async () => {
  mockGetSession.mockResolvedValueOnce(offline)
  await expect(auth.currentUserId("u1")).resolves.toBe("u1")
})

test("a live session wins over the fallback", async () => {
  mockGetSession.mockResolvedValueOnce({
    data: { session: { user: { id: "u2" } } },
    error: null,
  })
  await expect(auth.currentUserId("u1")).resolves.toBe("u2")
})

test("a refresh the auth server refuses still signs out", async () => {
  mockGetSession.mockResolvedValueOnce({
    data: { session: null },
    error: { name: "AuthApiError", message: "Invalid Refresh Token" },
  })
  await expect(auth.currentUserId("u1")).resolves.toBeNull()
})

test("no stored session at all is signed out", async () => {
  mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null })
  await expect(auth.currentUserId("u1")).resolves.toBeNull()
})

test("offline with no known account is signed out", async () => {
  mockGetSession.mockResolvedValueOnce(offline)
  await expect(auth.currentUserId(null)).resolves.toBeNull()
})
