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
import * as acm from "aws-cdk-lib/aws-certificatemanager"
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch"
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as ecr from "aws-cdk-lib/aws-ecr"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as elasticache from "aws-cdk-lib/aws-elasticache"
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2"
import * as iam from "aws-cdk-lib/aws-iam"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs"
import * as logs from "aws-cdk-lib/aws-logs"
import * as rds from "aws-cdk-lib/aws-rds"
import * as route53 from "aws-cdk-lib/aws-route53"
import * as route53Targets from "aws-cdk-lib/aws-route53-targets"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"
import * as ses from "aws-cdk-lib/aws-ses"
import * as sns from "aws-cdk-lib/aws-sns"
import * as snsSubs from "aws-cdk-lib/aws-sns-subscriptions"
import * as cr from "aws-cdk-lib/custom-resources"
import type { Construct } from "constructs"
import {
  BACKEND_REPOSITORY,
  IMAGES,
  POSTGRES_FULL_VERSION,
  POSTGRES_MAJOR_VERSION,
  PREFIX,
  type UnfurlConfig,
} from "./config"
import { createWebAcl } from "./waf"

const here = path.dirname(fileURLToPath(import.meta.url))
const lambdaEntry = (name: string) =>
  path.join(here, "..", "lambda", `${name}.ts`)

export interface ProdStackProps extends StackProps {
  config: UnfurlConfig
}

/** Ports inside the tasks. */
const API_PORT = 8000
const GOTRUE_PORT = 9999
const AUTH_PROXY_PORT = 8080

/** Server-sent-event streams (`/events/stream`, `/companion/ask/stream`)
 * heartbeat every 25 s; the ALB default of 60 s would cut a stream whose
 * model is still thinking between chunks. */
export const ALB_IDLE_TIMEOUT_SECONDS = 300

/** Characters kept out of generated passwords that end up inside URLs. */
const URL_UNSAFE = " %+~`#$&*()|[]{}:;<>?!'/@\"\\,="

/**
 * nginx in the GoTrue task: serves `/auth/v1/*` and strips the prefix, as
 * Supabase's Kong gateway does, so `supabase-js` and the backend use the
 * same paths as against the local CLI stack. The real client IP comes from
 * the ALB's X-Forwarded-For and is handed to GoTrue as X-Real-IP, which its
 * per-IP rate limits key on.
 */
export const NGINX_CONF = `server {
  listen ${AUTH_PROXY_PORT};
  set_real_ip_from 10.0.0.0/8;
  real_ip_header X-Forwarded-For;
  real_ip_recursive on;
  client_max_body_size 1m;
  location = /auth/v1/health {
    proxy_pass http://127.0.0.1:${GOTRUE_PORT}/health;
  }
  location /auth/v1/ {
    proxy_pass http://127.0.0.1:${GOTRUE_PORT}/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
    proxy_read_timeout 60s;
  }
  location / {
    return 404;
  }
}
`

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

    // ---------------------------------------------------------------- network
    // One NAT gateway, not one per AZ: the services must reach the internet
    // anyway (Nebius, Deepgram, Expo push, Apple and Google token checks), so
    // VPC interface endpoints could not replace NAT, and four of them across
    // two AZs (ECR api+dkr, Logs, Secrets Manager) would cost more than the
    // gateway. S3 traffic skips NAT through the free gateway endpoint. The
    // trade: an AZ outage takes egress down until the NAT is recreated.
    const natEip = new ec2.CfnEIP(this, "NatEip", {
      domain: "vpc",
      tags: [{ key: "Name", value: `${PREFIX}-nat` }],
    })
    const vpc = new ec2.Vpc(this, "Vpc", {
      vpcName: PREFIX,
      ipAddresses: ec2.IpAddresses.cidr("10.40.0.0/16"),
      maxAzs: 2,
      natGateways: 1,
      natGatewayProvider: ec2.NatProvider.gateway({
        eipAllocationIds: [natEip.attrAllocationId],
      }),
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        {
          name: "app",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 22,
        },
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
    const appSubnets = { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }
    const dataSubnets = { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }

    const sg = (name: string, description: string) =>
      new ec2.SecurityGroup(this, `${name}Sg`, {
        vpc,
        description,
        securityGroupName: `${PREFIX}-${name.toLowerCase()}`,
      })
    const albSg = sg("Alb", "Public load balancer")
    const apiSg = sg("Api", "API tasks")
    const workerSg = sg("Worker", "Job worker tasks")
    const gotrueSg = sg("Gotrue", "GoTrue tasks")
    const dbSetupSg = sg("DbSetup", "Database setup function")
    const dbSg = sg("Db", "RDS PostgreSQL")
    const redisSg = sg("Redis", "ElastiCache")

    // ------------------------------------------------------------------- DNS
    const publicHost = config.domain ? `api.${config.domain}` : ""
    const zone = config.hostedZoneId
      ? route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
          hostedZoneId: config.hostedZoneId,
          zoneName: config.domain,
        })
      : undefined

    // ---------------------------------------------------------- load balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      loadBalancerName: PREFIX,
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      idleTimeout: Duration.seconds(ALB_IDLE_TIMEOUT_SECONDS),
      dropInvalidHeaderFields: true,
    })
    const publicUrl = publicHost
      ? `https://${publicHost}`
      : `http://${alb.loadBalancerDnsName}`
    const issuer = `${publicUrl}/auth/v1`

    let listener: elbv2.ApplicationListener
    if (publicHost) {
      const certificate = new acm.Certificate(this, "Certificate", {
        domainName: publicHost,
        // Without a hosted zone the CNAME ACM asks for must be added at the
        // registrar by hand; the stack waits on it.
        validation: zone
          ? acm.CertificateValidation.fromDns(zone)
          : acm.CertificateValidation.fromDns(),
      })
      listener = alb.addListener("Https", {
        port: 443,
        certificates: [certificate],
        sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
        defaultAction: elbv2.ListenerAction.fixedResponse(404),
      })
      alb.addRedirect({ sourcePort: 80, targetPort: 443 })
      if (zone) {
        new route53.ARecord(this, "ApiAlias", {
          zone,
          recordName: publicHost,
          target: route53.RecordTarget.fromAlias(
            new route53Targets.LoadBalancerTarget(alb),
          ),
        })
      }
    } else {
      // No domain yet: plain HTTP on the ALB's own name. Not for real users.
      listener = alb.addListener("Http", {
        port: 80,
        defaultAction: elbv2.ListenerAction.fixedResponse(404),
      })
    }

    createWebAcl(this, alb.loadBalancerArn, [natEip.ref])

    // ---------------------------------------------------------------- secrets
    const secret = (
      name: string,
      description: string,
      opts: Partial<secretsmanager.SecretProps> = {},
    ) =>
      new secretsmanager.Secret(this, name, {
        secretName: `${PREFIX}/${name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}`,
        description,
        removalPolicy: RemovalPolicy.RETAIN,
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
    /** Third-party keys: empty until someone puts the real values in
     * (`aws secretsmanager put-secret-value`, see the infra README). An empty
     * value reaches the backend as unset. */
    const appSecret = secret(
      "App",
      "Backend third-party keys and generated app secrets",
      {
        generateSecretString: {
          secretStringTemplate: JSON.stringify({
            nebius_api_key: "",
            deepgram_api_key: "",
            openrouter_api_key: "",
            brave_api_key: "",
            expo_access_token: "",
            sentry_dsn: "",
            ai_credentials_kek: "",
          }),
          generateStringKey: "first_superuser_password",
          excludeCharacters: URL_UNSAFE,
          passwordLength: 32,
        },
      },
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
        ec2.InstanceClass.BURSTABLE4_GRAVITON,
        ec2.InstanceSize.SMALL,
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
      deletionProtection: true,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      enablePerformanceInsights: true,
      cloudwatchLogsExports: ["postgresql"],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_MONTH,
    })
    const masterSecret = db.secret
    if (!masterSecret) throw new Error("RDS did not generate a master secret")
    for (const peer of [apiSg, workerSg, gotrueSg, dbSetupSg]) {
      dbSg.addIngressRule(
        peer,
        ec2.Port.tcp(5432),
        `Postgres from ${peer.node.id}`,
      )
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
      cacheNodeType: "cache.t4g.micro",
      numCacheClusters: 1,
      automaticFailoverEnabled: false,
      transitEncryptionEnabled: true,
      atRestEncryptionEnabled: true,
      cacheSubnetGroupName: redisSubnets.ref,
      securityGroupIds: [redisSg.securityGroupId],
      snapshotRetentionLimit: 1,
    })
    for (const peer of [apiSg, workerSg]) {
      redisSg.addIngressRule(
        peer,
        ec2.Port.tcp(6379),
        `Redis from ${peer.node.id}`,
      )
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
      removalPolicy: RemovalPolicy.RETAIN,
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
    const fromAddress = config.domain ? `no-reply@${config.domain}` : ""
    if (config.domain) {
      new ses.EmailIdentity(this, "EmailIdentity", {
        identity: zone
          ? ses.Identity.publicHostedZone(zone)
          : ses.Identity.domain(config.domain),
        mailFromDomain: `mail.${config.domain}`,
      })
      if (zone) {
        new route53.TxtRecord(this, "Dmarc", {
          zone,
          recordName: `_dmarc.${config.domain}`,
          values: [`v=DMARC1; p=quarantine; rua=mailto:dmarc@${config.domain}`],
        })
      }
    }
    const smtpHost = `email-smtp.${this.region}.amazonaws.com`

    // ------------------------------------------------- bootstrap custom resources
    const bundling: lambdaNode.BundlingOptions = {
      format: lambdaNode.OutputFormat.ESM,
      target: "node22",
      // @aws-sdk v3 ships with the runtime; pg is bundled.
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

    const dbSetupFn = new lambdaNode.NodejsFunction(this, "DbSetupFn", {
      entry: lambdaEntry("db-setup"),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.minutes(2),
      vpc,
      vpcSubnets: appSubnets,
      securityGroups: [dbSetupSg],
      bundling,
      logGroup: fnLogs("db-setup"),
    })
    for (const s of [masterSecret, authDbSecret, appUserSecret])
      s.grantRead(dbSetupFn)
    const dbSetup = new CustomResource(this, "DbSetup", {
      serviceToken: new cr.Provider(this, "DbSetupProvider", {
        onEventHandler: dbSetupFn,
      }).serviceToken,
      properties: {
        // Bump to rerun the (idempotent) setup on the next deploy.
        Version: "1",
        MasterSecretArn: masterSecret.secretArn,
        AuthSecretArn: authDbSecret.secretArn,
        AppUserSecretArn: appUserSecret.secretArn,
        Host: db.dbInstanceEndpointAddress,
        Port: db.dbInstanceEndpointPort,
        AppDatabase: "app",
      },
    })
    dbSetup.node.addDependency(db)

    // ---------------------------------------------------------------- cluster
    const cluster = new ecs.Cluster(this, "Cluster", {
      clusterName: PREFIX,
      vpc,
      containerInsightsV2: ecs.ContainerInsights.DISABLED,
    })
    const logGroup = (name: string) =>
      new logs.LogGroup(this, `${name}Logs`, {
        logGroupName: `/${PREFIX}/${name.toLowerCase()}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.RETAIN,
      })
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

    // Backend environment: every variable backend/app/core/config.py reads
    // that production sets. The mapping, and what is still unset, is in
    // docs/23-aws-infrastructure.md.
    const backendEnv: Record<string, string> = {
      ENVIRONMENT: "production",
      PROJECT_NAME: "Unfurl",
      FRONTEND_HOST: config.domain ? `https://${config.domain}` : publicUrl,
      FIRST_SUPERUSER: config.adminEmail,
      SUPABASE_URL: publicUrl,
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
      // uvicorn trusts X-Forwarded-* only from listed peers; the ALB's
      // addresses are not fixed, and only the ALB can reach the tasks.
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
        appSecret,
        "nebius_api_key",
      ),
      DEEPGRAM_API_KEY: ecs.Secret.fromSecretsManager(
        appSecret,
        "deepgram_api_key",
      ),
      OPENROUTER_API_KEY: ecs.Secret.fromSecretsManager(
        appSecret,
        "openrouter_api_key",
      ),
      BRAVE_API_KEY: ecs.Secret.fromSecretsManager(appSecret, "brave_api_key"),
      EXPO_ACCESS_TOKEN: ecs.Secret.fromSecretsManager(
        appSecret,
        "expo_access_token",
      ),
      SENTRY_DSN: ecs.Secret.fromSecretsManager(appSecret, "sentry_dsn"),
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
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.X86_64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      })
      mediaBucket.grantReadWrite(task.taskRole)
      mediaBucket.grantDelete(task.taskRole)
      return task
    }

    // -------------------------------------------------------------- API service
    const apiTask = backendTask("Api", 512, 1024)
    apiTask.addContainer("api", {
      image: backendImage,
      command: [
        "fastapi",
        "run",
        "--workers",
        "2",
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
      serviceName: `${PREFIX}-api`,
      cluster,
      taskDefinition: apiTask,
      desiredCount: 2,
      vpcSubnets: appSubnets,
      securityGroups: [apiSg],
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { enable: true, rollback: true },
      healthCheckGracePeriod: Duration.seconds(90),
    })
    const apiTargets = listener.addTargets("Api", {
      priority: 20,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/api/*"])],
      port: API_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [apiService],
      deregistrationDelay: Duration.seconds(30),
      healthCheck: {
        path: "/api/v1/utils/health-check/",
        healthyHttpCodes: "200",
        interval: Duration.seconds(15),
      },
    })

    // ----------------------------------------------------------- GoTrue service
    const gotrueTask = new ecs.FargateTaskDefinition(this, "GotrueTask", {
      family: `${PREFIX}-gotrue`,
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    })
    const gotrueLogs = logGroup("Gotrue")
    const mailPath = "/auth/v1/verify"
    const gotrueEnv: Record<string, string> = {
      GOTRUE_API_HOST: "127.0.0.1",
      GOTRUE_API_PORT: String(GOTRUE_PORT),
      API_EXTERNAL_URL: publicUrl,
      GOTRUE_DB_DRIVER: "postgres",
      GOTRUE_DB_NAMESPACE: "auth",
      DB_HOST: db.dbInstanceEndpointAddress,
      DB_PORT: db.dbInstanceEndpointPort,
      GOTRUE_SITE_URL: config.domain ? `https://${config.domain}` : publicUrl,
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
      GOTRUE_RATE_LIMIT_HEADER: "X-Real-IP",
      GOTRUE_RATE_LIMIT_EMAIL_SENT: "30",
      GOTRUE_EXTERNAL_APPLE_ENABLED: String(config.appleSignIn),
      GOTRUE_EXTERNAL_GOOGLE_ENABLED: String(config.googleSignIn),
      GOTRUE_EXTERNAL_APPLE_REDIRECT_URI: `${issuer}/callback`,
      GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI: `${issuer}/callback`,
      GOTRUE_LOG_LEVEL: "info",
    }
    gotrueTask.addContainer("gotrue", {
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
    })
    proxy.addContainerDependencies({
      container: gotrueTask.findContainer("gotrue") as ecs.ContainerDefinition,
      condition: ecs.ContainerDependencyCondition.START,
    })
    const gotrueService = new ecs.FargateService(this, "GotrueService", {
      serviceName: `${PREFIX}-gotrue`,
      cluster,
      taskDefinition: gotrueTask,
      desiredCount: 2,
      vpcSubnets: appSubnets,
      securityGroups: [gotrueSg],
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { enable: true, rollback: true },
      healthCheckGracePeriod: Duration.seconds(60),
    })
    const gotrueTargets = listener.addTargets("Gotrue", {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/auth/v1/*"])],
      port: AUTH_PROXY_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [
        gotrueService.loadBalancerTarget({
          containerName: "auth-proxy",
          containerPort: AUTH_PROXY_PORT,
        }),
      ],
      deregistrationDelay: Duration.seconds(30),
      healthCheck: {
        path: "/auth/v1/health",
        healthyHttpCodes: "200",
        interval: Duration.seconds(15),
      },
    })
    gotrueService.node.addDependency(dbSetup, bootstrap)

    // ---------------------------------------------------------- worker service
    // Also the migration runner: before the worker starts, a one-shot
    // container runs `scripts/prestart.sh` (Alembic upgrade head, then the
    // seed). The worker is a single task replaced stop-then-start, so two
    // migrations never run at once, and the API service waits for it (see
    // the dependency below), so new API code meets the migrated schema.
    const workerTask = backendTask("Worker", 512, 1024)
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
      serviceName: `${PREFIX}-worker`,
      cluster,
      taskDefinition: workerTask,
      desiredCount: 1,
      vpcSubnets: appSubnets,
      securityGroups: [workerSg],
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      circuitBreaker: { enable: true, rollback: true },
    })
    // The seed creates the first superuser through GoTrue's admin API.
    workerService.node.addDependency(gotrueService, dbSetup, bootstrap)
    apiService.node.addDependency(workerService)

    // Load balancer → tasks.
    apiSg.addIngressRule(albSg, ec2.Port.tcp(API_PORT), "ALB to API")
    gotrueSg.addIngressRule(
      albSg,
      ec2.Port.tcp(AUTH_PROXY_PORT),
      "ALB to auth proxy",
    )

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
    const oneMinute = Duration.minutes(1)
    alarm("api-unhealthy", {
      alarmDescription:
        "An API task fails /api/v1/utils/health-check/ through the ALB",
      metric: apiTargets.metrics.unhealthyHostCount({
        period: oneMinute,
        statistic: "Maximum",
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 3,
    })
    alarm("api-no-healthy-hosts", {
      alarmDescription: "No API task is healthy: the API is down",
      metric: apiTargets.metrics.healthyHostCount({
        period: oneMinute,
        statistic: "Minimum",
      }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    })
    alarm("auth-unhealthy", {
      alarmDescription:
        "A GoTrue task fails /auth/v1/health through the ALB (sign-in may be down)",
      metric: gotrueTargets.metrics.unhealthyHostCount({
        period: oneMinute,
        statistic: "Maximum",
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 3,
    })
    alarm("auth-no-healthy-hosts", {
      alarmDescription: "No GoTrue task is healthy: sign-in is down",
      metric: gotrueTargets.metrics.healthyHostCount({
        period: oneMinute,
        statistic: "Minimum",
      }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    })
    alarm("api-5xx", {
      alarmDescription: "API returning 5xx responses",
      metric: apiTargets.metrics.httpCodeTarget(
        elbv2.HttpCodeTarget.TARGET_5XX_COUNT,
        {
          period: Duration.minutes(5),
          statistic: "Sum",
        },
      ),
      threshold: 20,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    alarm("worker-down", {
      alarmDescription:
        "The job worker has no running task (no metrics reported)",
      metric: workerService.metricCpuUtilization({
        period: Duration.minutes(5),
        statistic: "SampleCount",
      }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    })
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
    new CfnOutput(this, "AlbDnsName", { value: alb.loadBalancerDnsName })
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
