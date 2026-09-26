"""Settings guardrails."""

import pytest

from app.core.config import _DEMO_SUPABASE_SERVICE_ROLE_KEY, Settings

_BASE: dict[str, str] = {
    "PROJECT_NAME": "t",
    "POSTGRES_SERVER": "db",
    "POSTGRES_USER": "u",
    "POSTGRES_PASSWORD": "not-default",
    "FIRST_SUPERUSER": "a@b.co",
    "FIRST_SUPERUSER_PASSWORD": "not-default",
    # Non-default object-store creds so the deployment-secret guard passes;
    # individual MinIO tests override these back to a known-insecure value.
    "MINIO_ROOT_USER": "real-access-key",
    "MINIO_ROOT_PASSWORD": "real-secret-key",
}


def test_demo_service_role_key_rejected_outside_local() -> None:
    with pytest.raises(ValueError, match="SUPABASE_SERVICE_ROLE_KEY"):
        Settings(
            _env_file=None,  # type: ignore[call-arg]
            ENVIRONMENT="staging",
            SUPABASE_SERVICE_ROLE_KEY=_DEMO_SUPABASE_SERVICE_ROLE_KEY,
            **_BASE,
        )


def test_demo_service_role_key_warns_in_local() -> None:
    with pytest.warns(UserWarning, match="SUPABASE_SERVICE_ROLE_KEY"):
        Settings(
            _env_file=None,  # type: ignore[call-arg]
            ENVIRONMENT="local",
            SUPABASE_SERVICE_ROLE_KEY=_DEMO_SUPABASE_SERVICE_ROLE_KEY,
            **_BASE,
        )


def test_non_demo_key_accepted_outside_local() -> None:
    s = Settings(
        _env_file=None,  # type: ignore[call-arg]
        ENVIRONMENT="staging",
        SUPABASE_SERVICE_ROLE_KEY="a-real-project-key",
        **_BASE,
    )
    assert s.SUPABASE_SERVICE_ROLE_KEY == "a-real-project-key"


@pytest.mark.parametrize("bad", ["minioadmin", "changethis"])
def test_minio_root_password_default_rejected_outside_local(bad: str) -> None:
    with pytest.raises(ValueError, match="MINIO_ROOT_PASSWORD"):
        Settings(
            _env_file=None,  # type: ignore[call-arg]
            ENVIRONMENT="production",
            SUPABASE_SERVICE_ROLE_KEY="a-real-project-key",
            **{**_BASE, "MINIO_ROOT_PASSWORD": bad},
        )


def test_minio_root_user_default_rejected_outside_local() -> None:
    with pytest.raises(ValueError, match="MINIO_ROOT_USER"):
        Settings(
            _env_file=None,  # type: ignore[call-arg]
            ENVIRONMENT="production",
            SUPABASE_SERVICE_ROLE_KEY="a-real-project-key",
            **{**_BASE, "MINIO_ROOT_USER": "minioadmin"},
        )


def test_minio_defaults_only_warn_in_local() -> None:
    with pytest.warns(UserWarning, match="MINIO_ROOT_PASSWORD"):
        Settings(
            _env_file=None,  # type: ignore[call-arg]
            ENVIRONMENT="local",
            **{
                **_BASE,
                "MINIO_ROOT_USER": "minioadmin",
                "MINIO_ROOT_PASSWORD": "minioadmin",
            },
        )


def test_empty_service_role_key_rejected_outside_local() -> None:
    with pytest.raises(ValueError, match="SUPABASE_SERVICE_ROLE_KEY"):
        Settings(
            _env_file=None,  # type: ignore[call-arg]
            ENVIRONMENT="staging",
            **{**_BASE, "SUPABASE_SERVICE_ROLE_KEY": ""},
        )


def test_empty_service_role_key_allowed_in_local() -> None:
    s = Settings(
        _env_file=None,  # type: ignore[call-arg]
        ENVIRONMENT="local",
        **{**_BASE, "SUPABASE_SERVICE_ROLE_KEY": ""},
    )
    assert s.SUPABASE_SERVICE_ROLE_KEY == ""


def test_docs_enabled_only_in_local() -> None:
    local = Settings(_env_file=None, ENVIRONMENT="local", **_BASE)  # type: ignore[call-arg]
    assert local.docs_enabled is True
    for env in ("staging", "production"):
        s = Settings(
            _env_file=None,  # type: ignore[call-arg]
            ENVIRONMENT=env,
            SUPABASE_SERVICE_ROLE_KEY="a-real-project-key",
            **_BASE,
        )
        assert s.docs_enabled is False


def test_app_engine_uses_app_user_when_configured() -> None:
    s = Settings(
        _env_file=None,  # type: ignore[call-arg]
        ENVIRONMENT="local",
        POSTGRES_APP_USER="app_user",
        POSTGRES_APP_PASSWORD="app-secret",
        **_BASE,
    )
    assert s.app_user_configured is True
    uri = s.SQLALCHEMY_APP_DATABASE_URI
    assert "app_user" in uri
    assert "app-secret" in uri
    # Owner URI is unchanged and distinct from the app URI.
    assert "app_user" not in s.SQLALCHEMY_DATABASE_URI


def test_app_engine_falls_back_to_owner_when_unset() -> None:
    s = Settings(_env_file=None, ENVIRONMENT="local", **_BASE)  # type: ignore[call-arg]
    assert s.app_user_configured is False
    assert s.SQLALCHEMY_APP_DATABASE_URI == s.SQLALCHEMY_DATABASE_URI


def test_app_user_never_borrows_the_owner_password() -> None:
    # POSTGRES_APP_USER set but POSTGRES_APP_PASSWORD empty must NOT silently
    # dial app_user with the owner's password.
    base = {**_BASE, "POSTGRES_PASSWORD": "owner-secret"}
    s = Settings(
        _env_file=None,  # type: ignore[call-arg]
        ENVIRONMENT="local",
        POSTGRES_APP_USER="app_user",
        POSTGRES_APP_PASSWORD="",
        **base,
    )
    assert "owner-secret" not in s.SQLALCHEMY_APP_DATABASE_URI
    assert "app_user" in s.SQLALCHEMY_APP_DATABASE_URI
