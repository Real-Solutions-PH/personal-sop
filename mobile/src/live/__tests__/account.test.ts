// Live account settings: every sensitive change signs in again with the
// current password first, and deleting the account calls the server.
import { ApiError, NetworkError } from "../http"

const mockRequest = jest.fn()
const mockSignIn = jest.fn()
const mockUpdateUser = jest.fn()
const mockSignOut = jest.fn()
jest.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { user: { email: "me@example.test" } } },
        }),
      signInWithPassword: (...a: unknown[]) => mockSignIn(...a),
      updateUser: (...a: unknown[]) => mockUpdateUser(...a),
      signOut: (...a: unknown[]) => mockSignOut(...a),
    },
  }),
}))
jest.mock("../http", () => {
  const actual = jest.requireActual("../http")
  return {
    ...actual,
    createHttp: () => ({ request: mockRequest, raw: jest.fn() }),
  }
})

const auth = require("../auth") as typeof import("../auth")
const wrongPassword = {
  error: { code: "invalid_credentials", message: "Invalid login" },
}

beforeEach(() => {
  for (const m of [mockRequest, mockSignIn, mockUpdateUser, mockSignOut])
    m.mockReset()
  mockSignIn.mockResolvedValue({ error: null })
  mockUpdateUser.mockResolvedValue({ error: null })
  mockSignOut.mockResolvedValue({ error: null })
})

test("changePassword checks the current password, then sets the new one", async () => {
  await auth.changePassword("Old-pass1", "New-pass2!")
  expect(mockSignIn).toHaveBeenCalledWith({
    email: "me@example.test",
    password: "Old-pass1",
  })
  expect(mockUpdateUser).toHaveBeenCalledWith({ password: "New-pass2!" })
})

test("a wrong current password changes nothing", async () => {
  mockSignIn.mockResolvedValueOnce(wrongPassword)
  await expect(auth.changePassword("nope", "New-pass2!")).rejects.toMatchObject(
    { message: "That password is incorrect", field: "password" },
  )
  expect(mockUpdateUser).not.toHaveBeenCalled()
})

test("a new password equal to the old one is refused with a clear message", async () => {
  mockUpdateUser.mockResolvedValueOnce({ error: { code: "same_password" } })
  await expect(
    auth.changePassword("Same-pass1", "Same-pass1"),
  ).rejects.toMatchObject({ field: "password" })
})

test("changeEmail asks GoTrue to confirm the new address", async () => {
  await auth.changeEmail("new@example.test")
  expect(mockUpdateUser).toHaveBeenCalledWith({ email: "new@example.test" })
})

test("signOutEverywhere revokes every session", async () => {
  await auth.signOutEverywhere()
  expect(mockSignOut).toHaveBeenCalledWith({ scope: "global" })
})

test("deleteAccount signs in again, deletes on the server, then signs out locally", async () => {
  mockRequest.mockResolvedValueOnce({ message: "User deleted successfully" })
  await auth.deleteAccount("Pass-word1")
  expect(mockSignIn).toHaveBeenCalled()
  expect(mockRequest).toHaveBeenCalledWith("DELETE", "/users/me")
  expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" })
})

test("deleteAccount with a wrong password never reaches the server", async () => {
  mockSignIn.mockResolvedValueOnce(wrongPassword)
  await expect(auth.deleteAccount("nope")).rejects.toMatchObject({
    field: "password",
  })
  expect(mockRequest).not.toHaveBeenCalled()
})

test("deleteAccount explains offline and admin refusals", async () => {
  mockRequest.mockRejectedValueOnce(new NetworkError("offline"))
  await expect(auth.deleteAccount("Pass-word1")).rejects.toThrow(/offline/)
  mockRequest.mockRejectedValueOnce(
    new ApiError(403, "forbidden", "Super users are not allowed"),
  )
  await expect(auth.deleteAccount("Pass-word1")).rejects.toThrow(/admin/)
  mockRequest.mockRejectedValueOnce(new ApiError(502, "bad_gateway", "x"))
  await expect(auth.deleteAccount("Pass-word1")).rejects.toThrow(
    /Nothing was removed/,
  )
  expect(mockSignOut).not.toHaveBeenCalled()
})
