"""The public share page of a post: what a link pasted into Messenger, X or
Facebook unfurls into (Open Graph and Twitter tags), and the way back into
the app. No sign-in: link-preview crawlers carry no token."""

import re
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.modules.media.models import MediaObject
from tests.modules.social.api.conftest import Trio
from tests.modules.social.api.helpers import API, ok
from tests.modules.social.api.test_feed_media import _photo


def _meta(html: str) -> dict[str, str]:
    """``property``/``name`` → ``content`` of every ``<meta>`` tag."""
    return {
        m.group(1): m.group(2)
        for m in re.finditer(
            r'<meta (?:property|name)="([^"]+)" content="([^"]*)"', html
        )
    }


def _post(client: TestClient, headers: dict[str, str], **body: Any) -> str:
    post: dict[str, Any] = ok(client.post(f"{API}/posts", headers=headers, json=body))
    return str(post["id"])


def test_share_page_unfurls_without_sign_in(client: TestClient, trio: Trio) -> None:
    pid = _post(client, trio.ana.headers, caption='Squat PR <140kg> & "more"')
    r = client.get(f"/share/p/{pid}")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/html")
    meta = _meta(r.text)
    assert meta["og:title"] == "Ana on Unfurl"
    # The caption is escaped, never raw HTML.
    assert meta["og:description"] == "Squat PR &lt;140kg&gt; &amp; &quot;more&quot;"
    assert "<140kg>" not in r.text
    assert meta["og:url"].endswith(f"/share/p/{pid}")
    assert meta["og:url"].startswith("http")
    assert meta["og:type"] == "article"
    assert meta["og:site_name"] == "Unfurl"
    assert meta["twitter:card"] == "summary"
    assert "og:image" not in meta
    # The page opens the post in the app.
    assert f'href="personalsop://social/post/{pid}"' in r.text


def test_share_page_carries_the_first_photo(
    client: TestClient, db: Session, trio: Trio
) -> None:
    photo = _photo(db, trio.ana)
    pid = _post(
        client,
        trio.ana.headers,
        caption="Leg day",
        media=[{"media_id": str(photo.id), "kind": "image", "ratio": 1.33}],
    )
    meta = _meta(client.get(f"/share/p/{pid}").text)
    assert meta["twitter:card"] == "summary_large_image"
    assert meta["og:image"].startswith("http")
    # The 640-edge preview, not the full-size original.
    assert photo.preview_id is not None
    preview = db.get(MediaObject, photo.preview_id)
    assert preview is not None
    assert preview.storage_key in meta["og:image"]
    assert photo.storage_key not in meta["og:image"]


def test_share_page_of_a_deleted_or_unknown_post_is_a_plain_404(
    client: TestClient, trio: Trio
) -> None:
    pid = _post(client, trio.ana.headers, caption="secret caption")
    ok(client.delete(f"{API}/posts/{pid}", headers=trio.ana.headers), 204)
    for path in (f"/share/p/{pid}", f"/share/p/{uuid.uuid4()}", "/share/p/nope"):
        r = client.get(path)
        assert r.status_code == 404, path
        assert r.headers["content-type"].startswith("text/html")
        assert "secret caption" not in r.text
        assert _meta(r.text)["og:title"] == "Unfurl"


def test_share_page_sets_its_own_content_security_policy(
    client: TestClient, trio: Trio
) -> None:
    pid = _post(client, trio.ana.headers, caption="hi")
    csp = client.get(f"/share/p/{pid}").headers["content-security-policy"]
    assert "script-src" not in csp or "'none'" in csp
    assert "default-src 'none'" in csp
    assert "style-src 'unsafe-inline'" in csp


def test_share_links_are_https_on_the_public_host_outside_local(
    client: TestClient, trio: Trio, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Behind the tunnel the API is spoken to over plain http; the link a
    crawler is handed must still be the https one people paste."""
    pid = _post(client, trio.ana.headers, caption="hi")
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "PUBLIC_API_URL", None)
    meta = _meta(
        client.get(f"/share/p/{pid}", headers={"host": "api.example.com"}).text
    )
    assert meta["og:url"] == f"https://api.example.com/share/p/{pid}"
    monkeypatch.setattr(settings, "PUBLIC_API_URL", "https://share.example.com/")
    meta = _meta(client.get(f"/share/p/{pid}").text)
    assert meta["og:url"] == f"https://share.example.com/share/p/{pid}"
