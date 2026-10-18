"""Shared calls for the finance API tests."""

import uuid
from typing import Any

from fastapi.testclient import TestClient

from app.core.config import settings

API = f"{settings.API_V1_STR}/finance"
SYNC = f"{settings.API_V1_STR}/sync"


class Fin:
    """One signed-in user's finance API."""

    def __init__(self, client: TestClient, headers: dict[str, str]) -> None:
        self.c = client
        self.h = headers

    def get(self, path: str, status: int = 200, **params: Any) -> Any:
        r = self.c.get(f"{API}{path}", headers=self.h, params=params)
        assert r.status_code == status, r.text
        return r.json()

    def post(self, path: str, body: Any = None, status: int = 200) -> Any:
        r = self.c.post(f"{API}{path}", headers=self.h, json=body if body is not None else {})
        assert r.status_code == status, r.text
        return r.json()

    def patch(self, path: str, body: Any, status: int = 200) -> Any:
        r = self.c.patch(f"{API}{path}", headers=self.h, json=body)
        assert r.status_code == status, r.text
        return r.json()

    def delete(self, path: str, status: int = 200, **params: Any) -> Any:
        r = self.c.delete(f"{API}{path}", headers=self.h, params=params)
        assert r.status_code == status, r.text
        return r.json()

    def cats(self) -> dict[str, str]:
        """Seeded category slug -> id."""
        rows = self.get("/categories", limit=100)["data"]
        return {c["slug"]: c["id"] for c in rows if c["slug"]}

    def account(self, name: str, type: str = "ewallet", opening: int = 0, **extra: Any) -> str:
        body = {"name": name, "type": type, "opening_minor": opening, **extra}
        return str(self.post("/accounts", body)["id"])

    def expense(self, account: str, amount: int, cat: str | None = None, **extra: Any) -> dict[str, Any]:
        body = {"type": "expense", "amount_minor": amount, "account_id": account, "category_id": cat, **extra}
        out: dict[str, Any] = self.post("/records", body)["data"][0]
        return out

    def income(self, account: str, amount: int, cat: str | None = None, **extra: Any) -> dict[str, Any]:
        body = {"type": "income", "amount_minor": amount, "account_id": account, "category_id": cat, **extra}
        out: dict[str, Any] = self.post("/records", body)["data"][0]
        return out

    def balances(self) -> dict[str, int]:
        return {a["id"]: a["balance_minor"] for a in self.get("/accounts")["data"]}

    def push(self, *ops: dict[str, Any]) -> list[dict[str, Any]]:
        r = self.c.post(f"{SYNC}/push", headers=self.h, json={"ops": list(ops)})
        assert r.status_code == 200, r.text
        return list(r.json()["results"])

    def pull(self, cursor: int = 0, limit: int = 500) -> dict[str, Any]:
        r = self.c.get(f"{SYNC}/pull", headers=self.h, params={"cursor": cursor, "limit": limit})
        assert r.status_code == 200, r.text
        out: dict[str, Any] = r.json()
        return out


def op(kind: str, name: str, row_id: uuid.UUID | str | None = None, op_id: str | None = None, **data: Any) -> dict[str, Any]:
    return {
        "op_id": op_id or str(uuid.uuid4()),
        "kind": kind,
        "name": name,
        "id": str(row_id) if row_id else None,
        "data": data,
    }
