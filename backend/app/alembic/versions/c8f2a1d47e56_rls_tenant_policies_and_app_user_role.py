"""RLS tenant-isolation policies + app_user role

Policies key on ``current_setting('request.jwt.claims', true)`` — the exact
GUC Supabase's PostgREST sets — so they survive the Supabase migration
unchanged. Gotcha (verified live): after a transaction-local ``set_config``
ends, the GUC reads back as an EMPTY STRING (not NULL) on that session, so
every read of it MUST be wrapped in ``NULLIF(..., '')``; ``app_tenant_id()``
is the single place that does this.

Enforcement note: superusers and table owners bypass RLS, so Alembic,
prestart seeding, and the current app engine (postgres owner) are unaffected.
The policies become the live wall when the app engine is flipped to
``app_user`` (provisioned LOGIN out-of-band; see docs/runbook.md).

Global catalog tables (agent, tool, mcpserver, agenttool, role, permission)
deliberately keep RLS off.

Revision ID: c8f2a1d47e56
Revises: b7d4e12a9f03
Create Date: 2026-07-12 00:00:00.000000

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = 'c8f2a1d47e56'
down_revision = 'b7d4e12a9f03'
branch_labels = None
depends_on = None

# Tables whose rows carry tenant_id directly.
TENANT_COLUMN_TABLES = ('item', 'ocr_document', 'conversation', '"user"')


def upgrade():
    # NULLIF guards the ''-after-transaction-local-set_config gotcha.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid
        LANGUAGE sql STABLE AS $$
            SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::json
                    ->> 'tenant_id')::uuid
        $$
        """
    )

    for table in TENANT_COLUMN_TABLES:
        name = table.strip('"')
        op.execute(f'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY')
        op.execute(
            f"""
            CREATE POLICY {name}_tenant_isolation ON {table}
                USING (tenant_id = app_tenant_id())
                WITH CHECK (tenant_id = app_tenant_id())
            """
        )

    # tenant: a tenant only sees its own row.
    op.execute('ALTER TABLE tenant ENABLE ROW LEVEL SECURITY')
    op.execute(
        """
        CREATE POLICY tenant_tenant_isolation ON tenant
            USING (id = app_tenant_id())
            WITH CHECK (id = app_tenant_id())
        """
    )

    # message: no tenant_id column — tenancy is transitive through the parent
    # conversation, whose own policy filters the EXISTS subquery.
    op.execute('ALTER TABLE message ENABLE ROW LEVEL SECURITY')
    op.execute(
        """
        CREATE POLICY message_tenant_isolation ON message
            USING (EXISTS (SELECT 1 FROM conversation c
                           WHERE c.id = message.conversation_id))
            WITH CHECK (EXISTS (SELECT 1 FROM conversation c
                                WHERE c.id = message.conversation_id))
        """
    )

    # Non-owner role the app engine will connect as after the cutover. NOLOGIN and
    # passwordless here; ops provisions LOGIN + password out-of-band (§3.8).
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
                CREATE ROLE app_user NOLOGIN;
            END IF;
        END $$
        """
    )
    op.execute('GRANT USAGE ON SCHEMA public TO app_user')
    op.execute(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public'
        ' TO app_user'
    )
    op.execute(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public'
        ' GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user'
    )

    # Migration state is not app data — the app role never touches it.
    op.execute('REVOKE ALL ON alembic_version FROM app_user')


def downgrade():
    op.execute(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public'
        ' REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM app_user'
    )
    op.execute('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_user')
    op.execute('REVOKE USAGE ON SCHEMA public FROM app_user')
    # Guarded: the role may have been provisioned further (LOGIN, other DBs).
    op.execute(
        """
        DO $$ BEGIN
            DROP ROLE app_user;
        EXCEPTION WHEN dependent_objects_still_exist THEN
            RAISE NOTICE 'app_user still has dependent objects; not dropped';
        END $$
        """
    )

    op.execute('DROP POLICY message_tenant_isolation ON message')
    op.execute('ALTER TABLE message DISABLE ROW LEVEL SECURITY')
    op.execute('DROP POLICY tenant_tenant_isolation ON tenant')
    op.execute('ALTER TABLE tenant DISABLE ROW LEVEL SECURITY')
    for table in reversed(TENANT_COLUMN_TABLES):
        name = table.strip('"')
        op.execute(f'DROP POLICY {name}_tenant_isolation ON {table}')
        op.execute(f'ALTER TABLE {table} DISABLE ROW LEVEL SECURITY')

    op.execute('DROP FUNCTION app_tenant_id()')
