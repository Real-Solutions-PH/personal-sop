import { AxiosError, AxiosHeaders } from "axios"
import { cn, emailPattern, handleError, passwordRules } from "@/lib/utils"

function axiosErrorWithBody(data: unknown, message = "Request failed") {
  const headers = new AxiosHeaders()
  const config = { headers }
  return new AxiosError(message, "ERR_BAD_REQUEST", config, {}, {
    data,
    status: 422,
    statusText: "Unprocessable Entity",
    headers,
    config,
    // minimal AxiosResponse stub for tests (noExplicitAny is off in this repo)
  } as any)
}

describe("handleError", () => {
  it("extracts the first per-field msg from a 422 details envelope", () => {
    const err = axiosErrorWithBody({
      code: "validation_error",
      message: "Validation failed",
      details: [{ msg: "value is not a valid email address" }],
    })
    expect(handleError(err)).toBe("value is not a valid email address")
  })

  it("falls back to the envelope message when details is null", () => {
    const err = axiosErrorWithBody({
      code: "conflict",
      message: "A user with this email already exists",
      details: null,
    })
    expect(handleError(err)).toBe("A user with this email already exists")
  })

  it("falls back to the axios message when the body has no envelope", () => {
    const err = axiosErrorWithBody("<html>bad gateway</html>", "Network Error")
    expect(handleError(err)).toBe("Network Error")
  })

  it("returns .message for plain Errors (AuthError-shaped included)", () => {
    expect(handleError(new Error("Invalid login credentials"))).toBe(
      "Invalid login credentials",
    )
  })

  it("passes strings through and falls back for unknown values", () => {
    expect(handleError("boom")).toBe("boom")
    expect(handleError(undefined)).toBe("An unexpected error occurred")
    expect(handleError({ weird: true })).toBe("An unexpected error occurred")
  })
})

describe("emailPattern", () => {
  it("accepts normal addresses and rejects junk", () => {
    expect(emailPattern.value.test("user@example.com")).toBe(true)
    expect(emailPattern.value.test("User.Name+tag@sub.example.co")).toBe(true)
    expect(emailPattern.value.test("not-an-email")).toBe(false)
    expect(emailPattern.value.test("a@b@c.com")).toBe(false)
  })
})

describe("passwordRules", () => {
  it("always enforces min length 8, required only when asked", () => {
    expect(passwordRules()).toMatchObject({
      minLength: { value: 8 },
      required: "Password is required",
    })
    expect(passwordRules(false)).not.toHaveProperty("required")
  })
})

describe("cn", () => {
  it("merges conflicting tailwind classes, last one wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4")
  })
})
