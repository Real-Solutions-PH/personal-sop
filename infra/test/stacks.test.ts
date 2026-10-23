import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { App } from "aws-cdk-lib"
import { Match, Template } from "aws-cdk-lib/assertions"
import { BACKEND_DEFAULTED } from "../lib/backend-env"
import { CiStack } from "../lib/ci-stack"
import { CLOUDFLARE_IPV4 } from "../lib/cloudflare"
import { IMAGES, loadConfig, PROFILES } from "../lib/config"
import { ALB_IDLE_TIMEOUT_SECONDS, ProdStack } from "../lib/prod-stack"
import { AI_PATH_REGEX, RATE_LIMITS } from "../lib/waf"

const cdkJson = JSON.parse(
  readFileSync(path.join(import.meta.dir, "..", "cdk.json"), "utf8"),
)

function synth(extra: Record<string, unknown> = {}) {
  const app = new App({
    context: { ...cdkJson.context, "unfurl:imageTag": "abc1234", ...extra },
  })
  const config = loadConfig(app.node)
  const env = { account: config.account, region: config.region }
  const ci = new CiStack(app, "UnfurlCi", { env, config })
  const prod = new ProdStack(app, "UnfurlProd", { env, config })
  return { ci: Template.fromStack(ci), prod: Template.fromStack(prod) }
}

const { ci, prod } = synth()
const production = synth({ "unfurl:profile": "production" }).prod
const noHost = synth({ "unfurl:apiHost": "", "unfurl:emailDomain": "" }).prod

type Container = {
  Name: string
  Image: unknown
  Environment?: { Name: string; Value: unknown }[]
  Secrets?: { Name: string }[]
  DependsOn?: { ContainerName: string; Condition: string }[]
  Command?: string[]
}

function containers(family: string): Container[] {
  const defs = prod.findResources("AWS::ECS::TaskDefinition", {
    Properties: { Family: family },
  })
  const [def] = Object.values(defs)
  if (!def) throw new Error(`no task definition ${family}`)
  return def.Properties.ContainerDefinitions
}

function container(family: string, name: string): Container {
  const c = containers(family).find((x) => x.Name === name)
  if (!c) throw new Error(`no container ${name} in ${family}`)
  return c
}

const envNames = (c: Container) => (c.Environment ?? []).map((e) => e.Name)
const secretNames = (c: Container) => (c.Secrets ?? []).map((s) => s.Name)
const envValue = (c: Container, name: string) =>
  c.Environment?.find((e) => e.Name === name)?.Value

describe("CI stack", () => {
  test("ECR repository keeps tags immutable and scans on push", () => {
    ci.hasResourceProperties("AWS::ECR::Repository", {
      RepositoryName: "unfurl-backend",
      ImageTagMutability: "IMMUTABLE",
      ImageScanningConfiguration: { ScanOnPush: true },
    })
  })

  test("deploy role trusts only the repo's production environment", () => {
    ci.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "unfurl-github-deploy",
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub":
                  "repo:Real-Solutions-PH/personal-sop:environment:production",
              },
            },
          }),
        ],
      },
    })
  })
})

describe("network", () => {
  test("an S3 gateway endpoint in both profiles", () => {
    for (const t of [prod, production]) {
      t.resourceCountIs("AWS::EC2::VPCEndpoint", 1)
      t.hasResourceProperties("AWS::EC2::VPCEndpoint", {
        VpcEndpointType: "Gateway",
      })
    }
  })

  test("lean: one t4g.nano NAT instance holding the fixed Elastic IP, no NAT gateway", () => {
    prod.resourceCountIs("AWS::EC2::NatGateway", 0)
    prod.resourceCountIs("AWS::EC2::Instance", 1)
    prod.hasResourceProperties("AWS::EC2::Instance", {
      InstanceType: "t4g.nano",
      SourceDestCheck: false,
    })
    prod.resourceCountIs("AWS::EC2::EIPAssociation", 1)
  })

  test("production: one managed NAT gateway on the fixed Elastic IP", () => {
    production.resourceCountIs("AWS::EC2::NatGateway", 1)
    production.resourceCountIs("AWS::EC2::Instance", 0)
  })
})

describe("profiles", () => {
  const service = (t: Template, name: string) =>
    Object.values(t.findResources("AWS::ECS::Service")).find(
      (s) => s.Properties.ServiceName === name,
    )?.Properties.DesiredCount

  test("lean is the default in cdk.json", () => {
    expect(cdkJson.context["unfurl:profile"]).toBe("lean")
  })

  test("lean: one task per service, the smallest database", () => {
    expect(service(prod, "unfurl-api")).toBe(1)
    expect(service(prod, "unfurl-gotrue")).toBe(1)
    expect(service(prod, "unfurl-worker")).toBe(1)
    prod.hasResourceProperties("AWS::RDS::DBInstance", {
      DBInstanceClass: "db.t4g.micro",
    })
    prod.hasResourceProperties("AWS::ElastiCache::ReplicationGroup", {
      CacheNodeType: "cache.t4g.micro",
    })
  })

  test("production: two API and two GoTrue tasks, db.t4g.small", () => {
    expect(service(production, "unfurl-api")).toBe(2)
    expect(service(production, "unfurl-gotrue")).toBe(2)
    expect(service(production, "unfurl-worker")).toBe(1)
    production.hasResourceProperties("AWS::RDS::DBInstance", {
      DBInstanceClass: "db.t4g.small",
    })
  })

  test("task sizes are valid Fargate combinations", () => {
    // vCPU units → allowed memory (MiB) for the sizes these profiles use.
    const allowed: Record<number, number[]> = {
      256: [512, 1024, 2048],
      512: [1024, 2048, 3072, 4096],
    }
    for (const sizing of Object.values(PROFILES)) {
      for (const t of [sizing.api, sizing.worker, sizing.gotrue]) {
        expect(allowed[t.cpu]).toContain(t.memoryMiB)
      }
    }
  })

  test("an unknown profile is refused", () => {
    expect(() => synth({ "unfurl:profile": "huge" })).toThrow(/unfurl:profile/)
  })
})

describe("database", () => {
  test("Postgres 18, private, encrypted, backed up, protected", () => {
    prod.hasResourceProperties("AWS::RDS::DBInstance", {
      Engine: "postgres",
      EngineVersion: "18.6",
      DBName: "app",
      PubliclyAccessible: false,
      StorageEncrypted: true,
      BackupRetentionPeriod: 7,
      DeletionProtection: true,
    })
    prod.hasResource("AWS::RDS::DBInstance", {
      DeletionPolicy: "Snapshot",
    })
  })

  test("auth database and roles are set up by a custom resource in the VPC", () => {
    prod.hasResourceProperties("AWS::CloudFormation::CustomResource", {
      AppDatabase: "app",
      MasterSecretArn: Match.anyValue(),
      AuthSecretArn: Match.anyValue(),
    })
  })
})

describe("load balancer", () => {
  test("idle timeout raised for server-sent-event streams", () => {
    prod.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
      LoadBalancerAttributes: Match.arrayWith([
        {
          Key: "idle_timeout.timeout_seconds",
          Value: String(ALB_IDLE_TIMEOUT_SECONDS),
        },
      ]),
    })
    expect(ALB_IDLE_TIMEOUT_SECONDS).toBeGreaterThan(60)
  })

  test("routes /api/* and /auth/v1/*, 404 for anything else", () => {
    for (const p of ["/api/*", "/auth/v1/*"]) {
      prod.hasResourceProperties("AWS::ElasticLoadBalancingV2::ListenerRule", {
        Conditions: [
          { Field: "path-pattern", PathPatternConfig: { Values: [p] } },
        ],
      })
    }
    prod.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      DefaultActions: [
        Match.objectLike({
          Type: "fixed-response",
          FixedResponseConfig: { StatusCode: "404" },
        }),
      ],
    })
  })

  test("health checks: API health-check route and GoTrue through the proxy", () => {
    prod.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      Port: 8000,
      HealthCheckPath: "/api/v1/utils/health-check/",
    })
    prod.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      Port: 8080,
      HealthCheckPath: "/auth/v1/health",
    })
  })

  test("no host: plain HTTP, no certificate, no SES identity", () => {
    noHost.resourceCountIs("AWS::CertificateManager::Certificate", 0)
    noHost.resourceCountIs("AWS::SES::EmailIdentity", 0)
  })

  test("API host: an ACM certificate (DNS-validated) and HTTPS only, no port 80", () => {
    prod.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: "unfurl-api.realsolutionsph.com",
      ValidationMethod: "DNS",
    })
    prod.resourceCountIs("AWS::ElasticLoadBalancingV2::Listener", 1)
    prod.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      Port: 443,
      Protocol: "HTTPS",
    })
    prod.resourceCountIs("AWS::Route53::RecordSet", 0)
  })

  test("the ALB admits only Cloudflare's edge, on 443", () => {
    const [sg] = Object.values(
      prod.findResources("AWS::EC2::SecurityGroup", {
        Properties: { GroupName: "unfurl-alb" },
      }),
    )
    const ingress = sg.Properties.SecurityGroupIngress as {
      CidrIp?: string
      FromPort: number
      ToPort: number
    }[]
    expect(ingress.map((r) => r.CidrIp).sort()).toEqual(
      [...CLOUDFLARE_IPV4].sort(),
    )
    for (const r of ingress) expect([r.FromPort, r.ToPort]).toEqual([443, 443])
  })

  test("SES identity on the email subdomain, with a custom MAIL FROM", () => {
    prod.hasResourceProperties("AWS::SES::EmailIdentity", {
      EmailIdentity: "unfurl.realsolutionsph.com",
    })
    prod.hasResourceProperties("AWS::SES::EmailIdentity", {
      MailFromAttributes: { MailFromDomain: "mail.unfurl.realsolutionsph.com" },
    })
  })

  test("public URLs: the API host, the sender, and the site", () => {
    const api = container("unfurl-api", "api")
    expect(envValue(api, "SUPABASE_URL")).toBe(
      "https://unfurl-api.realsolutionsph.com",
    )
    expect(envValue(api, "EMAILS_FROM_EMAIL")).toBe(
      "noreply@unfurl.realsolutionsph.com",
    )
    expect(envValue(api, "FRONTEND_HOST")).toBe(
      "https://unfurl.realsolutionsph.com",
    )
    const gotrue = container("unfurl-gotrue", "gotrue")
    expect(envValue(gotrue, "GOTRUE_JWT_ISSUER")).toBe(
      "https://unfurl-api.realsolutionsph.com/auth/v1",
    )
    expect(envValue(gotrue, "GOTRUE_SMTP_ADMIN_EMAIL")).toBe(
      "noreply@unfurl.realsolutionsph.com",
    )
  })
})

describe("WAF", () => {
  const acl = () => {
    const [res] = Object.values(prod.findResources("AWS::WAFv2::WebACL"))
    return res.Properties.Rules as {
      Name: string
      Statement: {
        RateBasedStatement?: { Limit: number; ScopeDownStatement?: unknown }
      }
    }[]
  }

  test("is attached to the ALB", () => {
    prod.resourceCountIs("AWS::WAFv2::WebACLAssociation", 1)
  })

  test("rate-limits /auth/v1/* except the NAT address", () => {
    const rule = acl().find((r) => r.Name === "auth-rate")
    expect(rule?.Statement.RateBasedStatement?.Limit).toBe(RATE_LIMITS.auth)
    const scope = JSON.stringify(
      rule?.Statement.RateBasedStatement?.ScopeDownStatement,
    )
    expect(scope).toContain("/auth/v1/")
    expect(scope).toContain("NotStatement")
  })

  test("behind Cloudflare, every rate rule keys on CF-Connecting-IP", () => {
    const rules = acl().filter((r) => r.Statement.RateBasedStatement)
    expect(rules.length).toBe(3)
    for (const r of rules) {
      expect(r.Statement.RateBasedStatement).toMatchObject({
        AggregateKeyType: "FORWARDED_IP",
        ForwardedIPConfig: { HeaderName: "CF-Connecting-IP" },
      })
    }
    const auth = JSON.stringify(acl().find((r) => r.Name === "auth-rate"))
    expect(auth).toContain(
      '"IPSetForwardedIPConfig":{"FallbackBehavior":"NO_MATCH","HeaderName":"CF-Connecting-IP"',
    )
  })

  test("without a proxy, rate rules key on the peer address", () => {
    const [res] = Object.values(noHost.findResources("AWS::WAFv2::WebACL"))
    const rules = (
      res.Properties.Rules as { Statement: { RateBasedStatement?: object } }[]
    )
      .map((r) => r.Statement.RateBasedStatement)
      .filter(Boolean)
    for (const r of rules) expect(r).toMatchObject({ AggregateKeyType: "IP" })
  })

  test("rate-limits the AI endpoints", () => {
    const rule = acl().find((r) => r.Name === "ai-rate")
    expect(rule?.Statement.RateBasedStatement?.Limit).toBe(RATE_LIMITS.ai)
    expect(JSON.stringify(rule?.Statement)).toContain(AI_PATH_REGEX)
    for (const p of [
      "/api/v1/companion/ask/stream",
      "/api/v1/capture/x",
      "/api/v1/chat/",
    ]) {
      expect(new RegExp(AI_PATH_REGEX).test(p)).toBe(true)
    }
    for (const p of ["/api/v1/tasks/", "/api/v1/ai-free/"]) {
      expect(new RegExp(AI_PATH_REGEX).test(p)).toBe(false)
    }
  })
})

describe("services", () => {
  test("GoTrue image is pinned, never latest", () => {
    expect(IMAGES.gotrue).toMatch(/:v\d+\.\d+\.\d+$/)
    expect(IMAGES.nginx).toMatch(/:\d+\.\d+\.\d+-alpine$/)
    expect(container("unfurl-gotrue", "gotrue").Image).toBe(IMAGES.gotrue)
  })

  test("backend containers run the pushed image tag", () => {
    const image = JSON.stringify(container("unfurl-api", "api").Image)
    expect(image).toContain(":abc1234")
  })

  test("the worker runs migrations first and only starts on their success", () => {
    const migrate = container("unfurl-worker", "migrate")
    expect(migrate.Command).toEqual(["bash", "scripts/prestart.sh"])
    expect(container("unfurl-worker", "worker").DependsOn).toEqual([
      { ContainerName: "migrate", Condition: "SUCCESS" },
    ])
    prod.hasResourceProperties("AWS::ECS::Service", {
      ServiceName: "unfurl-worker",
      DesiredCount: 1,
      DeploymentConfiguration: Match.objectLike({
        MinimumHealthyPercent: 0,
        MaximumPercent: 100,
      }),
    })
  })

  test("the API service updates only after the worker (and so the migration)", () => {
    const services = prod.findResources("AWS::ECS::Service")
    const [apiId, api] = Object.entries(services).find(
      ([, s]) => s.Properties.ServiceName === "unfurl-api",
    ) ?? [undefined, undefined]
    const [workerId] = Object.entries(services).find(
      ([, s]) => s.Properties.ServiceName === "unfurl-worker",
    ) ?? [undefined]
    expect(apiId).toBeDefined()
    expect(api?.DependsOn).toContain(workerId)
  })

  // Settings whose NAMES look secret but whose values are policy, not keys.
  const notSecret = new Set([
    "GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED",
    "GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL",
    "GOTRUE_PASSWORD_MIN_LENGTH",
  ])

  test("no secret is a plain environment variable", () => {
    for (const [family, name] of [
      ["unfurl-api", "api"],
      ["unfurl-worker", "worker"],
      ["unfurl-gotrue", "gotrue"],
    ] as const) {
      const c = container(family, name)
      const leaked = envNames(c).filter(
        (n) =>
          !notSecret.has(n) &&
          /PASSWORD|SECRET|_KEY$|TOKEN|KEK|JWT_KEYS|DSN|_PASS$/.test(n),
      )
      expect({ family, leaked }).toEqual({ family, leaked: [] })
    }
  })

  test("GoTrue gets its signing keys and DB password from Secrets Manager", () => {
    const c = container("unfurl-gotrue", "gotrue")
    expect(secretNames(c)).toEqual(
      expect.arrayContaining([
        "DB_PASSWORD",
        "GOTRUE_JWT_KEYS",
        "GOTRUE_JWT_SECRET",
      ]),
    )
    expect(envValue(c, "GOTRUE_JWT_AUD")).toBe("authenticated")
  })

  test("the auth proxy strips /auth/v1 before GoTrue", () => {
    const conf = envValue(
      container("unfurl-gotrue", "auth-proxy"),
      "NGINX_CONF",
    )
    expect(String(conf)).toContain(
      "location /auth/v1/ {\n    proxy_pass http://127.0.0.1:9999/;",
    )
    expect(String(conf)).toContain("location = /auth/v1/health")
    // GoTrue's per-IP limits see the visitor, not the Cloudflare edge.
    expect(String(conf)).toContain("real_ip_header CF-Connecting-IP;")
  })
})

describe("backend environment", () => {
  const configPy = readFileSync(
    path.join(
      import.meta.dir,
      "..",
      "..",
      "backend",
      "app",
      "core",
      "config.py",
    ),
    "utf8",
  )
  const settings = [...configPy.matchAll(/^ {4}([A-Z][A-Z0-9_]+):/gm)].map(
    (m) => m[1],
  )
  const api = container("unfurl-api", "api")
  const provided = new Set([...envNames(api), ...secretNames(api)])

  test("the settings parse found the known fields (guards the regex)", () => {
    expect(settings).toContain("POSTGRES_SERVER")
    expect(settings).toContain("SUPABASE_SERVICE_ROLE_KEY")
    expect(settings.length).toBeGreaterThan(60)
  })

  test("every backend setting is set by the stack or listed as defaulted", () => {
    const unaccounted = settings.filter(
      (s) => !provided.has(s) && !(s in BACKEND_DEFAULTED),
    )
    expect(unaccounted).toEqual([])
  })

  test("nothing is both set and listed as defaulted", () => {
    const both = Object.keys(BACKEND_DEFAULTED).filter((s) => provided.has(s))
    expect(both).toEqual([])
  })

  test("the defaulted list names only real settings", () => {
    const stale = Object.keys(BACKEND_DEFAULTED).filter(
      (s) => !settings.includes(s),
    )
    expect(stale).toEqual([])
  })

  test("the worker and the migration get the same environment as the API", () => {
    for (const name of ["worker", "migrate"]) {
      const c = container("unfurl-worker", name)
      expect(new Set([...envNames(c), ...secretNames(c)])).toEqual(provided)
    }
  })
})

describe("storage and data", () => {
  test("media bucket is private and TLS-only", () => {
    prod.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    })
  })

  test("cache is encrypted in transit and the backend uses rediss://", () => {
    prod.hasResourceProperties("AWS::ElastiCache::ReplicationGroup", {
      TransitEncryptionEnabled: true,
      AtRestEncryptionEnabled: true,
    })
    expect(
      JSON.stringify(envValue(container("unfurl-api", "api"), "REDIS_URL")),
    ).toContain("rediss://")
  })
})

describe("alarms", () => {
  test("health alarms exist for the API and sign-in", () => {
    for (const name of [
      "unfurl-api-unhealthy",
      "unfurl-auth-unhealthy",
      "unfurl-auth-no-healthy-hosts",
      "unfurl-worker-down",
    ]) {
      prod.hasResourceProperties("AWS::CloudWatch::Alarm", { AlarmName: name })
    }
  })
})
