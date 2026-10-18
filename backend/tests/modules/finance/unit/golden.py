"""Load ``tests/golden/finance-calc.json`` (emitted by the prototype) into the
calc snapshot types. Pesos become centavos (x100); nothing here is computed
by the code under test."""

import json
from datetime import date
from functools import cache
from pathlib import Path
from typing import Any

from app.modules.finance import calc

GOLDEN = Path(__file__).resolve().parents[3] / "golden" / "finance-calc.json"


@cache
def data() -> dict[str, Any]:
    out: dict[str, Any] = json.loads(GOLDEN.read_text())["data"]
    return out


def c(pesos: float) -> float:
    """Pesos -> centavos without rounding (averages stay fractional)."""
    return pesos * 100


def d(k: str) -> date:
    return date.fromisoformat(k)


def plan_of(p: dict[str, Any]) -> calc.Plan:
    return calc.Plan(
        id=p["id"],
        name=p["name"],
        type=p["type"],
        amount=round(p["amount"] * 100),
        account_id=p["accountId"],
        to_account_id=p.get("toAccountId"),
        category_id=p.get("categoryId"),
        schedule=p["schedule"],
        start=d(p["start"]),
        end_rule=p["end"],
        auto_log=p["autoLog"],
        is_what_if=p["isWhatIf"],
        in_projection=p["inProjection"],
        archived=p["archived"],
        estimated=p["estimated"],
        skipped={d(x) for x in p["skipped"]},
        snoozed={d(k): d(v) for k, v in p["snoozed"].items()},
    )


def state(month_start_day: int = 1) -> calc.State:
    seed = data()["seed"]
    cats = [
        calc.Cat(
            id=x["id"],
            kind=x["kind"],
            parent_id=x.get("parentId"),
            discretionary=x["discretionary"],
            archived=x["archived"],
            system=bool(x.get("system")),
            name=x["name"],
            slug=x["id"],
        )
        for x in seed["categories"]
    ]
    return calc.State(
        today=d(seed["today"]),
        accounts=[
            calc.Acct(
                id=a["id"],
                type=a["type"],
                opening=round(a["opening"] * 100),
                in_net_worth=a["inNetWorth"],
                in_projection=a["inProjection"],
                archived=a["archived"],
                manual=bool(a.get("manual")),
                name=a["name"],
            )
            for a in seed["accounts"]
        ],
        categories=cats,
        records=[
            calc.Rec(
                id=r["id"],
                type=r["type"],
                amount=round(r["amount"] * 100),
                account_id=r["accountId"],
                to_account_id=r.get("toAccountId"),
                category_id=r.get("categoryId"),
                day=d(r["day"]),
                payee=r.get("payee"),
                planned_id=r.get("plannedId"),
                planned_on=d(r["plannedOn"]) if r.get("plannedOn") else None,
                import_id=r.get("importId"),
                is_refund=bool(r.get("isRefund")),
                is_adjustment=bool(r.get("isAdjustment")),
                source=r["source"],
                status=r["status"],
            )
            for r in seed["records"]
        ],
        budgets=[
            calc.Bud(
                id=b["id"],
                name=b["name"],
                category_ids=b["categoryIds"],
                limit=round(b["limit"] * 100),
                rollover=b["rollover"],
                start_date=d(b["startDate"]),
                archived=b["archived"],
            )
            for b in seed["budgets"]
        ],
        planned=[plan_of(p) for p in seed["planned"]],
        settings=calc.Settings(month_start_day=month_start_day),
        cat_by_slug={x.id: x.id for x in cats},
    )


def statement(account: str) -> list[calc.StatementRow]:
    return [
        calc.StatementRow(
            ref=r["ref"],
            date=d(r["date"]),
            time=r["time"],
            raw=r["raw"],
            amount=round(r["amount"] * 100),
            direction=r["direction"],
            pending=bool(r.get("pending")),
        )
        for r in data()["seed"]["statements"][account]
    ]
