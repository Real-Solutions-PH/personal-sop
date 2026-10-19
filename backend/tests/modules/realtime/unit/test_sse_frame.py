"""The SSE wire format of ``GET /events/stream`` (WHATWG server-sent events:
one ``field: value`` per line, a blank line ends the event, a multi-line data
value is split into one ``data:`` line per line)."""

from app.modules.realtime.routes import sse_frame


def test_single_line_frame() -> None:
    assert sse_frame("1-0", "chat.message", '{"a":1}') == (
        'id: 1-0\nevent: chat.message\ndata: {"a":1}\n\n'
    )


def test_multi_line_data_is_split() -> None:
    assert (
        sse_frame("2-1", "x", "one\ntwo")
        == "id: 2-1\nevent: x\ndata: one\ndata: two\n\n"
    )


def test_empty_data_still_has_a_data_line() -> None:
    assert sse_frame("3-0", "ping", "") == "id: 3-0\nevent: ping\ndata: \n\n"


def test_frame_ends_with_exactly_one_blank_line() -> None:
    frame = sse_frame("4-0", "t", "{}")
    assert frame.endswith("\n\n") and not frame.endswith("\n\n\n")
