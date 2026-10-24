import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { App } from "aws-cdk-lib"
import { Match, Template } from "aws-cdk-lib/assertions"
import { BACKEND_DEFAULTED } from "../lib/backend-env"
import { CiStack } from "../lib/ci-stack"
import { RATE_LIMITS } from "../lib/cloudflare"
import {
  IMAGES,
  LOOKS_LIKE_ARN_SUFFIX,
  loadConfig,
  PROFILES,
  THIRD_PARTY_SECRET,
  TUNNEL_TOKEN_SECRET,
} from "../lib/config"
import { ProdStack } from "../lib/prod-stack"

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

type Container = {
  Name: string
  Image: unknown
  Environment?: { Name: string; Value: unknown }[]
  Secrets?: { Name: string }[]
  DependsOn?: { ContainerName: string; Condition: string }[]
  Command?: string[]
}

function containers(family: string, t: Template = prod): Container[] {
  const defs = t.findResources("AWS::ECS::TaskDefinition", {
    Properties: { Family: family },
  })
  const [def] = Object.values(defs)
  if (!def) throw new Error(`no task definition ${family}`)
  return def.Properties.ContainerDefinitions
}

function container(
  family: string,
  name: string,
  t: Template = prod,
): Container {
  const c = containers(family, t).find((x) => x.Name === name)
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

describe("network: no NAT, no load balancer", () => {
  test("no NAT of any kind, no load balancer, WAF or certificate", () => {
    for (const t of [prod, production]) {
      t.resourceCountIs("AWS::EC2::NatGateway", 0)
      t.resourceCountIs("AWS::EC2::Instance", 0)
      t.resourceCountIs("AWS::EC2::EIP", 0)
      t.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 0)
      t.resourceCountIs("AWS::WAFv2::WebACL", 0)
      t.resourceCountIs("AWS::CertificateManager::Certificate", 0)
    }
  })

  test("an S3 gateway endpoint (free) and no interface endpoints", () => {
    prod.resourceCountIs("AWS::EC2::VPCEndpoint", 1)
    prod.hasResourceProperties("AWS::EC2::VPCEndpoint", {
      VpcEndpointType: "Gateway",
    })
  })

  test("every service runs in a public subnet with a public IP", () => {
    const services = Object.values(prod.findResources("AWS::ECS::Service"))
    expect(services.length).toBe(4)
    for (const s of services) {
      expect(
        s.Properties.NetworkConfiguration.AwsvpcConfiguration.AssignPublicIp,
      ).toBe("ENABLED")
    }
  })

  const groups = () => prod.findResources("AWS::EC2::SecurityGroup")
  const byName = (name: string) => {
    const g = Object.entries(groups()).find(
      ([, r]) => r.Properties.GroupName === name,
    )
    if (!g) throw new Error(`no security group ${name}`)
    return g
  }
  const ingressTo = (logicalId: string) =>
    Object.values(prod.findResources("AWS::EC2::SecurityGroupIngress")).filter(
      (r) => JSON.stringify(r.Properties.GroupId).includes(`"${logicalId}"`),
    )
  const ref = (id: string) => JSON.stringify({ "Fn::GetAtt": [id, "GroupId"] })

  test("no security group admits anything from the internet", () => {
    const inline = Object.values(groups()).flatMap(
      (g) => g.Properties.SecurityGroupIngress ?? [],
    )
    const separate = Object.values(
      prod.findResources("AWS::EC2::SecurityGroupIngress"),
    ).map((r) => r.Properties)
    for (const rule of [...inline, ...separate]) {
      expect(rule.CidrIp).toBeUndefined()
      expect(rule.CidrIpv6).toBeUndefined()
    }
  })

  test("the tunnel and worker accept no inbound at all", () => {
    for (const name of ["unfurl-tunnel", "unfurl-worker"]) {
      const [id, g] = byName(name)
      expect(g.Properties.SecurityGroupIngress ?? []).toEqual([])
      expect(ingressTo(id)).toEqual([])
    }
  })

  test("the API admits only the tunnel; the auth proxy only the tunnel, API and worker", () => {
    const [tunnelId] = byName("unfurl-tunnel")
    const [apiId] = byName("unfurl-api")
    const [workerId] = byName("unfurl-worker")
    const [gotrueId] = byName("unfurl-gotrue")
    const sources = (id: string) =>
      ingressTo(id).map((r) => [
        JSON.stringify(r.Properties.SourceSecurityGroupId),
        r.Properties.FromPort,
      ])
    expect(sources(apiId)).toEqual([[ref(tunnelId), 8000]])
    expect(
      sources(gotrueId)
        .map(([src]) => src)
        .sort(),
    ).toEqual([tunnelId, apiId, workerId].map(ref).sort())
    for (const [, port] of sources(gotrueId)) expect(port).toBe(8080)
  })

  test("egress is listed, not open", () => {
    const [, tunnel] = byName("unfurl-tunnel")
    type Rule = { IpProtocol: string; FromPort: number; CidrIp?: string }
    const out = (g: object) =>
      (
        (g as { Properties: { SecurityGroupEgress?: Rule[] } }).Properties
          .SecurityGroupEgress ?? []
      )
        .filter((r) => r.CidrIp === "0.0.0.0/0")
        .map((r) => `${r.IpProtocol}/${r.FromPort}`)
        .sort()
    expect(out(tunnel)).toEqual(["tcp/443", "tcp/7844", "udp/7844"])
    expect(out(byName("unfurl-api")[1])).toEqual(["tcp/443", "tcp/587"])
    expect(out(byName("unfurl-gotrue")[1])).toEqual(["tcp/443", "tcp/587"])
  })

  test("the database and cache admit only the task groups", () => {
    const [dbId] = byName("unfurl-db")
    const [redisId] = byName("unfurl-redis")
    expect(ingressTo(dbId).map((r) => r.Properties.FromPort)).toEqual([
      5432, 5432, 5432,
    ])
    expect(ingressTo(redisId).map((r) => r.Properties.FromPort)).toEqual([
      6379, 6379,
    ])
  })
})

describe("tunnel", () => {
  test("one cloudflared service, pinned image, token from the script-owned secret", () => {
    const c = container("unfurl-tunnel", "cloudflared")
    expect(IMAGES.cloudflared).toMatch(
      /^cloudflare\/cloudflared:\d{4}\.\d+\.\d+$/,
    )
    expect(c.Image).toBe(IMAGES.cloudflared)
    expect(c.Command).toEqual(["tunnel", "--metrics", "0.0.0.0:2000", "run"])
    expect(secretNames(c)).toEqual(["TUNNEL_TOKEN"])
    expect(JSON.stringify(c.Secrets)).toContain("secret:unfurl/tunnel-token")
  })

  test("the backend tasks read the script-owned third-party secret by its partial ARN", () => {
    const policies = JSON.stringify(prod.findResources("AWS::IAM::Policy"))
    expect(policies).toContain("secret:unfurl/third-party*")
    const nebius = container("unfurl-api", "api").Secrets?.find(
      (x) => x.Name === "NEBIUS_API_KEY",
    )
    expect(JSON.stringify(nebius)).toContain("secret:unfurl/third-party")
  })

  test("the tunnel's execution role can read the token secret by its partial ARN", () => {
    // ECS asks for `secret:unfurl/tunnel-token` without the random
    // suffix; a `-??????` resource alone was denied on the first deploy.
    const policies = JSON.stringify(prod.findResources("AWS::IAM::Policy"))
    expect(policies).toContain("secret:unfurl/tunnel-token*")
  })

  test("every task stop, with its reason, goes to a kept log group", () => {
    const rules = Object.values(prod.findResources("AWS::Events::Rule"))
    const stop = rules.find((r) =>
      JSON.stringify(r.Properties.EventPattern).includes(
        "ECS Task State Change",
      ),
    )
    expect(stop?.Properties.EventPattern.detail.lastStatus).toEqual(["STOPPED"])
    const target = JSON.stringify(stop?.Properties.Targets)
    expect(target).toContain("logs")
    expect(target).toContain("EcsEventsLogs")
  })

  test("API and GoTrue register in private DNS as api. and auth.unfurl.internal", () => {
    prod.hasResourceProperties("AWS::ServiceDiscovery::PrivateDnsNamespace", {
      Name: "unfurl.internal",
    })
    for (const name of ["api", "auth"]) {
      prod.hasResourceProperties("AWS::ServiceDiscovery::Service", {
        Name: name,
        DnsConfig: Match.objectLike({
          DnsRecords: [{ Type: "A", TTL: 10 }],
        }),
      })
    }
  })

  test("the backend reaches GoTrue privately but checks the public issuer", () => {
    const api = container("unfurl-api", "api")
    const issuer = "https://unfurl-api.realsolutionsph.com/auth/v1"
    expect(envValue(api, "SUPABASE_URL")).toBe(
      "http://auth.unfurl.internal:8080",
    )
    expect(envValue(api, "SUPABASE_JWT_ISSUER")).toBe(issuer)
    expect(
      envValue(container("unfurl-gotrue", "gotrue"), "GOTRUE_JWT_ISSUER"),
    ).toBe(issuer)
  })

  test("the tunnel service starts after the API and GoTrue", () => {
    const services = prod.findResources("AWS::ECS::Service")
    const id = (name: string) =>
      Object.entries(services).find(
        ([, s]) => s.Properties.ServiceName === name,
      )?.[0]
    const tunnel = Object.values(services).find(
      (s) => s.Properties.ServiceName === "unfurl-tunnel",
    )
    expect(tunnel?.DependsOn).toEqual(
      expect.arrayContaining([id("unfurl-api"), id("unfurl-gotrue")]),
    )
  })
})

describe("Graviton", () => {
  test("every task definition is ARM64", () => {
    const defs = Object.values(prod.findResources("AWS::ECS::TaskDefinition"))
    expect(defs.length).toBe(4)
    for (const d of defs) {
      expect(d.Properties.RuntimePlatform).toEqual({
        CpuArchitecture: "ARM64",
        OperatingSystemFamily: "LINUX",
      })
    }
  })
})

describe("in-app rate limits replace the WAF", () => {
  test("the API gets the visitor header and the per-minute budgets", () => {
    const api = container("unfurl-api", "api")
    expect(envValue(api, "CLIENT_IP_HEADER")).toBe("CF-Connecting-IP")
    expect(envValue(api, "RATE_LIMIT_AI_PER_MINUTE")).toBe(
      String(RATE_LIMITS.aiPerMinute),
    )
    expect(envValue(api, "RATE_LIMIT_ACCOUNT_PER_MINUTE")).toBe(
      String(RATE_LIMITS.accountPerMinute),
    )
  })

  test("sign-up is confirmed at once unless email confirmation is required", () => {
    // SES is in its sandbox, so a confirmation email to a new address
    // never arrives; the default must not wait for one.
    expect(
      envValue(
        container("unfurl-gotrue", "gotrue"),
        "GOTRUE_MAILER_AUTOCONFIRM",
      ),
    ).toBe("true")
    const strict = synth({ "unfurl:requireEmailConfirmation": true }).prod
    expect(
      envValue(
        container("unfurl-gotrue", "gotrue", strict),
        "GOTRUE_MAILER_AUTOCONFIRM",
      ),
    ).toBe("false")
  })

  test("GoTrue's own per-address limits are on, keyed on the visitor", () => {
    const g = container("unfurl-gotrue", "gotrue")
    expect(envValue(g, "GOTRUE_RATE_LIMIT_HEADER")).toBe("X-Real-IP")
    for (const k of [
      "GOTRUE_RATE_LIMIT_EMAIL_SENT",
      "GOTRUE_RATE_LIMIT_TOKEN_REFRESH",
      "GOTRUE_RATE_LIMIT_VERIFY",
    ]) {
      expect(Number(envValue(g, k))).toBeGreaterThan(0)
    }
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

  test("lean (up to 5 users): every task at Fargate's smallest size, one uvicorn worker", () => {
    for (const family of [
      "unfurl-api",
      "unfurl-worker",
      "unfurl-gotrue",
      "unfurl-tunnel",
    ]) {
      prod.hasResourceProperties("AWS::ECS::TaskDefinition", {
        Family: family,
        Cpu: "256",
        Memory: "512",
      })
    }
    expect(container("unfurl-api", "api").Command).toEqual([
      "fastapi",
      "run",
      "--workers",
      "1",
      "--port",
      "8000",
      "app/main.py",
    ])
  })

  test("production: the API runs two uvicorn workers in 1 GB", () => {
    production.hasResourceProperties("AWS::ECS::TaskDefinition", {
      Family: "unfurl-api",
      Cpu: "512",
      Memory: "1024",
    })
    const [api] = Object.values(
      production.findResources("AWS::ECS::TaskDefinition", {
        Properties: { Family: "unfurl-api" },
      }),
    )
    expect(api.Properties.ContainerDefinitions[0].Command.slice(2, 4)).toEqual([
      "--workers",
      "2",
    ])
  })

  test("scaling is configuration: overrides change counts, sizes and the DB class", () => {
    const scaled = synth({
      "unfurl:sizingOverrides": {
        api: { count: 3, cpu: 512, memoryMiB: 1024, workers: 2 },
        database: "t4g.small",
      },
    }).prod
    scaled.hasResourceProperties("AWS::ECS::Service", {
      ServiceName: "unfurl-api",
      DesiredCount: 3,
    })
    scaled.hasResourceProperties("AWS::ECS::TaskDefinition", {
      Family: "unfurl-api",
      Cpu: "512",
      Memory: "1024",
    })
    scaled.hasResourceProperties("AWS::RDS::DBInstance", {
      DBInstanceClass: "db.t4g.small",
    })
    // The rest of the profile is untouched.
    scaled.hasResourceProperties("AWS::ECS::TaskDefinition", {
      Family: "unfurl-gotrue",
      Cpu: "256",
      Memory: "512",
    })
  })

  test("overrides from the command line arrive as JSON text and work too", () => {
    const cli = synth({
      "unfurl:sizingOverrides": '{"gotrue":{"count":2}}',
    }).prod
    cli.hasResourceProperties("AWS::ECS::Service", {
      ServiceName: "unfurl-gotrue",
      DesiredCount: 2,
    })
  })

  test("a typo or an impossible size is refused, never silently defaulted", () => {
    expect(() =>
      synth({ "unfurl:sizingOverrides": { apii: { count: 2 } } }),
    ).toThrow(/unknown key "apii"/)
    expect(() =>
      synth({ "unfurl:sizingOverrides": { api: { cont: 2 } } }),
    ).toThrow(/unknown field "cont"/)
    expect(() =>
      synth({ "unfurl:sizingOverrides": { api: { memoryMiB: 768 } } }),
    ).toThrow(/not a Fargate size/)
    expect(() =>
      synth({ "unfurl:sizingOverrides": { api: { workers: 0 } } }),
    ).toThrow(/at least 1/)
  })

  test("lean: one task per service, the smallest database and cache", () => {
    for (const name of [
      "unfurl-api",
      "unfurl-gotrue",
      "unfurl-worker",
      "unfurl-tunnel",
    ]) {
      expect(service(prod, name)).toBe(1)
    }
    prod.hasResourceProperties("AWS::RDS::DBInstance", {
      DBInstanceClass: "db.t4g.micro",
    })
    prod.hasResourceProperties("AWS::ElastiCache::ReplicationGroup", {
      CacheNodeType: "cache.t4g.micro",
    })
  })

  test("production: two API, GoTrue and tunnel tasks, db.t4g.small", () => {
    expect(service(production, "unfurl-api")).toBe(2)
    expect(service(production, "unfurl-gotrue")).toBe(2)
    expect(service(production, "unfurl-tunnel")).toBe(2)
    expect(service(production, "unfurl-worker")).toBe(1)
    production.hasResourceProperties("AWS::RDS::DBInstance", {
      DBInstanceClass: "db.t4g.small",
    })
  })

  test("task sizes are valid Fargate combinations", () => {
    const allowed: Record<number, number[]> = {
      256: [512, 1024, 2048],
      512: [1024, 2048, 3072, 4096],
    }
    for (const sizing of Object.values(PROFILES)) {
      for (const t of [
        sizing.api,
        sizing.worker,
        sizing.gotrue,
        sizing.tunnel,
      ]) {
        expect(allowed[t.cpu]).toContain(t.memoryMiB)
      }
    }
  })

  test("an unknown profile, or a missing API host, is refused", () => {
    expect(() => synth({ "unfurl:profile": "huge" })).toThrow(/unfurl:profile/)
    expect(() => synth({ "unfurl:apiHost": "" })).toThrow(/unfurl:apiHost/)
  })
})

describe("email", () => {
  test("SES identity on the email subdomain, with a custom MAIL FROM", () => {
    prod.hasResourceProperties("AWS::SES::EmailIdentity", {
      EmailIdentity: "unfurl.realsolutionsph.com",
      MailFromAttributes: { MailFromDomain: "mail.unfurl.realsolutionsph.com" },
    })
    const api = container("unfurl-api", "api")
    expect(envValue(api, "EMAILS_FROM_EMAIL")).toBe(
      "noreply@unfurl.realsolutionsph.com",
    )
    expect(envValue(api, "FRONTEND_HOST")).toBe(
      "https://unfurl.realsolutionsph.com",
    )
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
    "GOTRUE_RATE_LIMIT_TOKEN_REFRESH",
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

  test("GoTrue starts only after the database setup container succeeds", () => {
    const setup = container("unfurl-gotrue", "db-setup")
    expect(setup.Command?.slice(0, 2)).toEqual(["python", "-c"])
    expect(secretNames(setup).sort()).toEqual([
      "APP_USER_PASSWORD",
      "AUTH_PASSWORD",
      "MASTER_PASSWORD",
    ])
    expect(container("unfurl-gotrue", "gotrue").DependsOn).toEqual([
      { ContainerName: "db-setup", Condition: "SUCCESS" },
    ])
    // Only the bootstrap-secrets custom resource remains.
    prod.resourceCountIs("AWS::CloudFormation::CustomResource", 1)
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

describe("secret names", () => {
  test("none ends like an ARN suffix (a hyphen and six characters)", () => {
    const names = [
      ...Object.values(prod.findResources("AWS::SecretsManager::Secret")).map(
        (r) => r.Properties.Name as string,
      ),
      TUNNEL_TOKEN_SECRET,
      THIRD_PARTY_SECRET,
    ]
    expect(names.length).toBeGreaterThan(8)
    for (const n of names)
      expect({ n, bad: LOOKS_LIKE_ARN_SUFFIX.test(n) }).toEqual({
        n,
        bad: false,
      })
    // The rule itself catches the name that broke the tunnel.
    expect(LOOKS_LIKE_ARN_SUFFIX.test("unfurl/cloudflared-tunnel")).toBe(true)
  })
})

describe("generated passwords", () => {
  test("are letters and digits only (they go into connection URLs)", () => {
    const generators = Object.values(
      prod.findResources("AWS::SecretsManager::Secret"),
    )
      .map((r) => r.Properties.GenerateSecretString)
      .filter(Boolean)
    // auth-db, app-user-db, app (first superuser), rds-master-user.
    expect(generators.length).toBe(4)
    for (const g of generators) {
      expect(g.ExcludePunctuation).toBe(true)
      expect(g.IncludeSpace).toBe(false)
      // A full punctuation deny-list is refused by Secrets Manager.
      expect(g.ExcludeCharacters).toBeUndefined()
      expect(g.PasswordLength).toBe(40)
    }
  })

  test("the RDS master secret is ours, named and kept", () => {
    prod.hasResource("AWS::SecretsManager::Secret", {
      Properties: Match.objectLike({ Name: "unfurl/rds-master-user" }),
      DeletionPolicy: "RetainExceptOnCreate",
    })
  })
})

describe("removal on a failed first create", () => {
  const named = (type: string, key: string, prefix: string) =>
    Object.values(prod.findResources(type)).filter((r) =>
      String(r.Properties?.[key] ?? "").startsWith(prefix),
    )

  test("named secrets and the media bucket are removed on create rollback, kept otherwise", () => {
    const secrets = named("AWS::SecretsManager::Secret", "Name", "unfurl/")
    const buckets = Object.values(prod.findResources("AWS::S3::Bucket")).filter(
      (r) =>
        JSON.stringify(r.Properties?.BucketName ?? "").includes("unfurl-media"),
    )
    expect(secrets.length).toBe(7)
    expect(buckets.length).toBe(1)
    for (const r of [...secrets, ...buckets]) {
      expect(r.DeletionPolicy).toBe("RetainExceptOnCreate")
    }
  })

  test("service log groups have generated names and are always kept", () => {
    const groups = Object.entries(
      prod.findResources("AWS::Logs::LogGroup"),
    ).filter(([id]) => /^(Api|Worker|Gotrue|Tunnel|EcsEvents)Logs/.test(id))
    expect(groups.length).toBe(5)
    for (const [, g] of groups) {
      expect(g.Properties.LogGroupName).toBeUndefined()
      expect(g.DeletionPolicy).toBe("Retain")
    }
  })

  test("database deletion protection is on by default and can be off for a first create", () => {
    prod.hasResourceProperties("AWS::RDS::DBInstance", {
      DeletionProtection: true,
    })
    const first = synth({ "unfurl:databaseDeletionProtection": "false" }).prod
    first.hasResourceProperties("AWS::RDS::DBInstance", {
      DeletionProtection: false,
    })
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
  test("a no-running-task alarm per service, plus the database", () => {
    for (const name of [
      "unfurl-api-down",
      "unfurl-auth-down",
      "unfurl-tunnel-down",
      "unfurl-worker-down",
      "unfurl-db-cpu",
      "unfurl-db-storage",
      "unfurl-api-memory",
      "unfurl-worker-memory",
    ]) {
      prod.hasResourceProperties("AWS::CloudWatch::Alarm", { AlarmName: name })
    }
  })

  test("the API and the auth proxy have container health checks", () => {
    expect(JSON.stringify(container("unfurl-api", "api"))).toContain(
      "/api/v1/utils/health-check/",
    )
    expect(JSON.stringify(container("unfurl-gotrue", "auth-proxy"))).toContain(
      "/auth/v1/health",
    )
  })
})
