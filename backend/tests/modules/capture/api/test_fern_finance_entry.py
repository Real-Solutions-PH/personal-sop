"""Fern adds a category or a sub-category, and files an income plan under
an income category."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.capture.models import RecordCard
from app.modules.companion import services
from app.modules.finance.models import Category
from tests.modules.capture.api.helpers import install, say
from tests.modules.companion.api.test_fern_agent import act, rows_of, stream
from tests.modules.companion.api.test_fern_fitness import fern, tool_result, turn


def _categories(api: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = api.get("/finance/categories")["data"]
    return out


def _named(api: Any, name: str) -> list[Category]:
    return [c for c in rows_of(api, Category) if c.name == name and not c.deleted_at]


def _fern(client: TestClient, db: Session) -> Any:
    api = fern(client, db)
    _categories(api)  # first visit seeds the defaults (Bills, Salary, ...)
    return api


def test_a_new_main_category_is_saved_with_its_emoji(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = _fern(client, db)
    step, model = turn(
        api,
        client,
        monkeypatch,
        "add a category for my dog's expenses",
        act("create_category", name="Pets", icon="🐶"),
    )
    assert "error" not in tool_result(model)
    assert step["ok"], step
    assert step["summary"] == "Added category: Pets"
    [cat] = _named(api, "Pets")
    assert (cat.kind, cat.parent_id, cat.icon) == ("expense", None, "🐶")
    # A new expense starts as a want, as the app's own editor starts it.
    assert cat.discretionary is True
    assert any(c["name"] == "Pets" for c in _categories(api))


def test_a_sub_category_goes_under_the_named_main_one(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = _fern(client, db)
    bills = next(c for c in _categories(api) if c["name"] == "Bills")
    step, model = turn(
        api,
        client,
        monkeypatch,
        "make Water a sub-category of bills",
        act("create_category", name="Water", parent="bills"),
    )
    assert "error" not in tool_result(model)
    assert step["summary"] == "Added category: Water under bills"
    [cat] = _named(api, "Water")
    assert str(cat.parent_id) == bills["id"]
    assert cat.kind == "expense"
    # No emoji given: it borrows its parent's.
    assert cat.icon == bills["icon"]


def test_an_income_category_keeps_its_kind(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = _fern(client, db)
    _, model = turn(
        api,
        client,
        monkeypatch,
        "add an income category for reimbursements",
        act("create_category", name="Reimbursements", kind="income"),
    )
    assert "error" not in tool_result(model)
    [cat] = _named(api, "Reimbursements")
    assert (cat.kind, cat.discretionary) == ("income", False)


def test_an_unknown_parent_is_refused_with_the_choices(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = _fern(client, db)
    _, model = turn(
        api,
        client,
        monkeypatch,
        "add Vet under pet stuff category",
        act("create_category", name="Vet", parent="Pet stuff"),
    )
    out = tool_result(model)
    assert out["error"] == "no_main_category_with_that_name"
    assert "Bills" in out["main_categories"]
    assert not _named(api, "Vet")


def test_a_category_that_exists_is_not_added_twice(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = _fern(client, db)
    _, model = turn(
        api,
        client,
        monkeypatch,
        "add a rent category",
        act("create_category", name="rent"),
    )
    assert tool_result(model)["error"] == "a_category_with_that_name_exists"
    assert len(_named(api, "Rent")) == 1


def test_it_counts_as_a_write_for_fern() -> None:
    assert "create_category" in services.WRITE_TOOLS


def test_an_income_plan_gets_its_income_category(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An income plan's category was looked up among expense categories, so
    it saved with none and its detail read "<account> · undefined"."""
    api = _fern(client, db)
    salary = next(c for c in _categories(api) if c["name"] == "Salary")
    install(
        monkeypatch,
        say(
            "",
            act(
                "add_planned",
                name="Reimbursement from Real Solutions",
                amount=1708.64,
                day_of_month=15,
                type="income",
                category="salary",
            ),
        ),
        say("Planned."),
    )
    stream(api, client, "plan my reimbursement every 15th, salary")
    [card] = [c for c in rows_of(api, RecordCard) if c.kind == "planned"]
    assert card.payload["category_id"] == salary["id"]
    assert card.payload["amount_minor"] == 170864


def test_undo_takes_the_new_category_away(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = _fern(client, db)
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "add a category for pets",
        act("create_category", name="Pets"),
    )
    assert _named(api, "Pets")
    out = api.post(f"/capture/cards/{step['card_id']}/undo")
    assert out["state"] == "undone", out
    assert not _named(api, "Pets")


def test_a_sub_category_cannot_be_a_parent(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = _fern(client, db)
    turn(
        api,
        client,
        monkeypatch,
        "make Water a sub-category of bills",
        act("create_category", name="Water", parent="Bills"),
    )
    _, model = turn(
        api,
        client,
        monkeypatch,
        "add Filtered under water",
        act("create_category", name="Filtered", parent="water"),
    )
    assert tool_result(model)["error"] == "categories_nest_one_level"
    assert not _named(api, "Filtered")


def test_an_icon_that_is_not_one_emoji_becomes_the_tag_emoji(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = _fern(client, db)
    turn(
        api,
        client,
        monkeypatch,
        "add a category for pets",
        act("create_category", name="Pets", icon="dog"),
    )
    turn(
        api,
        client,
        monkeypatch,
        "add a category for travel",
        act("create_category", name="Travel", icon="✈️🏖️"),
    )
    assert [c.icon for c in _named(api, "Pets")] == ["🏷️"]
    assert [c.icon for c in _named(api, "Travel")] == ["🏷️"]


def test_undo_is_refused_while_a_record_uses_the_category(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = _fern(client, db)
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "add a category for pets",
        act("create_category", name="Pets"),
    )
    [cat] = _named(api, "Pets")
    acct = api.account("GCash")
    api.post(
        "/finance/records",
        {
            "type": "expense",
            "amount_minor": 50_000,
            "account_id": acct,
            "category_id": str(cat.id),
        },
    )
    api.post(f"/capture/cards/{step['card_id']}/undo", status=409)
    assert _named(api, "Pets")


def test_another_users_categories_are_neither_duplicates_nor_parents(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    other = _fern(client, db)
    other.post("/finance/categories", {"name": "Pets", "kind": "expense"})
    other.post("/finance/categories", {"name": "Hobbies", "kind": "expense"})
    api = _fern(client, db)
    _, model = turn(
        api,
        client,
        monkeypatch,
        "add a category for pets",
        act("create_category", name="Pets"),
    )
    assert "error" not in tool_result(model)
    # Saved for this user (``_named`` reads only the caller's rows).
    assert len(_named(api, "Pets")) == 1
    _, model = turn(
        api,
        client,
        monkeypatch,
        "add Lego under hobbies",
        act("create_category", name="Lego", parent="Hobbies"),
    )
    out = tool_result(model)
    assert out["error"] == "no_main_category_with_that_name"
    assert "Hobbies" not in out["main_categories"]
    assert not _named(api, "Lego")
