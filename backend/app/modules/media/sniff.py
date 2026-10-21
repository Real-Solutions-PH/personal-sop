"""Decide a file's type from its first bytes, never from the client's claim.

``sniff`` returns the MIME type the bytes prove, or ``None``. An upload is
accepted only when that type is in the declared kind's allowlist; the
client-declared ``mime`` is recorded but not trusted.
"""

from typing import Literal

Kind = Literal["image", "video", "audio", "file"]

ALLOWED: dict[str, frozenset[str]] = {
    "image": frozenset(
        {"image/jpeg", "image/png", "image/webp", "image/heic", "image/gif"}
    ),
    "video": frozenset({"video/mp4", "video/quicktime"}),
    "audio": frozenset(
        {"audio/mp4", "audio/mpeg", "audio/wav", "audio/webm", "audio/aac"}
    ),
    "file": frozenset({"application/pdf", "text/csv", "image/jpeg", "image/png"}),
}

HEAD_BYTES = 64


def _ftyp_brand(head: bytes) -> bytes | None:
    if len(head) >= 12 and head[4:8] == b"ftyp":
        return head[8:12]
    return None


def sniff(head: bytes) -> str | None:  # noqa: PLR0911 - a table of signatures
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return "image/webp"
    if head.startswith(b"RIFF") and head[8:12] == b"WAVE":
        return "audio/wav"
    if head.startswith(b"%PDF-"):
        return "application/pdf"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "audio/webm"
    if head.startswith(b"ID3") or head[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return "audio/mpeg"
    if head[:2] in (b"\xff\xf1", b"\xff\xf9"):
        return "audio/aac"
    brand = _ftyp_brand(head)
    if brand is not None:
        if brand in (b"heic", b"heix", b"mif1", b"msf1", b"heim", b"heis"):
            return "image/heic"
        if brand in (b"M4A ", b"M4B "):
            return "audio/mp4"
        if brand == b"qt  ":
            return "video/quicktime"
        return "video/mp4"
    if _looks_like_csv(head):
        return "text/csv"
    return None


def _looks_like_csv(head: bytes) -> bool:
    """Printable UTF-8 text with a delimiter. The 64-byte window may cut a
    multi-byte character, so up to three trailing bytes may be dropped."""
    if not head or b"\x00" in head:
        return False
    for cut in range(4):
        try:
            text = head[: len(head) - cut].decode("utf-8")
            break
        except UnicodeDecodeError:
            continue
    else:
        return False
    has_delimiter = any(d in text for d in (",", ";", "\t"))
    return has_delimiter and all(c.isprintable() or c in "\r\n\t" for c in text)


def accepts(kind: str, proven: str | None) -> bool:
    return proven is not None and proven in ALLOWED.get(kind, frozenset())
