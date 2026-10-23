#!/usr/bin/env bun
import { App, Tags } from "aws-cdk-lib"
import { CiStack } from "../lib/ci-stack"
import { loadConfig } from "../lib/config"
import { ProdStack } from "../lib/prod-stack"

const app = new App()
const config = loadConfig(app.node)
const env = { account: config.account, region: config.region }

new CiStack(app, "UnfurlCi", {
  env,
  config,
  description: "Unfurl: ECR repository and the GitHub OIDC deploy role",
})

// The production stack needs an image tag; `cdk deploy UnfurlCi` alone
// (the first step, before any image exists) does not.
if (config.imageTag) {
  new ProdStack(app, "UnfurlProd", {
    env,
    config,
    description:
      "Unfurl production: VPC, ECS Fargate on Graviton (API, worker, GoTrue, Cloudflare Tunnel), RDS, ElastiCache, S3, SES, Secrets Manager, alarms",
    terminationProtection: true,
  })
}

Tags.of(app).add("project", "unfurl")
Tags.of(app).add("managed-by", "cdk")
