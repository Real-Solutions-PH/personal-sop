"""Synthesise the clips: every corpus sentence in four Deepgram Aura-2 voices
and three macOS voices (US, Indian and British English), as 16 kHz mono WAV,
plus a copy of every clip with low-passed noise at about 12 dB SNR.

usage: DEEPGRAM_API_KEY=... python gen.py OUT_DIR      (macOS: needs `say`)

Synthetic speech is cleaner and more uniform than a person; Aura voices come
from the same vendor as one candidate, which may flatter it. Read the
results as a ranking, not as the error rate a real person will see.
"""

# ruff: noqa: T201  (a command-line tool: it prints its results)

import os
import subprocess
import sys
import wave
import zlib
from concurrent.futures import ThreadPoolExecutor

import httpx
import numpy as np
from corpus import CORPUS

AURA = ["thalia", "apollo", "andromeda", "arcas"]
SAY = ["Samantha", "Aman", "Daniel"]


def aura(out: str, voice: str, uid: str, text: str) -> str:
    p = f"{out}/{uid}__{voice}.wav"
    if os.path.exists(p):
        return p
    r = httpx.post(
        "https://api.deepgram.com/v1/speak",
        params={
            "model": f"aura-2-{voice}-en",
            "encoding": "linear16",
            "sample_rate": 16000,
            "container": "wav",
        },
        headers={"Authorization": f"Token {os.environ['DEEPGRAM_API_KEY']}"},
        json={"text": text},
        timeout=60,
        trust_env=False,
    )
    r.raise_for_status()
    with open(p, "wb") as f:
        f.write(r.content)
    return p


def say(out: str, voice: str, uid: str, text: str) -> str:
    p = f"{out}/{uid}__{voice.lower()}.wav"
    if os.path.exists(p):
        return p
    aiff = p + ".aiff"
    subprocess.run(["say", "-v", voice, "-o", aiff, text], check=True)
    subprocess.run(
        ["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, p],
        check=True,
    )
    os.remove(aiff)
    return p


def noisy(p: str) -> str:
    q = p.replace(".wav", "__noisy.wav")
    if os.path.exists(q):
        return q
    with wave.open(p) as w:
        sr, n = w.getframerate(), w.getnframes()
        x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32)
    rng = np.random.default_rng(zlib.crc32(os.path.basename(p).encode()))
    white = rng.standard_normal(len(x)).astype(np.float32)
    pink = np.convolve(white, np.ones(8) / 8, mode="same")  # crude low-pass
    sig = np.sqrt(np.mean(x[np.abs(x) > 200] ** 2) + 1e-9)
    pink *= sig / (np.sqrt(np.mean(pink**2)) * 10 ** (12 / 20))
    y = np.clip(x + pink, -32768, 32767).astype(np.int16)
    with wave.open(q, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(y.tobytes())
    return q


def main(out: str) -> None:
    os.makedirs(out, exist_ok=True)
    jobs = [(aura, v, u, t) for u, _, t, _ in CORPUS for v in AURA]
    jobs += [(say, v, u, t) for u, _, t, _ in CORPUS for v in SAY]
    with ThreadPoolExecutor(8) as ex:
        paths = list(ex.map(lambda j: j[0](out, *j[1:]), jobs))
    for p in paths:
        noisy(p)
    print(len(paths), "clean clips +", len(paths), "noisy in", out)


if __name__ == "__main__":
    main(sys.argv[1])
