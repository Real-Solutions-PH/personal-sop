import { describe, expect, test } from "bun:test"
import {
  mergeFields,
  missingRequired,
  parseDotenv,
} from "../scripts/third-party-secrets"

describe("third-party secrets from .env", () => {
  test("parses plain, quoted and exported values; ignores comments", () => {
    const env = parseDotenv(
      [
        "# comment",
        'NEBIUS_API_KEY="n-1"',
        "export DEEPGRAM_API_KEY='d-2'",
        "BRAVE_API_KEY=b=3",
        "",
      ].join("\n"),
    )
    expect(env).toEqual({
      NEBIUS_API_KEY: "n-1",
      DEEPGRAM_API_KEY: "d-2",
      BRAVE_API_KEY: "b=3",
    })
  })

  test("the file wins; an empty file value keeps the current one", () => {
    const next = mergeFields(
      { nebius_api_key: "old", sentry_dsn: "https://dsn" },
      { NEBIUS_API_KEY: "new", SENTRY_DSN: "" },
    )
    expect(next.nebius_api_key).toBe("new")
    expect(next.sentry_dsn).toBe("https://dsn")
    expect(next.openrouter_api_key).toBe("")
  })

  test("refuses to write without the Nebius key", () => {
    expect(missingRequired(mergeFields({}, {}))).toEqual(["nebius_api_key"])
    expect(missingRequired(mergeFields({}, { NEBIUS_API_KEY: "k" }))).toEqual(
      [],
    )
  })
})
