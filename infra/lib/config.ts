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
  /** RDS deletion protection; default on. Off only for a first create. */
  databaseDeletionProtection: boolean
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
    sizing: applySizingOverrides(
      PROFILES[profile as ProfileName],
      node.tryGetContext("unfurl:sizingOverrides"),
    ),
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
    databaseDeletionProtection: !["false", false].includes(
      node.tryGetContext("unfurl:databaseDeletionProtection"),
    ),
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
  /** `workers` is uvicorn's process count; each holds about 250 MB. */
  api: TaskSize & { workers: number }
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
 * Two sizes of the same stack. Scaling is configuration, never a rebuild:
 * switch `unfurl:profile`, or override single values with
 * `unfurl:sizingOverrides` in cdk.json (e.g. `{"api": {"count": 2},
 * "database": "t4g.small"}`), then deploy. A database class change is an
 * RDS modification with a short restart; everything else rolls tasks.
 *
 * `lean` (default) serves up to 5 users: one task per service, each at
 * Fargate's smallest size (0.25 vCPU, 0.5 GB). Measured 2026-10-24 on the
 * backend venv (arm64, AI and jobs on): one uvicorn worker holds about
 * 250 MB after warm-up, two hold about 530 MB with the supervisor (too much
 * for 0.5 GB), the job worker about 30 MB, an Alembic upgrade peaks at
 * about 180 MB and the seed at about 135 MB. So the API runs one worker; a
 * sync route still serves concurrent requests from uvicorn's thread pool.
 *
 * `production` is the size planned for launch: two API (two workers each),
 * two GoTrue and two tunnel tasks, so one can fail or be replaced without
 * downtime, and a larger database.
 */
export const PROFILES: Record<ProfileName, Sizing> = {
  lean: {
    api: { cpu: 256, memoryMiB: 512, count: 1, workers: 1 },
    worker: { cpu: 256, memoryMiB: 512, count: 1 },
    gotrue: { cpu: 256, memoryMiB: 512, count: 1 },
    tunnel: { cpu: 256, memoryMiB: 512, count: 1 },
    database: "t4g.micro",
    cache: "cache.t4g.micro",
  },
  production: {
    api: { cpu: 512, memoryMiB: 1024, count: 2, workers: 2 },
    worker: { cpu: 512, memoryMiB: 1024, count: 1 },
    gotrue: { cpu: 256, memoryMiB: 512, count: 2 },
    tunnel: { cpu: 256, memoryMiB: 512, count: 2 },
    database: "t4g.small",
    cache: "cache.t4g.micro",
  },
}

/** Fargate's valid memory sizes (MiB) for the CPU sizes used here. */
export const FARGATE_MEMORY: Record<number, number[]> = {
  256: [512, 1024, 2048],
  512: [1024, 2048, 3072, 4096],
  1024: [2048, 3072, 4096, 5120, 6144, 7168, 8192],
}

/**
 * The profile with `unfurl:sizingOverrides` merged in, field by field.
 * Unknown keys and invalid Fargate combinations are refused at synth, so a
 * typo never deploys a default silently.
 */
export function applySizingOverrides(base: Sizing, overrides: unknown): Sizing {
  if (overrides === undefined || overrides === null || overrides === "")
    return base
  const o = (
    typeof overrides === "string" ? JSON.parse(overrides) : overrides
  ) as Record<string, unknown>
  const out: Sizing = structuredClone(base)
  for (const [key, value] of Object.entries(o)) {
    if (!(key in base))
      throw new Error(`unfurl:sizingOverrides: unknown key "${key}"`)
    const k = key as keyof Sizing
    if (typeof base[k] === "string") {
      if (typeof value !== "string")
        throw new Error(`unfurl:sizingOverrides.${key} must be a string`)
      ;(out as unknown as Record<string, unknown>)[k] = value
      continue
    }
    for (const [field, n] of Object.entries(value as Record<string, unknown>)) {
      const task = out[k] as unknown as Record<string, number>
      if (!(field in task))
        throw new Error(
          `unfurl:sizingOverrides.${key}: unknown field "${field}"`,
        )
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
        throw new Error(
          `unfurl:sizingOverrides.${key}.${field} must be a whole number`,
        )
      }
      task[field] = n
    }
  }
  for (const k of ["api", "worker", "gotrue", "tunnel"] as const) {
    const t = out[k]
    if (!FARGATE_MEMORY[t.cpu]?.includes(t.memoryMiB)) {
      throw new Error(
        `${k}: ${t.cpu} CPU units with ${t.memoryMiB} MiB is not a Fargate size`,
      )
    }
  }
  if (out.api.workers < 1) throw new Error("api.workers must be at least 1")
  return out
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

/** Third-party API keys, created and filled by scripts/third-party-secrets.ts
 * before the first deploy; the stack reads it by name. */
export const THIRD_PARTY_SECRET = `${PREFIX}/third-party`
/** Its fields, and which .env variable fills each. */
export const THIRD_PARTY_FIELDS = {
  nebius_api_key: "NEBIUS_API_KEY",
  deepgram_api_key: "DEEPGRAM_API_KEY",
  openrouter_api_key: "OPENROUTER_API_KEY",
  brave_api_key: "BRAVE_API_KEY",
  expo_access_token: "EXPO_ACCESS_TOKEN",
  sentry_dsn: "SENTRY_DSN",
} as const
/** The API cannot start with AI on without these. */
export const THIRD_PARTY_REQUIRED = ["nebius_api_key"] as const
export const TUNNEL_TOKEN_SECRET = `${PREFIX}/tunnel-token`

/**
 * Secret names must not end in a hyphen and six characters: Secrets Manager
 * then reads a partial ARN (how ECS asks for a secret imported by name) as a
 * full ARN with a random suffix, finds nothing, and denies. The tunnel token
 * was `unfurl/cloudflared-tunnel` (`-tunnel`), and every cloudflared task
 * failed with AccessDenied under a policy that allowed it (2026-10-24).
 */
export const LOOKS_LIKE_ARN_SUFFIX = /-[A-Za-z0-9]{6}$/

/** Private DNS (Cloud Map) the tunnel and the backend reach services at. */
export const SERVICE_NAMESPACE = `${PREFIX}.internal`
export const SERVICE_PORTS = { api: 8000, auth: 8080 } as const
export const internalUrl = (service: keyof typeof SERVICE_PORTS) =>
  `http://${service}.${SERVICE_NAMESPACE}:${SERVICE_PORTS[service]}`

/** RDS engine: Postgres 18, matching `pgvector/pgvector:pg18` in compose.yml. */
export const POSTGRES_FULL_VERSION = "18.6"
export const POSTGRES_MAJOR_VERSION = "18"
