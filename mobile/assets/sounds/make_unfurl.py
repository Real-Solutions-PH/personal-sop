"""Builds unfurl.wav, the app's notification sound, from nothing but maths.

Three soft notes rising a fifth and a third (D5, A5, D6 overlaid, each
starting while the last still rings): a fern frond opening, calm rather than
urgent. Each note is a sine with a quiet octave and twelfth for a wooden,
marimba-like body, an 8 ms fade-in so nothing clicks, and an exponential
decay. Mono, 44.1 kHz, 16-bit PCM, about 1.5 s, peak at -6 dBFS, which iOS
(under 30 s, linear PCM) and Android both play as a notification sound.

Run: python3 make_unfurl.py  (standard library only; deterministic)
"""

import math
import struct
import wave

RATE = 44_100
LENGTH = 1.5  # seconds
PEAK = 0.5  # -6 dBFS
# (start s, frequency Hz, loudness, decay s)
NOTES = [
    (0.00, 587.33, 1.0, 0.35),
    (0.14, 880.00, 0.9, 0.40),
    (0.28, 1174.66, 0.8, 0.55),
]
PARTIALS = [(1, 1.0), (2, 0.18), (3, 0.06)]
ATTACK = 0.008


def sample(t: float) -> float:
    v = 0.0
    for start, freq, loud, decay in NOTES:
        u = t - start
        if u < 0:
            continue
        env = min(1.0, u / ATTACK) * math.exp(-u / decay)
        for mult, amp in PARTIALS:
            # Higher partials fade faster, as a struck bar's do.
            v += (
                loud
                * amp
                * env
                * math.exp(-u * mult / 2)
                * math.sin(2 * math.pi * freq * mult * u)
            )
    return v


def main() -> None:
    n = int(RATE * LENGTH)
    raw = [sample(i / RATE) for i in range(n)]
    # Fade the last 60 ms to silence so the file never ends on a click.
    tail = int(0.06 * RATE)
    for i in range(tail):
        raw[n - tail + i] *= 1 - i / tail
    scale = PEAK / max(abs(x) for x in raw)
    with wave.open("unfurl.wav", "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(
            b"".join(struct.pack("<h", round(x * scale * 32767)) for x in raw)
        )


if __name__ == "__main__":
    main()
