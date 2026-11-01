"""A reply's text, shaped for the chat: lists kept, tables lifted out.

Fern used to be held to three sentences of plain text, with every list
marker stripped after the fact, so "wants exact gram portions" could never
take effect. Now the model may write lists and tables when the content has
several items. The chat draws a message's text as plain text (no markdown
renderer there), so:

- bullet and numbered lists stay, as "• item" and "1. item", which read
  well as plain text;
- a markdown table becomes a ``table`` block the chat draws as a table,
  and leaves the text;
- emphasis marks, heading marks and code ticks go (words stay).

:func:`shape` is pure.
"""

import re
from typing import Any

_EMPHASIS = [
    (re.compile(r"\*\*(.+?)\*\*", re.S), r"\1"),
    (re.compile(r"__(.+?)__", re.S), r"\1"),
    (re.compile(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])"), r"\1"),
    (re.compile(r"`([^`]*)`"), r"\1"),
]
_HEADING = re.compile(r"^[ \t]{0,3}#{1,6}[ \t]+", re.M)
_BULLET = re.compile(r"^([ \t]*)[-*+•][ \t]+", re.M)
_NUMBERED = re.compile(r"^([ \t]*)(\d+)[.)][ \t]+", re.M)
_TABLE_ROW = re.compile(r"^\s*\|?.*\|.*\|?\s*$")
_TABLE_RULE = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")
MAX_COLUMNS = 6
MAX_ROWS = 20


def _cells(line: str) -> list[str]:
    s = line.strip()
    s = s[1:] if s.startswith("|") else s
    s = s[:-1] if s.endswith("|") else s
    return [c.strip() for c in s.split("|")]


def _clean(s: str) -> str:
    for rx, sub in _EMPHASIS:
        s = rx.sub(sub, s)
    return s


def _tables(text: str) -> tuple[str, list[dict[str, Any]]]:
    """Markdown tables (a header, a --- rule, rows) out of ``text``, each
    as a table block; a table too wide for a phone stays as text."""
    lines = text.split("\n")
    out: list[str] = []
    blocks: list[dict[str, Any]] = []
    i = 0
    while i < len(lines):
        if i + 1 < len(lines) and "|" in lines[i] and _TABLE_RULE.match(lines[i + 1]):
            head = [_clean(c) for c in _cells(lines[i])]
            j = i + 2
            rows: list[list[str]] = []
            while j < len(lines) and "|" in lines[j] and _TABLE_ROW.match(lines[j]):
                cells = [_clean(c) for c in _cells(lines[j])]
                rows.append((cells + [""] * len(head))[: len(head)])
                j += 1
            if 1 < len(head) <= MAX_COLUMNS and rows:
                blocks.append({"t": "table", "columns": head, "rows": rows[:MAX_ROWS]})
                i = j
                continue
        out.append(lines[i])
        i += 1
    return "\n".join(out), blocks


def shape(text: str) -> tuple[str, list[dict[str, Any]]]:
    """The reply text as the chat shows it, and the table blocks lifted
    out of it (in order)."""
    text, blocks = _tables(text)
    text = _HEADING.sub("", text)
    for rx, sub in _EMPHASIS:
        text = rx.sub(sub, text)
    text = _BULLET.sub(lambda m: f"{m.group(1)}• ", text)
    text = _NUMBERED.sub(lambda m: f"{m.group(1)}{m.group(2)}. ", text)
    text = re.sub(r"[ \t]+$", "", text, flags=re.M)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip(), blocks


def stream_piece(delta: str) -> str:
    """A streamed piece without emphasis marks or code ticks; the stored
    reply goes through :func:`shape` and replaces the streamed one."""
    return delta.replace("**", "").replace("`", "")
