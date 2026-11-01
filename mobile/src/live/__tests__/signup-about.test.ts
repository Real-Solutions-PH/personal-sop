// The live sign-up call carries onboarding's "about you" answers, leaving
// out the ones not given.
const mockRequest = jest.fn()
jest.mock("@/lib/supabase", () => ({ getSupabase: () => ({}) }))
jest.mock("../http", () => {
  const actual = jest.requireActual("../http")
  return {
    ...actual,
    createHttp: () => ({ request: mockRequest, raw: jest.fn() }),
  }
})

const auth = require("../auth") as typeof import("../auth")

beforeEach(() => mockRequest.mockReset().mockResolvedValue({}))

test("completeProfile sends the four about answers", async () => {
  await auth.completeProfile("Kai", "kai.new", {
    occupation: "student",
    occupationDetail: "Nursing",
    referralSource: "friend",
    referralDetail: "Sam",
  })
  expect(mockRequest).toHaveBeenCalledWith(
    "POST",
    "/profile/complete-signup",
    expect.objectContaining({
      name: "Kai",
      handle: "kai.new",
      occupation: "student",
      occupation_detail: "Nursing",
      referral_source: "friend",
      referral_detail: "Sam",
    }),
  )
})

test("completeProfile leaves unanswered questions out", async () => {
  await auth.completeProfile("Kai", "kai.new", { referralSource: "youtube" })
  const body = mockRequest.mock.calls[0][2]
  expect(body).toMatchObject({ referral_source: "youtube" })
  for (const key of ["occupation", "occupation_detail", "referral_detail"])
    expect(body).not.toHaveProperty(key)
  await auth.completeProfile("Kai", "kai.new")
  expect(Object.keys(mockRequest.mock.calls[1][2]).sort()).toEqual([
    "handle",
    "name",
    "timezone",
  ])
})
