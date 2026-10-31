"""Shared catalog: merge duplicate exercises, routines and foods app-wide.

Exercises, workout routines and foods became one catalog every member of a
tenant shares (``app/modules/fitness/catalog.py``). Until now each member had
their own copies (the seeded library once per member) and Fern added a new
exercise for every new spelling ("Pec deck", "Pec deck machine", "Pec deck
fly"). This revision folds those copies together, per tenant:

- **Exercises** of one load type whose names have the same key (the frozen
  ``_key`` below: folded words, plurals and spellings collapsed, word order
  ignored, the pec-deck family and machine-only lifts collapsed) are one
  exercise; so are names that differ only by equipment words when at most one
  equipment variant exists ("Shoulder press" + "Shoulder press machine", but
  not when "Dumbbell shoulder press" is there too). Exercises already merged
  in the app (archived pointers) join their survivor's group.
- The survivor is the row with the most live workout entries, then a
  non-archived one, then the oldest, then the lowest id. It keeps its name;
  every other name becomes an alias.
- Every workout entry (``workout_exercise``, tombstones too), routine slot
  (``template_item``) and merged-pointer row moves to the survivor, so every
  member's sets, history and personal records now count under one exercise.
  Nothing a member logged is deleted.
- Each duplicate, once nothing references it, is tombstoned (``deleted_at``,
  so every device drops it on its next sync) with ``merged_into_id`` set, so
  an offline device that still sends its id is pointed at the survivor.
- **Routines** with the same folded name AND the same exercises and set
  counts in the same order (after the exercise merge) are one routine:
  workouts started from a duplicate point at the survivor (most workouts,
  then oldest) and the duplicate and its slots are tombstoned. Same name
  with different content is left alone.
- **Foods** with the same folded name (plurals folded) are one food: the
  survivor (label-verified, then most used, then oldest) gains the others'
  aliases and use counts; the others are tombstoned. No row references a
  food, so nothing else moves.
- Every merge is written to ``catalog_merge_log`` (what, from, into, how many
  references moved) for audit.

Schema: ``food_item.photo_media_id`` (a food's photo); the food name is
unique per tenant among live rows instead of per owner; a ``user`` delete
trigger passes the catalog rows a deleted member authored to an admin (else
the longest-standing member), so deleting an account never deletes rows
other members' history points at.

Idempotent: a second run finds no duplicates. Downgrade restores the schema
only; the merges stay, because a merge is not losslessly reversible (two
members' histories now share rows that no longer record which name each set
was logged under) and the log keeps what was merged.

Revision ID: c5e1d0a7b391
Revises: a9e3c51d7b42
Create Date: 2026-10-31

"""

import re
from collections import defaultdict
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "c5e1d0a7b391"
down_revision = "a9e3c51d7b42"
branch_labels = None
depends_on = None

LOG = "catalog_merge_log"
CATALOG = ("exercise", "workout_template", "template_item", "food_item")

# ---------------------------------------------------------------- frozen keys
# A copy of app/modules/fitness/catalog.py as of this revision.

SYNONYMS = {
    "flye": "fly",
    "flyes": "fly",
    "flys": "fly",
    "flies": "fly",
    "db": "dumbbell",
    "dumbell": "dumbbell",
    "dumbells": "dumbbell",
    "bb": "barbell",
    "kb": "kettlebell",
    "tricep": "triceps",
    "bicep": "biceps",
    "pecs": "pec",
    "pulldowns": "pulldown",
    "pushdowns": "pushdown",
    "pullups": "pullup",
    "chinups": "chinup",
    "situps": "situp",
    "pushups": "pushup",
}
PHRASES = (
    ("pull down", "pulldown"),
    ("push down", "pushdown"),
    ("pull up", "pullup"),
    ("chin up", "chinup"),
    ("push up", "pushup"),
    ("sit up", "situp"),
    ("pec dec", "pec deck"),
    ("ohp", "overhead press"),
)
NOISE = {"the", "a", "an", "of", "on", "with", "w", "exercise"}
EQUIPMENT = {
    "machine",
    "barbell",
    "dumbbell",
    "cable",
    "smith",
    "kettlebell",
    "band",
    "ez",
    "bodyweight",
    "plate",
    "loaded",
}
MACHINE_ONLY = (
    frozenset({"leg", "press"}),
    frozenset({"leg", "extension"}),
    frozenset({"leg", "curl"}),
    frozenset({"hack", "squat"}),
    frozenset({"lat", "pulldown"}),
)
PEC_DECK = frozenset({"pec", "deck"})
REAR = {"rear", "reverse", "delt", "delts"}


def _fold(name: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", name.lower()))


def _singular(w: str) -> str:
    if len(w) <= 3 or w.endswith("ss") or w in {"biceps", "triceps", "abs"}:
        return w
    if w.endswith("ies"):
        return w[:-3] + "y"
    if w.endswith(("sses", "xes", "ches", "shes")):
        return w[:-2]
    if w.endswith("s"):
        return w[:-1]
    return w


def _words(name: str) -> set[str]:
    text = f" {_fold(name)} "
    for phrase, joined in PHRASES:
        text = text.replace(f" {phrase} ", f" {joined} ")
    out = {
        _singular(w)
        for p in (SYNONYMS.get(w, w) for w in text.split())
        for w in p.split()
    }
    out -= NOISE
    if not out & REAR and (
        "pec" in out
        or "butterfly" in out
        or out in ({"fly", "machine"}, {"chest", "fly", "machine"})
    ):
        return set(PEC_DECK)
    if frozenset(out - {"machine"}) in MACHINE_ONLY:
        return out - {"machine"}
    return out


def _key(name: str) -> str:
    return " ".join(sorted(_words(name)))


def _bare(name: str) -> str:
    return " ".join(sorted(_words(name) - EQUIPMENT))


def _gear(name: str) -> frozenset[str]:
    return frozenset(_words(name) & EQUIPMENT)


def _plain(name: str) -> str:
    return " ".join(
        w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w
        for w in _fold(name).split()
    )


# ---------------------------------------------------------------- helpers


class _Groups:
    """Union-find over row ids."""

    def __init__(self) -> None:
        self.parent: dict[Any, Any] = {}

    def find(self, x: Any) -> Any:
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def join(self, a: Any, b: Any) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb, key=str)] = min(ra, rb, key=str)

    def sets(self) -> list[list[Any]]:
        out: dict[Any, list[Any]] = defaultdict(list)
        for x in list(self.parent):
            out[self.find(x)].append(x)
        return [v for v in out.values() if len(v) > 1]


def _log(conn: Any, rows: list[dict[str, Any]]) -> None:
    if rows:
        conn.execute(
            sa.text(
                f"INSERT INTO {LOG} (tenant_id, kind, loser_id, survivor_id,"
                " loser_name, survivor_name, refs_moved)"
                " VALUES (:tenant_id, :kind, :loser_id, :survivor_id,"
                " :loser_name, :survivor_name, :refs_moved)"
            ),
            rows,
        )


def _merge_exercises(conn: Any) -> None:
    rows = (
        conn.execute(
            sa.text(
                """
            SELECT e.id, e.tenant_id, e.name, e.aliases, e.load_type,
                   e.archived, e.created_at, e.merged_into_id,
                   (SELECT count(*) FROM workout_exercise we
                     WHERE we.exercise_id = e.id AND we.deleted_at IS NULL) AS refs
            FROM exercise e
            WHERE e.deleted_at IS NULL
            """
            )
        )
        .mappings()
        .all()
    )
    by_id = {r["id"]: r for r in rows}
    groups = _Groups()
    live = [r for r in rows if r["merged_into_id"] is None]
    # Same key: one exercise.
    first: dict[tuple[Any, str, str], Any] = {}
    for r in live:
        for name in [r["name"], *(r["aliases"] or [])]:
            k = (r["tenant_id"], r["load_type"], _key(name))
            if not k[2]:
                continue
            if k in first:
                groups.join(first[k], r["id"])
            else:
                first[k] = r["id"]
            groups.find(r["id"])
    # Same bare name: one exercise when at most one equipment variant exists.
    bare: dict[tuple[Any, str, str], list[Any]] = defaultdict(list)
    for r in live:
        k = (r["tenant_id"], r["load_type"], _bare(r["name"]))
        if k[2]:
            bare[k].append(r)
    for members in bare.values():
        gears = {_gear(m["name"]) for m in members} - {frozenset()}
        if len(members) > 1 and len(gears) <= 1:
            for m in members[1:]:
                groups.join(members[0]["id"], m["id"])
    # Rows merged in the app join their survivor's group.
    for r in rows:
        target = r["merged_into_id"]
        hops = 0
        while target in by_id and by_id[target]["merged_into_id"] and hops < 10:
            target = by_id[target]["merged_into_id"]
            hops += 1
        if r["merged_into_id"] is not None and target in by_id:
            groups.join(target, r["id"])

    log: list[dict[str, Any]] = []
    for ids in groups.sets():
        members = [by_id[i] for i in ids]
        candidates = [m for m in members if m["merged_into_id"] is None] or members
        survivor = sorted(
            candidates,
            key=lambda m: (-m["refs"], m["archived"], m["created_at"], str(m["id"])),
        )[0]
        losers = [m for m in members if m["id"] != survivor["id"]]
        seen = {survivor["name"].strip().lower()}
        aliases: list[str] = []
        for a in [
            *(survivor["aliases"] or []),
            *(n for m in losers for n in [m["name"], *(m["aliases"] or [])]),
        ]:
            if a.strip() and a.strip().lower() not in seen:
                seen.add(a.strip().lower())
                aliases.append(a.strip())
        keep_visible = survivor["archived"] and any(
            not m["archived"] and m["merged_into_id"] is None for m in losers
        )
        conn.execute(
            sa.text(
                "UPDATE exercise SET aliases = CAST(:aliases AS jsonb),"
                " archived = CASE WHEN :unarchive THEN false ELSE archived END,"
                " updated_at = now() WHERE id = :id"
            ),
            {
                "aliases": _json(aliases),
                "unarchive": keep_visible,
                "id": survivor["id"],
            },
        )
        for m in losers:
            moved = 0
            for table in ("workout_exercise", "template_item"):
                moved += conn.execute(
                    sa.text(
                        f"UPDATE {table} SET exercise_id = :s, updated_at = now()"
                        " WHERE exercise_id = :l"
                    ),
                    {"s": survivor["id"], "l": m["id"]},
                ).rowcount
            conn.execute(
                sa.text(
                    "UPDATE exercise SET merged_into_id = :s, updated_at = now()"
                    " WHERE merged_into_id = :l"
                ),
                {"s": survivor["id"], "l": m["id"]},
            )
            log.append(
                {
                    "tenant_id": m["tenant_id"],
                    "kind": "exercise",
                    "loser_id": m["id"],
                    "survivor_id": survivor["id"],
                    "loser_name": m["name"],
                    "survivor_name": survivor["name"],
                    "refs_moved": moved,
                }
            )
        # Tombstone only what is now empty: nothing references it any more.
        conn.execute(
            sa.text(
                """
                UPDATE exercise e
                SET merged_into_id = :s, archived = true,
                    deleted_at = now(), updated_at = now()
                WHERE e.id = ANY(:losers)
                  AND NOT EXISTS (SELECT 1 FROM workout_exercise w
                                  WHERE w.exercise_id = e.id)
                  AND NOT EXISTS (SELECT 1 FROM template_item t
                                  WHERE t.exercise_id = e.id)
                """
            ),
            {"s": survivor["id"], "losers": [m["id"] for m in losers]},
        )
    _log(conn, log)


def _merge_routines(conn: Any) -> None:
    rows = (
        conn.execute(
            sa.text(
                """
            SELECT t.id, t.tenant_id, t.name, t.created_at,
                   (SELECT count(*) FROM workout w WHERE w.template_id = t.id
                      AND w.deleted_at IS NULL) AS refs,
                   COALESCE((SELECT json_agg(json_build_array(i.exercise_id, i.sets)
                                             ORDER BY i.position)
                             FROM template_item i
                             WHERE i.template_id = t.id AND i.deleted_at IS NULL),
                            '[]') AS slots
            FROM workout_template t
            WHERE t.deleted_at IS NULL
            """
            )
        )
        .mappings()
        .all()
    )
    same: dict[tuple[Any, str, str], list[Any]] = defaultdict(list)
    for r in rows:
        same[(r["tenant_id"], _fold(r["name"]), _json(r["slots"]))].append(r)
    log: list[dict[str, Any]] = []
    for members in same.values():
        if len(members) < 2:
            continue
        survivor = sorted(
            members, key=lambda m: (-m["refs"], m["created_at"], str(m["id"]))
        )[0]
        for m in members:
            if m["id"] == survivor["id"]:
                continue
            moved = conn.execute(
                sa.text(
                    "UPDATE workout SET template_id = :s, updated_at = now()"
                    " WHERE template_id = :l"
                ),
                {"s": survivor["id"], "l": m["id"]},
            ).rowcount
            for table, col in (
                ("template_item", "template_id"),
                ("workout_template", "id"),
            ):
                conn.execute(
                    sa.text(
                        f"UPDATE {table} SET deleted_at = now(), updated_at = now()"
                        f" WHERE {col} = :l AND deleted_at IS NULL"
                    ),
                    {"l": m["id"]},
                )
            log.append(
                {
                    "tenant_id": m["tenant_id"],
                    "kind": "routine",
                    "loser_id": m["id"],
                    "survivor_id": survivor["id"],
                    "loser_name": m["name"],
                    "survivor_name": survivor["name"],
                    "refs_moved": moved,
                }
            )
    _log(conn, log)


def _merge_foods(conn: Any) -> None:
    rows = (
        conn.execute(
            sa.text(
                """
            SELECT id, tenant_id, name, key, aliases, verified, use_count,
                   last_used_at, created_at
            FROM food_item WHERE deleted_at IS NULL
            """
            )
        )
        .mappings()
        .all()
    )
    same: dict[tuple[Any, str], list[Any]] = defaultdict(list)
    for r in rows:
        same[(r["tenant_id"], _plain(r["key"]))].append(r)
    log: list[dict[str, Any]] = []
    for members in same.values():
        if len(members) < 2:
            continue
        survivor = sorted(
            members,
            key=lambda m: (
                not m["verified"],
                -(m["use_count"] or 0),
                m["created_at"],
                str(m["id"]),
            ),
        )[0]
        losers = [m for m in members if m["id"] != survivor["id"]]
        aliases = sorted(
            {
                a
                for m in members
                for a in [m["key"], *(m["aliases"] or [])]
                if a and a != survivor["key"]
            }
        )
        used = [m["last_used_at"] for m in members if m["last_used_at"]]
        conn.execute(
            sa.text(
                "UPDATE food_item SET aliases = CAST(:aliases AS jsonb),"
                " use_count = :uses, last_used_at = :last, updated_at = now()"
                " WHERE id = :id"
            ),
            {
                "aliases": _json(aliases),
                "uses": sum(m["use_count"] or 0 for m in members),
                "last": max(used) if used else None,
                "id": survivor["id"],
            },
        )
        conn.execute(
            sa.text(
                "UPDATE food_item SET deleted_at = now(), updated_at = now()"
                " WHERE id = ANY(:ids)"
            ),
            {"ids": [m["id"] for m in losers]},
        )
        log += [
            {
                "tenant_id": m["tenant_id"],
                "kind": "food",
                "loser_id": m["id"],
                "survivor_id": survivor["id"],
                "loser_name": m["name"],
                "survivor_name": survivor["name"],
                "refs_moved": 0,
            }
            for m in losers
        ]
    _log(conn, log)


def _json(v: Any) -> str:
    import json

    return json.dumps(v, default=str, sort_keys=True)


def upgrade() -> None:
    op.add_column("food_item", sa.Column("photo_media_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_food_item_photo_media",
        "food_item",
        "media_object",
        ["photo_media_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_table(
        LOG,
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("loser_id", sa.Uuid(), nullable=False),
        sa.Column("survivor_id", sa.Uuid(), nullable=False),
        sa.Column("loser_name", sa.Text(), nullable=False),
        sa.Column("survivor_name", sa.Text(), nullable=False),
        sa.Column("refs_moved", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.execute(f"ALTER TABLE {LOG} ENABLE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY {LOG}_tenant_isolation ON {LOG}
            USING (tenant_id = app_tenant_id())
            WITH CHECK (tenant_id = app_tenant_id())
        """
    )

    # A member's account deletion cascades to rows they own; catalog rows
    # they authored are everyone's, so they pass to an admin (else the
    # longest-standing member) first.
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION catalog_pass_on() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE heir uuid;
        BEGIN
            SELECT id INTO heir FROM "user"
            WHERE tenant_id = OLD.tenant_id AND id <> OLD.id
            ORDER BY is_superuser DESC, created_at ASC NULLS LAST, id
            LIMIT 1;
            IF heir IS NOT NULL THEN
                {"".join(f"UPDATE {t} SET owner_id = heir WHERE owner_id = OLD.id; " for t in CATALOG)}
            END IF;
            RETURN OLD;
        END $$
        """
    )
    op.execute(
        'CREATE TRIGGER catalog_pass_on BEFORE DELETE ON "user"'
        " FOR EACH ROW EXECUTE FUNCTION catalog_pass_on()"
    )

    conn = op.get_bind()
    _merge_exercises(conn)
    _merge_routines(conn)
    _merge_foods(conn)

    op.drop_constraint("uq_food_item_owner_key", "food_item", type_="unique")
    op.create_index(
        "uq_food_item_tenant_key_live",
        "food_item",
        ["tenant_id", "key"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    # Schema only: the merges stay (see the module docstring).
    op.execute('DROP TRIGGER catalog_pass_on ON "user"')
    op.execute("DROP FUNCTION catalog_pass_on()")
    op.drop_index("uq_food_item_tenant_key_live", table_name="food_item")
    # Per owner again: a tombstone that now shares its owner's name with
    # another row (a merged duplicate, or rows passed on by an account
    # deletion) goes; nothing references a food.
    op.execute(
        """
        DELETE FROM food_item f
        WHERE f.deleted_at IS NOT NULL AND EXISTS (
            SELECT 1 FROM food_item g
            WHERE g.owner_id = f.owner_id AND g.key = f.key AND g.id <> f.id
              AND (g.deleted_at IS NULL OR g.id < f.id)
        )
        """
    )
    op.create_unique_constraint(
        "uq_food_item_owner_key", "food_item", ["owner_id", "key"]
    )
    op.drop_table(LOG)
    op.drop_constraint("fk_food_item_photo_media", "food_item", type_="foreignkey")
    op.drop_column("food_item", "photo_media_id")
