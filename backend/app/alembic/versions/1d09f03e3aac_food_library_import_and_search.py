"""food library: imported databases, barcodes and indexed search

Revision ID: 1d09f03e3aac
Revises: 16bb85411e8a, 3a94561e128e
Create Date: 2026-11-06 01:10:00.000000

The shared food library takes in whole public databases (USDA FoodData
Central, Open Food Facts), so it grows from about a hundred foods to over
ten thousand:

- ``source`` gains ``off`` (Open Food Facts, crowd-sourced) so its products
  rank below lab-analysed and personal foods.
- ``barcode`` holds a packaged product's EAN/UPC, for barcode lookups.
- A full-text index over the food's folded name and aliases lets a lookup
  read the foods that share a word with what was said instead of loading
  the whole library. The expression is the one ``food_library`` queries
  with, character for character; change both together.

Also joins the two heads ``16bb85411e8a`` (funnel events) and
``3a94561e128e`` (module intro on profile), which both followed
``c3e7a1f05b92``.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "1d09f03e3aac"
down_revision = ("16bb85411e8a", "3a94561e128e")
branch_labels = None
depends_on = None

OLD_SOURCES = "'label', 'brand', 'philfct', 'usda', 'recipe', 'said', 'import'"
NEW_SOURCES = OLD_SOURCES + ", 'off'"
SEARCH_DOC = "to_tsvector('simple'::regconfig, key || ' ' || aliases::text)"


def upgrade():
    op.drop_constraint("ck_food_item_source", "food_item", type_="check")
    op.create_check_constraint(
        "ck_food_item_source", "food_item", f"source IN ({NEW_SOURCES})"
    )
    op.add_column("food_item", sa.Column("barcode", sa.String(14), nullable=True))
    op.create_index(
        "ix_food_item_tenant_barcode",
        "food_item",
        ["tenant_id", "barcode"],
        postgresql_where=sa.text("barcode IS NOT NULL AND deleted_at IS NULL"),
    )
    op.execute(
        f"CREATE INDEX ix_food_item_search ON food_item USING gin ({SEARCH_DOC})"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_food_item_search")
    op.drop_index("ix_food_item_tenant_barcode", table_name="food_item")
    op.drop_column("food_item", "barcode")
    # Open Food Facts rows stay, filed under the old catch-all source.
    op.execute("UPDATE food_item SET source = 'import' WHERE source = 'off'")
    op.drop_constraint("ck_food_item_source", "food_item", type_="check")
    op.create_check_constraint(
        "ck_food_item_source", "food_item", f"source IN ({OLD_SOURCES})"
    )
