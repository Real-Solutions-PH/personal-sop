"""procrastinate queue schema

Applies the background-job queue schema (the ``procrastinate_*`` tables, types,
functions and triggers) in a single self-contained revision that depends only
on the current head. The SQL is vendored and frozen in the sibling
``59d85cb46b83_procrastinate_queue_schema.sql`` so the migration is reproducible
regardless of the installed Procrastinate version.

Revision ID: 59d85cb46b83
Revises: d3f8a2b19c47
Create Date: 2026-09-10 15:24:48.136988

"""

from pathlib import Path

from alembic import op

# revision identifiers, used by Alembic.
revision = "59d85cb46b83"
down_revision = "d3f8a2b19c47"
branch_labels = None
depends_on = None

# The frozen schema uses '%' in PL/pgSQL RAISE messages; the driver treats '%'
# as a client-side placeholder, so every literal '%' is doubled before it is
# sent (mirrors how Procrastinate applies its own schema).
_SCHEMA_SQL = (Path(__file__).with_suffix(".sql")).read_text(encoding="utf-8")

# Drop every object the schema created, whatever the exact set. Tables go first
# (CASCADE takes their triggers, indexes and owned sequences), then functions,
# then types, then any orphan sequences. The shared plpgsql extension is left
# alone. Prefixed with 'procrastinate_' so nothing else is touched; escaped '_'
# keeps LIKE from treating it as a wildcard.
_DROP_SQL = """
DO $$
DECLARE
    obj record;
BEGIN
    FOR obj IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = current_schema()
          AND tablename LIKE 'procrastinate\\_%'
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', obj.tablename);
    END LOOP;

    FOR obj IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = current_schema()
          AND p.proname LIKE 'procrastinate\\_%'
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', obj.sig);
    END LOOP;

    FOR obj IN
        SELECT t.typname
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = current_schema()
          AND t.typname LIKE 'procrastinate\\_%'
    LOOP
        EXECUTE format('DROP TYPE IF EXISTS %I CASCADE', obj.typname);
    END LOOP;

    FOR obj IN
        SELECT sequencename FROM pg_sequences
        WHERE schemaname = current_schema()
          AND sequencename LIKE 'procrastinate\\_%'
    LOOP
        EXECUTE format('DROP SEQUENCE IF EXISTS %I CASCADE', obj.sequencename);
    END LOOP;
END $$;
"""


def upgrade() -> None:
    op.get_bind().exec_driver_sql(_SCHEMA_SQL.replace("%", "%%"))


def downgrade() -> None:
    op.get_bind().exec_driver_sql(_DROP_SQL.replace("%", "%%"))
