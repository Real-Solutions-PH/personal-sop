import { describe, expect, test } from "bun:test"
import { createPublicKey, verify } from "node:crypto"
import { makeGotrueSecret, sesSmtpPassword } from "../lambda/bootstrap-secrets"
import { appStatements, authRoleStatements } from "../lambda/db-setup"

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

describe("database setup SQL", () => {
  const lit = (s: string) => `'${s.replaceAll("'", "''")}'`

  test("app_user gets LOGIN with the secret's password, idempotently", () => {
    const sql = appStatements(lit, "pw").join("\n")
    expect(sql).toContain(
      "IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user')",
    )
    expect(sql).toContain("ALTER ROLE app_user LOGIN PASSWORD 'pw'")
  })

  test("supabase_auth_admin is created once and searches the auth schema", () => {
    const sql = authRoleStatements(lit, "x'y").join("\n")
    expect(sql).toContain(
      "CREATE ROLE supabase_auth_admin NOINHERIT CREATEROLE LOGIN",
    )
    expect(sql).toContain("PASSWORD 'x''y'")
    expect(sql).toContain("SET search_path = auth")
  })
})
