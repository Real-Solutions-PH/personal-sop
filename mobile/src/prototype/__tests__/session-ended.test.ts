// When the server stops accepting the session, the app returns to sign-in
// but keeps the edits still queued for upload, unlike a deliberate sign out.
const mockStopLive = jest.fn()
const mockToast = jest.fn()
jest.mock("@/live/runtime", () => ({
  stopLive: mockStopLive,
  engine: () => null,
}))
jest.mock("@domain/capture/toast", () => ({ toast: mockToast }))
const mockKeys = new Map<string, string>()
jest.mock("../storage", () => ({
  prototypeStorage: () => ({
    getItem: (k: string) => mockKeys.get(k) ?? null,
    setItem: (k: string, v: string) => mockKeys.set(k, v),
    removeItem: (k: string) => mockKeys.delete(k),
  }),
}))

const { sessionEnded, sessionStore } =
  require("../session") as typeof import("../session")
const { prototypeStorage } =
  require("../storage") as typeof import("../storage")

beforeEach(() => {
  mockStopLive.mockReset()
  mockToast.mockReset()
})

test("signs out, keeps the remembered email and the queued edits", () => {
  const storage = prototypeStorage()
  storage.setItem("sop-live:outbox", '[{"op_id":"a"}]')
  storage.setItem("sop-live:owner", "u1")
  sessionStore.set((s) => ({
    ...s,
    signedIn: true,
    rememberedEmail: "kai@example.com",
    user: { name: "Kai", username: "kai", email: "kai@example.com" },
  }))

  sessionEnded()

  expect(sessionStore.get()).toMatchObject({
    signedIn: false,
    user: null,
    rememberedEmail: "kai@example.com",
  })
  expect(mockStopLive).toHaveBeenCalledTimes(1)
  expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/sign in/i))
  expect(storage.getItem("sop-live:outbox")).toBe('[{"op_id":"a"}]')
  expect(storage.getItem("sop-live:owner")).toBe("u1")
})

test("does nothing when already signed out (several requests fail at once)", () => {
  sessionStore.set((s) => ({ ...s, signedIn: false }))
  sessionEnded()
  expect(mockStopLive).not.toHaveBeenCalled()
  expect(mockToast).not.toHaveBeenCalled()
})
