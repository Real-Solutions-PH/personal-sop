// A refresh the auth server refuses (session revoked, refresh token spent)
// reports the session as lost; a network failure does not.
const mockRefresh = jest.fn()
jest.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ auth: { refreshSession: mockRefresh } }),
}))

const auth = require("../auth") as typeof import("../auth")
const lost = jest.fn()

beforeEach(() => {
  mockRefresh.mockReset()
  lost.mockReset()
  auth.onSessionLost(lost)
})
afterAll(() => auth.onSessionLost(null))

test("a refresh rejected by the auth server reports the session lost", async () => {
  mockRefresh.mockResolvedValueOnce({
    data: { session: null },
    error: { name: "AuthApiError", message: "Invalid Refresh Token" },
  })
  await expect(auth.tokens.refresh()).resolves.toBeNull()
  expect(lost).toHaveBeenCalledTimes(1)
})

test("no stored session at all also reports it lost", async () => {
  mockRefresh.mockResolvedValueOnce({
    data: { session: null },
    error: {
      name: "AuthSessionMissingError",
      message: "Auth session missing!",
    },
  })
  await auth.tokens.refresh()
  expect(lost).toHaveBeenCalledTimes(1)
})

test("a network failure is retried later, not treated as signed out", async () => {
  mockRefresh.mockResolvedValueOnce({
    data: { session: null },
    error: {
      name: "AuthRetryableFetchError",
      message: "Network request failed",
    },
  })
  await expect(auth.tokens.refresh()).resolves.toBeNull()
  expect(lost).not.toHaveBeenCalled()
})

test("a successful refresh returns the new token", async () => {
  mockRefresh.mockResolvedValueOnce({
    data: { session: { access_token: "t2" } },
    error: null,
  })
  await expect(auth.tokens.refresh()).resolves.toBe("t2")
  expect(lost).not.toHaveBeenCalled()
})
