"""Accounts, categories and records through the REST routes."""

import csv
import io
import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.shared.ids import derived_id
from app.shared.money import MAX_MINOR
from tests.modules.finance.api.helpers import API, Fin, legacy_card
from tests.utils.mobile import signed_in


def _fin(client: TestClient, db: Session) -> Fin:
    _, headers = signed_in(db)
    return Fin(client, headers)


def test_settings_bootstrap_seeds_categories_with_derived_ids(
    client: TestClient, db: Session
) -> None:
    user, headers = signed_in(db)
    f = Fin(client, headers)
    st = f.get("/settings")
    assert (st["month_start_day"], st["horizon"], st["ai_scope"]) == (
        1,
        12,
        "aggregates",
    )
    cats = f.cats()
    assert len(cats) == 24
    assert cats["food"] == str(derived_id("category", user.id, "food"))
    rows = {c["slug"]: c for c in f.get("/categories", limit=100)["data"]}
    assert rows["dining"]["parent_id"] == cats["food"]
    assert rows["adjust"]["system"] and rows["fees"]["system"]
    assert not rows["food"]["system"]


def test_bill_reminder_time_defaults_sets_and_turns_off(
    client: TestClient, db: Session
) -> None:
    f = _fin(client, db)
    assert f.get("/settings")["bill_reminder"] == "09:00"
    assert f.patch("/settings", {"bill_reminder": "19:30"})["bill_reminder"] == "19:30"
    assert f.patch("/settings", {"bill_reminder": None})["bill_reminder"] is None
    f.patch("/settings", {"bill_reminder": "9am"}, status=422)
    assert f.post("/start-fresh")["bill_reminder"] is None  # settings stay
    assert f.post("/reset")["bill_reminder"] == "09:00"


def test_balances_transfer_fee_and_credit_card_liability(
    client: TestClient, db: Session
) -> None:
    f = _fin(client, db)
    cats = f.cats()
    gcash = f.account("GCash", opening=100_000)
    card = legacy_card(f, db, "BPI Card", limit_minor=8_000_000)
    f.expense(gcash, 18_000, cats["dining"])
    f.expense(card, 250_000, cats["shopping"])
    f.income(gcash, 900_000, cats["salary"])
    recs = f.post(
        "/records",
        {
            "type": "transfer",
            "amount_minor": 200_000,
            "account_id": gcash,
            "to_account_id": card,
            "fee_minor": 1_500,
        },
    )["data"]
    assert len(recs) == 2
    transfer, fee = recs
    assert fee["fee_of"] == transfer["id"]
    assert (fee["type"], fee["amount_minor"], fee["category_id"]) == (
        "expense",
        1_500,
        cats["fees"],
    )
    bal = f.balances()
    assert bal[gcash] == 100_000 - 18_000 + 900_000 - 200_000 - 1_500
    assert bal[card] == -250_000 + 200_000  # a liability runs negative
    accounts = f.get("/accounts")
    assert accounts["net_worth_minor"] == bal[gcash] + bal[card]
    # credit cards stay out of the liquid total by default? No: in_projection
    # defaults true for any account the user adds; the total follows the flag.
    assert accounts["liquid_minor"] == bal[gcash] + bal[card]
    f.patch(f"/accounts/{card}", {"in_projection": False})
    assert f.get("/accounts")["liquid_minor"] == bal[gcash]
    # Deleting the transfer takes its fee with it, and restore brings both.
    gone = f.post("/records/delete", {"ids": [transfer["id"]]})["ids"]
    assert set(gone) == {transfer["id"], fee["id"]}
    assert f.balances()[gcash] == 100_000 - 18_000 + 900_000
    back = f.post("/records/restore", {"ids": [transfer["id"]]})["ids"]
    assert set(back) == {transfer["id"], fee["id"]}
    assert f.balances() == bal


def test_credit_cards_cannot_be_added_but_an_older_one_still_counts(
    client: TestClient, db: Session
) -> None:
    f = _fin(client, db)
    cats = f.cats()
    assert (
        f.post("/accounts", {"name": "Card", "type": "credit"}, status=422)["code"]
        == "credit_retired"
    )
    bank = f.account("BPI", type="bank", opening=500_000)
    f.patch(f"/accounts/{bank}", {"type": "credit"}, status=422)
    # A card from before keeps working: it can be renamed and its limit
    # changed, it stays a card, and what it owes comes off net worth.
    card = legacy_card(f, db, "Old card", limit_minor=1_000_000)
    f.expense(card, 120_000, cats["shopping"])
    edited = f.patch(
        f"/accounts/{card}", {"name": "Maya Black", "limit_minor": 2_000_000}
    )
    assert (edited["type"], edited["limit_minor"]) == ("credit", 2_000_000)
    accounts = f.get("/accounts")
    assert f.balances()[card] == -120_000
    assert accounts["net_worth_minor"] == 500_000 - 120_000
    home = f.get("/home")
    assert home["net_worth_minor"] == 500_000 - 120_000
    # Nothing asks to be matched with a statement any more.
    assert home["stale_accounts"] == []


def test_record_rules_and_money_bounds(client: TestClient, db: Session) -> None:
    f = _fin(client, db)
    cats = f.cats()
    a = f.account("Cash", type="cash")
    b = f.account("Maya")
    base = {"type": "expense", "account_id": a, "category_id": cats["coffee"]}
    for amount in (0, -100, MAX_MINOR + 1):
        f.post("/records", {**base, "amount_minor": amount}, status=422)
    f.post("/records", {**base, "amount_minor": MAX_MINOR})
    f.post(
        "/records",
        {**base, "amount_minor": 100, "category_id": cats["salary"]},
        status=422,
    )
    f.post(
        "/records",
        {"type": "transfer", "amount_minor": 100, "account_id": a},
        status=422,
    )
    f.post(
        "/records",
        {"type": "transfer", "amount_minor": 100, "account_id": a, "to_account_id": a},
        status=422,
    )
    f.post("/records", {**base, "amount_minor": 100, "to_account_id": b}, status=422)
    f.post("/records", {**base, "amount_minor": 100, "fee_minor": 5}, status=422)
    f.post(
        "/records",
        {**base, "amount_minor": 100, "at": "2026-10-01T10:00:00"},
        status=422,
    )
    # A refund is income booked in the expense category: it lowers spend.
    refund = f.income(a, 50, cats["coffee"], is_refund=True)
    assert refund["is_refund"]
    f.post(
        "/accounts",
        {"name": "x", "type": "cash", "opening_minor": -MAX_MINOR - 1},
        status=422,
    )
    f.post("/accounts", {"name": "x", "type": "cash", "limit_minor": 5}, status=422)
    f.post(
        "/accounts", {"name": "x", "type": "cash", "opening_minor": -5_000}, status=200
    )
    # 404 for an unknown id, 422 for a malformed one.
    f.get(f"/records/{uuid.uuid4()}", status=404)
    f.get("/records/not-a-uuid", status=422)


def test_update_duplicate_confirm_recategorise(client: TestClient, db: Session) -> None:
    f = _fin(client, db)
    cats = f.cats()
    a = f.account("GCash")
    rec = f.expense(a, 16_000, cats["coffee"], status="pending", payee="Coffee")
    assert rec["status"] == "pending"
    confirmed = f.post(f"/records/{rec['id']}/confirm")
    assert confirmed["status"] == "cleared" and confirmed["edited_at"]
    new_id = str(uuid.uuid4())
    dup = f.post(f"/records/{rec['id']}/duplicate", {"new_id": new_id})
    assert (dup["id"], dup["amount_minor"], dup["source"]) == (new_id, 16_000, "manual")
    moved = f.post(
        "/records/recategorise",
        {"ids": [rec["id"], dup["id"]], "category_id": cats["dining"]},
    )
    assert {r["category_id"] for r in moved["data"]} == {cats["dining"]}
    f.post(
        "/records/recategorise",
        {"ids": [rec["id"]], "category_id": cats["salary"]},
        status=422,
    )
    upd = f.patch(
        f"/records/{rec['id']}", {"amount_minor": 17_500, "payee": "Starbucks"}
    )
    assert (upd["amount_minor"], upd["payee"]) == (17_500, "Starbucks")
    # Changing an expense into a transfer clears its category.
    b = f.account("BPI", type="bank")
    t = f.patch(f"/records/{rec['id']}", {"type": "transfer", "to_account_id": b})
    assert (t["type"], t["category_id"], t["to_account_id"]) == ("transfer", None, b)
    st = f.get("/settings")
    assert st["last_account_id"] == a and st["last_category_id"] == cats["coffee"]


def test_records_filter_search_and_pagination(client: TestClient, db: Session) -> None:
    f = _fin(client, db)
    cats = f.cats()
    a = f.account("Cash", type="cash")
    b = f.account("GCash")
    for i in range(7):
        f.expense(a, 1_000 * (i + 1), cats["coffee"], payee=f"Shop {i}")
    f.expense(b, 50_000, cats["grab"], payee="Grab")
    f.income(b, 99_900, cats["salary"], payee="Northwind")
    page = f.get("/records", limit=3, skip=0)
    assert page["count"] == 9 and len(page["data"]) == 3
    assert len(f.get("/records", limit=3, skip=8)["data"]) == 1
    f.get("/records", limit=101, status=422)
    f.get("/records", skip=-1, status=422)
    assert f.get("/records", q="shop 3")["count"] == 1
    assert f.get("/records", q="500")["data"][0]["payee"] == "Grab"  # ₱500 = 50,000
    assert f.get("/records", q="100%")["count"] == 0  # % is a literal, not a wildcard
    assert f.get("/records", account_ids=[b])["count"] == 2
    assert (
        f.get("/records", category_ids=[cats["food"]])["count"] == 7
    )  # children of Food
    assert f.get("/records", type="income")["count"] == 1
    assert f.get("/records", min_minor=5_000, max_minor=50_000)["count"] == 4
    by_amount = f.get("/records", sort="amount")["data"]
    assert [r["amount_minor"] for r in by_amount][:2] == [99_900, 50_000]


def test_account_delete_blocked_by_records_and_adjust(
    client: TestClient, db: Session
) -> None:
    f = _fin(client, db)
    cats = f.cats()
    a = f.account("BPI", type="bank", opening=1_000_000)
    empty = f.account("Spare", type="cash")
    f.delete(f"/accounts/{empty}")
    f.get(f"/accounts/{empty}", status=404)
    f.expense(a, 10_000, cats["rent"])
    r = f.c.delete(f"{API}/accounts/{a}", headers=f.h)
    assert r.status_code == 409 and r.json()["code"] == "account_has_records"
    adj = f.post(
        f"/accounts/{a}/adjust", {"actual_minor": 1_000_500, "note": "statement"}
    )
    assert (
        adj["type"],
        adj["amount_minor"],
        adj["is_adjustment"],
        adj["category_id"],
    ) == (
        "income",
        10_500,
        True,
        cats["adjust"],
    )
    assert f.balances()[a] == 1_000_500
    assert f.post(f"/accounts/{a}/adjust", {"actual_minor": 1_000_500}) is None
    down = f.post(f"/accounts/{a}/adjust", {"actual_minor": 0})
    assert (down["type"], down["amount_minor"]) == ("expense", 1_000_500)
    # Adjustments are neither income nor spend.
    rep = f.get("/reports", period="this")
    assert rep["flow"]["income_minor"] == 0 and rep["flow"]["spend_minor"] == 10_000
    detail = f.get(f"/accounts/{a}", days=30)
    assert len(detail["series_minor"]) == 30 and detail["series_minor"][-1] == 0


def test_categories_move_uses_and_delete_moving(
    client: TestClient, db: Session
) -> None:
    f = _fin(client, db)
    cats = f.cats()
    a = f.account("Cash", type="cash")
    mine = f.post(
        "/categories",
        {
            "name": "Milk tea",
            "kind": "expense",
            "parent_id": cats["food"],
            "discretionary": True,
        },
    )
    f.post(
        "/categories",
        {"name": "Deep", "kind": "expense", "parent_id": mine["id"]},
        status=422,
    )
    f.post(
        "/categories",
        {"name": "Wrong kind", "kind": "income", "parent_id": cats["food"]},
        status=422,
    )
    moved = f.post(f"/categories/{mine['id']}/move", {"parent_id": cats["shopping"]})
    assert moved["parent_id"] == cats["shopping"]
    f.post(
        f"/categories/{cats['food']}/move", {"parent_id": cats["bills"]}, status=422
    )  # has children
    rec = f.expense(a, 12_000, mine["id"])
    budget = f.post(
        "/budgets",
        {
            "name": "Treats",
            "limit_minor": 100_000,
            "category_ids": [mine["id"], cats["coffee"]],
        },
    )
    planned = f.post(
        "/planned",
        {
            "name": "Tea club",
            "type": "expense",
            "amount_minor": 5_000,
            "account_id": a,
            "category_id": mine["id"],
            "schedule": {"kind": "monthly", "day": 3},
        },
    )
    assert f.get(f"/categories/{mine['id']}/uses") == {
        "records": 1,
        "planned": 1,
        "budgets": 1,
    }
    r = f.c.delete(f"{API}/categories/{mine['id']}", headers=f.h)
    assert r.status_code == 409 and r.json()["code"] == "category_in_use"
    f.delete(f"/categories/{mine['id']}", move_to=cats["coffee"])
    assert f.get(f"/records/{rec['id']}")["category_id"] == cats["coffee"]
    assert f.get(f"/planned/{planned['id']}")["category_id"] == cats["coffee"]
    # The budget already covered coffee: the moved link folds into it.
    assert f.get(f"/budgets/{budget['id']}")["view"]["budget"]["category_ids"] == [
        cats["coffee"]
    ]
    sys = f.c.delete(f"{API}/categories/{cats['adjust']}", headers=f.h)
    assert sys.status_code == 409 and sys.json()["code"] == "category_system"
    f.patch(f"/categories/{cats['adjust']}", {"kind": "income"}, status=422)


def test_export_csv(client: TestClient, db: Session) -> None:
    f = _fin(client, db)
    cats = f.cats()
    a = f.account("Cash", type="cash")
    f.expense(a, 12_345, cats["coffee"], payee="=HYPERLINK(1)", note="flat white")
    r = f.c.get(f"{API}/export.csv", headers=f.h)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(r.text)))
    assert len(rows) == 1
    row = rows[0]
    assert (row["amount"], row["account"], row["category"], row["note"]) == (
        "123.45",
        "Cash",
        "Coffee",
        "flat white",
    )
    assert row["payee"] == "'=HYPERLINK(1)"  # never a live formula


def test_start_fresh_and_reset(client: TestClient, db: Session) -> None:
    f = _fin(client, db)
    cats = f.cats()
    a = f.account("Cash", type="cash")
    f.expense(a, 100, cats["coffee"])
    f.post("/categories", {"name": "Custom", "kind": "expense"})
    f.delete(f"/categories/{cats['gifts']}")
    f.patch(
        "/settings", {"disclaimer_ack": True, "month_start_day": 15, "setup_done": True}
    )
    st = f.post("/start-fresh")
    assert (st["disclaimer_ack"], st["setup_done"], st["month_start_day"]) == (
        False,
        False,
        15,
    )
    assert f.get("/accounts")["count"] == 0 and f.get("/records")["count"] == 0
    after = f.cats()
    assert set(after) == set(cats)  # the defaults are back, the custom one is gone
    assert f.get("/categories", limit=100)["count"] == 24
    st = f.post("/reset")
    assert st["month_start_day"] == 1
