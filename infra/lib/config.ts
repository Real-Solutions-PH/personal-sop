import type { Node } from "constructs"

/**
 * Deploy-time settings, read from CDK context (`cdk.json` → `context`, or
 * `-c key=value`). Everything here is non-secret; secrets live in Secrets
 * Manager and are never passed through context.
 */
export interface UnfurlConfig {
  /** AWS account the stacks deploy to. */
  account: string
  /** Region: Singapore, closest to the product's users (ADR-0021). */
  region: string
  /** GitHub `owner/repo` allowed to assume the deploy role. */
  githubRepo: string
  /** GitHub environment the deploy job runs in (part of the OIDC subject). */
  githubEnvironment: string
  /**
   * Apex domain (e.g. `unfurl.app`). Empty until it is bought: the stack
   * then serves plain HTTP on the load balancer's own DNS name and skips the
   * certificate, the DNS records and the SES domain identity.
   */
  domain: string
  /** Route 53 hosted zone for `domain`; empty means DNS is managed by hand. */
  hostedZoneId: string
  /** Backend image tag in ECR (the git SHA the workflow pushed). */
  imageTag: string
  /** Email subscribed to the alarm topic; empty means no subscription. */
  alertEmail: string
  /** Email of the bootstrap superuser the backend seeds into GoTrue. */
  adminEmail: string
  /** Redirect URLs GoTrue may send users back to (mobile deep links). */
  authRedirectUrls: string[]
  /** Sign in with Apple: enabled once the Apple Developer account exists. */
  appleSignIn: boolean
  /** Google sign-in: enabled once the Google Cloud OAuth clients exist. */
  googleSignIn: boolean
  /** RDS standby in a second AZ (doubles the instance cost). */
  databaseMultiAz: boolean
}

const str = (node: Node, key: string, fallback = ""): string => {
  const v = node.tryGetContext(`unfurl:${key}`)
  return v === undefined || v === null ? fallback : String(v)
}

const bool = (node: Node, key: string): boolean => {
  const v = node.tryGetContext(`unfurl:${key}`)
  return v === true || v === "true"
}

export function loadConfig(node: Node): UnfurlConfig {
  const domain = str(node, "domain")
  const hostedZoneId = str(node, "hostedZoneId")
  if (hostedZoneId && !domain) {
    throw new Error("unfurl:hostedZoneId is set but unfurl:domain is empty")
  }
  const redirects = str(node, "authRedirectUrls", "personalsop://**")
  return {
    account: str(node, "account", "619648596614"),
    region: str(node, "region", "ap-southeast-1"),
    githubRepo: str(node, "githubRepo", "Real-Solutions-PH/personal-sop"),
    githubEnvironment: str(node, "githubEnvironment", "production"),
    domain,
    hostedZoneId,
    imageTag: str(node, "imageTag"),
    alertEmail: str(node, "alertEmail"),
    adminEmail: str(
      node,
      "adminEmail",
      domain ? `admin@${domain}` : "admin@example.com",
    ),
    authRedirectUrls: redirects
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    appleSignIn: bool(node, "appleSignIn"),
    googleSignIn: bool(node, "googleSignIn"),
    databaseMultiAz: bool(node, "databaseMultiAz"),
  }
}

/** Name prefix for every resource and secret. */
export const PREFIX = "unfurl"

/** ECR repository the backend image is pushed to (owned by the CI stack). */
export const BACKEND_REPOSITORY = `${PREFIX}-backend`

/** Pinned images. Upgrade deliberately (ADR-0021), never `latest`. */
export const IMAGES = {
  gotrue: "public.ecr.aws/supabase/gotrue:v2.197.0",
  nginx: "public.ecr.aws/nginx/nginx:1.31.8-alpine",
} as const

/** RDS engine: Postgres 18, matching `pgvector/pgvector:pg18` in compose.yml. */
export const POSTGRES_FULL_VERSION = "18.6"
export const POSTGRES_MAJOR_VERSION = "18"
