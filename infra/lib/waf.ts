import * as wafv2 from "aws-cdk-lib/aws-wafv2"
import type { Construct } from "constructs"
import { PREFIX } from "./config"

/**
 * Per-IP request limits, counted over WAF's 5-minute window. Sized for one
 * person's phone with headroom; a client over the limit gets HTTP 429 until
 * its rate drops.
 */
export const RATE_LIMITS = {
  /** Sign-up, sign-in, token refresh, password reset, email OTP. */
  auth: 300,
  /** Model-backed routes: every request costs Nebius or Deepgram money. */
  ai: 300,
  /** Everything else, as a flood backstop. */
  global: 3000,
} as const

/** API routes that call a model provider (Fern, capture, OCR, transcription). */
export const AI_PATH_REGEX = "^/api/v1/(ai|agents|chat|companion|capture|ocr)/"

const visibility = (name: string) => ({
  cloudWatchMetricsEnabled: true,
  metricName: `${PREFIX}-${name}`,
  sampledRequestsEnabled: true,
})

const rateRule = (
  name: string,
  priority: number,
  limit: number,
  clientIpHeader: string | undefined,
  scopeDownStatement?: wafv2.CfnWebACL.StatementProperty,
): wafv2.CfnWebACL.RuleProperty => ({
  name,
  priority,
  action: { block: { customResponse: { responseCode: 429 } } },
  statement: {
    rateBasedStatement: clientIpHeader
      ? {
          aggregateKeyType: "FORWARDED_IP",
          // A request without the header did not come through Cloudflare
          // (the ALB only admits Cloudflare), so count it rather than skip.
          forwardedIpConfig: {
            headerName: clientIpHeader,
            fallbackBehavior: "MATCH",
          },
          evaluationWindowSec: 300,
          limit,
          scopeDownStatement,
        }
      : {
          aggregateKeyType: "IP",
          evaluationWindowSec: 300,
          limit,
          scopeDownStatement,
        },
  },
  visibilityConfig: visibility(name),
})

const managedRule = (
  name: string,
  priority: number,
): wafv2.CfnWebACL.RuleProperty => ({
  name,
  priority,
  overrideAction: { none: {} },
  statement: { managedRuleGroupStatement: { vendorName: "AWS", name } },
  visibilityConfig: visibility(name),
})

/**
 * Web ACL for the load balancer. `trustedIps` (the NAT's address) is exempt
 * from the auth limit: the API's own GoTrue admin calls and JWKS fetches
 * leave through NAT and come back in through Cloudflare and the ALB.
 * `clientIpHeader` (Cloudflare's CF-Connecting-IP) is where the visitor's
 * address is when the ALB sits behind a proxy; without it every visitor
 * would share the limit of the Cloudflare edge they arrive through.
 */
export function createWebAcl(
  scope: Construct,
  albArn: string,
  trustedIps: string[],
  clientIpHeader?: string,
) {
  const natSet = new wafv2.CfnIPSet(scope, "NatIpSet", {
    name: `${PREFIX}-nat`,
    scope: "REGIONAL",
    ipAddressVersion: "IPV4",
    addresses: trustedIps.map((ip) => `${ip}/32`),
  })

  const authPath: wafv2.CfnWebACL.StatementProperty = {
    byteMatchStatement: {
      fieldToMatch: { uriPath: {} },
      positionalConstraint: "STARTS_WITH",
      searchString: "/auth/v1/",
      textTransformations: [{ priority: 0, type: "NONE" }],
    },
  }

  const acl = new wafv2.CfnWebACL(scope, "WebAcl", {
    name: `${PREFIX}-alb`,
    scope: "REGIONAL",
    defaultAction: { allow: {} },
    visibilityConfig: visibility("alb"),
    rules: [
      managedRule("AWSManagedRulesAmazonIpReputationList", 0),
      managedRule("AWSManagedRulesKnownBadInputsRuleSet", 1),
      rateRule("auth-rate", 10, RATE_LIMITS.auth, clientIpHeader, {
        andStatement: {
          statements: [
            authPath,
            {
              notStatement: {
                statement: {
                  ipSetReferenceStatement: {
                    arn: natSet.attrArn,
                    ...(clientIpHeader && {
                      ipSetForwardedIpConfig: {
                        headerName: clientIpHeader,
                        fallbackBehavior: "NO_MATCH",
                        position: "FIRST",
                      },
                    }),
                  },
                },
              },
            },
          ],
        },
      }),
      rateRule("ai-rate", 20, RATE_LIMITS.ai, clientIpHeader, {
        regexMatchStatement: {
          fieldToMatch: { uriPath: {} },
          regexString: AI_PATH_REGEX,
          textTransformations: [{ priority: 0, type: "NONE" }],
        },
      }),
      rateRule("global-rate", 30, RATE_LIMITS.global, clientIpHeader),
    ],
  })

  new wafv2.CfnWebACLAssociation(scope, "WebAclAssociation", {
    resourceArn: albArn,
    webAclArn: acl.attrArn,
  })
  return acl
}
