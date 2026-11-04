"""The export for the replay eval reads only whom ADR-0029 and ADR-0034
allow: Kai, and people whose "Help improve Fern" setting is on now."""

import importlib.util
from pathlib import Path
from types import ModuleType

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from tests.utils.mobile import signed_in

API = f"{settings.API_V1_STR}/profile"


def _export_module() -> ModuleType:
    path = Path(__file__).parents[3] / "scripts" / "fern_eval_export.py"
    spec = importlib.util.spec_from_file_location("fern_eval_export", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_only_kai_and_people_who_turned_it_on_are_exported(
    client: TestClient, db: Session
) -> None:
    export = _export_module()
    kai, kai_h = signed_in(db)
    yes, yes_h = signed_in(db)
    no, no_h = signed_in(db)
    gone, gone_h = signed_in(db)
    for h in (kai_h, yes_h, no_h, gone_h):
        client.get(API, headers=h)  # creates each profile, consent off
    client.patch(API, headers=yes_h, json={"fern_eval_consent": True})
    client.patch(API, headers=gone_h, json={"fern_eval_consent": True})
    client.patch(API, headers=gone_h, json={"fern_eval_consent": False})
    with engine.connect() as conn:
        who = export.owners(conn, owner_email=kai.email)
        data = export.export(
            conn, since="2026-11-04T00:00:00+00:00", owner_email=kai.email
        )
    assert who[str(kai.id)] == "public"
    assert who[str(yes.id)] == "private"
    assert str(no.id) not in who and str(gone.id) not in who
    assert set(data["owners"]) == set(who)
    # Each owner's rows are their own.
    for uid, part in data["owners"].items():
        for rows in part["tables"].values():
            assert all(r["owner_id"] == uid for r in rows)


def test_kai_is_public_even_with_the_setting_on(
    client: TestClient, db: Session
) -> None:
    export = _export_module()
    kai, kai_h = signed_in(db)
    client.get(API, headers=kai_h)
    client.patch(API, headers=kai_h, json={"fern_eval_consent": True})
    with engine.connect() as conn:
        assert export.owners(conn, owner_email=kai.email)[str(kai.id)] == "public"
