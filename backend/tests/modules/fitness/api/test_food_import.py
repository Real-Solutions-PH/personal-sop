"""Bulk imports of public food databases (USDA FoodData Central, Open Food
Facts, PhilFCT) into the food library as built-in foods: re-running updates
instead of duplicating, a member's own food is never read or overwritten
(it may share a name with a built-in one), and a lookup
prefers the household's foods, then USDA, then Open Food Facts, and never
lets an imported food stand in for a dish on one shared word."""

import csv
import gzip
import io
import uuid
import zipfile
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session, col, select

from app.core.db import engine as db_engine
from app.modules.fitness import food_import as I
from app.modules.fitness import food_library as L
from app.modules.fitness.models import FoodItem
from app.shared import owned_repo
from tests.utils.mobile import ctx_for, signed_in

API = "/api/v1/nutrition/foods"


def _tag() -> str:
    """Letters only: a word with a digit in it reads as an amount."""
    return "".join(chr(ord("a") + int(c, 16) % 26) for c in uuid.uuid4().hex[:6])


def usda(ref: str, name: str, **kw: Any) -> L.FoodDraft:
    base: dict[str, Any] = {
        "name": name,
        "kcal": 130,
        "protein": 2.7,
        "carbs": 28,
        "fat": 0.3,
        "source": "usda",
        "external_ref": f"usda:{ref}",
        "verified": True,
    }
    return L.FoodDraft(**(base | kw))


def off(code: str, name: str, **kw: Any) -> L.FoodDraft:
    base: dict[str, Any] = {
        "name": name,
        "kcal": 400,
        "protein": 10,
        "carbs": 70,
        "fat": 8,
        "source": "off",
        "external_ref": f"off:{code}",
        "barcode": code,
    }
    return L.FoodDraft(**(base | kw))


def rows_by_ref(prefix: str) -> list[FoodItem]:
    with Session(db_engine) as s:
        return list(
            s.exec(
                select(FoodItem).where(col(FoodItem.external_ref).startswith(prefix))
            ).all()
        )


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


def test_a_re_import_updates_in_place_and_never_duplicates(db: Session) -> None:
    user_, _ = signed_in(db)
    t = _tag()
    drafts = [usda(f"{t}1", f"Rice {t}, cooked"), usda(f"{t}2", f"Egg {t}, raw")]
    with ctx_for(user_) as ctx:
        first = I.upsert_drafts(ctx, drafts)
    with ctx_for(user_) as ctx:
        again = I.upsert_drafts(ctx, drafts)
    with ctx_for(user_) as ctx:
        changed = I.upsert_drafts(ctx, [usda(f"{t}1", f"Rice {t}, cooked", kcal=131)])
    assert (first.added, first.updated, first.unchanged) == (2, 0, 0)
    assert (again.added, again.updated, again.unchanged) == (0, 0, 2)
    assert (changed.added, changed.updated) == (0, 1)
    rows = rows_by_ref(f"usda:{t}")
    assert sorted(r.kcal for r in rows) == [130, 131]
    # Everything an import makes is built in.
    assert all(r.is_global for r in rows)


def test_a_members_food_of_the_same_name_is_never_overwritten(
    db: Session,
) -> None:
    user_, _ = signed_in(db)
    t = _tag()
    with ctx_for(user_) as ctx:
        own, _ = L.save_food(
            ctx, L.FoodDraft(name=f"Banana {t}", kcal=105, basis="piece", source="said")
        )
        ctx.commit()
        res = I.upsert_drafts(
            ctx,
            [
                usda(f"{t}b", f"Banana {t}", kcal=89, aliases=[f"saging {t}"]),
                # A name a built-in food already holds is skipped.
                usda(f"{t}c", f"Banana {t}", kcal=90),
            ],
        )
        ctx.session.refresh(own)
        assert (res.added, res.skipped_name_taken) == (1, 1)
        assert (own.kcal, own.basis, own.source) == (105, "piece", "said")
        assert own.is_global is False
        [built_in] = rows_by_ref(f"usda:{t}b")
        assert built_in.is_global and built_in.kcal == 89
        # The member's own food answers the name.
        found = L.find_food(ctx, f"banana {t}")
        assert found is not None and found.id == own.id


def test_saving_a_label_food_never_rewrites_an_imported_one(db: Session) -> None:
    """Kai is an admin, so a label save that matched USDA's banana by its
    alias could rewrite it; it becomes the household's own food instead."""
    user_, _ = signed_in(db)
    user_.is_superuser = True
    db.add(user_)
    db.commit()
    t = _tag()
    with ctx_for(user_) as ctx:
        I.upsert_drafts(
            ctx, [usda(f"{t}n", f"Bananas {t}, raw", kcal=89, aliases=[f"banana{t}"])]
        )
        own, new = L.save_food(
            ctx,
            L.FoodDraft(
                name=f"Banana{t}",
                kcal=105,
                basis="piece",
                source="label",
                verified=True,
            ),
        )
        ctx.commit()
        assert new and own.source == "label" and not L.is_bulk(own)
        [imported] = rows_by_ref(f"usda:{t}n")
        assert (imported.kcal, imported.source) == (89, "usda")
        # Their own food answers the name from now on.
        assert L.match_food(ctx, f"banana{t}")[0] == own


def test_a_deleted_import_stays_deleted(db: Session) -> None:
    user_, _ = signed_in(db)
    t = _tag()
    with ctx_for(user_) as ctx:
        I.upsert_drafts(ctx, [usda(f"{t}d", f"Kale {t}, raw")])
    [row] = rows_by_ref(f"usda:{t}d")
    # A built-in food is removed only server-side (never through the API).
    with Session(db_engine) as s:
        s.execute(
            text("UPDATE food_item SET deleted_at = now() WHERE id = :id"),
            {"id": row.id},
        )
        s.commit()
    with ctx_for(user_) as ctx:
        res = I.upsert_drafts(ctx, [usda(f"{t}d", f"Kale {t}, raw")])
    assert (res.added, res.skipped_deleted) == (0, 1)
    assert [r.deleted_at is not None for r in rows_by_ref(f"usda:{t}d")] == [True]


def test_an_alias_another_food_is_named_is_dropped(db: Session) -> None:
    user_, _ = signed_in(db)
    t = _tag()
    with ctx_for(user_) as ctx:
        # A member's own food's name never costs a built-in food an alias.
        L.save_food(ctx, L.FoodDraft(name=f"bigas {t}", kcal=200, source="said"))
        ctx.commit()
        I.upsert_drafts(ctx, [usda(f"{t}k", f"kanin {t}")])
        I.upsert_drafts(
            ctx,
            [
                usda(
                    f"{t}r",
                    f"Rice {t}, white, cooked",
                    aliases=[f"kanin {t}", f"bigas {t}"],
                )
            ],
        )
    [row] = rows_by_ref(f"usda:{t}r")
    assert row.aliases == [f"bigas {t}"]


# ---------------------------------------------------------------------------
# Lookups over a large library
# ---------------------------------------------------------------------------


def test_lookup_prefers_the_household_then_usda_then_open_food_facts(
    db: Session,
) -> None:
    user_, _ = signed_in(db)
    t = _tag()
    with ctx_for(user_) as ctx:
        I.upsert_drafts(
            ctx,
            [
                off(f"4800{t}1", f"Milo {t} (Nestle)", aliases=[f"milo {t}"]),
                usda(
                    f"{t}m",
                    f"Beverage {t}, chocolate malt powder",
                    aliases=[f"milo {t} powder"],
                ),
            ],
        )
        L.save_food(
            ctx,
            L.FoodDraft(
                name=f"Milo {t} sachet",
                kcal=110,
                basis="serving",
                source="label",
                verified=True,
            ),
        )
        ctx.commit()
        names = [f.name for f in L.search_foods(ctx, f"milo {t}")]
        # The very alias wins; then the household's food before USDA's.
        assert names[0] == f"Milo {t} (Nestle)"
        assert names.index(f"Milo {t} sachet") < names.index(
            f"Beverage {t}, chocolate malt powder"
        )
        own_first = [f.name for f in L.search_foods(ctx, f"{t} powder")]
        assert own_first[0] == f"Beverage {t}, chocolate malt powder"


def test_an_imported_food_never_stands_in_for_a_dish_on_shared_words(
    db: Session,
) -> None:
    user_, _ = signed_in(db)
    t = _tag()
    with ctx_for(user_) as ctx:
        I.upsert_drafts(
            ctx,
            [
                usda(
                    f"{t}e",
                    f"Egg {t}, whole, raw, fresh",
                    aliases=[f"egg{t}", f"eggs{t}"],
                    unit_grams=50,
                ),
                usda(
                    f"{t}c",
                    f"Chicken {t}, breast, roasted",
                    aliases=[f"chicken{t} breast"],
                ),
            ],
        )
        # By an alias, with its amount and units around it: a match.
        egg, exact = L.match_food(ctx, f"eggs{t}")
        assert egg is not None and egg.name.startswith("Egg") and exact
        assert L.match_food(ctx, f"2 pcs eggs{t}")[0] is egg
        # One of its words inside a dish: never.
        assert L.match_food(ctx, f"eggs{t} fried rice")[0] is None
        assert L.match_food(ctx, f"chicken{t} breast adobo")[0] is None
        # The dish is offered back as a candidate instead.
        [near] = L.library_candidates(ctx, [{"name": f"eggs{t} fried rice", "qty": 1}])
        assert near["library_foods"][0]["name"].startswith("Egg")
        assert near["library_foods"][0]["from"] == "USDA FoodData Central"


def test_a_household_food_still_matches_on_its_words(db: Session) -> None:
    """The stricter rule is for imported foods only: Kai's own (Notion)
    foods keep matching by every word of their name or alias."""
    user_, _ = signed_in(db)
    t = _tag()
    with ctx_for(user_) as ctx:
        L.save_food(
            ctx,
            L.FoodDraft(
                name=f"Tapa {t}", kcal=250, aliases=[f"beef tapa{t}"], source="usda"
            ),
        )
        ctx.commit()
        food, _ = L.match_food(ctx, f"beef tapa{t} with garlic rice")
        assert food is not None and food.name == f"Tapa {t}"


def test_a_common_word_in_one_item_never_crowds_out_another(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Each item is looked up on its own: "chicken" matching more foods than
    one lookup reads must not drop the banana of the same meal."""
    monkeypatch.setattr(L, "CANDIDATES", 3)
    user_, _ = signed_in(db)
    t = _tag()
    with ctx_for(user_) as ctx:
        I.upsert_drafts(
            ctx,
            [usda(f"{t}c{i}", f"Chicken{t} cut {chr(97 + i)}") for i in range(6)]
            + [usda(f"{t}b", f"Bananas {t}, raw", kcal=89, aliases=[f"banana{t}"])],
        )
        items, used = L.apply_library(
            ctx,
            [
                {"name": f"chicken{t} cut a", "qty": 100, "unit": "g"},
                {"name": f"banana{t}", "qty": 100, "unit": "g"},
            ],
        )
    assert used == [f"Chicken{t} cut a", f"Bananas {t}, raw"]
    assert items[1]["kcal"] == 89


def test_a_meal_from_an_imported_food_names_its_source(db: Session) -> None:
    user_, _ = signed_in(db)
    t = _tag()
    with ctx_for(user_) as ctx:
        I.upsert_drafts(
            ctx, [usda(f"{t}k", f"Rice {t}, white, cooked", aliases=[f"kanin{t}"])]
        )
        items, used = L.apply_library(
            ctx, [{"name": f"kanin{t}", "qty": 150, "unit": "g", "kcal": 999}]
        )
        assert used == [f"Rice {t}, white, cooked"]
        assert items[0]["kcal"] == 195.0
        assert items[0]["assumption"] == (
            f"From USDA FoodData Central (food library): Rice {t}, white, cooked"
        )


def test_the_food_list_shows_own_and_eaten_foods_and_searches_all(
    client: TestClient, db: Session
) -> None:
    user_, headers = signed_in(db)
    t = _tag()
    with ctx_for(user_) as ctx:
        I.upsert_drafts(
            ctx,
            [usda(f"{t}x", f"Quinoa {t}, cooked"), usda(f"{t}y", f"Teff {t}, cooked")],
        )
        L.save_food(ctx, L.FoodDraft(name=f"Granola {t}", kcal=450, source="label"))
        teff = owned_repo.list_rows(
            ctx, FoodItem, col(FoodItem.key) == f"teff {t} cooked"
        )[0]
        teff.use_count = 1
        ctx.session.add(teff)
        ctx.commit()
    listed = client.get(API, headers=headers, params={"limit": 100}).json()["data"]
    names = {f["name"] for f in listed}
    assert f"Granola {t}" in names and f"Teff {t}, cooked" in names
    assert f"Quinoa {t}, cooked" not in names
    found = client.get(API, headers=headers, params={"q": f"quinoa {t}"}).json()["data"]
    assert [f["name"] for f in found] == [f"Quinoa {t}, cooked"]
    assert found[0]["source_url"] is None and found[0]["source"] == "usda"


def test_lookup_reads_through_the_search_index() -> None:
    """The planner can use ``ix_food_item_search`` for the lookup's own
    expression (it is the one the migration indexed)."""
    with Session(db_engine) as s:
        s.exec(text("SET LOCAL enable_seqscan = off"))  # type: ignore[call-overload]
        plan = s.exec(  # type: ignore[call-overload]
            text(
                f"EXPLAIN SELECT id FROM food_item WHERE {L.SEARCH_DOC} "
                "@@ to_tsquery('simple'::regconfig, 'rice | egg')"
            )
        ).all()
    assert "ix_food_item_search" in " ".join(str(r[0]) for r in plan)


# ---------------------------------------------------------------------------
# Reading the downloads
# ---------------------------------------------------------------------------


def _csv(rows: list[dict[str, Any]]) -> str:
    out = io.StringIO()
    w = csv.DictWriter(out, fieldnames=list(rows[0]), quoting=csv.QUOTE_ALL)
    w.writeheader()
    w.writerows(rows)
    return out.getvalue()


def _fdc_zip(path: Path) -> Path:
    d = "FoodData_Central_foundation_food_csv_test/"
    food = [
        {
            "fdc_id": 1,
            "data_type": "foundation_food",
            "description": "Egg, whole, raw, fresh",
        },
        {
            "fdc_id": 2,
            "data_type": "foundation_food",
            "description": "Chicken, breast, cooked, roasted",
        },
        {"fdc_id": 3, "data_type": "foundation_food", "description": "Oil, mystery"},
    ]
    nutrients = [
        # Egg: Energy (1008) wins over Atwater; total sugars (2000) are not added sugar.
        (1, 1008, 143),
        (1, 2048, 150),
        (1, 1003, 12.56),
        (1, 1005, 0.72),
        (1, 1004, 9.51),
        (1, 1093, 142),
        (1, 2000, 0.37),
        # Chicken: only the Atwater specific energy; added sugar 0.
        (2, 2048, 165),
        (2, 1003, 31.02),
        (2, 1050, 0),
        (2, 1004, 3.57),
        (2, 1235, 0),
        # Oil: no carbohydrate figure at all, so it is not imported.
        (3, 1008, 884),
        (3, 1003, 0),
        (3, 1004, 100),
    ]
    portions = [
        {
            "fdc_id": 1,
            "amount": 1,
            "measure_unit_id": 9999,
            "modifier": "cup (4.86 large eggs)",
            "portion_description": "",
            "gram_weight": 243,
        },
        {
            "fdc_id": 1,
            "amount": 1,
            "measure_unit_id": 9999,
            "modifier": "medium",
            "portion_description": "",
            "gram_weight": 44,
        },
        {
            "fdc_id": 1,
            "amount": 1,
            "measure_unit_id": 9999,
            "modifier": "large",
            "portion_description": "",
            "gram_weight": 50,
        },
        {
            "fdc_id": 2,
            "amount": 1,
            "measure_unit_id": 9999,
            "modifier": "unit (yield from 1 lb ready-to-cook chicken)",
            "portion_description": "",
            "gram_weight": 52,
        },
        {
            "fdc_id": 2,
            "amount": 0.5,
            "measure_unit_id": 9999,
            "modifier": "breast, bone and skin removed",
            "portion_description": "",
            "gram_weight": 86,
        },
    ]
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(
            d + "foundation_food.csv", _csv([{"fdc_id": f["fdc_id"]} for f in food])
        )
        z.writestr(d + "food.csv", _csv(food))
        z.writestr(
            d + "food_nutrient.csv",
            _csv(
                [{"fdc_id": f, "nutrient_id": n, "amount": a} for f, n, a in nutrients]
            ),
        )
        z.writestr(d + "measure_unit.csv", _csv([{"id": 9999, "name": "undetermined"}]))
        z.writestr(d + "food_portion.csv", _csv(portions))
    return path


def test_usda_rows_map_to_the_library_per_100_g(tmp_path: Path) -> None:
    drafts = {
        d.external_ref: d
        for d in I.usda_drafts([_fdc_zip(tmp_path / "foundation.zip")])
    }
    assert set(drafts) == {"usda:1", "usda:2"}
    egg, chicken = drafts["usda:1"], drafts["usda:2"]
    assert (egg.kcal, egg.protein, egg.carbs, egg.fat, egg.sodium) == (
        143,
        12.56,
        0.72,
        9.51,
        142,
    )
    assert egg.sugar is None  # total sugars are not added sugar
    assert (egg.state, egg.unit_grams, egg.verified, egg.basis) == (
        "raw",
        50,
        True,
        "100g",
    )
    assert "egg" in egg.aliases and "itlog" in egg.aliases
    assert egg.source_url == "https://fdc.nal.usda.gov/food-details/1/nutrients"
    assert (chicken.kcal, chicken.carbs, chicken.sugar) == (165, 0, 0)
    # The cooking-yield "unit" is not a piece; half a breast is 86 g.
    assert (chicken.state, chicken.unit_grams) == ("cooked", 172)


OFF_HEAD = [
    "code",
    "product_name",
    "brands",
    "countries_tags",
    "unique_scans_n",
    "energy-kcal_100g",
    "energy_100g",
    "proteins_100g",
    "carbohydrates_100g",
    "fat_100g",
    "fiber_100g",
    "saturated-fat_100g",
    "added-sugars_100g",
    "sodium_100g",
]


def _off_gz(path: Path, rows: list[list[str]]) -> Path:
    with gzip.open(path, "wt", encoding="utf-8") as f:
        for r in [OFF_HEAD, *rows]:
            f.write("\t".join(r) + "\n")
    return path


def test_open_food_facts_rows_sold_here_with_plausible_values(tmp_path: Path) -> None:
    ph = "en:philippines"
    rows = [
        # Sold here, complete: in. Sodium is grams in the export.
        [
            "4800016644290",
            "Pancit Canton Original",
            "Lucky Me!",
            ph,
            "3",
            "457",
            "",
            "9",
            "60",
            "20",
            "2",
            "9",
            "",
            "1.2",
        ],
        # Sold here, energy only in kJ: converted.
        [
            "4800361000016",
            "Skyflakes Crackers",
            "M.Y. San",
            ph,
            "",
            "",
            "1925",
            "10",
            "68",
            "17",
            "",
            "",
            "",
            "0.8",
        ],
        # Sold here but 900 kcal with 10 g of macros: a typo, out.
        [
            "4800000000001",
            "Bad row",
            "X",
            ph,
            "",
            "900",
            "",
            "1",
            "5",
            "4",
            "",
            "",
            "",
            "",
        ],
        # Sold here, no fat figure: out.
        [
            "4800000000002",
            "Missing fat",
            "X",
            ph,
            "",
            "300",
            "",
            "10",
            "60",
            "",
            "",
            "",
            "",
            "",
        ],
        # Not here, but scanned by 500 people in the US: in.
        [
            "0016000275287",
            "Cheerios",
            "General Mills",
            "en:united-states",
            "500",
            "367",
            "",
            "12",
            "73",
            "6.7",
            "10",
            "1.2",
            "4",
            "0.5",
        ],
        # Not here, scanned by 3 people: out.
        [
            "3017620422003",
            "Nutella",
            "Ferrero",
            "en:france",
            "3",
            "539",
            "",
            "6.3",
            "57.5",
            "30.9",
            "",
            "",
            "",
            "0.04",
        ],
        # Sold here, no brand: a generic name typed in, out.
        [
            "4800000000003",
            "Pancit Canton",
            "",
            ph,
            "",
            "450",
            "",
            "9",
            "60",
            "19",
            "",
            "",
            "",
            "",
        ],
        # Not a barcode: out.
        ["abc", "Odd", "X", ph, "", "100", "", "1", "20", "1", "", "", "", ""],
    ]
    drafts = {
        d.barcode: d for d in I.off_drafts(_off_gz(tmp_path / "off.csv.gz", rows))
    }
    assert set(drafts) == {"4800016644290", "4800361000016", "0016000275287"}
    canton = drafts["4800016644290"]
    assert canton.name == "Pancit Canton Original (Lucky Me!)"
    assert (canton.kcal, canton.sodium, canton.source, canton.verified) == (
        457,
        1200,
        "off",
        False,
    )
    assert canton.source_url == "https://world.openfoodfacts.org/product/4800016644290"
    assert drafts["4800361000016"].kcal == round(1925 / 4.184, 1)
    assert drafts["0016000275287"].name == "Cheerios (General Mills)"


def test_philfct_loads_only_a_file_in_its_columns(tmp_path: Path) -> None:
    good = tmp_path / "philfct.csv"
    good.write_text(
        _csv(
            [
                {
                    "food_id": "A001",
                    "name": "Rice, milled, boiled",
                    "filipino_name": "kanin, sinaing",
                    "state": "cooked",
                    "kcal": "129",
                    "protein_g": "2.1",
                    "carbs_g": "28.7",
                    "fat_g": "0.2",
                    "fiber_g": "0.4",
                    "sodium_mg": "1",
                }
            ]
        )
    )
    [d] = list(I.philfct_drafts(good))
    assert (d.name, d.state, d.aliases, d.source) == (
        "Rice, milled, boiled",
        "cooked",
        ["kanin", "sinaing"],
        "philfct",
    )
    assert d.external_ref == "philfct:A001"
    bad = tmp_path / "bad.csv"
    bad.write_text(_csv([{"name": "x", "kcal": "1"}]))
    with pytest.raises(ValueError, match="missing columns"):
        list(I.philfct_drafts(bad))
