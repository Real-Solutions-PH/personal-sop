/**
 * Custom resource: prepares the RDS instance for its two tenants, idempotently,
 * on every Create and Update (it reruns whenever its `Version` property
 * changes, and every statement is safe to repeat).
 *
 * - GoTrue (ADR-0021): the `supabase_auth_admin` role and the `auth`
 *   database it owns, with the `auth` schema GoTrue migrates into. GoTrue
 *   runs its own migrations there on start.
 * - The app (`app` database, created by RDS itself): the non-owner
 *   `app_user` role the API connects as so tenant RLS is enforced. The
 *   Alembic migration creates it NOLOGIN when absent; here it gets LOGIN and
 *   the password from Secrets Manager (the runbook's out-of-band step).
 *
 * Delete is a no-op: databases and roles go with the instance, which is
 * snapshotted rather than destroyed.
 */
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager"
import { Client } from "pg"

interface Props {
  MasterSecretArn: string
  AuthSecretArn: string
  AppUserSecretArn: string
  Host: string
  Port: string
  AppDatabase: string
}

interface CfnEvent {
  RequestType: "Create" | "Update" | "Delete"
  PhysicalResourceId?: string
  ResourceProperties: Props
}

const sm = new SecretsManagerClient({})

async function secretJson(arn: string): Promise<Record<string, string>> {
  const out = await sm.send(new GetSecretValueCommand({ SecretId: arn }))
  return JSON.parse(out.SecretString ?? "{}")
}

async function connect(
  p: Props,
  database: string,
  master: Record<string, string>,
) {
  const client = new Client({
    host: p.Host,
    port: Number(p.Port),
    user: master.username,
    password: master.password,
    database,
    // RDS enforces TLS (rds.force_ssl). The connection never leaves the VPC;
    // the RDS CA bundle is not shipped in the function.
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
  })
  await client.connect()
  return client
}

/** Statements for the app database, in order. Exported for the tests. */
export function appStatements(
  lit: (s: string) => string,
  appUserPassword: string,
) {
  return [
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
         CREATE ROLE app_user NOLOGIN;
       END IF;
     END $$`,
    `ALTER ROLE app_user LOGIN PASSWORD ${lit(appUserPassword)}`,
    // Roles GoTrue's migrations grant to when they exist (Supabase's own
    // platform roles). Created NOLOGIN so those grants succeed and mean
    // nothing.
    ...["anon", "authenticated", "service_role"].map(
      (r) => `DO $$ BEGIN
         IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${r}') THEN
           CREATE ROLE ${r} NOLOGIN NOINHERIT;
         END IF;
       END $$`,
    ),
  ]
}

export function authRoleStatements(
  lit: (s: string) => string,
  authPassword: string,
) {
  return [
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
         CREATE ROLE supabase_auth_admin NOINHERIT CREATEROLE LOGIN;
       END IF;
     END $$`,
    `ALTER ROLE supabase_auth_admin LOGIN PASSWORD ${lit(authPassword)}`,
    "ALTER ROLE supabase_auth_admin SET search_path = auth",
    // The master user must be a member to create a database it owns.
    "GRANT supabase_auth_admin TO CURRENT_USER",
  ]
}

export async function handler(event: CfnEvent) {
  const physicalId = event.PhysicalResourceId ?? "unfurl-db-setup"
  if (event.RequestType === "Delete") return { PhysicalResourceId: physicalId }

  const p = event.ResourceProperties
  const [master, auth, appUser] = await Promise.all([
    secretJson(p.MasterSecretArn),
    secretJson(p.AuthSecretArn),
    secretJson(p.AppUserSecretArn),
  ])

  const app = await connect(p, p.AppDatabase, master)
  try {
    const lit = (s: string) => app.escapeLiteral(s)
    for (const sql of authRoleStatements(lit, auth.password))
      await app.query(sql)
    for (const sql of appStatements(lit, appUser.password)) await app.query(sql)
    const exists = await app.query(
      "SELECT 1 FROM pg_database WHERE datname = 'auth'",
    )
    if (exists.rowCount === 0) {
      // CREATE DATABASE cannot run inside a transaction or a DO block.
      await app.query("CREATE DATABASE auth OWNER supabase_auth_admin")
    }
  } finally {
    await app.end()
  }

  const authDb = await connect(p, "auth", master)
  try {
    await authDb.query(
      "CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin",
    )
    await authDb.query("GRANT ALL ON DATABASE auth TO supabase_auth_admin")
  } finally {
    await authDb.end()
  }

  return { PhysicalResourceId: physicalId }
}
