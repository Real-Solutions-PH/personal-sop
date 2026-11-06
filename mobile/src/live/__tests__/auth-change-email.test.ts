// Changing the account email asks GoTrue to mail a confirmation link. When
// that mail cannot be sent (production, 2026-11-06: the mail provider
// refused the new address and GoTrue answered 500 "unexpected_failure"),
// the person was told only "Something went wrong".
const mockUpdateUser = jest.fn()
jest.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ auth: { updateUser: mockUpdateUser } }),
}))

const { changeEmail, LiveAuthError } =
  require("../auth") as typeof import("../auth")

beforeEach(() => jest.clearAllMocks())

test("a confirmation mail that cannot be sent says so, on the email field", async () => {
  mockUpdateUser.mockResolvedValue({
    data: { user: null },
    error: {
      name: "AuthApiError",
      status: 500,
      code: "unexpected_failure",
      message: "Error sending email change email",
    },
  })
  const failure = changeEmail("new@example.com")
  await expect(failure).rejects.toBeInstanceOf(LiveAuthError)
  await expect(failure).rejects.toMatchObject({
    field: "email",
    message: expect.stringMatching(/couldn't send .*new@example\.com/i),
  })
  await expect(failure).rejects.not.toMatchObject({
    message: expect.stringMatching(/something went wrong/i),
  })
  await expect(failure).rejects.toMatchObject({
    message: expect.stringMatching(/hasn't changed/i),
  })
})

test("a sent confirmation resolves", async () => {
  mockUpdateUser.mockResolvedValue({
    data: { user: { new_email: "new@example.com" } },
    error: null,
  })
  await expect(changeEmail("new@example.com")).resolves.toBeUndefined()
  expect(mockUpdateUser).toHaveBeenCalledWith({ email: "new@example.com" })
})

test("an address taken by another account is still reported as taken", async () => {
  mockUpdateUser.mockResolvedValue({
    data: { user: null },
    error: { name: "AuthApiError", status: 422, code: "email_exists" },
  })
  await expect(changeEmail("taken@example.com")).rejects.toMatchObject({
    field: "email",
    message: expect.stringMatching(/already exists/i),
  })
})
