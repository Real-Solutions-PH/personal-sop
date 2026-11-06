"""The public share page of a post, served at ``/share/p/{post_id}``.

A link shared out of Community is pasted into Messenger, X, Facebook and the
like. Their link-preview crawlers carry no token and do not follow custom
URL schemes, so the link points here: a small HTML page with Open Graph and
Twitter tags (who posted, the caption, the first photo) and a button that
opens the post in the app.

What the page shows, decided 2026-11-06: the author's display name, the
caption and the first photo of a live post. The share message already
carries the caption, and the post id is an unguessable UUID, so the page is
a capability link like any public post URL. A deleted or unknown post is a
plain 404 that names nothing. Kept out of the OpenAPI schema: it is a page,
not an API.
"""

import html
import uuid

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from sqlalchemy import and_
from sqlmodel import Session, col, select

from app.core.config import settings
from app.modules.iam.users.models import User
from app.modules.media import public as media
from app.modules.media.models import MediaObject
from app.modules.profile.models import UserProfile
from app.modules.social.models import Post, PostMedia
from app.shared.deps import SessionDep

# A tag: the app names every operation "<tag>-<name>" (custom_generate_unique_id).
router = APIRouter(tags=["share"], include_in_schema=False)

# The app's URL scheme (mobile/app.json ``scheme``) and its post route.
APP_POST_URL = "personalsop://social/post/{id}"
SITE_NAME = "Unfurl"
DESCRIPTION_MAX = 200

# The page has no script; only its own inline style and https images load.
CSP = (
    "default-src 'none'; style-src 'unsafe-inline'; img-src https:; "
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)


def public_origin(request: Request) -> str:
    """Origin a pasted link is reached on. ``PUBLIC_API_URL`` when set;
    otherwise the request's own host, over https outside local (behind the
    tunnel the API itself is spoken to over plain http)."""
    if settings.PUBLIC_API_URL:
        return settings.PUBLIC_API_URL.rstrip("/")
    if settings.ENVIRONMENT == "local":
        return str(request.base_url).rstrip("/")
    return f"https://{request.url.netloc}"


def _clip(text: str) -> str:
    one_line = " ".join(text.split())
    if len(one_line) <= DESCRIPTION_MAX:
        return one_line
    return one_line[: DESCRIPTION_MAX - 1].rstrip() + "…"


def _page(
    *,
    title: str,
    description: str,
    url: str,
    image: str | None,
    app_url: str | None,
    status: int,
) -> HTMLResponse:
    e = html.escape
    tags = [
        ("property", "og:site_name", SITE_NAME),
        ("property", "og:type", "article"),
        ("property", "og:title", title),
        ("property", "og:description", description),
        ("property", "og:url", url),
        ("name", "twitter:card", "summary_large_image" if image else "summary"),
        ("name", "twitter:title", title),
        ("name", "twitter:description", description),
        ("name", "description", description),
    ]
    if image:
        tags += [("property", "og:image", image), ("name", "twitter:image", image)]
    meta = "\n".join(
        f'<meta {kind}="{e(key)}" content="{e(value)}">' for kind, key, value in tags
    )
    figure = f'<img src="{e(image)}" alt="">' if image else ""
    button = (
        f'<a class="open" href="{e(app_url)}">Open in Unfurl</a>' if app_url else ""
    )
    body = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
{meta}
<link rel="canonical" href="{e(url)}">
<style>
body{{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#f6f4ee;color:#1d2b22}}
main{{max-width:480px;margin:0 auto;padding:32px 16px;display:flex;flex-direction:column;gap:16px}}
img{{width:100%;border-radius:16px}}
h1{{font-size:20px;margin:0}}
p{{font-size:16px;line-height:1.5;margin:0;white-space:pre-wrap}}
.open{{display:block;text-align:center;padding:14px;border-radius:12px;background:#2f6b4f;color:#fff;font-weight:600;text-decoration:none}}
@media (prefers-color-scheme:dark){{body{{background:#121a15;color:#e8efe9}}}}
</style>
</head>
<body>
<main>
{figure}
<h1>{e(title)}</h1>
<p>{e(description)}</p>
{button}
</main>
</body>
</html>
"""
    return HTMLResponse(
        body, status_code=status, headers={"Content-Security-Policy": CSP}
    )


def _not_found(url: str) -> HTMLResponse:
    return _page(
        title=SITE_NAME,
        description="This post isn't available. It may have been deleted.",
        url=url,
        image=None,
        app_url=None,
        status=404,
    )


def _first_photo(session: Session, post_id: uuid.UUID) -> str | None:
    """A presigned URL of the post's first photo: its 640-edge preview when it
    has one. Short-lived, which is enough: a crawler fetches the image right
    after the page and keeps its own copy."""
    row = session.exec(
        select(MediaObject)
        .join(PostMedia, col(PostMedia.media_id) == MediaObject.id)
        .where(
            col(PostMedia.post_id) == post_id,
            col(PostMedia.deleted_at).is_(None),
            col(PostMedia.kind) == "image",
            col(MediaObject.state) == "ready",
            col(MediaObject.deleted_at).is_(None),
        )
        .order_by(col(PostMedia.position))
        .limit(1)
    ).first()
    if row is None:
        return None
    if row.preview_id is not None:
        preview = session.get(MediaObject, row.preview_id)
        if preview is not None and preview.state == "ready":
            row = preview
    return media.download_url(row)


@router.get("/share/p/{post_id}", response_class=HTMLResponse)
def share_post(post_id: str, request: Request, session: SessionDep) -> HTMLResponse:
    try:
        pid = uuid.UUID(post_id)
    except ValueError:
        return _not_found(f"{public_origin(request)}/share/p/")
    url = f"{public_origin(request)}/share/p/{pid}"
    found = session.exec(
        select(Post, User, UserProfile)
        .join(User, col(User.id) == Post.owner_id)
        .join(
            UserProfile,
            and_(
                col(UserProfile.owner_id) == User.id,
                col(UserProfile.deleted_at).is_(None),
            ),
            isouter=True,
        )
        .where(col(Post.id) == pid, col(Post.deleted_at).is_(None))
    ).first()
    if found is None:
        return _not_found(url)
    post, user, profile = found
    name = (profile.name if profile else "") or user.full_name or "Someone"
    return _page(
        title=f"{name} on {SITE_NAME}",
        description=_clip(post.caption) or f"Progress shared on {SITE_NAME}",
        url=url,
        image=_first_photo(session, pid),
        app_url=APP_POST_URL.format(id=pid),
        status=200,
    )
