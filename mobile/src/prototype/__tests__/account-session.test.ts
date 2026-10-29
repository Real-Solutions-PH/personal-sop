// Live mode: deleting the account clears this device without pushing the
// outbox (the server copy is already gone), and the export carries the
// person's data but not sign-in state or caches.
import { dashStore } from "@domain/dash/store"
import { configureStorage } from "@domain/lib/store"
import { syncReady } from "@/live/ready"

jest.mock("@/live/config", () => ({
  liveMode: true,
  API_URL: "http://api.test",
  API_PREFIX: "/api/v1",
}))
const mockDelete = jest.fn()
jest.mock("@/live/auth", () => ({
  deleteAccount: (...a: unknown[]) => mockDelete(...a),
  onSessionLost: () => {},
  completeProfile: () => Promise.resolve(),
  currentUserId: () => Promise.resolve("new-user"),
}))
const mockStopLive = jest.fn()
const mockEngine = jest.fn()
const mockStartLive = jest.fn()
jest.mock("@/live/runtime", () => ({
  startLive: (...a: unknown[]) => mockStartLive(...a),
  stopLive: () => mockStopLive(),
  engine: () => mockEngine(),
}))
const mockBlank = jest.fn()
jest.mock("@/live/blank", () => ({ clearToBlank: () => mockBlank() }))
const mockRemove = jest.fn()
jest.mock("../storage", () => ({
  prototypeStorage: () => ({
    getItem: () => null,
    setItem: () => {},
    removeItem: (k: string) => mockRemove(k),
  }),
}))

const session = require("../session") as typeof import("../session")
// Loaded for their stores, so the export has real modules to include.
require("@domain/habits/store")
require("@/prototype/weather")

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  jest.clearAllMocks()
  session.sessionStore.set((s) => ({
    ...s,
    signedIn: true,
    user: { name: "Kai", username: "kai", email: "me@example.test" },
  }))
})

test("deleting the account signs out and clears the device without syncing", async () => {
  mockDelete.mockResolvedValueOnce(undefined)
  await session.deleteAccount("Pass-word1")
  expect(mockDelete).toHaveBeenCalledWith("Pass-word1")
  expect(mockEngine).not.toHaveBeenCalled()
  expect(mockStopLive).toHaveBeenCalled()
  expect(mockRemove).toHaveBeenCalledWith("sop-live:outbox")
  expect(mockBlank).toHaveBeenCalled()
  expect(session.sessionStore.get()).toMatchObject({
    signedIn: false,
    user: null,
  })
})

test("a refused delete keeps the person signed in and the device intact", async () => {
  mockDelete.mockRejectedValueOnce(new Error("That password is incorrect"))
  await expect(session.deleteAccount("nope")).rejects.toThrow("incorrect")
  expect(mockStopLive).not.toHaveBeenCalled()
  expect(mockRemove).not.toHaveBeenCalled()
  expect(session.sessionStore.get().signedIn).toBe(true)
})

test("the export holds the data stores but not sign-in state or caches", () => {
  const out = session.exportData(new Date("2026-10-22T08:00:00Z"))
  expect(out.exportedAt).toBe("2026-10-22T08:00:00.000Z")
  expect(out.account).toEqual({ name: "Kai", email: "me@example.test" })
  expect(Object.keys(out.data)).toContain("habits")
  for (const key of session.EXPORT_EXCLUDE)
    expect(Object.keys(out.data)).not.toContain(key)
  // Both are registered, so their absence is the exclusion working.
  const { snapshotStores } =
    require("@domain/lib/store") as typeof import("@domain/lib/store")
  expect(Object.keys(snapshotStores())).toEqual(
    expect.arrayContaining(["weather", "auth-session"]),
  )
  expect(JSON.stringify(out)).not.toContain("auth-session")
})

test("a new account is signed in with blank stores, known not to be onboarded", async () => {
  // The demo seed is onboarded; a brand-new account must never be shown it,
  // or the first-run gate waits for a sync it does not need.
  dashStore.set((s) => ({ ...s, onboarded: true }))
  syncReady.setState({ ready: false })
  session.sessionStore.set((s) => ({
    ...s,
    signedIn: false,
    user: null,
    pending: { name: "Kai", username: "kai", email: "me@example.test" },
  }))
  let atSignIn: { blanked: boolean; ready: boolean } | null = null
  const stop = session.sessionStore.subscribe(() => {
    if (session.sessionStore.get().signedIn && !atSignIn)
      atSignIn = {
        blanked: mockBlank.mock.calls.length > 0,
        ready: syncReady.getState().ready,
      }
  })
  await session.completeSignUp()
  stop()
  expect(atSignIn).toEqual({ blanked: true, ready: true })
  expect(dashStore.get().profile.name).toBe("Kai")
  // ...and sync starts knowing it, instead of waiting for the first pull.
  await new Promise((r) => setTimeout(r, 0))
  expect(mockStartLive).toHaveBeenCalledWith(
    "new-user",
    expect.anything(),
    true,
  )
})

test("the new-password rules", () => {
  expect(session.newPasswordErrors("", "short", "x")).toEqual({
    current: "Enter your current password",
    next: "Use 8+ characters with letters, a number or a symbol",
    confirm: "Passwords don't match",
  })
  expect(
    session.newPasswordErrors("Same-pass1", "Same-pass1", "Same-pass1"),
  ).toEqual({ next: "Choose a password different from your current one" })
  expect(
    session.newPasswordErrors("Old-pass1", "New-pass2!", "New-pass2!"),
  ).toEqual({})
})
