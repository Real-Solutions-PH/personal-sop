// The live sign-up calls: the public handle check and the handle claim.
import { ApiError, NetworkError } from "../http"

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

beforeEach(() => mockRequest.mockReset())

test("checkHandle calls the public endpoint with the handle encoded", async () => {
  mockRequest.mockResolvedValueOnce({ status: "taken" })
  await expect(auth.checkHandle("a.b_c")).resolves.toBe("taken")
  expect(mockRequest).toHaveBeenCalledWith(
    "GET",
    "/profile/signup/handle-available?handle=a.b_c",
  )
  mockRequest.mockResolvedValueOnce({ status: "available" })
  await auth.checkHandle("x&y")
  expect(mockRequest).toHaveBeenLastCalledWith(
    "GET",
    "/profile/signup/handle-available?handle=x%26y",
  )
})

test("checkHandle never reads a failure as available", async () => {
  for (const failure of [
    new NetworkError("offline"),
    new ApiError(429, "too_many_requests", "Too many requests"),
    new ApiError(500, "internal_error", "boom"),
  ]) {
    mockRequest.mockRejectedValueOnce(failure)
    await expect(auth.checkHandle("some.name")).resolves.toBe("unknown")
  }
  // "invalid" (or anything unexpected) is not a verdict the screen shows.
  mockRequest.mockResolvedValueOnce({ status: "invalid" })
  await expect(auth.checkHandle("some.name")).resolves.toBe("unknown")
})

test("completeProfile maps handle_taken to a username error", async () => {
  mockRequest.mockRejectedValueOnce(
    new ApiError(409, "handle_taken", "That username is taken"),
  )
  const e = await auth.completeProfile("N", "dup.name").catch((x) => x)
  expect(e).toBeInstanceOf(auth.LiveAuthError)
  expect(e.field).toBe("username")
  expect(e.message).toBe("@dup.name is already taken")
})

test("completeProfile turns any other failure into a retryable message", async () => {
  mockRequest.mockRejectedValueOnce(
    new NetworkError("TypeError: Failed to fetch"),
  )
  const e = await auth.completeProfile("N", "ok.name").catch((x) => x)
  expect(e).toBeInstanceOf(auth.LiveAuthError)
  expect(e.field).toBeUndefined()
  expect(e.message).toMatch(/Could not finish setting up your account/)
  expect(e.message).not.toMatch(/fetch/)
})
