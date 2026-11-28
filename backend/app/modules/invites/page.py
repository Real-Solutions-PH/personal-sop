"""The page an invite link opens: ``/i/{token}`` on the API host.

It reads nothing from the database, so a link (live or dead) tells someone
who merely holds it nothing about what it invites to. It hands the token to
the app through the app's URL scheme (``personalsop://invite/<token>``,
``mobile/app.json``): a zero-second meta refresh asks the browser to open the
app, and the button does the same for a browser that held the refresh back.
Without the app installed nothing opens and the page explains what to do.

A Universal Link / App Link (the https URL opening the app with no browser
step) needs the associated-domains entitlement and an Android intent filter
in a native build; until then this page is the bridge. Kept out of the
OpenAPI schema: it is a page, not an API.
"""

import html
import re

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from app.modules.social.share import CSP, OPEN_ICON, SITE_NAME
from app.modules.social.share import public_origin as _origin

router = APIRouter(tags=["invites"], include_in_schema=False)

APP_INVITE_URL = "personalsop://invite/{token}"
# What ``services.new_token`` makes: URL-safe base64, 32 characters.
TOKEN = re.compile(r"[A-Za-z0-9_-]{16,64}")


def public_origin(request: Request) -> str:
    return _origin(request)


def _page(*, app_url: str | None, status: int) -> HTMLResponse:
    e = html.escape
    refresh = (
        f'<meta http-equiv="refresh" content="0;url={e(app_url)}">' if app_url else ""
    )
    button = (
        f'<a class="open" href="{e(app_url)}">{OPEN_ICON}Open in Unfurl</a>'
        if app_url
        else ""
    )
    lead = (
        "Someone invited you to join them on Unfurl."
        if app_url
        else "This invite link isn't complete. Ask for a new one."
    )
    help_text = (
        '<p class="muted">Nothing happened? Install Unfurl on this phone, '
        "sign in, then open this link again.</p>"
        if app_url
        else ""
    )
    body = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>Invite · {SITE_NAME}</title>
{refresh}
<style>
body{{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#f6f4ee;color:#1d2b22}}
main{{max-width:480px;margin:0 auto;padding:48px 16px;display:flex;flex-direction:column;gap:16px}}
h1{{font-size:22px;margin:0}}
p{{font-size:16px;line-height:1.5;margin:0}}
.muted{{opacity:.7;font-size:14px}}
.open{{display:flex;align-items:center;justify-content:center;gap:8px;padding:14px;border-radius:12px;background:#2f6b4f;color:#fff;font-weight:600;text-decoration:none}}
@media (prefers-color-scheme:dark){{body{{background:#121a15;color:#e8efe9}}}}
</style>
</head>
<body>
<main>
<h1>You're invited</h1>
<p>{lead}</p>
{button}
{help_text}
</main>
</body>
</html>
"""
    return HTMLResponse(
        body,
        status_code=status,
        headers={
            "Content-Security-Policy": CSP,
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
        },
    )


@router.get("/i/{token}", response_class=HTMLResponse)
def invite_page(token: str) -> HTMLResponse:
    if not TOKEN.fullmatch(token):
        return _page(app_url=None, status=404)
    return _page(app_url=APP_INVITE_URL.format(token=token), status=200)
