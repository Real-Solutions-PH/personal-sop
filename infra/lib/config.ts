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
   * Public host of the API and sign-in (`/api/*`, `/auth/v1/*`), e.g.
   * `unfurl-api.realsolutionsph.com`. It is served by a Cloudflare Tunnel:
   * the tunnel, its ingress rules and the DNS record are applied by
   * `scripts/cloudflare.ts`, not by the stack. Required.
   */
  apiHost: string
  /**
   * SES sending domain, e.g. `unfurl.realsolutionsph.com`; mail goes from
   * `noreply@` it. Empty: no SES identity and email is off.
   */
  emailDomain: string
  /** Where links in email send people (GoTrue's site URL, FRONTEND_HOST). */
  siteUrl: string
  /** Sizing profile: `lean` (first deploy, one user) or `production`. */
  profile: ProfileName
  /** Sizes for `profile`. */
  sizing: Sizing
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
  const apiHost = str(node, "apiHost")
  if (!apiHost) {
    throw new Error("unfurl:apiHost is required (the tunnel's public hostname)")
  }
  const emailDomain = str(node, "emailDomain")
  const profile = str(node, "profile", "lean")
  if (!(profile in PROFILES)) {
    throw new Error(
      `unfurl:profile must be one of ${Object.keys(PROFILES).join(", ")}; got "${profile}"`,
    )
  }
  const redirects = str(node, "authRedirectUrls", "personalsop://**")
  return {
    account: str(node, "account", "619648596614"),
    region: str(node, "region", "ap-southeast-1"),
    githubRepo: str(node, "githubRepo", "Real-Solutions-PH/personal-sop"),
    githubEnvironment: str(node, "githubEnvironment", "production"),
    apiHost,
    emailDomain,
    siteUrl: str(
      node,
      "siteUrl",
      emailDomain ? `https://${emailDomain}` : `https://${apiHost}`,
    ),
    profile: profile as ProfileName,
    sizing: PROFILES[profile as ProfileName],
    imageTag: str(node, "imageTag"),
    alertEmail: str(node, "alertEmail"),
    adminEmail: str(
      node,
      "adminEmail",
      emailDomain ? `admin@${emailDomain}` : "admin@example.com",
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

export type ProfileName = "lean" | "production"

/** Fargate task size: vCPU units (1024 = 1 vCPU) and memory in MiB. */
export interface TaskSize {
  cpu: number
  memoryMiB: number
  count: number
}

export interface Sizing {
  api: TaskSize
  worker: TaskSize
  gotrue: TaskSize
  /** cloudflared connectors for the tunnel (each keeps 4 connections open). */
  tunnel: TaskSize
  /** RDS instance class, e.g. `t4g.micro` (the `db.` prefix is implied). */
  database: string
  /** ElastiCache node type. */
  cache: string
}

/**
 * Two sizes of the same stack. `lean` is the default for the first deploy:
 * one user before launch, one task per service, the smallest database and
 * cache. `production` is the size planned for launch: two API, two GoTrue
 * and two tunnel tasks (one can fail or be replaced without downtime) and a
 * larger database. Switching is one context value and a deploy; the
 * database class change is an RDS modification with a short restart.
 */
export const PROFILES: Record<ProfileName, Sizing> = {
  lean: {
    api: { cpu: 512, memoryMiB: 1024, count: 1 },
    worker: { cpu: 256, memoryMiB: 1024, count: 1 },
    gotrue: { cpu: 256, memoryMiB: 512, count: 1 },
    tunnel: { cpu: 256, memoryMiB: 512, count: 1 },
    database: "t4g.micro",
    cache: "cache.t4g.micro",
  },
  production: {
    api: { cpu: 512, memoryMiB: 1024, count: 2 },
    worker: { cpu: 512, memoryMiB: 1024, count: 1 },
    gotrue: { cpu: 256, memoryMiB: 512, count: 2 },
    tunnel: { cpu: 256, memoryMiB: 512, count: 2 },
    database: "t4g.small",
    cache: "cache.t4g.micro",
  },
}

/** Name prefix for every resource and secret. */
export const PREFIX = "unfurl"

/** ECR repository the backend image is pushed to (owned by the CI stack). */
export const BACKEND_REPOSITORY = `${PREFIX}-backend`

/** Pinned images, all multi-arch with arm64 (every task runs on Graviton).
 * Upgrade deliberately (ADR-0021), never `latest`. */
export const IMAGES = {
  gotrue: "public.ecr.aws/supabase/gotrue:v2.197.0",
  nginx: "public.ecr.aws/nginx/nginx:1.31.8-alpine",
  // Docker Hub only (no ECR Public copy).
  cloudflared: "cloudflare/cloudflared:2026.10.3",
} as const

/** The Cloudflare Tunnel's name, and the secret holding its token. Both are
 * created by scripts/cloudflare.ts; the stack reads the secret by name. */
export const TUNNEL_NAME = PREFIX
export const TUNNEL_TOKEN_SECRET = `${PREFIX}/cloudflared-tunnel`

/** Private DNS (Cloud Map) the tunnel and the backend reach services at. */
export const SERVICE_NAMESPACE = `${PREFIX}.internal`
export const SERVICE_PORTS = { api: 8000, auth: 8080 } as const
export const internalUrl = (service: keyof typeof SERVICE_PORTS) =>
  `http://${service}.${SERVICE_NAMESPACE}:${SERVICE_PORTS[service]}`

/** RDS engine: Postgres 18, matching `pgvector/pgvector:pg18` in compose.yml. */
export const POSTGRES_FULL_VERSION = "18.6"
export const POSTGRES_MAJOR_VERSION = "18"
