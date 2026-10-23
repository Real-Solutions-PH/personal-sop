#!/usr/bin/env bun
/**
 * Creates or updates `unfurl/third-party` in Secrets Manager from a dotenv
 * file: the Nebius, Deepgram, OpenRouter and Brave keys, the Expo access
 * token and the Sentry DSN. The stack reads this secret by name; it is an
 * input the stack cannot make, so it must exist before `cdk deploy` (the
 * API refuses to start with AI on and no Nebius key).
 *
 * Usage (from infra/):
 *   AWS_PROFILE=unfurl bun run secrets ../.env            # plan only
 *   AWS_PROFILE=unfurl bun run secrets ../.env --apply    # write
 *
 * Values are never printed: only each field's name and whether it is set.
 * A field the file leaves empty keeps its current value in the secret.
 */
import { readFileSync } from "node:fs"
import {
  CreateSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager"
import {
  THIRD_PARTY_FIELDS,
  THIRD_PARTY_REQUIRED,
  THIRD_PARTY_SECRET,
} from "../lib/config"

/** dotenv lines → values, for the variables this secret holds. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#") || !line.includes("=")) continue
    const i = line.indexOf("=")
    const key = line
      .slice(0, i)
      .trim()
      .replace(/^export\s+/, "")
    let value = line.slice(i + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/** The secret's next value: the file's values over the current ones. */
export function mergeFields(
  current: Record<string, string>,
  env: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [field, variable] of Object.entries(THIRD_PARTY_FIELDS)) {
    next[field] = env[variable] || current[field] || ""
  }
  return next
}

export function missingRequired(fields: Record<string, string>): string[] {
  return THIRD_PARTY_REQUIRED.filter((f) => !fields[f])
}

async function main() {
  const file = process.argv[2]
  const apply = process.argv.includes("--apply")
  if (!file || file.startsWith("--")) {
    throw new Error("usage: bun run secrets <path to .env> [--apply]")
  }
  const env = parseDotenv(readFileSync(file, "utf8"))
  const sm = new SecretsManagerClient({ region: "ap-southeast-1" })
  let current: Record<string, string> = {}
  let exists = true
  try {
    const v = await sm.send(
      new GetSecretValueCommand({ SecretId: THIRD_PARTY_SECRET }),
    )
    current = JSON.parse(v.SecretString ?? "{}")
  } catch (e) {
    if (!(e instanceof ResourceNotFoundException)) throw e
    exists = false
  }
  const next = mergeFields(current, env)
  for (const field of Object.keys(THIRD_PARTY_FIELDS)) {
    const changed = (current[field] ?? "") !== next[field]
    console.log(
      `${field.padEnd(20)} ${next[field] ? "set" : "empty"}${changed ? " (changes)" : ""}`,
    )
  }
  const missing = missingRequired(next)
  if (missing.length) {
    throw new Error(
      `refusing: ${missing.join(", ")} empty; the API cannot start with AI on without it`,
    )
  }
  const unchanged = exists && JSON.stringify(current) === JSON.stringify(next)
  if (unchanged) return console.log(`keep    ${THIRD_PARTY_SECRET}`)
  console.log(`${exists ? "update" : "create"}  ${THIRD_PARTY_SECRET}`)
  if (!apply) return console.log("Plan only (pass --apply to write).")
  const SecretString = JSON.stringify(next)
  if (exists) {
    await sm.send(
      new PutSecretValueCommand({ SecretId: THIRD_PARTY_SECRET, SecretString }),
    )
  } else {
    await sm.send(
      new CreateSecretCommand({
        Name: THIRD_PARTY_SECRET,
        Description:
          "Third-party API keys for the backend (managed by infra/scripts/third-party-secrets.ts)",
        SecretString,
        Tags: [
          { Key: "project", Value: "unfurl" },
          { Key: "managed-by", Value: "infra/scripts/third-party-secrets.ts" },
        ],
      }),
    )
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
