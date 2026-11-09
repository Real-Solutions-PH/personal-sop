"""The free Fern allowance and the Plus fair-use limit, with a moved clock.

Every "now" here is a fixed instant, and the account's sign-up instant is
set relative to it, so "day 2" and "day 8" mean the account's second and
eighth business day. Expected limits are the ruled numbers (pricing ruling
2026-11-08) written out, never read back from the module under test.
"""

import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.modules.ai_providers import allowance as allowance_mod
from app.modules.ai_providers import public
from app.modules.ai_providers.models import FernTurn
from app.modules.iam.users.models import User
from app.modules.profile.models import UserProfile
from app.shared import context as context_mod
from tests.modules.capture.api.helpers import Api, say, user
from tests.utils.mobile import ctx_for, signed_in

UTC = timezone.utc
# Signed up at 10:00 Manila on 2 Nov 2026 (business day 2 Nov).
JOINED = datetime(2026, 11, 2, 2, 0, tzinfo=UTC)
# Noon Manila on the account's 2nd, 7th and 8th business day.
DAY_2 = datetime(2026, 11, 3, 4, 0, tzinfo=UTC)
DAY_7 = datetime(2026, 11, 8, 4, 0, tzinfo=UTC)
DAY_8 = datetime(2026, 11, 9, 4, 0, tzinfo=UTC)


def _account(
    db: Session,
    *,
    tz: str = "Asia/Manila",
    storefront: str | None = None,
    start_hour: int = 4,
    joined: datetime = JOINED,
) -> User:
    u, _ = signed_in(db)
    _shape(db, u, tz=tz, storefront=storefront, start_hour=start_hour, joined=joined)
    return u


def _shape(
    db: Session,
    u: User,
    *,
    tz: str = "Asia/Manila",
    storefront: str | None = None,
    start_hour: int = 4,
    joined: datetime = JOINED,
) -> None:
    row = db.get(User, u.id)
    assert row is not None
    row.created_at = joined
    db.add(row)
    prof = db.exec(select(UserProfile).where(UserProfile.owner_id == u.id)).first()
    if prof is None:
        prof = UserProfile(owner_id=u.id, tenant_id=u.tenant_id)
    prof.timezone = tz
    prof.day_start_hour = start_hour
    prof.storefront_country = storefront
    db.add(prof)
    db.commit()
    db.refresh(row)
    u.created_at = joined


def _send(u: User, at: datetime) -> None:
    """One Fern message at ``at``, through the seam a turn uses."""
    with ctx_for(u, now=at) as ctx:
        a = public.check_fern_turn(ctx)
        public.count_fern_turn(ctx, uuid.uuid4(), a)
        ctx.session.commit()


def _limit_reached(u: User, at: datetime) -> HTTPException:
    with ctx_for(u, now=at) as ctx, pytest.raises(HTTPException) as exc:
        public.check_fern_turn(ctx)
    return exc.value


def _spend_server(u: User, cost_minor: int, at: datetime) -> None:
    with ctx_for(u, now=at) as ctx:
        public.record_usage(
            ctx,
            public.ResolvedModel(
                purpose="chat",
                provider="nebius",
                model="m",
                base_url="https://x",
                api_key=public.SecretStr("k"),
                credential_id=None,
                supports_vision=False,
                source="server",
            ),
            input_tokens=1,
            output_tokens=1,
            cost_minor=cost_minor,
        )
        ctx.session.commit()


# ---------------------------------------------------------------------------
# Free allowance at the seam
# ---------------------------------------------------------------------------


def test_free_day_2_allows_15_then_refuses_with_the_reset_time(
    db: Session,
) -> None:
    u = _account(db, storefront="US")
    for i in range(15):
        _send(u, DAY_2 + timedelta(minutes=i))
    err = _limit_reached(u, DAY_2 + timedelta(minutes=20))
    assert err.status_code == 402
    detail: dict[str, Any] = err.detail  # type: ignore[assignment]
    assert detail["code"] == "fern_daily_allowance_reached"
    # The next business day starts at 04:00 Manila on 4 Nov = 20:00 UTC 3 Nov.
    assert detail["details"]["resets_at"] == "2026-11-03T20:00:00+00:00"
    assert detail["details"]["limit"] == 15


def test_free_day_7_is_still_week_one_and_day_8_allows_5(db: Session) -> None:
    u = _account(db, storefront="US")
    with ctx_for(u, now=DAY_7) as ctx:
        assert public.allowance(ctx).limit == 15
    for i in range(5):
        _send(u, DAY_8 + timedelta(minutes=i))
    err = _limit_reached(u, DAY_8 + timedelta(minutes=10))
    assert err.detail["code"] == "fern_daily_allowance_reached"  # type: ignore[index]
    assert err.detail["details"]["limit"] == 5  # type: ignore[index]


def test_low_price_country_gets_10_then_3(db: Session) -> None:
    u = _account(db, tz="Asia/Manila")  # no storefront: the time zone's PH
    for i in range(10):
        _send(u, DAY_2 + timedelta(minutes=i))
    assert _limit_reached(u, DAY_2 + timedelta(minutes=11)).status_code == 402
    for i in range(3):
        _send(u, DAY_8 + timedelta(minutes=i))
    err = _limit_reached(u, DAY_8 + timedelta(minutes=5))
    assert err.detail["details"]["limit"] == 3  # type: ignore[index]


def test_the_storefront_country_beats_the_time_zone(db: Session) -> None:
    us_in_manila = _account(db, tz="Asia/Manila", storefront="US")
    ph_in_new_york = _account(db, tz="America/New_York", storefront="PH")
    with ctx_for(us_in_manila, now=DAY_8) as ctx:
        assert public.allowance(ctx).limit == 5
    with ctx_for(ph_in_new_york, now=DAY_8) as ctx:
        assert public.allowance(ctx).limit == 3


def test_the_count_resets_at_the_users_day_start_not_utc_midnight(
    db: Session,
) -> None:
    # New York, day starts 04:00 (EST, UTC-5, after 1 Nov 2026).
    u = _account(db, tz="America/New_York", joined=datetime(2026, 10, 1, tzinfo=UTC))
    # 18:00 EST on 2 Nov: business day 2 Nov, UTC day 2 Nov.
    _send(u, datetime(2026, 11, 2, 23, 0, tzinfo=UTC))
    # 03:30 EST on 3 Nov: still business day 2 Nov, but UTC day 3 Nov.
    _send(u, datetime(2026, 11, 3, 8, 30, tzinfo=UTC))
    with ctx_for(u, now=datetime(2026, 11, 3, 8, 45, tzinfo=UTC)) as ctx:
        a = public.allowance(ctx)
        # UTC-midnight counting would see 1 here.
        assert a.used == 2
        assert a.resets_at == datetime(2026, 11, 3, 9, 0, tzinfo=UTC)
    # 04:30 EST on 3 Nov: a new business day; UTC counting would see 1 more.
    with ctx_for(u, now=datetime(2026, 11, 3, 9, 30, tzinfo=UTC)) as ctx:
        assert public.allowance(ctx).used == 0


def test_the_same_message_is_counted_once(db: Session) -> None:
    u = _account(db, storefront="US")
    mid = uuid.uuid4()
    for _ in range(3):
        with ctx_for(u, now=DAY_2) as ctx:
            public.count_fern_turn(ctx, mid, public.allowance(ctx))
            ctx.session.commit()
    with ctx_for(u, now=DAY_2) as ctx:
        assert public.allowance(ctx).used == 1


# ---------------------------------------------------------------------------
# Plus fair use at the seam
# ---------------------------------------------------------------------------


@pytest.fixture
def plus(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every account is on Plus (the plan seam)."""
    monkeypatch.setattr(allowance_mod, "plan_of", lambda ctx: "plus")


def _usd(usd: float) -> int:
    # Written out, not read from the module: US$ x 57 PHP x 100 centavos.
    return round(usd * 57.0 * 100)


@pytest.mark.usefixtures("plus")
def test_plus_past_its_tier_budget_goes_light(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "AI_USD_TO_PHP", 57.0)
    us = _account(db, storefront="US")
    ph = _account(db, storefront="PH")
    # US$1.20 spent: under tier 1's US$2.50, over tier 3's US$1.00.
    _spend_server(us, _usd(1.20), DAY_2)
    _spend_server(ph, _usd(1.20), DAY_2)
    with ctx_for(us, now=DAY_2) as ctx:
        assert not public.allowance(ctx).light
    with ctx_for(ph, now=DAY_2) as ctx:
        assert public.allowance(ctx).light
    _spend_server(us, _usd(1.31), DAY_2)
    with ctx_for(us, now=DAY_2) as ctx:
        assert public.allowance(ctx).light


@pytest.mark.usefixtures("plus")
def test_plus_hard_stop_at_60_a_day(db: Session) -> None:
    u = _account(db, storefront="US")
    for i in range(60):
        _send(u, DAY_2 + timedelta(seconds=i))
    err = _limit_reached(u, DAY_2 + timedelta(minutes=5))
    assert err.detail["code"] == "fern_daily_allowance_reached"  # type: ignore[index]
    assert err.detail["details"]["plan"] == "plus"  # type: ignore[index]
    assert err.detail["details"]["limit"] == 60  # type: ignore[index]


@pytest.mark.usefixtures("plus")
def test_plus_hard_stop_at_5_dollars_a_month(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "AI_USD_TO_PHP", 57.0)
    u = _account(db, storefront="US")
    _spend_server(u, _usd(4.99), DAY_2)
    _send(u, DAY_2)
    _spend_server(u, _usd(0.01), DAY_2)
    err = _limit_reached(u, DAY_2 + timedelta(minutes=1))
    assert err.detail["code"] == "fern_monthly_limit_reached"  # type: ignore[index]
    # The business month of December starts 04:00 Manila on 1 Dec.
    assert err.detail["details"]["resets_at"] == "2026-11-30T20:00:00+00:00"  # type: ignore[index]


def test_limits_come_from_settings(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "FERN_FREE_DAILY", 7)
    monkeypatch.setattr(settings, "PRICE_TIER_COUNTRIES", "US=3")
    u = _account(db, storefront="DE")
    with ctx_for(u, now=DAY_8) as ctx:
        assert public.allowance(ctx).limit == 7
    v = _account(db, storefront="US")
    with ctx_for(v, now=DAY_8) as ctx:
        assert public.allowance(ctx).limit == 3


# ---------------------------------------------------------------------------
# Through Fern's chat (server key, scripted model)
# ---------------------------------------------------------------------------


class _Seen:
    def __init__(self) -> None:
        self.models: list[str] = []


@pytest.fixture
def server_key(monkeypatch: pytest.MonkeyPatch) -> _Seen:
    """Key-less users answered on the server's Nebius key, by a scripted
    model that records which model each call was built for."""
    monkeypatch.setattr(settings, "AI_SERVER_FALLBACK", True)
    monkeypatch.setattr(settings, "DEFAULT_LLM_PROVIDER", "nebius")
    monkeypatch.setattr(settings, "NEBIUS_API_KEY", "nebius-test-key")
    seen = _Seen()
    from tests.modules.capture.api.helpers import ScriptedModel

    def factory(resolved: public.ResolvedModel) -> Any:
        seen.models.append(resolved.model)
        return ScriptedModel(script=[say("Done.")] * 4, seen=[], opts=[])

    monkeypatch.setattr(public, "model_factory", factory)
    return seen


def _clock(monkeypatch: pytest.MonkeyPatch, at: datetime) -> Callable[[datetime], None]:
    now = [at]
    monkeypatch.setattr(context_mod, "utcnow", lambda: now[0])

    def move(to: datetime) -> None:
        now[0] = to

    return move


def _api(client: TestClient, db: Session, **shape: Any) -> Api:
    api = user(client, db, accounts=False)
    _shape(db, api.user, **shape)  # type: ignore[attr-defined]
    return api


def _turns(db: Session, api: Api) -> int:
    db.expire_all()
    return len(
        db.exec(
            select(FernTurn).where(FernTurn.owner_id == api.user.id)  # type: ignore[attr-defined]
        ).all()
    )


@pytest.mark.usefixtures("server_key")
def test_chat_refuses_the_16th_message_on_day_2(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clock(monkeypatch, DAY_2)
    api = _api(client, db, storefront="US")
    assert api.get("/companion/allowance")["remaining"] == 15
    for i in range(15):
        api.post("/companion/ask", {"text": f"hello {i}", "id": str(uuid.uuid4())})
    out = api.get("/companion/allowance")
    assert (out["applies"], out["used"], out["remaining"]) == (True, 15, 0)
    r = client.post(
        "/api/v1/companion/ask",
        headers=api.h,
        json={"text": "one more", "id": str(uuid.uuid4())},
    )
    assert r.status_code == 402
    body = r.json()
    assert body["code"] == "fern_daily_allowance_reached"
    assert body["details"]["resets_at"].startswith("2026-11-03T20:00:00")
    # The stream is refused before it opens, with the same code.
    s = client.post(
        "/api/v1/companion/ask/stream",
        headers=api.h,
        json={"text": "one more", "id": str(uuid.uuid4())},
    )
    assert s.status_code == 402 and s.json()["code"] == "fern_daily_allowance_reached"
    assert _turns(db, api) == 15


@pytest.mark.usefixtures("server_key")
def test_a_resent_message_reads_its_reply_and_is_not_counted_again(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clock(monkeypatch, DAY_8)
    api = _api(client, db, storefront="US")
    mid = str(uuid.uuid4())
    for _ in range(3):
        api.post("/companion/ask", {"text": "plan my day", "id": mid})
    assert _turns(db, api) == 1
    # Even at the limit, a resend of a stored question still reads its reply.
    for i in range(4):
        api.post("/companion/ask", {"text": f"hi {i}", "id": str(uuid.uuid4())})
    assert api.get("/companion/allowance")["remaining"] == 0
    again = api.post("/companion/ask", {"text": "plan my day", "id": mid})
    assert again["messages"][0]["id"] == mid
    assert _turns(db, api) == 5


@pytest.mark.usefixtures("server_key")
def test_a_failed_turn_retried_is_counted_once(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tests.modules.capture.api.helpers import ScriptedModel

    _clock(monkeypatch, DAY_8)
    api = _api(client, db, storefront="US")
    monkeypatch.setattr(
        public,
        "model_factory",
        lambda resolved: ScriptedModel(script=[], seen=[], opts=[], fail=True),
    )
    mid = str(uuid.uuid4())
    # The provider fails; the router answers and the question is stored.
    api.post("/companion/ask", {"text": "plan my day", "id": mid})
    api.post("/companion/ask", {"text": "plan my day", "id": mid})
    assert _turns(db, api) == 1


@pytest.mark.usefixtures("server_key")
def test_the_users_own_key_is_not_counted(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clock(monkeypatch, DAY_8)
    api = _api(client, db, storefront="US")
    api.assign("chat")
    for i in range(7):
        api.post("/companion/ask", {"text": f"hi {i}", "id": str(uuid.uuid4())})
    assert _turns(db, api) == 0
    assert api.get("/companion/allowance")["applies"] is False


@pytest.mark.usefixtures("plus")
def test_plus_past_its_budget_is_answered_by_the_light_model(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    server_key: _Seen,
) -> None:
    monkeypatch.setattr(settings, "AI_USD_TO_PHP", 57.0)
    _clock(monkeypatch, DAY_2)
    api = _api(client, db, storefront="US")
    api.post("/companion/ask", {"text": "hello", "id": str(uuid.uuid4())})
    assert server_key.models and settings.NEBIUS_MODEL in server_key.models
    assert "deepseek-ai/DeepSeek-V4-Flash-0731" not in server_key.models
    _spend_server(api.user, _usd(2.50), DAY_2)  # type: ignore[attr-defined]
    server_key.models.clear()
    api.post("/companion/ask", {"text": "hello again", "id": str(uuid.uuid4())})
    assert server_key.models
    assert set(server_key.models) == {"deepseek-ai/DeepSeek-V4-Flash-0731"}
