#!/usr/bin/env bun
/**
 * Applies Unfurl's Cloudflare side: the tunnel, its token, its ingress, the
 * DNS records and the zone rate-limiting rule.
 *
 * The API host is served by a Cloudflare Tunnel, so nothing in AWS listens
 * on the internet. The stack cannot create Cloudflare objects itself (CDK
 * has no first-class Cloudflare support, and a custom resource would put
 * the Cloudflare token into AWS), so this script does, idempotently:
 *
 * | Object | Value |
 * |---|---|
 * | Tunnel `unfurl` (remotely managed) | created once |
 * | Secret `unfurl/cloudflared-tunnel` in Secrets Manager | `{"token": …}`, read by the stack's cloudflared service |
 * | Tunnel ingress | `<apiHost>` + `^/auth/v1/` → `http://auth.unfurl.internal:8080`; `<apiHost>` → `http://api.unfurl.internal:8000`; else 404 |
 * | `<apiHost>` CNAME | `<tunnel id>.cfargotunnel.com`, proxied |
 * | `<token>._domainkey.<emailDomain>` ×3 | SES Easy DKIM (once the stack has created the identity) |
 * | `mail.<emailDomain>` MX + SPF TXT | SES custom MAIL FROM |
 * | `_dmarc.<emailDomain>` TXT | DMARC policy |
 * | Rate-limiting rule `unfurl_rate_limit` | per visitor IP on the auth and AI paths (the Free plan's one rule) |
 *
 * Run it before `cdk deploy` (the cloudflared service needs the token
 * secret) and after (the SES records need the identity the deploy creates).
 *
 * Usage (from infra/):
 *   CLOUDFLARE_API_TOKEN=... AWS_PROFILE=unfurl bun run cloudflare           # plan only
 *   CLOUDFLARE_API_TOKEN=... AWS_PROFILE=unfurl bun run cloudflare --apply   # write
 *
 * It never deletes anything, only touches DNS names under the API host and
 * the email domain, and never prints the tunnel token.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import {
  CreateSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager"
import { GetEmailIdentityCommand, SESv2Client } from "@aws-sdk/client-sesv2"
import { CLOUDFLARE_LIMITED_PATHS, RATE_LIMITS } from "../lib/cloudflare"
import {
  internalUrl,
  PREFIX,
  TUNNEL_NAME,
  TUNNEL_TOKEN_SECRET,
} from "../lib/config"

export interface DnsRecord {
  type: "CNAME" | "TXT" | "MX"
  name: string
  content: string
  proxied: boolean
  priority?: number
}

export interface Facts {
  /** The tunnel's id, once it exists. */
  tunnelId?: string
  dkimTokens?: string[]
  mailFromDomain?: string
}

const MANAGED = "managed by infra/scripts/cloudflare.ts"

/** The DNS records Cloudflare should hold, given what exists so far. */
export function desiredRecords(
  apiHost: string,
  emailDomain: string,
  region: string,
  facts: Facts,
): DnsRecord[] {
  const out: DnsRecord[] = []
  if (facts.tunnelId) {
    out.push({
      type: "CNAME",
      name: apiHost,
      content: `${facts.tunnelId}.cfargotunnel.com`,
      proxied: true,
    })
  }
  if (emailDomain) {
    for (const t of facts.dkimTokens ?? []) {
      out.push({
        type: "CNAME",
        name: `${t}._domainkey.${emailDomain}`,
        content: `${t}.dkim.amazonses.com`,
        proxied: false,
      })
    }
    if (facts.mailFromDomain) {
      out.push({
        type: "MX",
        name: facts.mailFromDomain,
        content: `feedback-smtp.${region}.amazonses.com`,
        priority: 10,
        proxied: false,
      })
      out.push({
        type: "TXT",
        name: facts.mailFromDomain,
        content: '"v=spf1 include:amazonses.com ~all"',
        proxied: false,
      })
    }
    // Relaxed alignment: mail leaves with MAIL FROM `mail.<emailDomain>` and
    // DKIM `d=<emailDomain>`, both aligned with the From domain.
    out.push({
      type: "TXT",
      name: `_dmarc.${emailDomain}`,
      content: '"v=DMARC1; p=quarantine; adkim=r; aspf=r"',
      proxied: false,
    })
  }
  const under = (name: string, d: string) =>
    !!d && (name === d || name.endsWith(`.${d}`))
  for (const r of out) {
    if (!under(r.name, apiHost) && !under(r.name, emailDomain)) {
      throw new Error(
        `refusing to manage ${r.name}: outside the API host and email domain`,
      )
    }
  }
  return out
}

export interface ExistingRecord extends DnsRecord {
  id: string
}

export type Action =
  | { op: "create"; record: DnsRecord }
  | { op: "update"; id: string; record: DnsRecord; from: ExistingRecord }
  | { op: "keep"; record: DnsRecord }

const same = (a: DnsRecord, b: DnsRecord) =>
  a.content.toLowerCase() === b.content.toLowerCase() &&
  a.proxied === b.proxied &&
  (a.priority ?? null) === (b.priority ?? null)

/**
 * Create what is missing, update a record of the same name and type that
 * differs, keep what matches. TXT at a name is matched by its kind (SPF or
 * DMARC), so an unrelated TXT record there is left alone.
 */
export function plan(
  desired: DnsRecord[],
  existing: ExistingRecord[],
): Action[] {
  const kind = (r: DnsRecord) =>
    r.type === "TXT"
      ? r.content.includes("v=spf1")
        ? "spf"
        : r.content.includes("v=DMARC1")
          ? "dmarc"
          : "txt"
      : r.type
  return desired.map((record) => {
    const current = existing.find(
      (e) =>
        e.name === record.name &&
        e.type === record.type &&
        kind(e) === kind(record),
    )
    if (!current) return { op: "create", record }
    if (same(current, record)) return { op: "keep", record }
    return { op: "update", id: current.id, record, from: current }
  })
}

/** The tunnel's ingress: one hostname, two services by path. */
export function tunnelConfig(apiHost: string) {
  return {
    ingress: [
      { hostname: apiHost, path: "^/auth/v1/", service: internalUrl("auth") },
      { hostname: apiHost, service: internalUrl("api") },
      { service: "http_status:404" },
    ],
    // Idle origin connections are kept 300 s, as the ALB idle timeout was.
    // Server-sent-event streams heartbeat every 25 s, well inside the
    // 100 s Cloudflare allows a proxied response to stay silent.
    originRequest: { connectTimeout: 10, keepAliveTimeout: 300 },
  }
}

type Ingress = { hostname?: string; path?: string; service: string }
type TunnelConfig = ReturnType<typeof tunnelConfig>

/** True when the live config already routes the way `want` does. */
export function sameTunnelConfig(
  live: Partial<TunnelConfig> | undefined,
  want: TunnelConfig,
): boolean {
  const norm = (rules: Ingress[] = []) =>
    JSON.stringify(
      rules.map((r) => [r.hostname ?? "", r.path ?? "", r.service]),
    )
  return (
    norm(live?.ingress) === norm(want.ingress) &&
    live?.originRequest?.keepAliveTimeout ===
      want.originRequest.keepAliveTimeout &&
    live?.originRequest?.connectTimeout === want.originRequest.connectTimeout
  )
}

/** The zone rate-limiting rule (Free plan: one rule, IP, 10 s period). */
export function rateLimitRule() {
  const expression = CLOUDFLARE_LIMITED_PATHS.map(
    (p) => `starts_with(http.request.uri.path, "${p}")`,
  ).join(" or ")
  return {
    ref: `${PREFIX}_rate_limit`,
    description: `Unfurl auth and AI paths, per visitor IP (${MANAGED})`,
    expression: `(${expression})`,
    action: "block",
    ratelimit: {
      characteristics: ["cf.colo.id", "ip.src"],
      period: 10,
      requests_per_period: RATE_LIMITS.cloudflare.requestsPer10Seconds,
      mitigation_timeout: RATE_LIMITS.cloudflare.blockSeconds,
    },
    enabled: true,
  }
}

// ------------------------------------------------------------------ Cloudflare

const CF = "https://api.cloudflare.com/client/v4"

async function cf<T>(
  token: string,
  method: string,
  url: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${CF}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json()) as {
    success: boolean
    errors: unknown
    result: T
  }
  if (!json.success) {
    const err = new Error(
      `Cloudflare ${method} ${url.split("?")[0]}: ${JSON.stringify(json.errors)}`,
    )
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }
  return json.result
}

async function ensureRateLimitRule(
  token: string,
  zoneId: string,
  apply: boolean,
) {
  const rule = rateLimitRule()
  const base = `/zones/${zoneId}/rulesets/phases/http_ratelimit/entrypoint`
  let ruleset:
    | { id: string; rules?: (typeof rule & { id: string })[] }
    | undefined
  try {
    ruleset = await cf(token, "GET", base)
  } catch (e) {
    if ((e as { status?: number }).status !== 404) throw e
  }
  const current = ruleset?.rules?.find((r) => r.ref === rule.ref)
  const matches =
    current &&
    current.expression === rule.expression &&
    JSON.stringify(current.ratelimit) === JSON.stringify(rule.ratelimit) &&
    current.enabled
  const label = `rate rule   ${rule.ratelimit.requests_per_period}/10 s per IP on ${CLOUDFLARE_LIMITED_PATHS.join(" ")}`
  if (matches) return console.log(`keep    ${label}`)
  console.log(`${current ? "update" : "create"}  ${label}`)
  if (!apply) return
  if (!ruleset) await cf(token, "PUT", base, { rules: [rule] })
  else if (current)
    await cf(
      token,
      "PATCH",
      `/zones/${zoneId}/rulesets/${ruleset.id}/rules/${current.id}`,
      rule,
    )
  else
    await cf(
      token,
      "POST",
      `/zones/${zoneId}/rulesets/${ruleset.id}/rules`,
      rule,
    )
}

/** Finds or (with apply) creates the tunnel; returns its id when it exists. */
async function ensureTunnel(
  token: string,
  accountId: string,
  apply: boolean,
): Promise<string | undefined> {
  const found = await cf<{ id: string }[]>(
    token,
    "GET",
    `/accounts/${accountId}/cfd_tunnel?name=${TUNNEL_NAME}&is_deleted=false`,
  )
  if (found[0]) {
    console.log(`keep    tunnel      ${TUNNEL_NAME} (${found[0].id})`)
    return found[0].id
  }
  console.log(`create  tunnel      ${TUNNEL_NAME} (remotely managed)`)
  if (!apply) return undefined
  const created = await cf<{ id: string }>(
    token,
    "POST",
    `/accounts/${accountId}/cfd_tunnel`,
    { name: TUNNEL_NAME, config_src: "cloudflare" },
  )
  return created.id
}

async function ensureTunnelConfig(
  token: string,
  accountId: string,
  tunnelId: string | undefined,
  apiHost: string,
  apply: boolean,
) {
  const want = tunnelConfig(apiHost)
  const label = `ingress     ${apiHost}: ^/auth/v1/ → ${internalUrl("auth")}, else → ${internalUrl("api")}`
  if (!tunnelId) return console.log(`create  ${label}`)
  const live = await cf<{ config?: Partial<TunnelConfig> }>(
    token,
    "GET",
    `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
  )
  if (sameTunnelConfig(live.config, want))
    return console.log(`keep    ${label}`)
  console.log(`update  ${label}`)
  if (apply) {
    await cf(
      token,
      "PUT",
      `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
      { config: want },
    )
  }
}

// ------------------------------------------------------------------------ AWS

async function ensureTokenSecret(
  token: string,
  accountId: string,
  tunnelId: string | undefined,
  region: string,
  apply: boolean,
) {
  const sm = new SecretsManagerClient({ region })
  let current: string | undefined
  let exists = true
  try {
    const v = await sm.send(
      new GetSecretValueCommand({ SecretId: TUNNEL_TOKEN_SECRET }),
    )
    current = JSON.parse(v.SecretString ?? "{}").token
  } catch (e) {
    if (!(e instanceof ResourceNotFoundException)) throw e
    exists = false
  }
  const label = `secret      ${TUNNEL_TOKEN_SECRET} (tunnel token, value not shown)`
  if (!tunnelId) return console.log(`create  ${label}`)
  const want = await cf<string>(
    token,
    "GET",
    `/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`,
  )
  if (current === want) return console.log(`keep    ${label}`)
  console.log(`${exists ? "update" : "create"}  ${label}`)
  if (!apply) return
  const SecretString = JSON.stringify({ token: want })
  if (exists) {
    await sm.send(
      new PutSecretValueCommand({
        SecretId: TUNNEL_TOKEN_SECRET,
        SecretString,
      }),
    )
  } else {
    await sm.send(
      new CreateSecretCommand({
        Name: TUNNEL_TOKEN_SECRET,
        Description: `Cloudflare Tunnel token for ${TUNNEL_NAME} (${MANAGED})`,
        SecretString,
        Tags: [
          { Key: "project", Value: "unfurl" },
          { Key: "managed-by", Value: "infra/scripts/cloudflare.ts" },
        ],
      }),
    )
  }
}

async function sesFacts(emailDomain: string, region: string): Promise<Facts> {
  if (!emailDomain) return {}
  try {
    const ses = new SESv2Client({ region })
    const id = await ses.send(
      new GetEmailIdentityCommand({ EmailIdentity: emailDomain }),
    )
    return {
      dkimTokens: id.DkimAttributes?.Tokens,
      mailFromDomain: id.MailFromAttributes?.MailFromDomain,
    }
  } catch (e) {
    if ((e as { name?: string }).name !== "NotFoundException") throw e
    return {}
  }
}

// ----------------------------------------------------------------------- main

async function main() {
  const apply = process.argv.includes("--apply")
  if (!apply) console.log("Plan only (pass --apply to write):")
  const cdk = JSON.parse(
    readFileSync(path.join(import.meta.dir, "..", "cdk.json"), "utf8"),
  )
  const ctx = cdk.context as Record<string, string>
  const apiHost = ctx["unfurl:apiHost"]
  const emailDomain = ctx["unfurl:emailDomain"] ?? ""
  const region = ctx["unfurl:region"]
  if (!apiHost) throw new Error("unfurl:apiHost is empty in cdk.json")
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not set")

  const zoneName = apiHost.split(".").slice(-2).join(".")
  const zones = await cf<{ id: string; account: { id: string } }[]>(
    token,
    "GET",
    `/zones?name=${zoneName}`,
  )
  const zone = zones[0]
  if (!zone)
    throw new Error(`Cloudflare zone ${zoneName} not visible to this token`)

  const tunnelId = await ensureTunnel(token, zone.account.id, apply)
  await ensureTokenSecret(token, zone.account.id, tunnelId, region, apply)
  await ensureTunnelConfig(token, zone.account.id, tunnelId, apiHost, apply)

  const facts = { tunnelId, ...(await sesFacts(emailDomain, region)) }
  const desired = desiredRecords(apiHost, emailDomain, region, facts)
  if (!tunnelId) {
    console.log(
      `create  CNAME ${apiHost} → <new tunnel id>.cfargotunnel.com (proxied)`,
    )
  }
  const existing: ExistingRecord[] = []
  for (const name of new Set(desired.map((r) => r.name))) {
    existing.push(
      ...(await cf<ExistingRecord[]>(
        token,
        "GET",
        `/zones/${zone.id}/dns_records?name=${encodeURIComponent(name)}&per_page=100`,
      )),
    )
  }
  for (const a of plan(desired, existing)) {
    const r = a.record
    console.log(
      `${a.op.padEnd(7)} ${r.type.padEnd(5)} ${r.name} → ${r.content}${r.proxied ? " (proxied)" : ""}`,
    )
    if (!apply || a.op === "keep") continue
    const body = { ...r, ttl: 1, comment: MANAGED }
    if (a.op === "create")
      await cf(token, "POST", `/zones/${zone.id}/dns_records`, body)
    else await cf(token, "PATCH", `/zones/${zone.id}/dns_records/${a.id}`, body)
  }
  await ensureRateLimitRule(token, zone.id, apply)
  if (emailDomain && !facts.dkimTokens) {
    console.log(
      "SES identity not in AWS yet: rerun after `cdk deploy` for the DKIM and MAIL FROM records.",
    )
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
