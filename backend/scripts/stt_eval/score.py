"""Word error rate and key-term hits against the corpus.

Both sides are normalised before comparing (case, punctuation, "₱600,000" vs
"600000 pesos", "ten" vs "10", "kgs" vs "kilos"...), so formatting choices
are not counted as errors; a misheard word is.

usage: python score.py RESULTS_DIR [NAME ...]   (one row per results file)
"""

# ruff: noqa: T201  (a command-line tool: it prints its results)

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from corpus import CORPUS

SMALL = (
    "zero one two three four five six seven eight nine ten eleven twelve "
    "thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty"
).split()
TRUTH = {u: (cat, text, keys) for u, cat, text, keys in CORPUS}


def norm(s: str) -> str:
    s = s.lower().replace("’", "'")
    s = re.sub(r"₱\s?([\d,.]+)", r"\1 pesos", s)
    s = re.sub(r"\bphp\s?([\d,.]+)", r"\1 pesos", s)
    s = re.sub(r"\$\s?([\d,.]+)", r"\1 dollars", s)
    s = re.sub(r"(\d),(?=\d{3})", r"\1", s)
    s = re.sub(r"(\d)\.(?!\d)", r"\1", s)  # sentence-final period after a number
    s = s.replace("m²", " square meter").replace("sq m", "square meter")
    s = re.sub(r"\bp\.?\s?m\.?(?=\W|$)", "pm", s)
    s = re.sub(r"\ba\.?\s?m\.?(?=\W|$)", "am", s)
    s = re.sub(r"(\d)\s?(k)\b", r"\1k", s)
    s = re.sub(r"(\d)\s?ml\b", r"\1 ml", s)
    s = re.sub(r"(\d)\s?(g|grams?)\b", r"\1 grams", s)
    s = re.sub(r"\bmilliliters?\b", "ml", s)
    s = re.sub(r"\b(kilos?|kilograms?|kgs?)\b", "kilos", s)
    s = re.sub(r"(\d)\s?(kilos)", r"\1 kilos", s)
    s = s.replace("'s", "s").replace("-", " ")
    s = re.sub(r"[^\w\s.]", " ", s)
    s = re.sub(r"(?<!\d)\.|\.(?!\d)", " ", s)
    words = [str(SMALL.index(w)) if w in SMALL else w for w in s.split()]
    return " ".join(words)


def wer(ref: str, hyp: str) -> tuple[int, int]:
    """(word edits, reference words)."""
    r, h = norm(ref).split(), norm(hyp).split()
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev = cur
    return d[len(h)], len(r)


def key_hits(uid: str, hyp: str) -> tuple[int, int]:
    """(key terms found in the transcript, key terms)."""
    h = " " + norm(hyp) + " "
    keys = TRUTH[uid][2]
    found = sum(
        (" " + norm(k) + " ") in h or norm(k).replace(" ", "") in h.replace(" ", "")
        for k in keys
    )
    return found, len(keys)


def clip_id(path: str) -> tuple[str, str, bool]:
    """(sentence id, voice, noisy) from a clip's file name."""
    base = Path(path).stem
    parts = base.split("__")
    return parts[0], parts[1], len(parts) > 2


def summarise(rows: list[dict]) -> dict[str, tuple[float, float, int]]:
    """{group: (WER %, key-term hit %, clips)} for all, each category, clean/noisy."""
    agg: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0, 0, 0])
    for row in rows:
        uid, _, is_noisy = clip_id(row["file"])
        e, n = wer(TRUTH[uid][1], row["hyp"])
        k, kn = key_hits(uid, row["hyp"])
        for g in ("all", TRUTH[uid][0], "noisy" if is_noisy else "clean"):
            a = agg[g]
            a[0] += e
            a[1] += n
            a[2] += k
            a[3] += kn
            a[4] += 1
    return {g: (100 * a[0] / a[1], 100 * a[2] / a[3], a[4]) for g, a in agg.items()}


def load(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def main(results: str, names: list[str]) -> None:
    files = sorted(Path(results).glob("*.jsonl"))
    if names:
        files = [f for f in files if f.stem in names]
    cols = ["all", "clean", "noisy", "real", "taglish", "food", "money"]
    print(f"{'config':34} " + " ".join(f"{c:>13}" for c in cols) + "   s/clip  $/min")
    for f in files:
        rows = load(f)
        s = summarise(rows)
        cells = " ".join(
            f"{s[c][0]:5.1f}% {s[c][1]:4.0f}%" if c in s else " " * 13 for c in cols
        )
        ms = sorted(r.get("ms", 0) for r in rows)
        p50 = ms[len(ms) // 2] / 1000 if ms else 0
        secs = sum(r.get("seconds", 0) for r in rows)
        usd = sum(r.get("usd", 0) for r in rows)
        rate = f"{usd / secs * 60:.4f}" if secs and usd else "   -  "
        print(f"{f.stem:34} {cells}   {p50:5.1f}  {rate}")
    print("cells: WER %, key terms kept %")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
