import { describe, expect, it } from "bun:test"

import { cleanEnv, requireEnv } from "./env"

describe("cleanEnv", () => {
  it("returns a trimmed non-empty value", () => {
    expect(cleanEnv("  https://x  ")).toBe("https://x")
  })

  it("treats undefined, empty, and whitespace-only as absent", () => {
    expect(cleanEnv(undefined)).toBeUndefined()
    expect(cleanEnv("")).toBeUndefined()
    expect(cleanEnv("   ")).toBeUndefined()
  })
})

describe("requireEnv", () => {
  it("returns the value when present", () => {
    expect(requireEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x")).toBe(
      "https://x",
    )
  })

  it("throws naming the variable when missing or blank", () => {
    expect(() => requireEnv("NEXT_PUBLIC_SUPABASE_URL", undefined)).toThrow(
      "NEXT_PUBLIC_SUPABASE_URL",
    )
    expect(() => requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "  ")).toThrow(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    )
  })
})
