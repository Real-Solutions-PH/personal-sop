import * as path from "node:path"
import { fileURLToPath } from "node:url"
import {
  CfnOutput,
  CustomResource,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  type StackProps,
} from "aws-cdk-lib"
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch"
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as ecr from "aws-cdk-lib/aws-ecr"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as elasticache from "aws-cdk-lib/aws-elasticache"
import * as events from "aws-cdk-lib/aws-events"
import * as eventsTargets from "aws-cdk-lib/aws-events-targets"
import * as iam from "aws-cdk-lib/aws-iam"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs"
import * as logs from "aws-cdk-lib/aws-logs"
import * as rds from "aws-cdk-lib/aws-rds"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery"
import * as ses from "aws-cdk-lib/aws-ses"
import * as sns from "aws-cdk-lib/aws-sns"
import * as snsSubs from "aws-cdk-lib/aws-sns-subscriptions"
import * as cr from "aws-cdk-lib/custom-resources"
import type { Construct } from "constructs"
import { CLIENT_IP_HEADER, RATE_LIMITS } from "./cloudflare"
import {
  BACKEND_REPOSITORY,
  IMAGES,
  internalUrl,
  POSTGRES_FULL_VERSION,
  POSTGRES_MAJOR_VERSION,
  PREFIX,
  SERVICE_NAMESPACE,
  SERVICE_PORTS,
  THIRD_PARTY_SECRET,
  TUNNEL_TOKEN_SECRET,
  type UnfurlConfig,
} from "./config"
import { DB_SETUP_PY } from "./db-setup"

const here = path.dirname(fileURLToPath(import.meta.url))
const lambdaEntry = (name: string) =>
  path.join(here, "..", "lambda", `${name}.ts`)

export interface ProdStackProps extends StackProps {
  config: UnfurlConfig
}

/** Ports inside the tasks. */
const API_PORT = SERVICE_PORTS.api
const GOTRUE_PORT = 9999
const AUTH_PROXY_PORT = SERVICE_PORTS.auth

/** Characters kept out of generated passwords that end up inside URLs. */
const URL_UNSAFE = " %+~`#$&*()|[]{}:;<>?!'/@\"\\,="

/**
 * nginx in the GoTrue task: serves `/auth/v1/*` and strips the prefix, as
 * Supabase's Kong gateway does, so `supabase-js` and the backend use the
 * same paths as against the local CLI stack. The client IP is Cloudflare's
 * CF-Connecting-IP, trusted from the VPC only (the tunnel and the backend
 * are the only callers), handed to GoTrue as X-Real-IP for its per-IP
 * rate limits.
 */
export const NGINX_CONF = `server {
  listen ${AUTH_PROXY_PORT};
  set_real_ip_from 10.0.0.0/8;
  real_ip_header ${CLIENT_IP_HEADER};
  client_max_body_size 1m;
  location = /auth/v1/health {
    proxy_pass http://127.0.0.1:${GOTRUE_PORT}/health;
  }
  location /auth/v1/ {
    proxy_pass http://127.0.0.1:${GOTRUE_PORT}/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 60s;
  }
  location / {
    return 404;
  }
}
`

/**
 * Kept when the stack is updated or deleted, but removed when a first
 * create rolls back. With plain RETAIN, a failed first create left the
 * secrets, log groups and bucket behind under their fixed names, and the
 * next create could not reuse those names (2026-10-24).
 */
const RETAIN = RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE

const ARM64: ecs.RuntimePlatform = {
  cpuArchitecture: ecs.CpuArchitecture.ARM64,
  operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
}

export class ProdStack extends Stack {
  /** Fixed AZs, so synth never needs an account lookup. */
  override get availabilityZones(): string[] {
    return [`${this.region}a`, `${this.region}b`]
  }

  constructor(scope: Construct, id: string, props: ProdStackProps) {
    super(scope, id, props)
    const { config } = props
    if (!config.imageTag) {
      throw new Error(
        "unfurl:imageTag is required: pass -c unfurl:imageTag=<git sha pushed to ECR>",
      )
    }
    const { sizing } = config

    // ---------------------------------------------------------------- network
    // No NAT and no load balancer. The tasks run in public subnets with a
    // public IP so they reach the internet directly (ECR, Secrets Manager,
    // CloudWatch, Nebius, Deepgram, Expo, Cloudflare), and their security
    // groups admit nothing from the internet: requests arrive through a
    // Cloudflare Tunnel that cloudflared opens outward. RDS and Valkey sit
    // in isolated subnets, reachable only from the task security groups. S3
    // goes through the free gateway endpoint.
    const vpc = new ec2.Vpc(this, "Vpc", {
      vpcName: PREFIX,
      ipAddresses: ec2.IpAddresses.cidr("10.40.0.0/16"),
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 22 },
        {
          name: "data",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
      gatewayEndpoints: {
        S3: { service: ec2.GatewayVpcEndpointAwsService.S3 },
      },
    })
    const taskSubnets = { subnetType: ec2.SubnetType.PUBLIC }
    const dataSubnets = { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }

    // Security groups: no rule admits the internet. Egress is listed per
    // group; SG-to-SG pairs are added where the callers are defined.
    const sg = (name: string, description: string) =>
      new ec2.SecurityGroup(this, `${name}Sg`, {
        vpc,
        description,
        securityGroupName: `${PREFIX}-${name.toLowerCase()}`,
        allowAllOutbound: false,
      })
    const tunnelSg = sg("Tunnel", "cloudflared: outbound to Cloudflare only")
    const apiSg = sg("Api", "API tasks")
    const workerSg = sg("Worker", "Job worker tasks")
    const gotrueSg = sg("Gotrue", "GoTrue tasks")
    const dbSg = sg("Db", "RDS PostgreSQL")
    const redisSg = sg("Redis", "ElastiCache")
    const https = ec2.Port.tcp(443)
    const smtp = ec2.Port.tcp(587)
    for (const group of [tunnelSg, apiSg, workerSg, gotrueSg]) {
      // Image pulls, Secrets Manager, CloudWatch Logs, S3, provider APIs.
      group.addEgressRule(ec2.Peer.anyIpv4(), https, "HTTPS out")
    }
    for (const group of [apiSg, workerSg, gotrueSg]) {
      group.addEgressRule(ec2.Peer.anyIpv4(), smtp, "SES SMTP (STARTTLS)")
    }
    // cloudflared's tunnel connections (QUIC, falling back to HTTP/2).
    tunnelSg.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(7844),
      "Cloudflare tunnel (HTTP/2)",
    )
    tunnelSg.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.udp(7844),
      "Cloudflare tunnel (QUIC)",
    )
    tunnelSg.connections.allowTo(apiSg, ec2.Port.tcp(API_PORT), "Tunnel to API")
    for (const caller of [tunnelSg, apiSg, workerSg]) {
      caller.connections.allowTo(
        gotrueSg,
        ec2.Port.tcp(AUTH_PROXY_PORT),
        "To the auth proxy",
      )
    }

    const publicUrl = `https://${config.apiHost}`
    const issuer = `${publicUrl}/auth/v1`

    // ---------------------------------------------------------------- secrets
    const secret = (
      name: string,
      description: string,
      opts: Partial<secretsmanager.SecretProps> = {},
    ) =>
      new secretsmanager.Secret(this, name, {
        secretName: `${PREFIX}/${name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}`,
        description,
        removalPolicy: RETAIN,
        ...opts,
      })
    const generatedPassword = (
      template: Record<string, string>,
    ): secretsmanager.SecretStringGenerator => ({
      secretStringTemplate: JSON.stringify(template),
      generateStringKey: "password",
      excludeCharacters: URL_UNSAFE,
      passwordLength: 40,
    })

    /** Filled by the bootstrap function: jwt_keys, jwt_secret, anon_key, service_role_key. */
    const gotrueSecret = secret(
      "Gotrue",
      "GoTrue ES256 signing key and anon/service_role JWTs",
      {
        secretStringValue: SecretValue.unsafePlainText("{}"),
      },
    )
    /** `supabase_auth_admin` database password. */
    const authDbSecret = secret("AuthDb", "GoTrue database role password", {
      generateSecretString: generatedPassword({
        username: "supabase_auth_admin",
      }),
    })
    /** `app_user` (non-owner, RLS-enforced) database password. */
    const appUserSecret = secret(
      "AppUserDb",
      "App database role (RLS) password",
      {
        generateSecretString: generatedPassword({ username: "app_user" }),
      },
    )
    /** Filled by the bootstrap function: SES SMTP username and password. */
    const smtpSecret = secret("Smtp", "SES SMTP credentials", {
      secretStringValue: SecretValue.unsafePlainText(
        JSON.stringify({ username: "", password: "" }),
      ),
    })
    /** Generated app secrets (the first superuser's password here, the AI
     * key-encryption key from the bootstrap function). */
    const appSecret = secret(
      "App",
      "Backend generated secrets: first superuser password, AI credentials KEK",
      {
        generateSecretString: {
          secretStringTemplate: JSON.stringify({ ai_credentials_kek: "" }),
          generateStringKey: "first_superuser_password",
          excludeCharacters: URL_UNSAFE,
          passwordLength: 32,
        },
      },
    )
    /** Third-party keys (Nebius, Deepgram, ...): an input, not something the
     * stack can make. `scripts/third-party-secrets.ts` creates and fills it
     * before the first deploy, as `scripts/cloudflare.ts` does the tunnel
     * token, because the API refuses to start with AI on and no Nebius key
     * (the second create, 2026-10-24, rolled back on exactly that). Read by
     * name, so its execution-role grant needs the partial-ARN wildcard. */
    const thirdPartySecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "ThirdPartySecret",
      THIRD_PARTY_SECRET,
    )
    const providersSecret = secret(
      "AuthProviders",
      "Sign in with Apple and Google client secrets",
      {
        secretStringValue: SecretValue.unsafePlainText(
          JSON.stringify({
            apple_client_id: "",
            apple_secret: "",
            google_client_id: "",
            google_secret: "",
          }),
        ),
      },
    )

    // -------------------------------------------------------------- database
    const db = new rds.DatabaseInstance(this, "Database", {
      instanceIdentifier: PREFIX,
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.of(
          POSTGRES_FULL_VERSION,
          POSTGRES_MAJOR_VERSION,
        ),
      }),
      instanceType: ec2.InstanceType.of(
        ...(sizing.database.split(".") as [
          ec2.InstanceClass,
          ec2.InstanceSize,
        ]),
      ),
      vpc,
      vpcSubnets: dataSubnets,
      securityGroups: [dbSg],
      multiAz: config.databaseMultiAz,
      databaseName: "app",
      credentials: rds.Credentials.fromGeneratedSecret("postgres", {
        secretName: `${PREFIX}/db-master`,
        excludeCharacters: URL_UNSAFE,
      }),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      // Automated backups make point-in-time restore available for the
      // whole retention window.
      backupRetention: Duration.days(7),
      preferredBackupWindow: "18:00-19:00", // 02:00-03:00 Manila
      preferredMaintenanceWindow: "sun:19:30-sun:20:30",
      autoMinorVersionUpgrade: true,
      // On by default. A first create can run with it off
      // (`-c unfurl:databaseDeletionProtection=false`) so a failure rolls
      // back cleanly; turn it on with the next deploy once data lands.
      deletionProtection: config.databaseDeletionProtection,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      enablePerformanceInsights: true,
      cloudwatchLogsExports: ["postgresql"],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_MONTH,
    })
    const masterSecret = db.secret
    if (!masterSecret) throw new Error("RDS did not generate a master secret")
    for (const peer of [apiSg, workerSg, gotrueSg]) {
      peer.connections.allowTo(dbSg, ec2.Port.tcp(5432), "Postgres")
    }

    // ----------------------------------------------------------------- redis
    const redisSubnets = new elasticache.CfnSubnetGroup(this, "RedisSubnets", {
      cacheSubnetGroupName: PREFIX,
      description: "Isolated subnets for the cache",
      subnetIds: vpc.selectSubnets(dataSubnets).subnetIds,
    })
    const redis = new elasticache.CfnReplicationGroup(this, "Redis", {
      replicationGroupId: PREFIX,
      replicationGroupDescription:
        "Rate limits, event replay and caches (replaces the compose redis)",
      engine: "valkey",
      engineVersion: "8.0",
      cacheNodeType: sizing.cache,
      numCacheClusters: 1,
      automaticFailoverEnabled: false,
      transitEncryptionEnabled: true,
      atRestEncryptionEnabled: true,
      cacheSubnetGroupName: redisSubnets.ref,
      securityGroupIds: [redisSg.securityGroupId],
      snapshotRetentionLimit: 1,
    })
    for (const peer of [apiSg, workerSg]) {
      peer.connections.allowTo(redisSg, ec2.Port.tcp(6379), "Redis")
    }
    const redisUrl = `rediss://${redis.attrPrimaryEndPointAddress}:${redis.attrPrimaryEndPointPort}/0`

    // ----------------------------------------------------------- media (S3)
    const mediaBucket = new s3.Bucket(this, "Media", {
      bucketName: `${PREFIX}-media-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RETAIN,
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: Duration.days(7) },
        { noncurrentVersionExpiration: Duration.days(30) },
      ],
    })

    // ----------------------------------------------------------------- email
    const smtpUser = new iam.User(this, "SesSmtpUser", {
      userName: `${PREFIX}-ses-smtp`,
    })
    smtpUser.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendRawEmail"],
        resources: ["*"],
      }),
    )
    const fromAddress = config.emailDomain
      ? `noreply@${config.emailDomain}`
      : ""
    if (config.emailDomain) {
      // Easy DKIM and a custom MAIL FROM on `mail.<emailDomain>`; the DKIM
      // CNAMEs, MAIL FROM MX/SPF and DMARC go into Cloudflare via
      // scripts/cloudflare.ts (they are not CloudFormation resources).
      new ses.EmailIdentity(this, "EmailIdentity", {
        identity: ses.Identity.domain(config.emailDomain),
        mailFromDomain: `mail.${config.emailDomain}`,
      })
    }
    const smtpHost = `email-smtp.${this.region}.amazonaws.com`

    // ------------------------------------------------- bootstrap custom resources
    const bundling: lambdaNode.BundlingOptions = {
      format: lambdaNode.OutputFormat.ESM,
      target: "node22",
      // @aws-sdk v3 ships with the runtime.
      externalModules: ["@aws-sdk/*"],
      banner:
        "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    }
    const fnLogs = (name: string) =>
      new logs.LogGroup(this, `${name}-fn-logs`, {
        logGroupName: `/${PREFIX}/fn/${name}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      })
    const bootstrapFn = new lambdaNode.NodejsFunction(
      this,
      "BootstrapSecretsFn",
      {
        entry: lambdaEntry("bootstrap-secrets"),
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        timeout: Duration.minutes(2),
        bundling,
        logGroup: fnLogs("bootstrap-secrets"),
      },
    )
    for (const s of [gotrueSecret, smtpSecret, appSecret]) {
      s.grantRead(bootstrapFn)
      s.grantWrite(bootstrapFn)
    }
    bootstrapFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "iam:CreateAccessKey",
          "iam:DeleteAccessKey",
          "iam:ListAccessKeys",
        ],
        resources: [smtpUser.userArn],
      }),
    )
    const bootstrap = new CustomResource(this, "BootstrapSecrets", {
      serviceToken: new cr.Provider(this, "BootstrapSecretsProvider", {
        onEventHandler: bootstrapFn,
      }).serviceToken,
      properties: {
        GotrueSecretArn: gotrueSecret.secretArn,
        SmtpSecretArn: smtpSecret.secretArn,
        AppSecretArn: appSecret.secretArn,
        SmtpUserName: smtpUser.userName,
        Issuer: issuer,
        Region: this.region,
      },
    })

    // ---------------------------------------------------------------- cluster
    const cluster = new ecs.Cluster(this, "Cluster", {
      clusterName: PREFIX,
      vpc,
      containerInsightsV2: ecs.ContainerInsights.DISABLED,
    })
    // Private DNS the tunnel and the backend reach the services at:
    // api.unfurl.internal and auth.unfurl.internal (A records per task).
    const namespace = cluster.addDefaultCloudMapNamespace({
      name: SERVICE_NAMESPACE,
      type: servicediscovery.NamespaceType.DNS_PRIVATE,
      vpc,
    })
    const discovery = (
      name: keyof typeof SERVICE_PORTS,
    ): ecs.CloudMapOptions => ({
      name,
      cloudMapNamespace: namespace,
      dnsRecordType: servicediscovery.DnsRecordType.A,
      dnsTtl: Duration.seconds(10),
    })
    // Generated names, always kept: a failed create keeps its logs (the
    // second create's API crash was unreadable once its group was removed),
    // and a retry never collides with a leftover name. The stack outputs
    // list the names.
    const logGroup = (name: string) => {
      const group = new logs.LogGroup(this, `${name}Logs`, {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.RETAIN,
      })
      new CfnOutput(this, `${name.replace(/-/g, "")}LogGroup`, {
        value: group.logGroupName,
      })
      return group
    }
    // By name, not a cross-stack reference: the CI stack owns the repository
    // and must stay deletable/updatable on its own.
    const repository = ecr.Repository.fromRepositoryName(
      this,
      "BackendRepository",
      BACKEND_REPOSITORY,
    )
    const backendImage = ecs.ContainerImage.fromEcrRepository(
      repository,
      config.imageTag,
    )
    const serviceDefaults = {
      cluster,
      vpcSubnets: taskSubnets,
      // A public IP is the tasks' route out (there is no NAT); the security
      // groups admit nothing from the internet.
      assignPublicIp: true,
      circuitBreaker: { enable: true, rollback: true },
    }

    // Backend environment: every variable backend/app/core/config.py reads
    // that production sets. The mapping, and what is still unset, is in
    // docs/23-aws-infrastructure.md.
    const backendEnv: Record<string, string> = {
      ENVIRONMENT: "production",
      PROJECT_NAME: "Unfurl",
      FRONTEND_HOST: config.siteUrl,
      FIRST_SUPERUSER: config.adminEmail,
      // GoTrue over the private network (Cloud Map), not out through
      // Cloudflare and back; the tokens still carry the public issuer.
      SUPABASE_URL: internalUrl("auth"),
      SUPABASE_JWT_ISSUER: issuer,
      POSTGRES_SERVER: db.dbInstanceEndpointAddress,
      POSTGRES_PORT: db.dbInstanceEndpointPort,
      POSTGRES_DB: "app",
      POSTGRES_USER: "postgres",
      POSTGRES_APP_USER: "app_user",
      REDIS_URL: redisUrl,
      SMTP_HOST: smtpHost,
      SMTP_PORT: "587",
      SMTP_TLS: "true",
      SMTP_SSL: "false",
      EMAILS_FROM_EMAIL: fromAddress,
      EMAILS_FROM_NAME: "Unfurl",
      // S3 replaces MinIO: same client, AWS endpoint, credentials from the
      // task role instead of static keys.
      OBJECT_STORAGE_IAM_AUTH: "true",
      MINIO_ENDPOINT: `https://s3.${this.region}.amazonaws.com`,
      MINIO_REGION: this.region,
      MINIO_DEFAULT_BUCKET: mediaBucket.bucketName,
      MEDIA_BUCKET: mediaBucket.bucketName,
      OCR_BUCKET: mediaBucket.bucketName,
      AI_ENABLED: "true",
      AI_SERVER_FALLBACK: "true",
      DEFAULT_LLM_PROVIDER: "nebius",
      JOBS_ENABLED: "true",
      PUSH_ENABLED: "true",
      OCR_ENABLED: "false",
      // No load balancer or WAF in front: the API's own per-user and
      // per-address limits (backend/app/shared/rate_limit.py) cover the
      // model-backed and account routes, keyed on Cloudflare's visitor IP.
      CLIENT_IP_HEADER: CLIENT_IP_HEADER,
      RATE_LIMIT_AI_PER_MINUTE: String(RATE_LIMITS.aiPerMinute),
      RATE_LIMIT_ACCOUNT_PER_MINUTE: String(RATE_LIMITS.accountPerMinute),
      // uvicorn trusts X-Forwarded-* only from listed peers; only the tunnel
      // (cloudflared) can reach the API, from changing private addresses.
      FORWARDED_ALLOW_IPS: "*",
    }
    const backendSecrets: Record<string, ecs.Secret> = {
      POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(
        masterSecret,
        "password",
      ),
      POSTGRES_APP_PASSWORD: ecs.Secret.fromSecretsManager(
        appUserSecret,
        "password",
      ),
      FIRST_SUPERUSER_PASSWORD: ecs.Secret.fromSecretsManager(
        appSecret,
        "first_superuser_password",
      ),
      SUPABASE_ANON_KEY: ecs.Secret.fromSecretsManager(
        gotrueSecret,
        "anon_key",
      ),
      SUPABASE_SERVICE_ROLE_KEY: ecs.Secret.fromSecretsManager(
        gotrueSecret,
        "service_role_key",
      ),
      SMTP_USER: ecs.Secret.fromSecretsManager(smtpSecret, "username"),
      SMTP_PASSWORD: ecs.Secret.fromSecretsManager(smtpSecret, "password"),
      NEBIUS_API_KEY: ecs.Secret.fromSecretsManager(
        thirdPartySecret,
        "nebius_api_key",
      ),
      DEEPGRAM_API_KEY: ecs.Secret.fromSecretsManager(
        thirdPartySecret,
        "deepgram_api_key",
      ),
      OPENROUTER_API_KEY: ecs.Secret.fromSecretsManager(
        thirdPartySecret,
        "openrouter_api_key",
      ),
      BRAVE_API_KEY: ecs.Secret.fromSecretsManager(
        thirdPartySecret,
        "brave_api_key",
      ),
      EXPO_ACCESS_TOKEN: ecs.Secret.fromSecretsManager(
        thirdPartySecret,
        "expo_access_token",
      ),
      SENTRY_DSN: ecs.Secret.fromSecretsManager(thirdPartySecret, "sentry_dsn"),
      AI_CREDENTIALS_KEK: ecs.Secret.fromSecretsManager(
        appSecret,
        "ai_credentials_kek",
      ),
    }

    const backendTask = (name: string, cpu: number, memoryLimitMiB: number) => {
      const task = new ecs.FargateTaskDefinition(this, `${name}Task`, {
        family: `${PREFIX}-${name.toLowerCase()}`,
        cpu,
        memoryLimitMiB,
        runtimePlatform: ARM64,
      })
      // See ThirdPartySecret: ECS asks for the partial ARN.
      task.addToExecutionRolePolicy(
        new iam.PolicyStatement({
          actions: ["secretsmanager:GetSecretValue"],
          resources: [
            `arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:${THIRD_PARTY_SECRET}*`,
          ],
        }),
      )
      mediaBucket.grantReadWrite(task.taskRole)
      mediaBucket.grantDelete(task.taskRole)
      return task
    }

    // ----------------------------------------------------------- GoTrue service
    const gotrueTask = new ecs.FargateTaskDefinition(this, "GotrueTask", {
      family: `${PREFIX}-gotrue`,
      cpu: sizing.gotrue.cpu,
      memoryLimitMiB: sizing.gotrue.memoryMiB,
      runtimePlatform: ARM64,
    })
    const gotrueLogs = logGroup("Gotrue")
    // Database setup (lib/db-setup.ts) runs first in every GoTrue task:
    // GoTrue needs its role and database before it can migrate.
    const dbSetupContainer = gotrueTask.addContainer("db-setup", {
      image: backendImage,
      command: ["python", "-c", DB_SETUP_PY],
      environment: {
        DB_HOST: db.dbInstanceEndpointAddress,
        DB_PORT: db.dbInstanceEndpointPort,
        DB_NAME: "app",
        MASTER_USER: "postgres",
      },
      secrets: {
        MASTER_PASSWORD: ecs.Secret.fromSecretsManager(
          masterSecret,
          "password",
        ),
        AUTH_PASSWORD: ecs.Secret.fromSecretsManager(authDbSecret, "password"),
        APP_USER_PASSWORD: ecs.Secret.fromSecretsManager(
          appUserSecret,
          "password",
        ),
      },
      essential: false,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "db-setup",
        logGroup: gotrueLogs,
      }),
    })
    const mailPath = "/auth/v1/verify"
    const gotrueEnv: Record<string, string> = {
      GOTRUE_API_HOST: "127.0.0.1",
      GOTRUE_API_PORT: String(GOTRUE_PORT),
      API_EXTERNAL_URL: publicUrl,
      GOTRUE_DB_DRIVER: "postgres",
      GOTRUE_DB_NAMESPACE: "auth",
      DB_HOST: db.dbInstanceEndpointAddress,
      DB_PORT: db.dbInstanceEndpointPort,
      GOTRUE_SITE_URL: config.siteUrl,
      GOTRUE_URI_ALLOW_LIST: config.authRedirectUrls.join(","),
      GOTRUE_DISABLE_SIGNUP: "false",
      GOTRUE_JWT_ISSUER: issuer,
      GOTRUE_JWT_AUD: "authenticated",
      GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
      GOTRUE_JWT_ADMIN_ROLES: "service_role",
      GOTRUE_JWT_EXP: "3600",
      GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: "true",
      GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: "10",
      GOTRUE_PASSWORD_MIN_LENGTH: "8",
      GOTRUE_EXTERNAL_EMAIL_ENABLED: "true",
      GOTRUE_MAILER_AUTOCONFIRM: "false",
      GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED: "true",
      GOTRUE_MAILER_OTP_EXP: "3600",
      GOTRUE_MAILER_URLPATHS_CONFIRMATION: mailPath,
      GOTRUE_MAILER_URLPATHS_INVITE: mailPath,
      GOTRUE_MAILER_URLPATHS_RECOVERY: mailPath,
      GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE: mailPath,
      GOTRUE_SMTP_HOST: smtpHost,
      GOTRUE_SMTP_PORT: "587",
      GOTRUE_SMTP_ADMIN_EMAIL: fromAddress,
      GOTRUE_SMTP_SENDER_NAME: "Unfurl",
      GOTRUE_SMTP_MAX_FREQUENCY: "1s",
      // GoTrue's own per-IP limits are the sign-in limit (there is no WAF):
      // X-Real-IP is the visitor's address (see NGINX_CONF). Values are per
      // hour for email and per 5 minutes for the rest, per address.
      GOTRUE_RATE_LIMIT_HEADER: "X-Real-IP",
      GOTRUE_RATE_LIMIT_EMAIL_SENT: "30",
      GOTRUE_RATE_LIMIT_TOKEN_REFRESH: "150",
      GOTRUE_RATE_LIMIT_VERIFY: "30",
      GOTRUE_RATE_LIMIT_OTP: "30",
      GOTRUE_EXTERNAL_APPLE_ENABLED: String(config.appleSignIn),
      GOTRUE_EXTERNAL_GOOGLE_ENABLED: String(config.googleSignIn),
      GOTRUE_EXTERNAL_APPLE_REDIRECT_URI: `${issuer}/callback`,
      GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI: `${issuer}/callback`,
      GOTRUE_LOG_LEVEL: "info",
    }
    const gotrue = gotrueTask.addContainer("gotrue", {
      image: ecs.ContainerImage.fromRegistry(IMAGES.gotrue),
      // GoTrue takes its database as one URL; the password arrives as its
      // own secret, so the URL is assembled at start. Generated passwords
      // exclude every URL-reserved character.
      entryPoint: ["sh", "-c"],
      command: [
        'export GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$DB_PASSWORD@$DB_HOST:$DB_PORT/auth?sslmode=require&search_path=auth" && exec auth',
      ],
      environment: gotrueEnv,
      secrets: {
        DB_PASSWORD: ecs.Secret.fromSecretsManager(authDbSecret, "password"),
        GOTRUE_JWT_KEYS: ecs.Secret.fromSecretsManager(
          gotrueSecret,
          "jwt_keys",
        ),
        GOTRUE_JWT_SECRET: ecs.Secret.fromSecretsManager(
          gotrueSecret,
          "jwt_secret",
        ),
        GOTRUE_SMTP_USER: ecs.Secret.fromSecretsManager(smtpSecret, "username"),
        GOTRUE_SMTP_PASS: ecs.Secret.fromSecretsManager(smtpSecret, "password"),
        GOTRUE_EXTERNAL_APPLE_CLIENT_ID: ecs.Secret.fromSecretsManager(
          providersSecret,
          "apple_client_id",
        ),
        GOTRUE_EXTERNAL_APPLE_SECRET: ecs.Secret.fromSecretsManager(
          providersSecret,
          "apple_secret",
        ),
        GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID: ecs.Secret.fromSecretsManager(
          providersSecret,
          "google_client_id",
        ),
        GOTRUE_EXTERNAL_GOOGLE_SECRET: ecs.Secret.fromSecretsManager(
          providersSecret,
          "google_secret",
        ),
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "gotrue",
        logGroup: gotrueLogs,
      }),
      essential: true,
    })
    gotrue.addContainerDependencies({
      container: dbSetupContainer,
      condition: ecs.ContainerDependencyCondition.SUCCESS,
    })
    const proxy = gotrueTask.addContainer("auth-proxy", {
      image: ecs.ContainerImage.fromRegistry(IMAGES.nginx),
      entryPoint: ["sh", "-c"],
      command: [
        'printf "%s" "$NGINX_CONF" > /etc/nginx/conf.d/default.conf && exec nginx -g "daemon off;"',
      ],
      environment: { NGINX_CONF },
      portMappings: [{ containerPort: AUTH_PROXY_PORT }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "auth-proxy",
        logGroup: gotrueLogs,
      }),
      essential: true,
      // Through the proxy, so a broken prefix rule fails the check too.
      healthCheck: {
        command: [
          "CMD-SHELL",
          `wget -q -O /dev/null http://127.0.0.1:${AUTH_PROXY_PORT}/auth/v1/health || exit 1`,
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
    })
    proxy.addContainerDependencies({
      container: gotrue,
      condition: ecs.ContainerDependencyCondition.START,
    })
    const gotrueService = new ecs.FargateService(this, "GotrueService", {
      ...serviceDefaults,
      serviceName: `${PREFIX}-gotrue`,
      taskDefinition: gotrueTask,
      desiredCount: sizing.gotrue.count,
      securityGroups: [gotrueSg],
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      cloudMapOptions: discovery("auth"),
    })
    gotrueService.node.addDependency(bootstrap)

    // ---------------------------------------------------------- worker service
    // Also the migration runner: before the worker starts, a one-shot
    // container runs `scripts/prestart.sh` (Alembic upgrade head, then the
    // seed). The worker is a single task replaced stop-then-start, so two
    // migrations never run at once, and the API service waits for it (see
    // the dependency below), so new API code meets the migrated schema.
    const workerTask = backendTask(
      "Worker",
      sizing.worker.cpu,
      sizing.worker.memoryMiB,
    )
    const workerLogs = logGroup("Worker")
    const migrate = workerTask.addContainer("migrate", {
      image: backendImage,
      command: ["bash", "scripts/prestart.sh"],
      environment: backendEnv,
      secrets: backendSecrets,
      essential: false,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "migrate",
        logGroup: workerLogs,
      }),
    })
    const worker = workerTask.addContainer("worker", {
      image: backendImage,
      command: [
        "procrastinate",
        "--app=app.modules.jobs.app.jobs_app",
        "worker",
      ],
      environment: backendEnv,
      secrets: backendSecrets,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "worker",
        logGroup: workerLogs,
      }),
    })
    worker.addContainerDependencies({
      container: migrate,
      condition: ecs.ContainerDependencyCondition.SUCCESS,
    })
    const workerService = new ecs.FargateService(this, "WorkerService", {
      ...serviceDefaults,
      serviceName: `${PREFIX}-worker`,
      taskDefinition: workerTask,
      desiredCount: sizing.worker.count,
      securityGroups: [workerSg],
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
    })
    // The seed creates the first superuser through GoTrue's admin API.
    workerService.node.addDependency(gotrueService, bootstrap)

    // -------------------------------------------------------------- API service
    const apiTask = backendTask("Api", sizing.api.cpu, sizing.api.memoryMiB)
    apiTask.addContainer("api", {
      image: backendImage,
      command: [
        "fastapi",
        "run",
        "--workers",
        String(sizing.api.workers),
        "--port",
        String(API_PORT),
        "app/main.py",
      ],
      environment: backendEnv,
      secrets: backendSecrets,
      portMappings: [{ containerPort: API_PORT }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "api",
        logGroup: logGroup("Api"),
      }),
      healthCheck: {
        command: [
          "CMD-SHELL",
          `curl -fs http://localhost:${API_PORT}/api/v1/utils/health-check/ || exit 1`,
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
    })
    const apiService = new ecs.FargateService(this, "ApiService", {
      ...serviceDefaults,
      serviceName: `${PREFIX}-api`,
      taskDefinition: apiTask,
      desiredCount: sizing.api.count,
      securityGroups: [apiSg],
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      cloudMapOptions: discovery("api"),
    })
    apiService.node.addDependency(workerService)

    // ----------------------------------------------------------- tunnel service
    // One cloudflared service for the whole tunnel, not a sidecar per task:
    // the tunnel's ingress rules (scripts/cloudflare.ts) are shared by every
    // connector, and they route one hostname to two services by path
    // (/auth/v1/* to GoTrue's proxy, the rest to the API), so each connector
    // must reach both. It does so through Cloud Map DNS rather than Service
    // Connect, whose Envoy sidecar would add memory to every task for
    // nothing these two plain HTTP hops need. The token comes from the
    // secret the Cloudflare script creates with the tunnel.
    const tunnelToken = secretsmanager.Secret.fromSecretNameV2(
      this,
      "TunnelToken",
      TUNNEL_TOKEN_SECRET,
    )
    const tunnelTask = new ecs.FargateTaskDefinition(this, "TunnelTask", {
      family: `${PREFIX}-tunnel`,
      cpu: sizing.tunnel.cpu,
      memoryLimitMiB: sizing.tunnel.memoryMiB,
      runtimePlatform: ARM64,
    })
    // ECS fetches a secret imported by name through its partial ARN (no
    // random suffix), which the policy CDK generates for fromSecretNameV2
    // (`<name>-??????`) does not match: the first deploy's tunnel tasks
    // stopped with AccessDenied before cloudflared ever ran. Grant on the
    // name with a wildcard so both forms match.
    tunnelTask.addToExecutionRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:${TUNNEL_TOKEN_SECRET}*`,
        ],
      }),
    )
    tunnelTask.addContainer("cloudflared", {
      image: ecs.ContainerImage.fromRegistry(IMAGES.cloudflared),
      // The image's entrypoint is `cloudflared --no-autoupdate`; the token
      // is read from TUNNEL_TOKEN.
      command: ["tunnel", "--metrics", "0.0.0.0:2000", "run"],
      secrets: {
        TUNNEL_TOKEN: ecs.Secret.fromSecretsManager(tunnelToken, "token"),
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "cloudflared",
        logGroup: logGroup("Tunnel"),
      }),
    })
    const tunnelService = new ecs.FargateService(this, "TunnelService", {
      ...serviceDefaults,
      serviceName: `${PREFIX}-tunnel`,
      taskDefinition: tunnelTask,
      desiredCount: sizing.tunnel.count,
      securityGroups: [tunnelSg],
      // A new connector registers before the old one leaves: no gap.
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    })
    tunnelService.node.addDependency(apiService, gotrueService)

    // A task that stops before its container starts (a secret it cannot
    // read, an image it cannot pull) leaves nothing in its own log group.
    // Every task stop, with ECS's reason, goes to /unfurl/ecs-events.
    new events.Rule(this, "TaskStoppedEvents", {
      ruleName: `${PREFIX}-task-stopped`,
      eventPattern: {
        source: ["aws.ecs"],
        detailType: ["ECS Task State Change"],
        detail: { clusterArn: [cluster.clusterArn], lastStatus: ["STOPPED"] },
      },
      targets: [new eventsTargets.CloudWatchLogGroup(logGroup("Ecs-Events"))],
    })

    // ----------------------------------------------------------------- alarms
    const topic = new sns.Topic(this, "Alarms", {
      topicName: `${PREFIX}-alarms`,
    })
    if (config.alertEmail) {
      topic.addSubscription(new snsSubs.EmailSubscription(config.alertEmail))
    }
    const alarm = (id: string, props: cloudwatch.AlarmProps) => {
      const a = new cloudwatch.Alarm(this, id, {
        alarmName: `${PREFIX}-${id}`,
        ...props,
      })
      a.addAlarmAction(new cwActions.SnsAction(topic))
      a.addOkAction(new cwActions.SnsAction(topic))
      return a
    }
    // ECS replaces a task whose container health check fails (the API's
    // /api/v1/utils/health-check/, GoTrue's /auth/v1/health through nginx);
    // these fire when a service has no running task at all for 10 minutes.
    const down = (id: string, service: ecs.FargateService, what: string) =>
      alarm(id, {
        alarmDescription: `${what} has no running task (no metrics reported)`,
        metric: service.metricCpuUtilization({
          period: Duration.minutes(5),
          statistic: "SampleCount",
        }),
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        evaluationPeriods: 2,
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      })
    down("api-down", apiService, "The API")
    down("auth-down", gotrueService, "Sign-in (GoTrue)")
    down("tunnel-down", tunnelService, "The Cloudflare tunnel (cloudflared)")
    down("worker-down", workerService, "The job worker")
    // `lean` runs every task at 0.5 GB; this is the signal to scale up
    // (unfurl:sizingOverrides) before a task is killed for memory.
    const memoryHigh = (
      id: string,
      service: ecs.FargateService,
      what: string,
    ) =>
      alarm(id, {
        alarmDescription: `${what} above 85% of its memory for 15 minutes: raise its size`,
        metric: service.metricMemoryUtilization({
          period: Duration.minutes(5),
        }),
        threshold: 85,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 3,
      })
    memoryHigh("api-memory", apiService, "The API")
    memoryHigh("worker-memory", workerService, "The job worker")
    alarm("db-cpu", {
      alarmDescription: "Database CPU above 80% for 15 minutes",
      metric: db.metricCPUUtilization({ period: Duration.minutes(5) }),
      threshold: 80,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 3,
    })
    alarm("db-storage", {
      alarmDescription: "Database free storage below 2 GB",
      metric: db.metricFreeStorageSpace({ period: Duration.minutes(5) }),
      threshold: 2 * 1024 ** 3,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1,
    })

    // ---------------------------------------------------------------- outputs
    new CfnOutput(this, "PublicUrl", { value: publicUrl })
    new CfnOutput(this, "MediaBucket", { value: mediaBucket.bucketName })
    new CfnOutput(this, "DatabaseEndpoint", {
      value: db.dbInstanceEndpointAddress,
    })
    new CfnOutput(this, "AppSecretName", { value: appSecret.secretName })
    new CfnOutput(this, "AuthProvidersSecretName", {
      value: providersSecret.secretName,
    })
  }
}
