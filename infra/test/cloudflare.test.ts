import { describe, expect, test } from "bun:test"
import {
  desiredRecords,
  type ExistingRecord,
  plan,
  rateLimitRule,
  sameRateLimit,
  sameTunnelConfig,
  tunnelConfig,
} from "../scripts/cloudflare"

const API = "unfurl-api.realsolutionsph.com"
const MAIL = "unfurl.realsolutionsph.com"
const TUNNEL = "0f8c8a64-1111-2222-3333-444455556666"
const facts = {
  tunnelId: TUNNEL,
  dkimTokens: ["t1", "t2", "t3"],
  mailFromDomain: `mail.${MAIL}`,
}

describe("desired DNS records", () => {
  const records = desiredRecords(API, MAIL, "ap-southeast-1", facts)
  const find = (type: string, name: string) =>
    records.filter((r) => r.type === type && r.name === name)

  test("the API host is a proxied CNAME to the tunnel, and the only proxied record", () => {
    expect(find("CNAME", API)[0]).toMatchObject({
      content: `${TUNNEL}.cfargotunnel.com`,
      proxied: true,
    })
    expect(records.filter((r) => r.proxied).map((r) => r.name)).toEqual([API])
  })

  test("no ACM validation or load balancer records any more", () => {
    expect(records.some((r) => r.content.includes("acm-validations"))).toBe(
      false,
    )
    expect(records.some((r) => r.content.includes("elb.amazonaws.com"))).toBe(
      false,
    )
  })

  test("three DKIM CNAMEs, MAIL FROM MX and SPF, DMARC", () => {
    for (const t of facts.dkimTokens) {
      expect(find("CNAME", `${t}._domainkey.${MAIL}`)[0].content).toBe(
        `${t}.dkim.amazonses.com`,
      )
    }
    expect(find("MX", `mail.${MAIL}`)[0]).toMatchObject({
      content: "feedback-smtp.ap-southeast-1.amazonses.com",
      priority: 10,
    })
    expect(find("TXT", `mail.${MAIL}`)[0].content).toContain(
      "v=spf1 include:amazonses.com",
    )
    expect(find("TXT", `_dmarc.${MAIL}`)[0].content).toContain(
      "v=DMARC1; p=quarantine",
    )
    expect(records.length).toBe(1 + 3 + 2 + 1)
  })

  test("before anything exists, only DMARC is wanted", () => {
    expect(
      desiredRecords(API, MAIL, "ap-southeast-1", {}).map((r) => r.name),
    ).toEqual([`_dmarc.${MAIL}`])
  })

  test("refuses to manage a name outside the API host and email domain", () => {
    expect(() =>
      desiredRecords(API, MAIL, "ap-southeast-1", {
        mailFromDomain: "mail.realsolutionsph.com",
      }),
    ).toThrow(/refusing/)
  })
})

describe("DNS plan", () => {
  const desired = desiredRecords(API, MAIL, "ap-southeast-1", facts)

  test("creates everything in an empty zone", () => {
    expect(plan(desired, []).every((a) => a.op === "create")).toBe(true)
  })

  test("keeps matching records and updates a changed tunnel target", () => {
    const existing: ExistingRecord[] = desired.map((r, i) => ({
      ...r,
      id: `id${i}`,
    }))
    const api = existing.find((r) => r.name === API)
    if (!api) throw new Error("no API record")
    api.content = "old-tunnel.cfargotunnel.com"
    const actions = plan(desired, existing)
    expect(
      actions.filter((a) => a.op === "update").map((a) => a.record.name),
    ).toEqual([API])
    expect(actions.filter((a) => a.op === "keep").length).toBe(
      desired.length - 1,
    )
  })

  test("an unrelated TXT at the MAIL FROM name is left alone", () => {
    const existing: ExistingRecord[] = [
      {
        id: "x",
        type: "TXT",
        name: `mail.${MAIL}`,
        content: '"google-site-verification=abc"',
        proxied: false,
      },
    ]
    const spf = plan(desired, existing).find(
      (a) => a.record.type === "TXT" && a.record.name === `mail.${MAIL}`,
    )
    expect(spf?.op).toBe("create")
  })
})

describe("tunnel ingress", () => {
  const cfg = tunnelConfig(API)

  test("/auth/v1/* goes to GoTrue's proxy, everything else on the host to the API, the rest 404", () => {
    expect(cfg.ingress).toEqual([
      {
        hostname: API,
        path: "^/auth/v1/",
        service: "http://auth.unfurl.internal:8080",
      },
      { hostname: API, service: "http://api.unfurl.internal:8000" },
      { service: "http_status:404" },
    ])
    // cloudflared matches `path` as a regular expression.
    const auth = new RegExp(cfg.ingress[0].path ?? "")
    expect(auth.test("/auth/v1/token")).toBe(true)
    expect(auth.test("/api/v1/auth/v1/x")).toBe(false)
  })

  test("idle origin connections are kept 300 s", () => {
    expect(cfg.originRequest.keepAliveTimeout).toBe(300)
  })

  test("the live config is compared by routing, not by object identity", () => {
    expect(sameTunnelConfig(JSON.parse(JSON.stringify(cfg)), cfg)).toBe(true)
    const moved = JSON.parse(JSON.stringify(cfg))
    moved.ingress[1].service = "http://elsewhere:8000"
    expect(sameTunnelConfig(moved, cfg)).toBe(false)
    expect(sameTunnelConfig(undefined, cfg)).toBe(false)
  })
})

describe("Cloudflare rate-limiting rule", () => {
  const rule = rateLimitRule()

  test("counts per visitor IP over 10 s and blocks", () => {
    expect(rule.action).toBe("block")
    expect(rule.ratelimit.characteristics).toEqual(["cf.colo.id", "ip.src"])
    expect(rule.ratelimit.period).toBe(10)
  })

  test("covers sign-in and every model-backed path prefix", () => {
    for (const p of [
      "/auth/v1/",
      "/api/v1/companion/",
      "/api/v1/capture/",
      "/api/v1/ai/",
      "/api/v1/ocr/",
      "/api/v1/fitness/meals/estimate",
    ]) {
      expect(rule.expression).toContain(
        `starts_with(http.request.uri.path, "${p}")`,
      )
    }
    expect(rule.expression).not.toContain("/api/v1/tasks/")
  })
})

describe("rate rule comparison", () => {
  test("ignores the key order Cloudflare returns the rule in", () => {
    const want = rateLimitRule().ratelimit
    const live = {
      characteristics: ["cf.colo.id", "ip.src"],
      mitigation_timeout: want.mitigation_timeout,
      period: 10,
      requests_per_period: want.requests_per_period,
    }
    expect(sameRateLimit(live, want)).toBe(true)
    expect(sameRateLimit({ ...live, period: 60 }, want)).toBe(false)
    expect(sameRateLimit(undefined, want)).toBe(false)
  })
})
