import { describe, expect, test } from "bun:test"
import {
  desiredRecords,
  type ExistingRecord,
  plan,
} from "../scripts/cloudflare-dns"

const API = "unfurl-api.realsolutionsph.com"
const MAIL = "unfurl.realsolutionsph.com"
const facts = {
  certValidation: {
    name: `_abc123.${API}.`,
    value: "_def456.xlfgrmvvlj.acm-validations.aws.",
  },
  certStatus: "PENDING_VALIDATION",
  albDnsName: "unfurl-123.ap-southeast-1.elb.amazonaws.com",
  dkimTokens: ["t1", "t2", "t3"],
  mailFromDomain: `mail.${MAIL}`,
}

describe("desired records", () => {
  const records = desiredRecords(API, MAIL, "ap-southeast-1", facts)
  const find = (type: string, name: string) =>
    records.filter((r) => r.type === type && r.name === name)

  test("only the API host CNAME is proxied", () => {
    expect(records.filter((r) => r.proxied).map((r) => r.name)).toEqual([API])
    expect(find("CNAME", API)[0].content).toBe(facts.albDnsName)
  })

  test("ACM validation CNAME without the trailing dots", () => {
    expect(find("CNAME", `_abc123.${API}`)[0]).toMatchObject({
      content: "_def456.xlfgrmvvlj.acm-validations.aws",
      proxied: false,
    })
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
    expect(records.length).toBe(1 + 1 + 3 + 2 + 1)
  })

  test("before the deploy creates anything, only DMARC is wanted", () => {
    expect(
      desiredRecords(API, MAIL, "ap-southeast-1", {}).map((r) => r.name),
    ).toEqual([`_dmarc.${MAIL}`])
  })

  test("refuses to manage a name outside the API host and email domain", () => {
    expect(() =>
      desiredRecords(API, MAIL, "ap-southeast-1", {
        certValidation: { name: "_x.realsolutionsph.com.", value: "y." },
      }),
    ).toThrow(/refusing/)
  })
})

describe("plan", () => {
  const desired = desiredRecords(API, MAIL, "ap-southeast-1", facts)

  test("creates everything in an empty zone", () => {
    expect(plan(desired, []).every((a) => a.op === "create")).toBe(true)
  })

  test("keeps matching records and updates a changed ALB target", () => {
    const existing: ExistingRecord[] = desired.map((r, i) => ({
      ...r,
      id: `id${i}`,
    }))
    const alb = existing.find((r) => r.name === API)
    if (!alb) throw new Error("no ALB record")
    alb.content = "old-alb.example.com"
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
