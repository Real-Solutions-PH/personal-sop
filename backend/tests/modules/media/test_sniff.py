import pytest

from app.modules.media.sniff import accepts, sniff

JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 40
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40
HEIC = b"\x00\x00\x00\x18ftypheic" + b"\x00" * 40
MP4 = b"\x00\x00\x00\x20ftypisom" + b"\x00" * 40
MOV = b"\x00\x00\x00\x14ftypqt  " + b"\x00" * 40
M4A = b"\x00\x00\x00\x1cftypM4A " + b"\x00" * 40
PDF = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3"
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 "
WAV = b"RIFF\x24\x00\x00\x00WAVEfmt "
CSV = b"Date,Description,Amount\n2026-10-01,GRAB,120.00\n"


@pytest.mark.parametrize(
    ("head", "mime"),
    [
        (JPEG, "image/jpeg"),
        (PNG, "image/png"),
        (HEIC, "image/heic"),
        (MP4, "video/mp4"),
        (MOV, "video/quicktime"),
        (M4A, "audio/mp4"),
        (PDF, "application/pdf"),
        (WEBP, "image/webp"),
        (WAV, "audio/wav"),
        (CSV, "text/csv"),
        (b"ID3\x04\x00", "audio/mpeg"),
        (b"GIF89a\x01\x00", "image/gif"),
    ],
)
def test_sniff_known_signatures(head: bytes, mime: str) -> None:
    assert sniff(head) == mime


def test_csv_cut_mid_character_still_reads() -> None:
    text = "Payee,Amount\nCafé Ñ,120\n".encode()
    assert sniff(text[: text.index("é".encode()) + 1]) == "text/csv"


@pytest.mark.parametrize(
    "head", [b"", b"just some words", b"\x00\x01\x02binary,", b"<html>,</html>\x00"]
)
def test_unknown_bytes_prove_nothing(head: bytes) -> None:
    assert sniff(head) is None


def test_accepts_checks_the_kind_allowlist() -> None:
    assert accepts("image", "image/jpeg")
    assert not accepts("image", "application/pdf")
    assert accepts("file", "application/pdf")
    assert not accepts("video", None)
    assert not accepts("bogus", "image/png")
