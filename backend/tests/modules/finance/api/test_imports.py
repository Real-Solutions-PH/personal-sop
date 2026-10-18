"""Statement import: CSV and OCR rows -> reconcile -> review -> commit ->
undo -> restore -> re-commit, plus discard/restore and the failure paths."""

import uuid
from datetime import datetime, time, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.shared.day import DayClock
from app.shared.ids import derived_id
from tests.modules.finance.api.helpers import API, Fin
from tests.utils.mobile import signed_in

CLOCK = DayClock()
TODAY = CLOCK.today()


def d(n: int) -> str:
    return (TODAY + timedelta(days=n)).isoformat()


def at(n: int, hh: int = 12) -> str:
    return datetime.combine(
        TODAY + timedelta(days=n), time(hh), tzinfo=CLOCK.zone
    ).isoformat()


def _setup(
    client: TestClient, db: Session
) -> tuple[Fin, dict[str, str], str, str, dict[str, Any], dict[str, Any]]:
    _, headers = signed_in(db)
    f = Fin(client, headers)
    cats = f.cats()
    gcash = f.account("GCash", opening=500_000)
    bpi = f.account("BPI", type="bank", opening=5_000_000)
    jolli = f.expense(gcash, 18_000, cats["dining"], payee="Jollibee", at=at(-3))
    coffee = f.expense(gcash, 25_000, cats["coffee"], at=at(-5))
    return f, cats, gcash, bpi, jolli, coffee


GCASH_CSV = """GCash Transaction History
Date and Time,Description,Reference No.,Debit,Credit,Balance
{m3} 12:10 PM,Payment to JOLLIBEE FOODS CORP,7001,180.00,,1000.00
{m5} 08:05,Payment to STARBUCKS COFFEE PH,7002,260.00,,820.00
{m2} 19:30,Payment to FOODPANDA PHILIPPINES,7003,386.00,,434.00
{m1} 09:00,Cash-in via InstaPay from BPI,7004,,"3,000.00",3434.00
{m2} 19:30,Payment to FOODPANDA PHILIPPINES,7003,386.00,,48.00

{m1} 22:02,PENDING — Payment to SHOPEEPAY PHILIPPINES,7005,749.00,,48.00
"""


def _gcash_csv() -> str:
    return GCASH_CSV.format(m1=d(-1), m2=d(-2), m3=d(-3), m5=d(-5))


def _start(f: Fin, account: str, file_type: str = "csv") -> str:
    imp = f.post(
        "/imports",
        {"account_id": account, "file_name": "history.csv", "file_type": file_type},
    )
    assert imp["status"] == "parsing"
    return str(imp["id"])


def test_csv_import_review_commit_undo_restore(client: TestClient, db: Session) -> None:
    f, cats, gcash, bpi, jolli, coffee = _setup(client, db)
    before = f.balances()
    imp_id = _start(f, gcash)
    parsed = f.post(f"/imports/{imp_id}/csv", {"text": _gcash_csv(), "layout": "gcash"})
    assert (parsed["status"], parsed["period_from"], parsed["period_to"]) == (
        "review",
        d(-5),
        d(-1),
    )
    detail = f.get(f"/imports/{imp_id}")
    rows = detail["rows"]
    assert [(r["state"], r["decision"]) for r in rows] == [
        ("matched", "accept"),
        ("probable", "take"),
        ("new", "accept"),
        ("new", "accept"),
        ("duplicate", "ignore"),
        ("pending", "ignore"),
    ]
    assert rows[0]["match_id"] == jolli["id"] and rows[1]["match_id"] == coffee["id"]
    assert (rows[2]["payee"], rows[2]["category_id"]) == ("foodpanda", cats["dining"])
    assert rows[3]["is_transfer"] and rows[3]["direction"] == "in"
    assert rows[1]["needs_attention"] and not rows[0]["needs_attention"]
    # Statement closing = app balance + what the file adds or corrects.
    assert parsed["closing_minor"] == before[gcash] - 38_600 + 300_000 - 1_000
    # Transfers need the other account.
    r = f.c.post(f"{API}/imports/{imp_id}/commit", headers=f.h, json={})
    assert r.status_code == 422 and r.json()["code"] == "transfer_account_required"
    # Review: re-categorise the food delivery.
    f.patch(
        f"/imports/{imp_id}/rows",
        {"row_ids": [rows[2]["id"]], "category_id": cats["groceries"]},
    )
    out = f.post(f"/imports/{imp_id}/commit", {"transfer_account_id": bpi})
    assert out == {
        "gap_minor": 0,
        "created": 2,
        "updated": 1,
        "matched": 1,
        "ignored": 2,
    }
    done = f.get(f"/imports/{imp_id}")["import"]
    assert done["status"] == "done" and not done["file_kept"]
    created = [
        str(derived_id("import-record", uuid.UUID(imp_id), str(i))) for i in (2, 3)
    ]
    assert done["created_ids"] == created
    after = f.balances()
    assert after[gcash] == before[gcash] - 1_000 - 38_600 + 300_000
    assert after[bpi] == before[bpi] - 300_000
    assert f.get(f"/records/{coffee['id']}")["amount_minor"] == 26_000
    assert f.get(f"/records/{jolli['id']}")["import_id"] == imp_id
    assert f.get(f"/records/{created[0]}")["category_id"] == cats["groceries"]
    acct = next(a for a in f.get("/accounts")["data"] if a["id"] == gcash)
    assert acct["last_reconciled"] == d(-1)
    # Undo reverts exactly what the commit did.
    undone = f.post(f"/imports/{imp_id}/undo")
    assert undone["status"] == "undone"
    assert f.balances() == before
    c = f.get(f"/records/{coffee['id']}")
    assert (c["amount_minor"], c["import_id"]) == (25_000, None)
    assert f.get(f"/records/{jolli['id']}")["import_id"] is None
    f.get(f"/records/{created[0]}", status=404)
    f.post(f"/imports/{imp_id}/undo", status=409)
    # Restore reopens the review; a second commit revives the same records.
    restored = f.post(f"/imports/{imp_id}/restore")
    assert restored["status"] == "review"
    again = f.post(f"/imports/{imp_id}/commit", {"transfer_account_id": bpi})
    assert again["created"] == 2
    assert f.balances() == after
    assert f.get("/records", import_id=imp_id)["count"] == 4  # 2 created + 2 stamped
    assert f.get("/records")["count"] == 4  # 2 seeded + 2 created, no duplicates
    r = f.c.delete(f"{API}/imports/{imp_id}", headers=f.h)
    assert r.status_code == 409 and r.json()["code"] == "import_committed"


def test_ocr_rows_discard_restore_and_failures(client: TestClient, db: Session) -> None:
    f, cats, gcash, bpi, jolli, _ = _setup(client, db)
    imp_id = _start(f, gcash, "image")
    f.post(f"/imports/{imp_id}/fail", {"error_code": "unreadable"})
    assert f.get(f"/imports/{imp_id}")["import"]["error_code"] == "unreadable"
    f.post(f"/imports/{imp_id}/retry")
    rows = [
        {
            "ref": "",
            "date": d(-3),
            "time": "12:10",
            "raw": "Payment to JOLLIBEE FOODS CORP",
            "amount_minor": 18_000,
            "direction": "out",
        },
        {
            "date": d(-2),
            "raw": "Send Money to J** D***",
            "amount_minor": 50_000,
            "direction": "out",
        },
    ]
    out = f.post(f"/imports/{imp_id}/rows", {"rows": rows})
    assert out["status"] == "review"
    got = f.get(f"/imports/{imp_id}")["rows"]
    assert [r["state"] for r in got] == ["matched", "new"]
    assert (got[1]["confidence"], got[1]["category_id"], got[1]["needs_attention"]) == (
        0.48,
        None,
        True,
    )
    f.post(f"/imports/{imp_id}/rows", {"rows": rows}, status=409)  # already read
    # Discard a draft, then undo the discard.
    f.delete(f"/imports/{imp_id}")
    f.get(f"/imports/{imp_id}", status=404)
    assert f.post(f"/imports/{imp_id}/restore")["status"] == "review"
    assert f.post(f"/imports/{imp_id}/discard-file")["file_kept"] is False
    # An empty extraction fails with no_rows.
    empty = _start(f, gcash, "image")
    assert f.post(f"/imports/{empty}/rows", {"rows": []})["error_code"] == "no_rows"
    hist = f.get("/imports", account_id=gcash)
    assert hist["count"] == 2 and hist["data"][0]["status"] == "review"  # drafts first
    f.post(
        f"/imports/{imp_id}/rows",
        {"rows": [{**rows[0], "amount_minor": 0}]},
        status=422,
    )


def test_csv_layout_wrong_account_and_generic_mapping(
    client: TestClient, db: Session
) -> None:
    f, cats, gcash, bpi, _, _ = _setup(client, db)
    imp_id = _start(f, bpi)
    r = f.c.post(
        f"{API}/imports/{imp_id}/csv",
        headers=f.h,
        json={"text": _gcash_csv(), "layout": "gcash"},
    )
    assert r.status_code == 409 and r.json()["code"] == "wrong_account"
    r = f.c.post(
        f"{API}/imports/{imp_id}/csv",
        headers=f.h,
        json={"text": "a,b\n1,2\n", "layout": "generic"},
    )
    assert r.status_code == 422 and r.json()["code"] == "csv_mapping_required"
    bad = "Date,Memo,Amount\n2026-10-01,Coffee,abc\n"
    mapping = {"date": "Date", "description": "Memo", "amount": "Amount"}
    r = f.c.post(
        f"{API}/imports/{imp_id}/csv",
        headers=f.h,
        json={"text": bad, "mapping": mapping},
    )
    assert r.status_code == 422 and r.json()["code"] == "csv_row_invalid"
    assert r.json()["details"] == {"row": 1}
    assert "abc" not in r.text  # never echo the cell
    good = f"Date,Memo,Amount\n{d(-4)},INTEREST EARNED,14.00\n{d(-4)},WITHHOLDING TAX ON INTEREST,-2.80\n"
    out = f.post(f"/imports/{imp_id}/csv", {"text": good, "mapping": mapping})
    rows = f.get(f"/imports/{out['id']}")["rows"]
    assert [(r["direction"], r["amount_minor"], r["category_id"]) for r in rows] == [
        ("in", 1_400, cats["interest"]),
        ("out", 280, cats["fees"]),
    ]
    res = f.post(f"/imports/{imp_id}/commit", {})
    assert (res["created"], res["gap_minor"]) == (2, 0)
