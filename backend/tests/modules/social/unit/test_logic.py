"""Pure social rules. Expected values are hand-read from the prototype
(``mobile/src/prototype/social/{store,feed,explore}.ts(x)``) and its seed, not
produced by the code under test."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.modules.social import logic

T0 = datetime(2026, 10, 18, 4, 0, tzinfo=UTC)
A = uuid.UUID("00000000-0000-4000-8000-00000000000a")
B = uuid.UUID("00000000-0000-4000-8000-00000000000b")
C = uuid.UUID("00000000-0000-4000-8000-00000000000c")


# ---------------------------------------------------------------- tags


@pytest.mark.parametrize(
    ("caption", "tags"),
    [
        # Seed post p1's caption.
        (
            "New squat PR 🎉 140kg finally moved. Twelve weeks of boring 5x5 "
            "paid off. #legday #progress",
            ["legday", "progress"],
        ),
        ("#LegDay and #legday again", ["legday"]),
        ("no tags here", []),
        ("#", []),
        ("mid#word counts too #ok", ["word", "ok"]),
        ("#día_uno #2026", ["día_uno", "2026"]),
        ("#a,#b.#c", ["a", "b", "c"]),
        ("", []),
    ],
)
def test_parse_tags(caption: str, tags: list[str]) -> None:
    assert logic.parse_tags(caption) == tags


def test_parse_tags_caps_count_and_length() -> None:
    caption = " ".join(f"#t{i}" for i in range(40))
    assert len(logic.parse_tags(caption)) == logic.MAX_TAGS
    assert logic.parse_tags("#" + "x" * 80) == ["x" * logic.MAX_TAG_LEN]


@pytest.mark.parametrize(
    ("query", "tag"),
    [
        ("#LegDay", "legday"),
        ("legday", "legday"),
        ("  #progress ", "progress"),
        ("#", None),
        ("", None),
        ("##", None),
    ],
)
def test_normalize_tag(query: str, tag: str | None) -> None:
    assert logic.normalize_tag(query) == tag


# ---------------------------------------------------------------- mentions


@pytest.mark.parametrize(
    ("text", "handles"),
    [
        # Seed comment c2 replies to Marco by handle.
        ("@marcoruns 145 first, then we talk 😅", ["marcoruns"]),
        ("thanks @Ana.Lifts!", ["ana.lifts"]),
        ("see you @bea.eats.clean.", ["bea.eats.clean"]),
        ("mail me at kim@example.com", []),
        ("@josh @josh @JOSH", ["josh"]),
        ("@@x and @_y", ["_y"]),
        ("@", []),
        ("@.", []),
    ],
)
def test_parse_mentions(text: str, handles: list[str]) -> None:
    assert logic.parse_mentions(text) == handles


def test_parse_mentions_caps_count() -> None:
    text = " ".join(f"@u{i}" for i in range(30))
    assert len(logic.parse_mentions(text)) == logic.MAX_MENTIONS


def test_normalize_handle() -> None:
    assert logic.normalize_handle("@Ana.Lifts ") == "ana.lifts"
    assert logic.normalize_handle(None) == ""


# ---------------------------------------------------------------- direct key


def test_direct_key_is_order_independent() -> None:
    assert logic.direct_key(A, B) == logic.direct_key(B, A)
    assert logic.direct_key(A, B) == f"{A}:{B}"
    assert logic.direct_key(A, C) != logic.direct_key(B, C)


def test_direct_key_fits_the_column() -> None:
    # chat.direct_key is VARCHAR(80).
    assert len(logic.direct_key(uuid.uuid4(), uuid.uuid4())) <= 80


def test_direct_key_refuses_self() -> None:
    with pytest.raises(ValueError):
        logic.direct_key(A, A)


# ---------------------------------------------------------------- ranking


def _post(n: int, *, minutes_ago: int) -> logic.Rankable:
    return logic.Rankable(
        id=uuid.UUID(int=n), created_at=T0 - timedelta(minutes=minutes_ago)
    )


def test_everyone_tab_is_newest_first() -> None:
    # Hand-read: 10 min, 42 min, 3 h, 6 h ago. Cheers never reorder it.
    p1 = _post(1, minutes_ago=42)
    p2 = _post(2, minutes_ago=180)
    p3 = _post(3, minutes_ago=360)
    p4 = _post(4, minutes_ago=10)
    assert [p.id for p in logic.rank_for_you([p1, p2, p3, p4])] == [
        p4.id,
        p1.id,
        p2.id,
        p3.id,
    ]


def test_everyone_tab_breaks_time_ties_by_id() -> None:
    twin_b = _post(4, minutes_ago=30)
    twin_a = _post(3, minutes_ago=30)
    ranked = logic.rank_for_you([twin_b, twin_a])
    assert [p.id for p in ranked] == [twin_a.id, twin_b.id]


def test_for_you_of_nothing() -> None:
    assert logic.rank_for_you([]) == []


# ---------------------------------------------------------------- story tray


def test_tray_order_is_me_then_unseen_then_latest() -> None:
    me = uuid.UUID(int=99)
    groups = [
        logic.TrayGroup(owner_id=A, unseen=False, latest=T0),
        logic.TrayGroup(owner_id=B, unseen=True, latest=T0 - timedelta(hours=5)),
        logic.TrayGroup(owner_id=me, unseen=False, latest=T0 - timedelta(hours=9)),
        logic.TrayGroup(owner_id=C, unseen=True, latest=T0 - timedelta(hours=1)),
    ]
    assert [g.owner_id for g in logic.order_tray(groups, me=me)] == [me, C, B, A]


# ---------------------------------------------------------------- cursor


def test_cursor_round_trip() -> None:
    at = T0 + timedelta(microseconds=123)
    assert logic.decode_cursor(logic.encode_cursor(at, A)) == (at, A)


@pytest.mark.parametrize("bad", ["", "nope", "!!!", "MjAyNi0xMC0xOA", "Zm9vfGJhcg"])
def test_cursor_rejects_garbage(bad: str) -> None:
    assert logic.decode_cursor(bad) is None


def test_cursor_rejects_naive_time() -> None:
    import base64

    raw = base64.urlsafe_b64encode(f"2026-10-18T04:00:00|{A}".encode()).decode()
    assert logic.decode_cursor(raw) is None


# ---------------------------------------------------------------- previews


@pytest.mark.parametrize(
    ("kw", "preview"),
    [
        ({"text": "hi"}, "hi"),
        ({"text": None, "has_media": True}, "Sent a photo"),
        ({"text": "", "has_post": True}, "Shared a post"),
        ({"text": None, "has_story": True}, "Replied to your story"),
        ({"text": None}, "New message"),
    ],
)
def test_message_preview(kw: dict[str, object], preview: str) -> None:
    args: dict[str, object] = {
        "text": None,
        "has_media": False,
        "has_post": False,
        "has_story": False,
    }
    args.update(kw)
    assert logic.message_preview(**args) == preview  # type: ignore[arg-type]


def test_message_preview_clips_long_text() -> None:
    out = logic.message_preview(
        text="x" * 500, has_media=False, has_post=False, has_story=False
    )
    assert len(out) == 120 and out.endswith("…")
