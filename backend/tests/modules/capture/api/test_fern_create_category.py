"""Fern adds a category or a sub-category the person asks for."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.companion import services
from app.modules.finance.models import Category
from tests.modules.companion.api.test_fern_agent import act, rows_of
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
    out = tool_result(model)
    assert out["created"] == "category" and out["parent"] is None, out
    assert step["ok"], step
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
    _, model = turn(
        api,
        client,
        monkeypatch,
        "make Water a sub-category of bills",
        act("create_category", name="Water", parent="bills"),
    )
    out = tool_result(model)
    assert out["created"] == "sub-category" and out["parent"] == "Bills", out
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
