"""RevenueCat's REST API: the one seam the server reads a subscriber
through. Tests substitute ``fetch_subscriber``."""

import logging
from typing import Any
from urllib.parse import quote

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

API = "https://api.revenuecat.com/v1"
TIMEOUT_SECONDS = 8.0


def fetch_subscriber(app_user_id: str) -> dict[str, Any] | None:
    """``GET /subscribers/{id}``; None when it cannot be read (no key, a
    network failure, an error status), so a caller keeps what it holds."""
    key = settings.REVENUECAT_SECRET_API_KEY
    if key is None:
        return None
    try:
        r = httpx.get(
            f"{API}/subscribers/{quote(app_user_id, safe='')}",
            headers={"Authorization": f"Bearer {key.get_secret_value()}"},
            timeout=TIMEOUT_SECONDS,
        )
    except httpx.HTTPError:
        logger.warning("revenuecat subscriber read failed")
        return None
    if r.status_code != 200:
        logger.warning(
            "revenuecat subscriber read refused", extra={"status": r.status_code}
        )
        return None
    try:
        body = r.json()
    except ValueError:
        return None
    return body if isinstance(body, dict) else None
