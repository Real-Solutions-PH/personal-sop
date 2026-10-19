"""Load the capture golden fixtures and shape them like the server payloads.

The fixtures hold the prototype's own output: camelCase keys and whole
pesos. :func:`server_shape` renames keys to snake_case and turns money into
centavos (``amount`` -> ``amount_minor`` x 100) — a mechanical rename, so the
expected values still come from the prototype, never from the Python port.
"""

import json
import re
from dataclasses import asdict
from datetime import date
from pathlib import Path
from typing import Any

from app.modules.capture.parse import (
    HabitRef,
    MealEstimate,
    RoutineRef,
    TaskRef,
    World,
)
from app.modules.fitness import foods as F

GOLDEN = Path(__file__).resolve().parents[3] / "golden"
MONEY_KINDS = {"expense", "income", "transfer", "planned", "command"}


def load(name: str) -> dict[str, Any]:
    return dict(json.loads((GOLDEN / f"{name}.json").read_text()))


def snake(key: str) -> str:
    return re.sub(r"(?<!^)([A-Z])", lambda m: "_" + m.group(1).lower(), key)


def server_shape(v: Any, *, money: bool = False) -> Any:
    """Prototype JSON -> server JSON (see module docstring). ``None`` values
    are dropped: the prototype's ``undefined`` never reaches its JSON."""
    if isinstance(v, list):
        return [server_shape(x, money=money) for x in v]
    if not isinstance(v, dict):
        return v
    money = money or v.get("kind") in MONEY_KINDS
    out: dict[str, Any] = {}
    for k, x in v.items():
        if x is None:
            continue
        if k == "amount" and money:
            out["amount_minor"] = x * 100
            continue
        key = snake(k)
        if k == "field" and isinstance(x, str):
            x = snake(x)
        out[key] = server_shape(x, money=money)
    return out


def drop_none(v: Any) -> Any:
    if isinstance(v, list):
        return [drop_none(x) for x in v]
    if isinstance(v, dict):
        return {k: drop_none(x) for k, x in v.items() if x is not None}
    return v


def fitness_meal(text: str) -> MealEstimate | None:
    est = F.parse_meal_text(text)
    if est is None:
        return None
    items = []
    for it in est.items:
        d = asdict(it)
        if d.get("assumption") is None:
            d.pop("assumption", None)
        items.append(d)
    return MealEstimate(
        items=items,
        confidence=est.confidence,
        follow_up=est.follow_up.as_dict() if est.follow_up else None,
    )


def world_from(w: dict[str, Any]) -> World:
    return World(
        today=date.fromisoformat(w["today"]),
        habits=[
            HabitRef(h["id"], h["name"], h["type"], h["target"], h["status"])
            for h in w["habits"]
        ],
        tasks=[TaskRef(t["id"], t["title"]) for t in w["tasks"]],
        routines=[
            RoutineRef(r["id"], r["name"], r["icon"], r["status"])
            for r in w["routines"]
        ],
        # Prototype ids ARE the account words and category slugs.
        account_keys={a["id"]: a["id"] for a in w["accounts"]},
        category_slugs={c["id"]: c["id"] for c in w["categories"]},
        default_account=w["defaultAccount"],
        latest_kg=w["latestKg"],
        recent_cats=w["recentCats"],
        account_options=w["accountOptions"],
        list_keys={k: k for k in ("work", "job2", "life", "groceries")},
        meal=fitness_meal,
    )
