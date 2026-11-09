"""Built-in (global) and own foods.

Until now the food library was one catalog every member of a tenant read,
editable by its author or an admin (``c5e1d0a7b391``), so one member
editing or deleting a food changed it for everyone. From here on
``food_item`` carries ``is_global``, like exercises and routines
(``0ebdc219ab8e``):

- a **global** food is built in: every member reads and uses it, nobody
  edits or deletes it through the API (``owned_repo.guard_write``);
- every other food is its **owner's** alone.

Classification of the existing rows: a food a bulk import of a public
database made is built in, i.e. ``external_ref`` starts with ``usda:``,
``off:`` or ``philfct:`` (frozen copy of ``food_library.BULK_PREFIXES``),
tombstones included. Everything else (read from a label, said to Fern, a
recipe, a Notion import, a brand typed by a member) stays its author's,
now private.

Past meals are unaffected: ``meal_item`` snapshots its numbers and has no
foreign key to ``food_item``, so a food turning private (or a member's
edit to it) never changes a meal another member logged.

Uniqueness: ``uq_food_item_tenant_key_live`` (one live food per name in the
tenant) becomes two partial unique indexes: one live built-in food per name
in the tenant, and one live own food per name per member. An own food may
share a name with a built-in one. The old index already made every live
(tenant, key) unique, so no existing row can break the new ones. The
barcode index (``ix_food_item_tenant_barcode``) is not unique and stays.

Foods are not a synced entity (the app reads them through
``/nutrition/foods``), so no ``sync_scope_exit`` records are needed.

The user-delete trigger now passes on only the built-in foods a deleted
member was filed under; their own foods go with them.

Downgrade restores the single (tenant, key) index; where two live foods
now share a key (an own food named like a built-in one, or two members'
own foods), the built-in one, else the oldest, keeps it and the others are
tombstoned (deterministic: ``is_global DESC, created_at, id``). Then the
column goes and every food is shared again.

Revision ID: 4d6171529d45
Revises: b3f1d7a2c946
Create Date: 2026-11-09

"""

import sqlalchemy as sa
from alembic import op

revision = "4d6171529d45"
down_revision = "b3f1d7a2c946"
branch_labels = None
depends_on = None

CATALOG = ("exercise", "workout_template", "template_item", "food_item")
BULK_PREFIXES = ("usda:", "off:", "philfct:")


def _pass_on_trigger(where: dict[str, str]) -> str:
    """``catalog_pass_on()`` (as in ``0ebdc219ab8e``): before a user is
    deleted, the catalog rows they authored (``where`` narrows which) pass
    to an admin, else the longest-standing member."""
    updates = "".join(
        f"UPDATE {t} SET owner_id = heir WHERE owner_id = OLD.id{where.get(t, '')}; "
        for t in CATALOG
    )
    return f"""
        CREATE OR REPLACE FUNCTION catalog_pass_on() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE heir uuid;
        BEGIN
            SELECT id INTO heir FROM "user"
            WHERE tenant_id = OLD.tenant_id AND id <> OLD.id
            ORDER BY is_superuser DESC, created_at ASC NULLS LAST, id
            LIMIT 1;
            IF heir IS NOT NULL THEN
                {updates}
            END IF;
            RETURN OLD;
        END $$
        """


def upgrade() -> None:
    op.add_column(
        "food_item",
        sa.Column(
            "is_global", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
    )
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "UPDATE food_item SET is_global = true"
            " WHERE external_ref LIKE ANY(:prefixes)"
        ),
        {"prefixes": [p + "%" for p in BULK_PREFIXES]},
    )
    op.drop_index("uq_food_item_tenant_key_live", table_name="food_item")
    op.create_index(
        "uq_food_item_global_key_live",
        "food_item",
        ["tenant_id", "key"],
        unique=True,
        postgresql_where=sa.text("is_global AND deleted_at IS NULL"),
    )
    op.create_index(
        "uq_food_item_owner_key_live",
        "food_item",
        ["owner_id", "key"],
        unique=True,
        postgresql_where=sa.text("NOT is_global AND deleted_at IS NULL"),
    )
    op.execute(_pass_on_trigger({t: " AND is_global" for t in CATALOG}))


def downgrade() -> None:
    op.execute(
        _pass_on_trigger({t: " AND is_global" for t in CATALOG if t != "food_item"})
    )
    op.drop_index("uq_food_item_owner_key_live", table_name="food_item")
    op.drop_index("uq_food_item_global_key_live", table_name="food_item")
    op.execute(
        """
        UPDATE food_item f SET deleted_at = now(), updated_at = now()
        FROM (
            SELECT id, row_number() OVER (
                PARTITION BY tenant_id, key
                ORDER BY is_global DESC, created_at, id
            ) AS n
            FROM food_item WHERE deleted_at IS NULL
        ) d
        WHERE f.id = d.id AND d.n > 1
        """
    )
    op.create_index(
        "uq_food_item_tenant_key_live",
        "food_item",
        ["tenant_id", "key"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_column("food_item", "is_global")
