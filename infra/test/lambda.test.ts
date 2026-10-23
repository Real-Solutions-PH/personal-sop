import { describe, expect, test } from "bun:test"
import { createPublicKey, verify } from "node:crypto"
import { makeGotrueSecret, sesSmtpPassword } from "../lambda/bootstrap-secrets"
import { DB_SETUP_PY } from "../lib/db-setup"

describe("SES SMTP password", () => {
  test("matches AWS's documented derivation", () => {
    // Expected value computed with the Python script in the SES developer
    // guide ("Obtaining Amazon SES SMTP credentials"), not with this module.
    expect(
      sesSmtpPassword(
        "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        "ap-southeast-1",
      ),
    ).toBe("BPFxvU6FSotUttFTKPPijavrWlByiD8MvThjbo1MuvNt")
  })
})

describe("GoTrue secret", () => {
  const issuer = "https://api.example.org/auth/v1"
  const secret = makeGotrueSecret(issuer, new Date("2026-10-23T00:00:00Z"))
  const [jwk] = JSON.parse(secret.jwt_keys)

  test("signing key is an ES256 private JWK GoTrue can sign with", () => {
    expect(jwk).toMatchObject({
      kty: "EC",
      crv: "P-256",
      alg: "ES256",
      use: "sig",
    })
    expect(jwk.key_ops).toEqual(["sign", "verify"])
    expect(typeof jwk.d).toBe("string")
    expect(typeof jwk.kid).toBe("string")
  })

  for (const [field, role] of [
    ["anon_key", "anon"],
    ["service_role_key", "service_role"],
  ] as const) {
    test(`${field} is an ES256 JWT for role ${role}, verifiable with the public key`, () => {
      const [h, p, s] = secret[field].split(".")
      const header = JSON.parse(Buffer.from(h, "base64url").toString())
      const payload = JSON.parse(Buffer.from(p, "base64url").toString())
      expect(header).toEqual({ alg: "ES256", typ: "JWT", kid: jwk.kid })
      expect(payload.role).toBe(role)
      expect(payload.iss).toBe(issuer)
      expect(payload.exp - payload.iat).toBeGreaterThan(9 * 365 * 24 * 3600)
      const { d: _d, ...publicJwk } = jwk
      const ok = verify(
        "sha256",
        Buffer.from(`${h}.${p}`),
        {
          key: createPublicKey({ key: publicJwk, format: "jwk" }),
          dsaEncoding: "ieee-p1363",
        },
        Buffer.from(s, "base64url"),
      )
      expect(ok).toBe(true)
    })
  }

  test("each run generates a fresh key", () => {
    expect(JSON.parse(makeGotrueSecret(issuer).jwt_keys)[0].d).not.toBe(jwk.d)
  })
})

describe("database setup script (runs in the GoTrue task)", () => {
  test("is valid Python", () => {
    const r = Bun.spawnSync(
      [
        "python3",
        "-c",
        "import sys; compile(sys.stdin.read(), 'db_setup', 'exec')",
      ],
      { stdin: new TextEncoder().encode(DB_SETUP_PY) },
    )
    expect(r.stderr.toString()).toBe("")
    expect(r.exitCode).toBe(0)
  })

  test("passes passwords as SQL literals, never formatted into the text", () => {
    expect(DB_SETUP_PY).toContain('sql.Literal(env["AUTH_PASSWORD"])')
    expect(DB_SETUP_PY).toContain('sql.Literal(env["APP_USER_PASSWORD"])')
    expect(DB_SETUP_PY).not.toMatch(/f["'].*PASSWORD/)
  })

  test("serialises concurrent task starts with an advisory lock", () => {
    expect(DB_SETUP_PY).toContain("pg_advisory_lock(")
    expect(DB_SETUP_PY).toContain("pg_advisory_unlock(")
  })

  test("creates GoTrue's role, database and schema, and gives app_user LOGIN", () => {
    for (const s of [
      '"supabase_auth_admin", "NOINHERIT CREATEROLE LOGIN"',
      "ALTER ROLE supabase_auth_admin SET search_path = auth",
      "CREATE DATABASE auth OWNER supabase_auth_admin",
      "CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin",
      "ALTER ROLE app_user LOGIN PASSWORD",
    ]) {
      expect(DB_SETUP_PY).toContain(s)
    }
  })
})
