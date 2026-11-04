"""Read-only export of the chats the Fern replay eval may be built from.

Run as a one-off ECS task on the backend image (docs/runbook.md, "Fern eval
export"); the export is printed to the task's log, gzipped and base64 in
numbered lines, and nothing is written anywhere.

Whose chats: Kai's (ADR-0029, the public dataset) and those of every person
whose "Help improve Fern" setting is on at the moment of the export
(ADR-0034, the private store). Nobody else's rows are read. A person who
turned it off is simply absent, so their cases leave the private store at
the next refresh.

    python scripts/fern_eval_export.py --since 2026-11-04T08:27:22+00:00
"""

import argparse
import base64
import gzip
import json
import sys
import uuid
from typing import Any

from sqlalchemy import Connection, text

# Kai's account: his chats make the public dataset whatever the setting says.
OWNER_EMAIL = "admin@example.com"
# The rows a case's record state is rebuilt from (harness.TABLES), the chat,
# and the person's feedback on replies.
TABLES = (
    "account",
    "category",
    "fin_record",
    "habit",
    "habit_log",
    "task",
    "macro_target",
    "food_item",
    "meal",
    "meal_item",
    "exercise",
    "workout_template",
    "template_item",
    "workout",
    "workout_exercise",
    "workout_set",
    "weigh_in",
    "memory",
    "capture",
    "capture_attachment",
    "record_card",
    "companion_thread",
    "companion_message",
    "fern_feedback",
    "user_profile",
)
# Never exported: vectors, and nothing a case needs.
SKIP_COLUMNS = {"embedding"}
LINE = 8000


def owners(conn: Connection, owner_email: str = OWNER_EMAIL) -> dict[str, str]:
    """Who may be exported: user id -> "public" (Kai) or "private" (a person
    with the setting on now)."""
    out: dict[str, str] = {}
    for (uid,) in conn.execute(
        text('SELECT id FROM "user" WHERE email = :e'), {"e": owner_email}
    ):
        out[str(uid)] = "public"
    for (uid,) in conn.execute(
        text(
            "SELECT owner_id FROM user_profile "
            "WHERE fern_eval_consent AND deleted_at IS NULL"
        )
    ):
        out.setdefault(str(uid), "private")
    return out


def _rows(conn: Connection, table: str, owner: uuid.UUID) -> list[Any]:
    cols = [
        c
        for (c,) in conn.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = :t ORDER BY ordinal_position"
            ),
            {"t": table},
        )
        if c not in SKIP_COLUMNS
    ]
    picked = ", ".join(f'"{c}"' for c in cols)
    q = f'SELECT row_to_json(x) FROM (SELECT {picked} FROM "{table}" WHERE owner_id = :u) x'  # noqa: S608 - names from the fixed list above
    return [r for (r,) in conn.execute(text(q), {"u": owner})]


def export(
    conn: Connection, since: str, owner_email: str = OWNER_EMAIL
) -> dict[str, Any]:
    """Every exportable owner's rows, read inside a read-only transaction.
    ``since`` is the last case's moment, recorded for the case builder."""
    conn.execute(text("SET TRANSACTION READ ONLY"))
    out: dict[str, Any] = {"since": since, "owners": {}}
    for uid, store in owners(conn, owner_email).items():
        tables = {t: _rows(conn, t, uuid.UUID(uid)) for t in TABLES}
        out["owners"][uid] = {"store": store, "tables": tables}
    conn.rollback()
    return out


def main() -> None:
    import app.db.models  # noqa: F401 - registers every model
    from app.core.db import engine

    ap = argparse.ArgumentParser()
    ap.add_argument("--since", required=True, help="the last case's moment, ISO")
    args = ap.parse_args()
    with engine.connect() as conn:
        data = export(conn, args.since)
    blob = base64.b64encode(
        gzip.compress(json.dumps(data, default=str).encode())
    ).decode()
    parts = [blob[i : i + LINE] for i in range(0, len(blob), LINE)]
    # One numbered line each: a log event holds at most 256 KB.
    out = [f"EXPSTART {len(parts)}"]
    out += [f"EXP {i} {p}" for i, p in enumerate(parts)]
    sys.stdout.write("\n".join([*out, "EXPEND"]) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
