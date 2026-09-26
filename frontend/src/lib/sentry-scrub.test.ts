import { describe, expect, it } from "bun:test"
import type { ErrorEvent } from "@sentry/nextjs"
import { AUTH_COOKIE_NAME, scrubSentryEvent } from "./sentry-scrub"

function makeEvent(request: NonNullable<ErrorEvent["request"]>): ErrorEvent {
  return { type: undefined, message: "boom", level: "error", request }
}

describe("scrubSentryEvent", () => {
  it("strips the Authorization header and the auth cookie, keeps the rest", () => {
    const event = makeEvent({
      headers: { Authorization: "Bearer secret", Accept: "application/json" },
      cookies: { "sb-app-auth": "jwt", theme: "dark" },
    })

    const result = scrubSentryEvent(event)

    expect(result.request?.headers).not.toHaveProperty("Authorization")
    expect(result.request?.headers?.Accept).toBe("application/json")
    expect(result.request?.cookies).not.toHaveProperty(AUTH_COOKIE_NAME)
    expect(result.request?.cookies?.theme).toBe("dark")
    expect(result.message).toBe("boom")
    expect(result.level).toBe("error")
  })

  it("is null-safe when request/headers/cookies are absent", () => {
    expect(() =>
      scrubSentryEvent({ type: undefined } as ErrorEvent),
    ).not.toThrow()
    expect(() => scrubSentryEvent(makeEvent({}))).not.toThrow()
  })

  it("removes the Authorization header case-insensitively", () => {
    for (const name of ["Authorization", "authorization", "AUTHORIZATION"]) {
      const event = makeEvent({
        headers: { [name]: "Bearer secret", "X-Trace": "1" },
      })
      const result = scrubSentryEvent(event)
      expect(result.request?.headers).not.toHaveProperty(name)
      expect(result.request?.headers?.["X-Trace"]).toBe("1")
    }
  })

  it("strips only the auth pair from a raw Cookie header", () => {
    const event = makeEvent({
      headers: { Cookie: "a=1; sb-app-auth=jwt; b=2" },
    })
    const result = scrubSentryEvent(event)
    expect(result.request?.headers?.Cookie).toBe("a=1; b=2")
  })

  it("drops the Cookie header when auth was the only pair", () => {
    const event = makeEvent({ headers: { Cookie: "sb-app-auth=jwt" } })
    const result = scrubSentryEvent(event)
    expect(result.request?.headers).not.toHaveProperty("Cookie")
  })

  it("coerces a non-string Cookie value without throwing", () => {
    const event = makeEvent({
      headers: { Cookie: 12345 as unknown as string },
    })
    expect(() => scrubSentryEvent(event)).not.toThrow()
    expect(event.request?.headers?.Cookie).toBe("12345")
  })

  it("removes chunked auth cookies from the parsed cookies map", () => {
    const event = makeEvent({
      cookies: {
        "sb-app-auth.0": "part0",
        "sb-app-auth.1": "part1",
        "sb-app-auth": "base",
        keep: "yes",
      },
    })
    const result = scrubSentryEvent(event)
    expect(result.request?.cookies).toEqual({ keep: "yes" })
  })

  it("removes chunked auth cookies from a raw Cookie header", () => {
    const event = makeEvent({
      headers: { cookie: "a=1; sb-app-auth.0=x; sb-app-auth.1=y; b=2" },
    })
    const result = scrubSentryEvent(event)
    expect(result.request?.headers?.cookie).toBe("a=1; b=2")
  })

  it("is idempotent when re-scrubbing", () => {
    const event = makeEvent({
      headers: {
        Authorization: "Bearer secret",
        Cookie: "sb-app-auth=jwt; a=1",
      },
      cookies: { "sb-app-auth": "jwt", keep: "1" },
    })
    const once = scrubSentryEvent(event)
    const twice = scrubSentryEvent(once)
    expect(twice).toEqual(once)
    expect(twice.request?.headers).not.toHaveProperty("Authorization")
    expect(twice.request?.headers?.Cookie).toBe("a=1")
    expect(twice.request?.cookies).toEqual({ keep: "1" })
  })

  it("preserves breadcrumbs and other non-secret fields", () => {
    const event: ErrorEvent = {
      type: undefined,
      message: "boom",
      level: "warning",
      breadcrumbs: [{ message: "step 1" }, { message: "step 2" }],
      request: {
        headers: { Authorization: "Bearer secret", "User-Agent": "vitest" },
        cookies: { "sb-app-auth": "jwt" },
      },
    }
    const result = scrubSentryEvent(event)
    expect(result.breadcrumbs).toEqual([
      { message: "step 1" },
      { message: "step 2" },
    ])
    expect(result.level).toBe("warning")
    expect(result.request?.headers?.["User-Agent"]).toBe("vitest")
  })
})
