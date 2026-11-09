"""``/nutrition/foods``: the food library. Every member lists and reads the
built-in foods (a bulk import made them) and their own, most used first;
nobody edits a built-in food (admins included), a member's own food is
theirs alone, its photo included; any visible food copies into one's own;
picking a food into a meal counts a use."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.fitness.models import FoodItem
from app.modules.iam.users.models import User
from app.modules.media.models import MediaObject
from app.shared import owned_repo
from tests.utils.mobile import ctx_for, signed_in
from tests.utils.tenant import fresh_tenant
from tests.utils.user import create_auth_user
from tests.utils.utils import auth_headers

API = "/api/v1/nutrition/foods"


def _tag() -> str:
    return uuid.uuid4().hex[:8]


def _food(ctx: Any, name: str, uses: int, **extra: Any) -> str:
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
        }
        | extra,
    )
    ctx.session.commit()
    return str(row.id)


def _built_in(ctx: Any, name: str, uses: int = 0, **extra: Any) -> str:
    """A food a bulk import made: built in (``is_global``)."""
    fid = _food(
        ctx,
        name,
        uses,
        **({"source": "usda", "external_ref": f"usda:{_tag()}"} | extra),
    )
    row = ctx.session.get(FoodItem, uuid.UUID(fid))
    row.is_global = True
    ctx.session.add(row)
    ctx.session.commit()
    return fid


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


def test_a_member_lists_their_own_foods_and_the_built_in_ones(
    client: TestClient, db: Session
) -> None:
    me, headers = signed_in(db)
    other, _ = signed_in(db)
    t = _tag()
    with ctx_for(me) as ctx:
        _food(ctx, f"chicken breast {t}", 2)
        _food(ctx, f"greek yogurt {t}", 9)
    with ctx_for(other) as ctx:
        _food(ctx, f"their rice {t}", 50)
        _built_in(ctx, f"white rice {t}", 70)
    body = client.get(f"{API}?q={t}", headers=headers).json()
    assert body["count"] == 3
    # Own foods before database ones, then the most used.
    assert [f["name"] for f in body["data"]] == [
        f"greek yogurt {t}",
        f"chicken breast {t}",
        f"white rice {t}",
    ]
    assert [f["can_edit"] for f in body["data"]] == [True, True, False]
    assert [f["is_global"] for f in body["data"]] == [False, False, True]
    assert body["data"][1]["sodium"] == 74 and body["data"][1]["basis"] == "100g"

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


def test_another_members_food_is_invisible(client: TestClient, db: Session) -> None:
    me, _ = signed_in(db)
    _, theirs = signed_in(db)
    t = _tag()
    with ctx_for(me) as ctx:
        fid = _food(ctx, f"adobo {t}", 0)
    assert client.get(f"{API}/{fid}", headers=theirs).status_code == 404
    assert client.get(f"{API}?q=adobo {t}", headers=theirs).json()["count"] == 0
    r = client.patch(f"{API}/{fid}", headers=theirs, json={"kcal": 1})
    assert r.status_code == 404
    assert client.post(f"{API}/{fid}/copy", headers=theirs).status_code == 404
    assert client.post(f"{API}/{fid}/use", headers=theirs).status_code == 404


def test_nobody_edits_a_built_in_food_admins_included(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    admin, admin_headers = signed_in(db)
    admin.is_superuser = True
    db.add(admin)
    db.commit()
    with ctx_for(admin) as ctx:
        fid = _built_in(ctx, f"lumpia {_tag()}")
    for h in (headers, admin_headers):
        got = client.get(f"{API}/{fid}", headers=h).json()
        assert got["is_global"] is True and got["can_edit"] is False
        r = client.patch(f"{API}/{fid}", headers=h, json={"kcal": 99})
        assert r.status_code == 403 and r.json()["code"] == "catalog_read_only"
    assert client.get(f"{API}/{fid}", headers=headers).json()["kcal"] == 165


def test_copy_makes_an_own_food_from_a_built_in_one(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    other, _ = signed_in(db)
    t = _tag()
    name = f"Bananas, raw {t}"
    with ctx_for(other) as ctx:
        fid = _built_in(ctx, name, 5, aliases=["saging"])
    r = client.post(f"{API}/{fid}/copy", headers=headers)
    assert r.status_code == 200, r.text
    mine = r.json()
    assert mine["id"] != fid and mine["name"] == name
    assert mine["is_global"] is False and mine["can_edit"] is True
    assert (mine["kcal"], mine["protein"], mine["aliases"]) == (165, 31, ["saging"])
    # The copy is the member's own: no longer a database row, never counted.
    assert mine["origin"] == "you" and mine["use_count"] == 0
    r = client.patch(f"{API}/{mine['id']}", headers=headers, json={"kcal": 90})
    assert r.status_code == 200, r.text
    assert client.get(f"{API}/{fid}", headers=headers).json()["kcal"] == 165
    # A second copy gains " (copy)": the member already has that name.
    again = client.post(f"{API}/{fid}/copy", headers=headers).json()
    assert again["name"] == f"{name} (copy)" and again["aliases"] == []
    third = client.post(f"{API}/{fid}/copy", headers=headers).json()
    assert third["name"] == f"{name} (copy 2)"
    # Another member sees none of the copies.
    with ctx_for(other) as ctx:
        seen = [f for f in owned_repo.list_rows(ctx, FoodItem) if t in f.name]
    assert [str(f.id) for f in seen] == [fid]
    missing = client.post(f"{API}/{uuid.uuid4()}/copy", headers=headers)
    assert missing.status_code == 404


def test_copy_of_an_own_food(client: TestClient, db: Session) -> None:
    me, headers = signed_in(db)
    name = f"siomai {_tag()}"
    with ctx_for(me) as ctx:
        fid = _food(ctx, name, 3)
    r = client.post(f"{API}/{fid}/copy", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["name"] == f"{name} (copy)" and r.json()["can_edit"] is True


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
    me, mine = signed_in(db)
    _, headers = signed_in(db)
    with ctx_for(me) as ctx:
        own = _food(ctx, f"banana {_tag()}", 3)
        # A built-in food's count is every member's together.
        fid = _built_in(ctx, f"banana db {_tag()}", 3)
    r = client.post(f"{API}/{fid}/use", headers=headers)
    assert r.status_code == 204, r.text
    got = client.get(f"{API}/{fid}", headers=headers).json()
    assert got["use_count"] == 4 and got["last_used_at"]
    assert client.post(f"{API}/{own}/use", headers=mine).status_code == 204
    assert client.get(f"{API}/{own}", headers=mine).json()["use_count"] == 4


def test_needs_sign_in(client: TestClient) -> None:
    assert client.get(API).status_code in (401, 403)


# The Log meal sheet reads the first page (``limit=100``): these pin what it
# gets back for a large library, a search, an empty one, and another tenant's.


def test_a_large_library_pages_by_the_limit_with_the_whole_count(
    client: TestClient, db: Session
) -> None:
    me, headers = signed_in(db)
    t = _tag()
    with ctx_for(me) as ctx:
        for i in range(130):
            _food(ctx, f"food {i:03d} {t}", i)
    first = client.get(f"{API}?limit=100", headers=headers)
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["count"] == 130 and len(body["data"]) == 100
    # Most used first: the busiest food leads the first page.
    assert body["data"][0]["name"] == f"food 129 {t}"
    rest = client.get(f"{API}?limit=100&skip=100", headers=headers).json()
    assert len(rest["data"]) == 30 and rest["data"][-1]["name"] == f"food 000 {t}"
    names = {f["name"] for f in body["data"]} | {f["name"] for f in rest["data"]}
    assert len(names) == 130
    # A limit past the cap is refused at the edge, never a full-table read.
    assert client.get(f"{API}?limit=101", headers=headers).status_code == 422


def test_search_ignores_case_and_matches_part_of_a_name(
    client: TestClient, db: Session
) -> None:
    me, headers = signed_in(db)
    t = _tag()
    with ctx_for(me) as ctx:
        _food(ctx, f"Chicken Adobo {t}", 1)
        _food(ctx, f"chicken breast {t}", 5)
        _food(ctx, f"rice {t}", 9)
    body = client.get(f"{API}?q=CHICKEN", headers=headers).json()
    assert [f["name"] for f in body["data"]] == [
        f"chicken breast {t}",
        f"Chicken Adobo {t}",
    ]
    assert body["count"] == 2
    none = client.get(f"{API}?q=zzz-{t}", headers=headers).json()
    assert none == {"data": [], "count": 0}


def test_an_empty_library_is_an_empty_page_not_an_error(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    r = client.get(f"{API}?limit=100", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"data": [], "count": 0}


def test_another_tenants_foods_never_show(client: TestClient, db: Session) -> None:
    me, headers = signed_in(db)
    stranger, password = create_auth_user(db, tenant_id=fresh_tenant(db))
    t = _tag()
    with ctx_for(me) as ctx:
        _food(ctx, f"mine {t}", 1)
    with ctx_for(stranger) as ctx:
        theirs = _food(ctx, f"theirs {t}", 99)
    mine = client.get(f"{API}?q={t}", headers=headers).json()
    assert [f["name"] for f in mine["data"]] == [f"mine {t}"]
    assert mine["count"] == 1
    assert client.get(f"{API}/{theirs}", headers=headers).status_code == 404
    other = client.get(
        f"{API}?q={t}", headers=auth_headers(stranger.email, password)
    ).json()
    assert [f["name"] for f in other["data"]] == [f"theirs {t}"]


def test_every_food_says_who_it_came_from_and_filters_by_it(
    client: TestClient, db: Session
) -> None:
    """Fern: read from a label, told, or a brand. You: the person's own
    import or recipe, even one whose values were copied from USDA. Database:
    what a bulk import made."""
    me, headers = signed_in(db)
    t = _tag()
    with ctx_for(me) as ctx:
        _food(ctx, f"label {t}", 1)
        _food(ctx, f"said {t}", 1, source="said")
        _food(ctx, f"mine {t}", 1, source="import")
        _food(ctx, f"copied {t}", 1, source="usda")
        _food(ctx, f"usda {t}", 0, source="usda", external_ref=f"usda:{t}")
        _food(ctx, f"off {t}", 0, source="off", external_ref=f"off:{t}")
    body = client.get(f"{API}?q={t}&limit=100", headers=headers).json()
    got = {f["name"].split()[0]: f["origin"] for f in body["data"]}
    assert got == {
        "label": "fern",
        "said": "fern",
        "mine": "you",
        "copied": "you",
        "usda": "database",
        "off": "database",
    }
    for origin, names in (
        ("you", {"mine", "copied"}),
        ("fern", {"label", "said"}),
        ("database", {"usda", "off"}),
    ):
        r = client.get(f"{API}?q={t}&origin={origin}", headers=headers).json()
        assert {f["name"].split()[0] for f in r["data"]} == names
        assert r["count"] == len(names)
    # The databases browse without a search; a bad origin is refused.
    r = client.get(f"{API}?origin=database&limit=100", headers=headers).json()
    assert {f"usda {t}", f"off {t}"} <= {f["name"] for f in r["data"]}
    assert client.get(f"{API}?origin=other", headers=headers).status_code == 422


def test_search_needs_every_word_in_any_order_and_reads_aliases(
    client: TestClient, db: Session
) -> None:
    me, headers = signed_in(db)
    t = _tag()
    with ctx_for(me) as ctx:
        _food(ctx, f"Chicken Adobo {t}", 1)
        _food(ctx, f"Pork Adobo {t}", 1)
        _food(ctx, f"Garlic rice {t}", 1, aliases=["sinangag"])
    body = client.get(f"{API}?q=adobo chicken {t}", headers=headers).json()
    assert [f["name"] for f in body["data"]] == [f"Chicken Adobo {t}"]
    body = client.get(f"{API}?q=sinangag {t}", headers=headers).json()
    assert [f["name"] for f in body["data"]] == [f"Garlic rice {t}"]


def test_search_puts_own_and_recently_eaten_foods_first(
    client: TestClient, db: Session
) -> None:
    """Own foods before database ones whatever their use; among own foods
    the most recently eaten first, then the most used."""
    me, headers = signed_in(db)
    t = _tag()
    now = datetime.now(UTC)
    with ctx_for(me) as ctx:
        _food(ctx, f"egg db {t}", 99, source="usda", external_ref=f"usda:{t}")
        _food(ctx, f"egg often {t}", 50)
        _food(ctx, f"egg lately {t}", 1, last_used_at=now - timedelta(hours=2))
        _food(ctx, f"egg before {t}", 1, last_used_at=now - timedelta(days=3))
    body = client.get(f"{API}?q=egg {t}", headers=headers).json()
    assert [f["name"].split()[1] for f in body["data"]] == [
        "lately",
        "before",
        "often",
        "db",
    ]
