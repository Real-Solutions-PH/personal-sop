import base64
import os
import uuid
from decimal import Decimal

import pytest
from pydantic import SecretStr

from app.core.config import settings
from app.shared import crypto
from app.shared.ids import derived_id
from app.shared.money import MAX_MINOR, check_minor, ratio, to_major, to_minor


@pytest.mark.parametrize(
    ("given", "minor"),
    [
        ("1,234.50", 123450),
        ("₱12", 1200),
        (0.1, 10),
        ("0.005", 1),  # half-up, not banker's
        ("0.004", 0),
        (Decimal("-2.25"), -225),
        (99, 9900),
    ],
)
def test_to_minor(given: str | float | Decimal | int, minor: int) -> None:
    assert to_minor(given) == minor


@pytest.mark.parametrize("bad", ["NaN", "inf", "abc", "", True, "1000000000000.01"])
def test_to_minor_rejects(bad: object) -> None:
    with pytest.raises(ValueError):
        to_minor(bad)  # type: ignore[arg-type]


def test_major_and_bounds() -> None:
    assert to_major(123450) == Decimal("1234.50")
    assert check_minor(MAX_MINOR) == MAX_MINOR
    with pytest.raises(ValueError):
        check_minor(MAX_MINOR + 1)
    assert ratio(1, 4) == 0.25
    assert ratio(1, 0) is None


def test_derived_id_is_stable_and_scoped() -> None:
    parent = uuid.UUID("00000000-0000-4000-8000-000000000001")
    a = derived_id("task-next", parent, "2026-10-19")
    assert a == derived_id("task-next", parent, "2026-10-19")
    assert a != derived_id("task-next", parent, "2026-10-20")
    assert a != derived_id("planned-record", parent, "2026-10-19")
    assert a.version == 5
    # Pinned: the mobile client computes the same value with uuid.v5.
    assert str(a) == str(
        uuid.uuid5(
            uuid.UUID("6f1d7c2a-4b8e-5a3c-9d10-2e7f40b1c9a5"),
            f"task-next:{parent}:2026-10-19",
        )
    )
    with pytest.raises(ValueError):
        derived_id("bad:kind", parent, "x")


@pytest.fixture()
def kek(monkeypatch: pytest.MonkeyPatch) -> None:
    key = base64.b64encode(os.urandom(32)).decode()
    monkeypatch.setattr(settings, "AI_CREDENTIALS_KEK", SecretStr(key))
    monkeypatch.setattr(settings, "AI_CREDENTIALS_KEK_VERSION", 1)


@pytest.mark.usefixtures("kek")
def test_seal_round_trip_and_owner_binding() -> None:
    owner = uuid.uuid4()
    sealed = crypto.seal("sk-live-abcdef123456", owner_id=owner)
    assert b"abcdef" not in sealed.ciphertext
    assert crypto.unseal(sealed, owner_id=owner) == "sk-live-abcdef123456"
    with pytest.raises(crypto.SecretUnavailable):
        crypto.unseal(sealed, owner_id=uuid.uuid4())


@pytest.mark.usefixtures("kek")
def test_unseal_refuses_retired_key_version(monkeypatch: pytest.MonkeyPatch) -> None:
    owner = uuid.uuid4()
    sealed = crypto.seal("secret-value-1", owner_id=owner)
    monkeypatch.setattr(settings, "AI_CREDENTIALS_KEK_VERSION", 2)
    with pytest.raises(crypto.SecretUnavailable):
        crypto.unseal(sealed, owner_id=owner)


def test_missing_or_short_kek(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "AI_CREDENTIALS_KEK", None)
    with pytest.raises(crypto.SecretUnavailable):
        crypto.seal("x", owner_id=uuid.uuid4())
    monkeypatch.setattr(
        settings, "AI_CREDENTIALS_KEK", SecretStr(base64.b64encode(b"short").decode())
    )
    with pytest.raises(crypto.SecretUnavailable):
        crypto.seal("x", owner_id=uuid.uuid4())


def test_last4() -> None:
    assert crypto.last4("sk-or-v1-0123456789") == "6789"
    assert crypto.last4("short") == ""
