/**
 * Prepares the RDS instance for its two tenants. It runs as a one-shot
 * `db-setup` container (the backend image, which has Python and psycopg)
 * before GoTrue starts in every GoTrue task, so it repeats on every task
 * start and every statement is idempotent.
 *
 * - GoTrue (ADR-0021): the `supabase_auth_admin` role and the `auth`
 *   database it owns, with the `auth` schema GoTrue migrates into, plus
 *   NOLOGIN `anon` / `authenticated` / `service_role` roles for GoTrue's
 *   migration grants.
 * - The app: the non-owner `app_user` role the API connects as, so tenant
 *   RLS is enforced. The Alembic migration creates it NOLOGIN when absent;
 *   here it gets LOGIN and the password from Secrets Manager.
 *
 * It was a Lambda custom resource. Without NAT the private subnets have no
 * route to Secrets Manager, while the tasks get their secrets injected by
 * ECS, so the setup now runs where the secrets already are.
 *
 * Two tasks starting at once take an advisory lock, so they never race the
 * same CREATE. Passwords are passed as SQL literals by psycopg, never
 * formatted into the text. Environment: DB_HOST, DB_PORT, DB_NAME,
 * MASTER_USER, MASTER_PASSWORD, AUTH_PASSWORD, APP_USER_PASSWORD.
 */
export const DB_SETUP_PY = `
import os
import psycopg
from psycopg import sql

env = os.environ
conn_args = dict(host=env["DB_HOST"], port=env["DB_PORT"], user=env["MASTER_USER"],
                 password=env["MASTER_PASSWORD"], sslmode=env.get("DB_SSLMODE", "require"),
                 connect_timeout=10)

def role(cur, name, attrs):
    cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (name,))
    if cur.fetchone() is None:
        cur.execute(sql.SQL("CREATE ROLE {} " + attrs).format(sql.Identifier(name)))

with psycopg.connect(dbname=env["DB_NAME"], autocommit=True, **conn_args) as c:
    cur = c.cursor()
    cur.execute("SELECT pg_advisory_lock(72417)")
    role(cur, "supabase_auth_admin", "NOINHERIT CREATEROLE LOGIN")
    cur.execute(sql.SQL("ALTER ROLE supabase_auth_admin LOGIN PASSWORD {}").format(
        sql.Literal(env["AUTH_PASSWORD"])))
    cur.execute("ALTER ROLE supabase_auth_admin SET search_path = auth")
    # The master user must be a member to create a database it owns.
    cur.execute("GRANT supabase_auth_admin TO CURRENT_USER")
    role(cur, "app_user", "NOLOGIN")
    cur.execute(sql.SQL("ALTER ROLE app_user LOGIN PASSWORD {}").format(
        sql.Literal(env["APP_USER_PASSWORD"])))
    for r in ("anon", "authenticated", "service_role"):
        role(cur, r, "NOLOGIN NOINHERIT")
    cur.execute("SELECT 1 FROM pg_database WHERE datname = 'auth'")
    if cur.fetchone() is None:
        cur.execute("CREATE DATABASE auth OWNER supabase_auth_admin")
    with psycopg.connect(dbname="auth", autocommit=True, **conn_args) as a:
        a.execute("CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin")
        a.execute("GRANT ALL ON DATABASE auth TO supabase_auth_admin")
    cur.execute("SELECT pg_advisory_unlock(72417)")
print("db-setup: ok")
`
