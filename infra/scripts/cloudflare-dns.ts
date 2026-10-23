#!/usr/bin/env bun
/**
 * Applies Unfurl's DNS records on Cloudflare, from what exists in AWS.
 *
 * DNS for the product's domain is on Cloudflare, not Route 53, so the stack
 * cannot create its own records. This script reads the live AWS resources
 * by name (no stack outputs, so it works while a deploy is still running)
 * and makes Cloudflare match:
 *
 * | Record | Points at | Proxied |
 * |---|---|---|
 * | ACM validation CNAME for the API host | ACM | no |
 * | `<apiHost>` CNAME | the `unfurl` ALB | **yes** (SSL Full strict) |
 * | `<token>._domainkey.<emailDomain>` ×3 | SES Easy DKIM | no |
 * | `mail.<emailDomain>` MX + SPF TXT | SES custom MAIL FROM | no |
 * | `_dmarc.<emailDomain>` TXT | DMARC policy | no |
 *
 * plus a Configuration Rule that sets SSL "Full (strict)" for the API host
 * only (the zone's own SSL mode is left alone: other sites depend on it).
 *
 * Why a script and not the Cloudflare provider: CDK has no first-class
 * Cloudflare support, the ACM validation name only exists once the deploy
 * has started (CloudFormation then waits on it), and a CloudFormation
 * custom resource would need the Cloudflare token stored in AWS.
 *
 * Usage (from infra/):
 *   CLOUDFLARE_API_TOKEN=... AWS_PROFILE=unfurl bun run dns            # plan only
 *   CLOUDFLARE_API_TOKEN=... AWS_PROFILE=unfurl bun run dns --apply    # write
 *   ... bun run dns --apply --watch   # repeat until the certificate is issued
 *
 * It never deletes a record and only touches names under the API host and
 * the email domain.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import {
  ACMClient,
  DescribeCertificateCommand,
  ListCertificatesCommand,
} from "@aws-sdk/client-acm"
import {
  DescribeLoadBalancersCommand,
  ElasticLoadBalancingV2Client,
} from "@aws-sdk/client-elastic-load-balancing-v2"
import { GetEmailIdentityCommand, SESv2Client } from "@aws-sdk/client-sesv2"
import { CLOUDFLARE_IPV4 } from "../lib/cloudflare"
import { PREFIX } from "../lib/config"

export interface DnsRecord {
  type: "CNAME" | "TXT" | "MX"
  name: string
  content: string
  proxied: boolean
  priority?: number
}

export interface AwsFacts {
  /** ACM validation record for the API host's newest certificate. */
  certValidation?: { name: string; value: string }
  certStatus?: string
  albDnsName?: string
  dkimTokens?: string[]
  mailFromDomain?: string
}

const MANAGED = "managed by infra/scripts/cloudflare-dns.ts"
const trimDot = (s: string) => s.replace(/\.$/, "")

/** The records Cloudflare should hold, given what exists in AWS so far. */
export function desiredRecords(
  apiHost: string,
  emailDomain: string,
  region: string,
  facts: AwsFacts,
): DnsRecord[] {
  const out: DnsRecord[] = []
  if (facts.certValidation) {
    out.push({
      type: "CNAME",
      name: trimDot(facts.certValidation.name),
      content: trimDot(facts.certValidation.value),
      proxied: false,
    })
  }
  if (facts.albDnsName) {
    out.push({
      type: "CNAME",
      name: apiHost,
      content: facts.albDnsName,
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
  // ACM's validation name is `_<hash>.<apiHost>`, so it is under the API host.
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
      `Cloudflare ${method} ${url}: ${JSON.stringify(json.errors)}`,
    )
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }
  return json.result
}

const SSL_RULE_REF = `${PREFIX}_api_ssl_strict`

async function ensureSslStrict(
  token: string,
  zoneId: string,
  apiHost: string,
  apply: boolean,
) {
  const rule = {
    ref: SSL_RULE_REF,
    description: `SSL Full (strict) for ${apiHost} (${MANAGED})`,
    expression: `(http.host eq "${apiHost}")`,
    action: "set_config",
    action_parameters: { ssl: "strict" },
    enabled: true,
  }
  const base = `/zones/${zoneId}/rulesets/phases/http_config_settings/entrypoint`
  let ruleset:
    | { id: string; rules?: (typeof rule & { id: string })[] }
    | undefined
  try {
    ruleset = await cf(token, "GET", base)
  } catch (e) {
    if ((e as { status?: number }).status !== 404) throw e
  }
  const current = ruleset?.rules?.find((r) => r.ref === SSL_RULE_REF)
  const matches =
    current &&
    current.expression === rule.expression &&
    current.action_parameters?.ssl === "strict" &&
    current.enabled
  if (matches)
    return console.log(`keep    config rule  ${rule.expression} → ssl strict`)
  console.log(
    `${current ? "update" : "create"}  config rule  ${rule.expression} → ssl strict`,
  )
  if (!apply) return
  if (!ruleset) {
    // A new entrypoint holds only this rule; an existing one keeps its rules.
    await cf(token, "PUT", base, { rules: [rule] })
  } else if (current) {
    await cf(
      token,
      "PATCH",
      `/zones/${zoneId}/rulesets/${ruleset.id}/rules/${current.id}`,
      rule,
    )
  } else {
    await cf(
      token,
      "POST",
      `/zones/${zoneId}/rulesets/${ruleset.id}/rules`,
      rule,
    )
  }
}

async function checkCloudflareRanges() {
  const res = await fetch(`${CF}/ips`)
  const ips = ((await res.json()) as { result: { ipv4_cidrs: string[] } })
    .result.ipv4_cidrs
  const a = [...ips].sort().join(",")
  const b = [...CLOUDFLARE_IPV4].sort().join(",")
  if (a !== b) {
    console.warn(
      "WARNING: Cloudflare's published IPv4 ranges differ from lib/cloudflare.ts; update it and deploy, or the ALB may refuse some edges.",
    )
  }
}

// ------------------------------------------------------------------------ AWS

async function awsFacts(
  apiHost: string,
  emailDomain: string,
  region: string,
): Promise<AwsFacts> {
  const facts: AwsFacts = {}
  const acm = new ACMClient({ region })
  const certs = await acm.send(
    new ListCertificatesCommand({
      CertificateStatuses: ["PENDING_VALIDATION", "ISSUED"],
    }),
  )
  const mine = (certs.CertificateSummaryList ?? [])
    .filter((c) => c.DomainName === apiHost)
    .sort(
      (x, y) => (y.CreatedAt?.getTime() ?? 0) - (x.CreatedAt?.getTime() ?? 0),
    )[0]
  if (mine?.CertificateArn) {
    const d = await acm.send(
      new DescribeCertificateCommand({ CertificateArn: mine.CertificateArn }),
    )
    facts.certStatus = d.Certificate?.Status
    const rr = d.Certificate?.DomainValidationOptions?.[0]?.ResourceRecord
    if (rr?.Name && rr.Value)
      facts.certValidation = { name: rr.Name, value: rr.Value }
  }
  try {
    const elb = new ElasticLoadBalancingV2Client({ region })
    const lbs = await elb.send(
      new DescribeLoadBalancersCommand({ Names: [PREFIX] }),
    )
    facts.albDnsName = lbs.LoadBalancers?.[0]?.DNSName
  } catch (e) {
    if ((e as { name?: string }).name !== "LoadBalancerNotFoundException")
      throw e
  }
  if (emailDomain) {
    try {
      const ses = new SESv2Client({ region })
      const id = await ses.send(
        new GetEmailIdentityCommand({ EmailIdentity: emailDomain }),
      )
      facts.dkimTokens = id.DkimAttributes?.Tokens
      facts.mailFromDomain = id.MailFromAttributes?.MailFromDomain
    } catch (e) {
      if ((e as { name?: string }).name !== "NotFoundException") throw e
    }
  }
  return facts
}

// ----------------------------------------------------------------------- main

async function once(apply: boolean) {
  const cdk = JSON.parse(
    readFileSync(path.join(import.meta.dir, "..", "cdk.json"), "utf8"),
  )
  const ctx = cdk.context as Record<string, string>
  const apiHost = ctx["unfurl:apiHost"]
  const emailDomain = ctx["unfurl:emailDomain"] ?? ""
  const region = ctx["unfurl:region"]
  if (!apiHost)
    throw new Error("unfurl:apiHost is empty in cdk.json: nothing to manage")
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not set")

  const zoneName = apiHost.split(".").slice(-2).join(".")
  const zones = await cf<{ id: string }[]>(
    token,
    "GET",
    `/zones?name=${zoneName}`,
  )
  const zoneId = zones[0]?.id
  if (!zoneId)
    throw new Error(`Cloudflare zone ${zoneName} not visible to this token`)

  const facts = await awsFacts(apiHost, emailDomain, region)
  const desired = desiredRecords(apiHost, emailDomain, region, facts)
  const existing: ExistingRecord[] = []
  for (const name of new Set(desired.map((r) => r.name))) {
    const recs = await cf<(ExistingRecord & { comment?: string })[]>(
      token,
      "GET",
      `/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}&per_page=100`,
    )
    existing.push(...recs)
  }

  for (const a of plan(desired, existing)) {
    const r = a.record
    console.log(
      `${a.op.padEnd(7)} ${r.type.padEnd(5)} ${r.name} → ${r.content}${r.proxied ? " (proxied)" : ""}`,
    )
    if (!apply || a.op === "keep") continue
    const body = { ...r, ttl: 1, comment: MANAGED }
    if (a.op === "create")
      await cf(token, "POST", `/zones/${zoneId}/dns_records`, body)
    else await cf(token, "PATCH", `/zones/${zoneId}/dns_records/${a.id}`, body)
  }
  await ensureSslStrict(token, zoneId, apiHost, apply)

  const waiting = [
    !facts.certValidation && "ACM certificate (not requested yet)",
    facts.certStatus &&
      facts.certStatus !== "ISSUED" &&
      `ACM certificate (${facts.certStatus})`,
    !facts.albDnsName && "load balancer",
    emailDomain && !facts.dkimTokens && "SES identity",
  ].filter(Boolean)
  return waiting as string[]
}

async function main() {
  const apply = process.argv.includes("--apply")
  const watch = process.argv.includes("--watch")
  if (!apply) console.log("Plan only (pass --apply to write):")
  await checkCloudflareRanges()
  const deadline = Date.now() + 60 * 60 * 1000
  for (;;) {
    const waiting = await once(apply)
    if (!watch || waiting.length === 0) {
      if (waiting.length) console.log(`Not in AWS yet: ${waiting.join(", ")}`)
      return
    }
    if (Date.now() > deadline)
      throw new Error(`gave up waiting for: ${waiting.join(", ")}`)
    console.log(`Waiting for: ${waiting.join(", ")} (retry in 30 s)`)
    await new Promise((r) => setTimeout(r, 30_000))
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
