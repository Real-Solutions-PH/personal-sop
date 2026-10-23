/**
 * Custom resource: fills the generated secrets the first time the stack is
 * created, so no key material is ever typed by hand or passes through the
 * CloudFormation template.
 *
 * On Create it writes:
 * - the GoTrue secret: an ES256 signing key (JWK array for GOTRUE_JWT_KEYS),
 *   an HS256 fallback secret GoTrue still requires, and the long-lived
 *   `anon` and `service_role` JWTs signed with the ES256 key;
 * - the SMTP secret: an access key for the SES-only IAM user, converted to
 *   an SES SMTP password;
 * - the app secret's AI_CREDENTIALS_KEK (32 random bytes, base64).
 *
 * Update is a no-op (rotating keys is a runbook step, never a side effect of
 * a deploy). Delete removes the SES user's access keys so the IAM user can
 * be deleted.
 */
import {
  createHmac,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto"
import {
  CreateAccessKeyCommand,
  DeleteAccessKeyCommand,
  IAMClient,
  ListAccessKeysCommand,
} from "@aws-sdk/client-iam"
import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager"

interface Props {
  GotrueSecretArn: string
  SmtpSecretArn: string
  AppSecretArn: string
  SmtpUserName: string
  Issuer: string
  Region: string
}

interface CfnEvent {
  RequestType: "Create" | "Update" | "Delete"
  PhysicalResourceId?: string
  ResourceProperties: Props
}

const sm = new SecretsManagerClient({})
const iam = new IAMClient({})

const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf).toString("base64url")

/** ES256 JWT: raw r||s signature, as JWS requires (not DER). */
export function signJwt(
  privateKey: import("node:crypto").KeyObject,
  kid: string,
  payload: Record<string, unknown>,
): string {
  const header = b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid }))
  const body = b64url(JSON.stringify(payload))
  const signature = sign("sha256", Buffer.from(`${header}.${body}`), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  })
  return `${header}.${body}.${b64url(signature)}`
}

export function makeGotrueSecret(issuer: string, now = new Date()) {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
  const kid = randomUUID()
  const jwk = privateKey.export({ format: "jwk" })
  const signingKey = {
    ...jwk,
    kid,
    alg: "ES256",
    use: "sig",
    key_ops: ["sign", "verify"],
  }
  const iat = Math.floor(now.getTime() / 1000)
  // Ten years, like Supabase's own project keys; revoked by rotating the key.
  const exp = iat + 10 * 365 * 24 * 3600
  const base = { iss: issuer, iat, exp }
  return {
    jwt_keys: JSON.stringify([signingKey]),
    jwt_secret: randomBytes(48).toString("base64url"),
    anon_key: signJwt(privateKey, kid, { ...base, role: "anon" }),
    service_role_key: signJwt(privateKey, kid, {
      ...base,
      role: "service_role",
    }),
  }
}

/**
 * SES SMTP password from an IAM secret access key (AWS's documented
 * algorithm, version 4).
 */
export function sesSmtpPassword(secretAccessKey: string, region: string) {
  const hmac = (key: Buffer, msg: string) =>
    createHmac("sha256", key).update(msg, "utf8").digest()
  let sig = hmac(Buffer.from(`AWS4${secretAccessKey}`, "utf8"), "11111111")
  for (const part of [region, "ses", "aws4_request", "SendRawEmail"]) {
    sig = hmac(sig, part)
  }
  return Buffer.concat([Buffer.from([0x04]), sig]).toString("base64")
}

async function mergeSecret(arn: string, values: Record<string, string>) {
  const current = await sm.send(new GetSecretValueCommand({ SecretId: arn }))
  const merged = { ...JSON.parse(current.SecretString ?? "{}"), ...values }
  await sm.send(
    new PutSecretValueCommand({
      SecretId: arn,
      SecretString: JSON.stringify(merged),
    }),
  )
}

async function deleteAccessKeys(userName: string) {
  const keys = await iam.send(new ListAccessKeysCommand({ UserName: userName }))
  for (const k of keys.AccessKeyMetadata ?? []) {
    await iam.send(
      new DeleteAccessKeyCommand({
        UserName: userName,
        AccessKeyId: k.AccessKeyId,
      }),
    )
  }
}

export async function handler(event: CfnEvent) {
  const p = event.ResourceProperties
  const physicalId = event.PhysicalResourceId ?? "unfurl-bootstrap-secrets"

  if (event.RequestType === "Delete") {
    await deleteAccessKeys(p.SmtpUserName)
    return { PhysicalResourceId: physicalId }
  }
  if (event.RequestType === "Update") {
    return { PhysicalResourceId: physicalId }
  }

  await mergeSecret(p.GotrueSecretArn, makeGotrueSecret(p.Issuer))

  await deleteAccessKeys(p.SmtpUserName)
  const key = await iam.send(
    new CreateAccessKeyCommand({ UserName: p.SmtpUserName }),
  )
  const accessKey = key.AccessKey
  if (!accessKey?.AccessKeyId || !accessKey.SecretAccessKey) {
    throw new Error("IAM returned no access key for the SES SMTP user")
  }
  await mergeSecret(p.SmtpSecretArn, {
    username: accessKey.AccessKeyId,
    password: sesSmtpPassword(accessKey.SecretAccessKey, p.Region),
  })

  await mergeSecret(p.AppSecretArn, {
    ai_credentials_kek: randomBytes(32).toString("base64"),
  })

  return { PhysicalResourceId: physicalId }
}
