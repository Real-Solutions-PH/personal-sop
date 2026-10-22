"""Web search for Fern (Brave Search API): the one network seam the
``web_search`` tool goes through, so tests substitute this function only."""

import re
from typing import Any

import httpx

from app.core.config import settings

BRAVE_URL = "https://api.search.brave.com/res/v1/web/search"
_TAGS = re.compile(r"<[^>]+>")


class WebSearchError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def available() -> bool:
    return bool(settings.BRAVE_API_KEY)


def search(query: str, *, count: int = 5) -> list[dict[str, Any]]:
    """Top web results for ``query``: title, url and a plain-text snippet."""
    if not settings.BRAVE_API_KEY:
        raise WebSearchError("web_search_unavailable")
    try:
        with httpx.Client(timeout=12, trust_env=False) as c:
            r = c.get(
                BRAVE_URL,
                params={"q": query, "count": count, "safesearch": "moderate"},
                headers={
                    "Accept": "application/json",
                    "X-Subscription-Token": settings.BRAVE_API_KEY,
                },
            )
    except httpx.HTTPError:
        raise WebSearchError("web_search_unreachable") from None
    if r.status_code != 200:
        raise WebSearchError("web_search_failed")
    try:
        rows = r.json().get("web", {}).get("results", [])
    except ValueError:
        raise WebSearchError("web_search_failed") from None
    out = []
    for row in rows[:count]:
        snippet = " ".join(
            _TAGS.sub("", str(x))
            for x in [row.get("description", "")]
            + (row.get("extra_snippets") or [])[:2]
        )
        out.append(
            {
                "title": _TAGS.sub("", str(row.get("title", "")))[:200],
                "url": str(row.get("url", ""))[:500],
                "snippet": snippet[:700],
            }
        )
    return out
