"""Transcribe every clip with one configuration; write RESULTS/NAME.jsonl.

usage (from backend/, so ``app`` imports):
  python scripts/stt_eval/run.py AUDIO RESULTS NAME KIND [ARG]

KIND:
  deepgram LANG[+kt]     the server's own ``seams.transcribe`` (LANG "tl" is
                         sent as ``multi``); "+kt" adds the key terms
                         (names.py). With OPENROUTER_API_KEY set this is
                         the shipped setup, Deepgram plus the second
                         listener; export STT_CHECK_ENABLED=false for
                         Deepgram alone.
  dgmodel MODEL:LANG     another Deepgram model, no key terms.
  audio-llm MODEL        an audio-input chat model on OpenRouter, given the
                         same names in its prompt.
  correct BASE:MODEL     a text model on OpenRouter rewrites the BASE
                         results' transcripts, given the same names.
  hybrid BASE:MODEL      an audio-input model hears the clip AND reads the
                         BASE transcript and the names.

Keys come from the environment: DEEPGRAM_API_KEY, OPENROUTER_API_KEY. Each
row records the transcript, wall time and, where the provider reports it,
the cost in USD (Deepgram: the server's own per-minute rate).
"""

# ruff: noqa: T201  (a command-line tool: it prints its results)

import base64
import json
import os
import sys
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).parent))
# The app's settings refuse to load without these; nothing here touches a
# database or a user, so placeholders do.
for _k in ("PROJECT_NAME", "POSTGRES_SERVER", "POSTGRES_USER", "FIRST_SUPERUSER"):
    os.environ.setdefault(_k, "stt-eval@example.com")
os.environ.setdefault("FIRST_SUPERUSER_PASSWORD", "stt-eval-placeholder")
from names import keyterms  # noqa: E402
from pydantic import SecretStr  # noqa: E402

from app.modules.ai_providers.public import (  # noqa: E402
    KEYTERM_USD_PER_MIN,
    STT_CHECK_USD_PER_MIN,
    USD_PER_MIN,
    ResolvedModel,
)
from app.modules.capture.seams import (  # noqa: E402
    checked,
    tidy_transcript,
    transcribe,
)

DG = "https://api.deepgram.com/v1/listen"
OR = "https://openrouter.ai/api/v1/chat/completions"

GUIDE = (
    "The speaker lives in the Philippines and talks to Fern, the assistant in "
    "a habits, food, fitness and money app. They may mix English and Tagalog "
    "(Taglish): keep each word in the language it was said in, never "
    "translate. Write numbers as digits and peso amounts as ₱ with commas "
    "(₱1,200). Names they often say: {terms}."
)
AUDIO_PROMPT = (
    "Transcribe this voice message word for word. "
    + GUIDE
    + " Reply with the transcript only."
)
CORRECT_PROMPT = (
    "A speech recogniser wrote the transcript below. Fix only words it "
    "misheard (most often names, food, brands and Tagalog words), keeping "
    "everything else exactly as written. "
    + GUIDE
    + " Reply with the corrected transcript only.\n\nTranscript: {draft}"
)
HYBRID_PROMPT = (
    "Transcribe this voice message word for word. A speech recogniser's "
    "draft is below; use it as a hint but trust the audio. "
    + GUIDE
    + " Reply with the transcript only.\n\nDraft: {draft}"
)


def _resolved() -> ResolvedModel:
    return ResolvedModel(
        purpose="transcription",
        provider="deepgram",
        model="nova-3",
        base_url="https://api.deepgram.com/v1",
        api_key=SecretStr(os.environ["DEEPGRAM_API_KEY"]),
        credential_id=None,
        supports_vision=False,
        source="server",
    )


def seconds(path: Path) -> float:
    """From the file's size, not its header: Aura's WAVs are streamed with
    the size fields left at 0xFFFFFFFF."""
    with wave.open(str(path)) as w:
        rate, width, ch = w.getframerate(), w.getsampwidth(), w.getnchannels()
    return (path.stat().st_size - 44) / (rate * width * ch)


def post(client: httpx.Client, url: str, **kw) -> httpx.Response:
    for attempt in range(5):
        r = client.post(url, **kw)
        if r.status_code == 200:
            return r
        if r.status_code not in (429, 500, 502, 503, 504):
            raise SystemExit(f"{r.status_code} {r.text[:300]}")
        time.sleep(2 * (attempt + 1))
    raise SystemExit(f"{r.status_code} after retries")


def chat(client: httpx.Client, model: str, content: list | str) -> tuple[str, float]:
    """``model`` may end in ``@EFFORT`` (e.g. ``@minimal``): the reasoning
    effort. Gemini Flash otherwise thinks at length, which cost 4x as much
    for the same words on a sample clip."""
    model, _, effort = model.partition("@")
    body: dict = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0,
        "usage": {"include": True},
    }
    if effort:
        body["reasoning"] = {"effort": effort}
    r = post(
        client,
        OR,
        headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}"},
        json=body,
    )
    d = r.json()
    text = d["choices"][0]["message"]["content"] or ""
    return text.strip(), float(d.get("usage", {}).get("cost") or 0)


def audio_part(path: Path) -> dict:
    data = base64.b64encode(path.read_bytes()).decode()
    return {"type": "input_audio", "input_audio": {"data": data, "format": "wav"}}


def main(audio: str, results: str, name: str, kind: str, arg: str = "") -> None:
    files = sorted(Path(audio).glob("*.wav"))
    terms = keyterms()
    base: dict[str, str] = {}
    if kind in ("correct", "hybrid"):
        base_name, arg = arg.split(":", 1)
        for line in (Path(results) / f"{base_name}.jsonl").read_text().splitlines():
            row = json.loads(line)
            base[Path(row["file"]).name] = row["hyp"]

    def one(path: Path) -> dict:
        secs = seconds(path)
        t = time.time()
        usd = 0.0
        with httpx.Client(timeout=120, trust_env=False) as c:
            if kind == "deepgram":
                lang, _, kt = arg.partition("+")
                hyp = transcribe(
                    _resolved(),
                    path.read_bytes(),
                    filename=path.name,
                    mime="audio/wav",
                    language=lang,
                    keyterms=terms if kt else (),
                )
                rate = USD_PER_MIN["deepgram"] + (
                    KEYTERM_USD_PER_MIN["deepgram"] if kt else 0
                )
                if checked(_resolved(), "audio/wav"):
                    rate += STT_CHECK_USD_PER_MIN
                usd = secs / 60 * rate
            elif kind == "dgmodel":
                model, lang = arg.split(":")
                r = post(
                    c,
                    DG,
                    params={"model": model, "language": lang, "smart_format": "true"},
                    headers={
                        "Authorization": f"Token {os.environ['DEEPGRAM_API_KEY']}",
                        "Content-Type": "audio/wav",
                    },
                    content=path.read_bytes(),
                )
                alt = r.json()["results"]["channels"][0]["alternatives"][0]
                hyp = tidy_transcript(alt["transcript"])
            elif kind == "audio-llm":
                prompt = AUDIO_PROMPT.format(terms=", ".join(terms))
                hyp, usd = chat(
                    c, arg, [{"type": "text", "text": prompt}, audio_part(path)]
                )
            elif kind == "correct":
                draft = base[path.name]
                prompt = CORRECT_PROMPT.format(terms=", ".join(terms), draft=draft)
                hyp, usd = chat(c, arg, prompt)
            elif kind == "hybrid":
                draft = base[path.name]
                prompt = HYBRID_PROMPT.format(terms=", ".join(terms), draft=draft)
                hyp, usd = chat(
                    c, arg, [{"type": "text", "text": prompt}, audio_part(path)]
                )
            else:
                raise SystemExit(f"unknown kind {kind}")
        return {
            "file": path.name,
            "hyp": hyp,
            "ms": int((time.time() - t) * 1000),
            "seconds": round(secs, 2),
            "usd": usd,
        }

    with ThreadPoolExecutor(8) as ex:
        rows = list(ex.map(one, files))
    os.makedirs(results, exist_ok=True)
    with open(Path(results) / f"{name}.jsonl", "w") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(name, len(rows), "clips")


if __name__ == "__main__":
    main(*sys.argv[1:])
