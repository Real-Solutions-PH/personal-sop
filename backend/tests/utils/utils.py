import random
import string

import httpx

from app.core.config import settings


def random_lower_string() -> str:
    return "".join(random.choices(string.ascii_lowercase, k=32))


def random_email() -> str:
    return f"{random_lower_string()}@{random_lower_string()}.com"


def supabase_password_grant(email: str, password: str) -> str:
    """Mint a real access token from the local GoTrue (password grant)."""
    r = httpx.post(
        f"{settings.SUPABASE_URL}/auth/v1/token",
        params={"grant_type": "password"},
        headers={"apikey": settings.SUPABASE_ANON_KEY},
        json={"email": email, "password": password},
        timeout=10,
    )
    r.raise_for_status()
    token: str = r.json()["access_token"]
    return token


def auth_headers(email: str, password: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {supabase_password_grant(email, password)}"}


def get_superuser_token_headers() -> dict[str, str]:
    # The FIRST_SUPERUSER GoTrue user (and its password) is guaranteed by
    # the init_db bootstrap, which the session-scoped db fixture runs.
    return auth_headers(settings.FIRST_SUPERUSER, settings.FIRST_SUPERUSER_PASSWORD)
