"""Media renditions: a photo's preview object and inline placeholder.

``media_object`` gains ``preview_id`` (the smaller rendition, another
``media_object`` row; cleared when that row goes) and ``lqip`` (a tiny JPEG
data URI). Both nullable, no backfill: older uploads have neither and show
the full image only.

Revision ID: 5d1ede2701f9
Revises: a3c19e7d2b44
Create Date: 2026-10-30

"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

revision = "5d1ede2701f9"
down_revision = "a3c19e7d2b44"
branch_labels = None
depends_on = None

FK = "media_object_preview_id_fkey"


def upgrade() -> None:
    op.add_column("media_object", sa.Column("preview_id", sa.Uuid(), nullable=True))
    op.add_column(
        "media_object",
        sa.Column("lqip", sqlmodel.sql.sqltypes.AutoString(length=2048), nullable=True),
    )
    op.create_foreign_key(
        FK, "media_object", "media_object", ["preview_id"], ["id"], ondelete="SET NULL"
    )


def downgrade() -> None:
    op.drop_constraint(FK, "media_object", type_="foreignkey")
    op.drop_column("media_object", "lqip")
    op.drop_column("media_object", "preview_id")
