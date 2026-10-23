import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib"
import * as ecr from "aws-cdk-lib/aws-ecr"
import * as iam from "aws-cdk-lib/aws-iam"
import type { Construct } from "constructs"
import { BACKEND_REPOSITORY, PREFIX, type UnfurlConfig } from "./config"

export interface CiStackProps extends StackProps {
  config: UnfurlConfig
}

/**
 * The pieces that must exist before the production stack can run: the ECR
 * repository the backend image is pushed to, and the role GitHub Actions
 * assumes (via OIDC, no stored AWS keys) to push that image and run
 * `cdk deploy`. Kept apart from the production stack so the image can be
 * pushed before any service that needs it is created.
 */
export class CiStack extends Stack {
  readonly repository: ecr.Repository
  readonly deployRole: iam.Role

  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props)
    const { config } = props

    this.repository = new ecr.Repository(this, "BackendRepository", {
      repositoryName: BACKEND_REPOSITORY,
      imageScanOnPush: true,
      // Tags are git SHAs: a tag always means the same bytes.
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      encryption: ecr.RepositoryEncryption.AES_256,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          description: "Keep the 30 most recent images",
          maxImageCount: 30,
        },
      ],
    })

    // The account has no GitHub OIDC provider yet (checked 2026-10-23);
    // an account holds one per URL, so this stack owns it.
    const github = new iam.OidcProviderNative(this, "GitHubOidc", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    })

    this.deployRole = new iam.Role(this, "DeployRole", {
      roleName: `${PREFIX}-github-deploy`,
      description:
        "Assumed by the workflow_dispatch deploy workflow (GitHub OIDC) to push the backend image and run cdk deploy",
      maxSessionDuration: Duration.hours(2),
      assumedBy: new iam.WebIdentityPrincipal(github.oidcProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          // Only jobs bound to the protected GitHub environment, so a
          // workflow on any branch cannot deploy without that gate.
          "token.actions.githubusercontent.com:sub": `repo:${config.githubRepo}:environment:${config.githubEnvironment}`,
        },
      }),
    })

    this.repository.grantPullPush(this.deployRole)
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      }),
    )
    // Read-only lookups for scripts/cloudflare-dns.ts, which the workflow
    // runs beside `cdk deploy` to put the ACM, ALB and SES records into
    // Cloudflare.
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "acm:ListCertificates",
          "acm:DescribeCertificate",
          "elasticloadbalancing:DescribeLoadBalancers",
          "ses:GetEmailIdentity",
        ],
        resources: ["*"],
      }),
    )
    // cdk deploy works by assuming the roles `cdk bootstrap` created; the
    // CloudFormation execution role (not this one) holds the broad rights.
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [
          `arn:${this.partition}:iam::${this.account}:role/cdk-hnb659fds-*-${this.account}-${this.region}`,
        ],
      }),
    )

    new CfnOutput(this, "RepositoryUri", {
      value: this.repository.repositoryUri,
    })
    new CfnOutput(this, "DeployRoleArn", {
      value: this.deployRole.roleArn,
      description: "Set as the GitHub variable AWS_DEPLOY_ROLE_ARN",
    })
  }
}
