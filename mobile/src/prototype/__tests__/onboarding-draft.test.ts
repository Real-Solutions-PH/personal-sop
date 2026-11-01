// Live mode: onboarding's answers are given before the account exists and
// written to it right after it is created; signing in to an existing account
// discards them.
import { dashStore } from "@domain/dash/store"
import { configureStorage } from "@domain/lib/store"

jest.mock("@/live/config", () => ({
  liveMode: true,
  API_URL: "http://api.test",
  API_PREFIX: "/api/v1",
}))
const mockComplete = jest.fn()
const mockSignIn = jest.fn()
jest.mock("@/live/auth", () => ({
  onSessionLost: () => {},
  completeProfile: (...a: unknown[]) => mockComplete(...a),
  signIn: (...a: unknown[]) => mockSignIn(...a),
  currentUserId: () => Promise.resolve("new-user"),
}))
jest.mock("@/live/runtime", () => ({
  startLive: () => {},
  stopLive: () => {},
  engine: () => null,
}))
// Clearing to blank empties what onboarding is about to write, as the real
// one does; the order of the two is what is under test.
const mockBlank = jest.fn(() =>
  require("@domain/dash/store").dashStore.set(
    (s: ReturnType<typeof dashStore.get>) => ({
      ...s,
      goals: [],
      profile: { ...s.profile, identities: [] },
    }),
  ),
)
jest.mock("@/live/blank", () => ({ clearToBlank: () => mockBlank() }))
jest.mock("../storage", () => ({
  prototypeStorage: () => ({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }),
}))

const session = require("../session") as typeof import("../session")
const D = require("../onboarding-draft") as typeof import("../onboarding-draft")

const KAI = { name: "Kai", username: "kai.new", email: "kai@example.test" }

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  jest.clearAllMocks()
  mockComplete.mockResolvedValue(undefined)
  dashStore.set((s) => ({
    ...s,
    goals: [],
    profile: { ...s.profile, identities: [] },
  }))
  session.sessionStore.set((s) => ({
    ...s,
    signedIn: false,
    user: null,
    pending: KAI,
    claim: null,
    returning: false,
  }))
  D.discardDraft()
  // Two identities, fitness off, steady pace, 06:30 / 21:30, about answers.
  D.editDraft({
    identities: ["I show up every day", "I finish what I start"],
    enabled: { ...D.newDraft().enabled, fitness: false },
    pace: "steady",
    targets: {
      habits: 80,
      tasks: 85,
      fitness: 4,
      nutrition: 75,
      focus: 5,
      finance: 20,
      screen: 180,
    },
    pushMorning: "06:30",
    pushEvening: "21:30",
    occupation: "student",
    occupationDetail: " Nursing ",
    referralSource: "tiktok",
    // Typed under "Other" before switching to TikTok, which asks no detail.
    referralDetail: "a poster",
  })
})

test("sign-up writes the draft into the new account after clearing it, then forgets it", async () => {
  await session.completeSignUp()
  expect(mockBlank).toHaveBeenCalledTimes(1)
  const dash = dashStore.get()
  expect(dash.profile.identities.map((i) => i.text)).toEqual([
    "I show up every day",
    "I finish what I start",
  ])
  expect(dash.enabled.fitness).toBe(false)
  expect(dash.enabled.screen).toBe(false)
  expect(dash.push).toMatchObject({ morning: "06:30", evening: "21:30" })
  const starters = dash.goals.filter((g) => g.via === "onboarding")
  expect(Object.fromEntries(starters.map((g) => [g.metric, g.target]))).toEqual(
    {
      "habits:habits.rate": 80,
      "tasks:tasks.onTime": 85,
      "nutrition:protein": 75,
      "focus:goalDays": 5,
      "finance:savings-rate": 20,
    },
  )
  expect(D.getDraft()).toBeNull()
  expect(session.sessionStore.get()).toMatchObject({
    signedIn: true,
    returning: false,
  })
})

test("the about answers go with the sign-up call", async () => {
  await session.completeSignUp()
  expect(mockComplete).toHaveBeenCalledWith("Kai", "kai.new", {
    occupation: "student",
    occupationDetail: "Nursing",
    referralSource: "tiktok",
  })
})

test("a failed sign-up call keeps the draft for the retry", async () => {
  mockComplete.mockRejectedValueOnce(new Error("offline"))
  await expect(session.completeSignUp()).rejects.toThrow()
  expect(D.getDraft()?.identities).toHaveLength(2)
  expect(mockBlank).not.toHaveBeenCalled()
  await session.completeSignUp()
  expect(D.getDraft()).toBeNull()
})

test("Screen time picked in onboarding is on after sign-up, so setup asks", async () => {
  D.editDraft({ enabled: { ...D.getDraft()!.enabled, screen: true } })
  await session.completeSignUp()
  expect(dashStore.get().enabled.screen).toBe(true)
})

test("signing in to an existing account discards the draft and marks it returning", async () => {
  mockSignIn.mockResolvedValueOnce(undefined)
  await session.signIn({
    email: "old@example.test",
    password: "Pass-word1",
    remember: false,
  })
  expect(D.getDraft()).toBeNull()
  expect(session.sessionStore.get()).toMatchObject({
    signedIn: true,
    returning: true,
  })
  expect(dashStore.get().profile.identities.map((i) => i.text)).not.toContain(
    "I finish what I start",
  )
})
