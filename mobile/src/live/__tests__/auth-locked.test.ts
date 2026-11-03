// A lock-screen tap starts the app in the background on a locked phone.
// If the session's key cannot be read there, the session is unknown: the
// account this device was syncing is kept and the session is never ended
// (ending it signed the person out and cleared the Live Activity).
let mockReadable = true
const mockGetSession = jest.fn()
const mockRefreshSession = jest.fn()
jest.mock("@/lib/storage", () => ({
  sessionStoreReadable: async () => mockReadable,
}))
jest.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    auth: { getSession: mockGetSession, refreshSession: mockRefreshSession },
  }),
}))

const { currentUserId, onSessionLost, tokens } =
  require("../auth") as typeof import("../auth")

const failedRead = {
  data: { session: null },
  error: { name: "AuthUnknownError" },
}
beforeEach(() => {
  mockReadable = true
  jest.clearAllMocks()
})

test("locked: the account this device was syncing is kept", async () => {
  mockReadable = false
  mockGetSession.mockResolvedValue(failedRead)
  await expect(currentUserId("u1")).resolves.toBe("u1")
  expect(mockGetSession).not.toHaveBeenCalled()
})

test("unlocked with no session: signed out as before", async () => {
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
  await expect(currentUserId("u1")).resolves.toBeNull()
})

test("locked: a refresh that fails does not end the session", async () => {
  mockReadable = false
  mockRefreshSession.mockResolvedValue(failedRead)
  const lost = jest.fn()
  onSessionLost(lost)
  await expect(tokens.refresh()).resolves.toBeNull()
  expect(lost).not.toHaveBeenCalled()
})

test("unlocked: a refused refresh still ends the session", async () => {
  mockRefreshSession.mockResolvedValue({
    data: { session: null },
    error: { name: "AuthApiError" },
  })
  const lost = jest.fn()
  onSessionLost(lost)
  await tokens.refresh()
  expect(lost).toHaveBeenCalledTimes(1)
  onSessionLost(null)
})
