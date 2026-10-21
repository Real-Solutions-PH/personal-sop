"""First-sign-in provisioning commits the user and its default role together,
so a concurrent request can never see a role-less user (a spurious 403)."""

import uuid
from typing import Any

import pytest
from sqlmodel import Session, select

from app.core import supabase_auth
from app.modules.iam.rbac.models import UserRole
from app.modules.iam.users import services


def test_user_and_role_commit_in_one_transaction(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(supabase_auth, "admin_user_exists", lambda _uid: True)
    commits: list[bool] = []
    real_commit = db.commit
    uid = uuid.uuid4()

    def counting_commit(*a: Any, **k: Any) -> None:
        # At the moment of each commit, is the role already part of it?
        commits.append(
            any(isinstance(o, UserRole) and o.user_id == uid for o in db.new)
        )
        real_commit(*a, **k)

    monkeypatch.setattr(db, "commit", counting_commit)
    user = services.provision_user_from_claims(
        session=db, user_id=uid, email=f"atomic-{uid.hex[:8]}@example.com"
    )
    assert commits == [True]  # one commit, carrying the role
    assert db.exec(select(UserRole).where(UserRole.user_id == user.id)).first()


def test_race_loser_returns_the_existing_user(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(supabase_auth, "admin_user_exists", lambda _uid: True)
    uid = uuid.uuid4()
    email = f"race-{uid.hex[:8]}@example.com"
    first = services.provision_user_from_claims(session=db, user_id=uid, email=email)
    again = services.provision_user_from_claims(session=db, user_id=uid, email=email)
    assert again.id == first.id
    assert db.exec(select(UserRole).where(UserRole.user_id == uid)).first()
