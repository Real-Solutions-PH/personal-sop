"""``/nutrition/foods``: the shared food library. Every member lists and
reads every food, most used first; only a food's author (or an admin) edits
it, its photo included; picking a food into a meal counts a use."""

import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.fitness.models import FoodItem
from app.modules.iam.users.models import User
from app.modules.media.models import MediaObject
from app.shared import owned_repo
from tests.utils.mobile import ctx_for, signed_in

API = "/api/v1/nutrition/foods"


def _tag() -> str:
    return uuid.uuid4().hex[:8]


def _food(ctx: Any, name: str, uses: int) -> str:
    row = owned_repo.insert(
        ctx,
        FoodItem,
        {
            "name": name,
            "key": name.lower(),
            "aliases": [],
            "basis": "100g",
            "kcal": 165,
            "protein": 31,
            "carbs": 0,
            "fat": 3.6,
            "sodium": 74,
            "source": "label",
            "use_count": uses,
        },
    )
    ctx.session.commit()
    return str(row.id)


def _photo(db: Session, user: User) -> str:
    m = MediaObject(
        owner_id=user.id,
        tenant_id=user.tenant_id,
        kind="image",
        storage_key=f"u/{user.id}/{uuid.uuid4()}",
        mime="image/jpeg",
        size_bytes=10,
        state="ready",
    )
    db.add(m)
    db.commit()
    return str(m.id)


def test_every_member_lists_every_food_most_used_first(
    client: TestClient, db: Session
) -> None:
    me, headers = signed_in(db)
    other, _ = signed_in(db)
    t = _tag()
    with ctx_for(me) as ctx:
        _food(ctx, f"chicken breast {t}", 2)
        _food(ctx, f"greek yogurt {t}", 9)
    with ctx_for(other) as ctx:
        _food(ctx, f"rice {t}", 50)
    body = client.get(f"{API}?q={t}", headers=headers).json()
    assert body["count"] == 3
    assert [f["name"] for f in body["data"]] == [
        f"rice {t}",
        f"greek yogurt {t}",
        f"chicken breast {t}",
    ]
    assert [f["can_edit"] for f in body["data"]] == [False, True, True]
    assert body["data"][2]["sodium"] == 74 and body["data"][2]["basis"] == "100g"

    r = client.get(f"{API}?q=chicken breast {t}", headers=headers)
    assert [f["name"] for f in r.json()["data"]] == [f"chicken breast {t}"]


def test_the_author_edits_macros_info_and_photo(
    client: TestClient, db: Session
) -> None:
    me, headers = signed_in(db)
    with ctx_for(me) as ctx:
        fid = _food(ctx, f"siomai {_tag()}", 0)
    photo = _photo(db, me)
    r = client.patch(
        f"{API}/{fid}",
        headers=headers,
        json={
            "kcal": 140,
            "protein": 11,
            "basis": "piece",
            "unit_grams": 18,
            "notes": "From the corner shop",
            "photo_media_id": photo,
        },
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert (out["kcal"], out["protein"], out["basis"], out["unit_grams"]) == (
        140,
        11,
        "piece",
        18,
    )
    assert out["notes"] == "From the corner shop"
    assert out["photo_media_id"] == photo and out["photo_url"]
    assert client.get(f"{API}/{fid}", headers=headers).json()["kcal"] == 140


def test_another_member_reads_but_cannot_edit(client: TestClient, db: Session) -> None:
    me, _ = signed_in(db)
    _, theirs = signed_in(db)
    with ctx_for(me) as ctx:
        fid = _food(ctx, f"adobo {_tag()}", 0)
    got = client.get(f"{API}/{fid}", headers=theirs).json()
    assert got["can_edit"] is False
    r = client.patch(f"{API}/{fid}", headers=theirs, json={"kcal": 1})
    assert r.status_code == 403 and r.json()["code"] == "catalog_read_only"
    assert client.get(f"{API}/{fid}", headers=theirs).json()["kcal"] == 165


def test_an_admin_edits_any_food(client: TestClient, db: Session) -> None:
    me, _ = signed_in(db)
    admin, headers = signed_in(db)
    admin.is_superuser = True
    db.add(admin)
    db.commit()
    with ctx_for(me) as ctx:
        fid = _food(ctx, f"lumpia {_tag()}", 0)
    assert client.get(f"{API}/{fid}", headers=headers).json()["can_edit"] is True
    r = client.patch(f"{API}/{fid}", headers=headers, json={"kcal": 99})
    assert r.status_code == 200, r.text


def test_edit_refusals(client: TestClient, db: Session) -> None:
    me, headers = signed_in(db)
    with ctx_for(me) as ctx:
        a = _food(ctx, f"pandesal {_tag()}", 0)
        b_name = f"ensaymada {_tag()}"
        _food(ctx, b_name, 0)
    r = client.patch(f"{API}/{a}", headers=headers, json={"name": b_name})
    assert r.status_code == 409 and r.json()["code"] == "food_name_taken"
    r = client.patch(f"{API}/{a}", headers=headers, json={"name": " ! "})
    assert r.status_code == 422
    r = client.patch(f"{API}/{a}", headers=headers, json={"kcal": -1})
    assert r.status_code == 422
    r = client.patch(f"{API}/{uuid.uuid4()}", headers=headers, json={"kcal": 1})
    assert r.status_code == 404


def test_picking_a_food_counts_a_use(client: TestClient, db: Session) -> None:
    me, _ = signed_in(db)
    _, headers = signed_in(db)
    with ctx_for(me) as ctx:
        fid = _food(ctx, f"banana {_tag()}", 3)
    r = client.post(f"{API}/{fid}/use", headers=headers)
    assert r.status_code == 204, r.text
    got = client.get(f"{API}/{fid}", headers=headers).json()
    assert got["use_count"] == 4 and got["last_used_at"]


def test_needs_sign_in(client: TestClient) -> None:
    assert client.get(API).status_code in (401, 403)
