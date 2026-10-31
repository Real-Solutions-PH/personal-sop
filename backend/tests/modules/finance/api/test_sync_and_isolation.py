"""Sync push/pull of every finance entity and action, and two-user isolation."""

import uuid
from datetime import timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.shared.day import DayClock
from app.shared.ids import derived_id
from tests.modules.finance.api.helpers import API, Fin, op
from tests.utils.mobile import signed_in

TODAY = DayClock().today()


def _fin(client: TestClient, db: Session) -> Fin:
    _, headers = signed_in(db)
    return Fin(client, headers)


def _applied(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    assert [r["status"] for r in results] == ["applied"] * len(results), results
    return results


def test_push_and_pull_every_entity(client: TestClient, db: Session) -> None:
    f = _fin(client, db)
    cats = f.cats()
    ids = {
        k: uuid.uuid4()
        for k in (
            "acct",
            "acct2",
            "cat",
            "rec",
            "bud",
            "bc",
            "plan",
            "snz",
            "lb",
            "thr",
            "msg",
        )
    }
    anchor = (TODAY - timedelta(days=7)).isoformat()
    res = _applied(
        f.push(
            op(
                "upsert",
                "account",
                ids["acct"],
                name="GCash",
                type="ewallet",
                opening_minor=100_000,
            ),
            op("upsert", "account", ids["acct2"], name="BPI", type="bank"),
            op(
                "upsert",
                "category",
                ids["cat"],
                name="Milk tea",
                kind="expense",
                parent_id=cats["food"],
            ),
            op(
                "upsert",
                "fin_record",
                ids["rec"],
                type="transfer",
                amount_minor=50_000,
                account_id=str(ids["acct"]),
                to_account_id=str(ids["acct2"]),
                fee_minor=1_500,
            ),
            op("upsert", "budget", ids["bud"], name="Treats", limit_minor=200_000),
            op(
                "upsert",
                "budget_category",
                ids["bc"],
                budget_id=str(ids["bud"]),
                category_id=str(ids["cat"]),
            ),
            op(
                "upsert",
                "planned_item",
                ids["plan"],
                name="Allowance",
                type="income",
                amount_minor=10_000,
                account_id=str(ids["acct"]),
                schedule={"kind": "weekly", "every": 1, "anchor": anchor},
                start=anchor,
            ),
            op(
                "upsert",
                "planned_skip",
                uuid.uuid4(),
                planned_id=str(ids["plan"]),
                on_day=anchor,
            ),
            op(
                "upsert",
                "planned_snooze",
                ids["snz"],
                planned_id=str(ids["plan"]),
                on_day=TODAY.isoformat(),
                until_day=(TODAY + timedelta(days=2)).isoformat(),
            ),
            op(
                "upsert",
                "look_back",
                ids["lb"],
                period="2026-09",
                note="n",
                snapshot={"savings_rate": 0.2, "income_minor": 10, "spend_minor": 8},
            ),
            op("upsert", "advisor_thread", ids["thr"], title="Hi"),
            op(
                "upsert",
                "advisor_message",
                ids["msg"],
                thread_id=str(ids["thr"]),
                role="user",
                text="afford?",
            ),
            op(
                "upsert",
                "finance_settings",
                uuid.uuid4(),
                month_start_day=5,
                horizon=24,
            ),
        )
    )
    assert res[3]["row"]["type"] == "transfer"
    # The fee came with the transfer, with its derived id.
    fee_id = str(derived_id("transfer-fee", ids["rec"], "fee"))
    assert f.get(f"/records/{fee_id}")["fee_of"] == str(ids["rec"])
    assert f.get(f"/planned/{ids['plan']}")["skipped"] == [anchor]
    assert f.get("/settings")["month_start_day"] == 5
    pulled = f.pull()
    # The stats rollups (daily_module_stat, life_score_daily) ride the same
    # pull once a finance write moves a day; this test is about finance's own.
    names = {
        c["entity"]
        for c in pulled["changes"]
        # Rollups are derived; the fitness catalog is shared by the tenant.
        if c["entity"]
        not in (
            "daily_module_stat",
            "life_score_daily",
            "exercise",
            "workout_template",
            "template_item",
        )
    }
    assert names == {
        "account",
        "category",
        "fin_record",
        "budget",
        "budget_category",
        "planned_item",
        "planned_skip",
        "planned_snooze",
        "look_back",
        "advisor_thread",
        "advisor_message",
        "finance_settings",
    }
    versions = [c["version"] for c in pulled["changes"]]
    assert versions == sorted(versions)
    # Field-level LWW: a partial upsert keeps the other fields.
    upd = _applied(f.push(op("upsert", "fin_record", ids["rec"], note="rent split")))[0]
    assert (upd["row"]["note"], upd["row"]["amount_minor"]) == ("rent split", 50_000)
    # Business rules still guard a synced write.
    bad = f.push(
        op(
            "upsert",
            "fin_record",
            uuid.uuid4(),
            type="expense",
            amount_minor=100,
            account_id=str(ids["acct"]),
            category_id=cats["salary"],
        ),
        op(
            "upsert",
            "fin_record",
            uuid.uuid4(),
            type="expense",
            amount_minor=0,
            account_id=str(ids["acct"]),
        ),
        op("upsert", "fin_record", uuid.uuid4(), amount_minor=100),
        op("delete", "account", ids["acct"]),
        op("delete", "finance_settings", uuid.uuid4()),
    )
    assert [(r["status"], r.get("code")) for r in bad] == [
        ("rejected", "category_kind_mismatch"),
        ("rejected", "validation_error"),
        ("rejected", "missing_fields"),
        ("rejected", "account_has_records"),
        ("applied", None),  # unknown row: deleting nothing is idempotent
    ]


def test_tombstones_replay_and_restore(client: TestClient, db: Session) -> None:
    f = _fin(client, db)
    cats = f.cats()
    a = f.account("Cash", type="cash")
    rid = uuid.uuid4()
    create = op(
        "upsert",
        "fin_record",
        rid,
        type="expense",
        amount_minor=7_500,
        account_id=a,
        category_id=cats["coffee"],
    )
    first = _applied(f.push(create))[0]
    again = f.push(create)[0]
    assert again["replayed"] and again["row"] == first["row"]
    assert f.get("/records")["count"] == 1
    cursor = f.pull()["cursor"]
    _applied(f.push(op("delete", "fin_record", rid)))
    tomb = [c for c in f.pull(cursor)["changes"] if c["id"] == str(rid)]
    assert tomb and tomb[0]["deleted"] and tomb[0]["row"] is None
    stale = f.push(op("upsert", "fin_record", rid, note="offline edit"))[0]
    assert (stale["status"], stale["code"]) == ("conflict", "deleted_on_server")
    back = f.push({**op("upsert", "fin_record", rid), "data": {"deleted_at": None}})[0]
    assert back["status"] == "applied"
    assert f.get(f"/records/{rid}")["amount_minor"] == 7_500


def test_settle_replayed_through_sync_creates_one_record(
    client: TestClient, db: Session
) -> None:
    f = _fin(client, db)
    cats = f.cats()
    a = f.account("BPI", type="bank", opening=1_000_000)
    anchor = (TODAY - timedelta(days=7)).isoformat()
    p = f.post(
        "/planned",
        {
            "name": "Rent",
            "type": "expense",
            "amount_minor": 1_200_000,
            "account_id": a,
            "category_id": cats["rent"],
            "schedule": {"kind": "weekly", "every": 1, "anchor": anchor},
            "start": anchor,
        },
    )
    settle = op("action", "finance.settle", planned_id=p["id"], day=anchor)
    first = _applied(f.push(settle))[0]
    expected = str(derived_id("planned-record", uuid.UUID(p["id"]), anchor))
    assert first["result"] == {"record_id": expected}
    # The same op replayed returns the receipt; a NEW op for the same
    # occurrence (another device) resolves to the same record.
    assert f.push(settle)[0]["replayed"]
    other = _applied(
        f.push(
            op(
                "action",
                "finance.settle",
                planned_id=p["id"],
                day=anchor,
                amount_minor=999,
            )
        )
    )[0]
    assert other["result"] == {"record_id": expected}
    # The device's optimistic copy, pushed as an upsert with the derived id,
    # lands on the same row too.
    _applied(f.push(op("upsert", "fin_record", expected, note="paid via app")))
    recs = f.get("/records")["data"]
    assert [r["id"] for r in recs] == [expected]
    assert (recs[0]["amount_minor"], recs[0]["note"]) == (1_200_000, "paid via app")
    assert f.balances()[a] == 1_000_000 - 1_200_000


def test_every_domain_action(client: TestClient, db: Session) -> None:
    f = _fin(client, db)
    cats = f.cats()
    a = f.account("GCash", opening=100_000)
    anchor = (TODAY - timedelta(days=7)).isoformat()
    p = f.post(
        "/planned",
        {
            "name": "Load",
            "type": "expense",
            "amount_minor": 9_900,
            "account_id": a,
            "schedule": {"kind": "weekly", "every": 1, "anchor": anchor},
            "start": anchor,
        },
    )
    rec = f.expense(a, 5_000, cats["coffee"], status="pending")
    mine = f.post("/categories", {"name": "Snacks", "kind": "expense"})
    res = _applied(
        f.push(
            op("action", "finance.skip", planned_id=p["id"], day=anchor),
            op("action", "finance.unskip", planned_id=p["id"], day=anchor),
            op(
                "action",
                "finance.snooze",
                planned_id=p["id"],
                day=TODAY.isoformat(),
                days=2,
            ),
            op("action", "finance.adjust_balance", account_id=a, actual_minor=200_000),
            op(
                "action",
                "finance.recategorise",
                ids=[str(rec["id"])],
                category_id=mine["id"],
            ),
            op("action", "finance.confirm_record", record_id=str(rec["id"])),
            op(
                "action",
                "finance.delete_category_moving",
                category_id=mine["id"],
                move_to=cats["dining"],
            ),
        )
    )
    assert res[2]["result"]["until_day"] == (TODAY + timedelta(days=2)).isoformat()
    assert f.get(f"/planned/{p['id']}")["skipped"] == []
    assert f.balances()[a] == 200_000
    r = f.get(f"/records/{rec['id']}")
    assert (r["status"], r["category_id"]) == ("cleared", cats["dining"])
    bad = f.push(
        op(
            "action",
            "finance.skip",
            planned_id=p["id"],
            day=(TODAY - timedelta(days=1)).isoformat(),
        ),
        op("action", "finance.delete_category_moving", category_id=cats["adjust"]),
        op("action", "finance.nope"),
    )
    assert [(r["status"], r.get("code")) for r in bad] == [
        ("rejected", "not_an_occurrence"),
        ("rejected", "category_system"),
        ("rejected", "unknown_action"),
    ]


def test_second_user_cannot_read_or_change_rows(
    client: TestClient, db: Session
) -> None:
    owner = _fin(client, db)
    other = _fin(client, db)
    cats = owner.cats()
    a = owner.account("Cash", type="cash")
    rec = owner.expense(a, 100, cats["coffee"])
    bud = owner.post("/budgets", {"name": "B", "limit_minor": 1_000})
    p = owner.post(
        "/planned",
        {
            "name": "P",
            "type": "expense",
            "amount_minor": 100,
            "account_id": a,
            "schedule": {"kind": "monthly", "day": 1},
        },
    )
    imp = owner.post(
        "/imports", {"account_id": a, "file_name": "f.csv", "file_type": "csv"}
    )
    t = owner.post("/advisor/threads", {"title": "T"})
    for path in (
        f"/accounts/{a}",
        f"/records/{rec['id']}",
        f"/budgets/{bud['id']}",
        f"/planned/{p['id']}",
        f"/imports/{imp['id']}",
        f"/advisor/threads/{t['id']}",
    ):
        other.get(path, status=404)
    other.patch(f"/records/{rec['id']}", {"note": "x"}, status=404)
    other.delete(f"/accounts/{a}", status=404)
    other.post(
        "/records", {"type": "expense", "amount_minor": 1, "account_id": a}, status=404
    )
    other.post("/records/delete", {"ids": [rec["id"]]}, status=404)
    other.post(
        "/planned/settle", {"planned_id": p["id"], "day": "2026-11-01"}, status=404
    )
    other.post(
        "/records",
        {
            "type": "expense",
            "amount_minor": 1,
            "account_id": other.account("Mine"),
            "category_id": cats["coffee"],
        },
        status=404,
    )
    # Their own seeded categories have different (derived) ids.
    assert set(other.cats().values()).isdisjoint(cats.values())
    assert other.get("/records")["count"] == 0
    assert all(c["entity"] != "fin_record" for c in other.pull()["changes"])
    # A sync op naming another user's row cannot reach it.
    res = other.push(op("upsert", "fin_record", rec["id"], note="mine now"))[0]
    assert res["status"] == "rejected"
    assert owner.get(f"/records/{rec['id']}")["note"] is None


def test_permissions_and_auth(client: TestClient) -> None:
    r = client.get(f"{API}/home")
    assert r.status_code == 401
    r = client.get(f"{API}/home", headers={"Authorization": "Bearer nope"})
    assert r.status_code in (401, 403)
