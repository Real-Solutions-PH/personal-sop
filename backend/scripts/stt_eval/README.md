# Speech-to-text eval

Measures how well a speech-to-text setup hears the kind of message Unfurl's
users dictate to Fern: English with Tagalog, Filipino food, brands, habit
and account names, numbers and money. Used for ADR-0016's measurements.

The audio is synthetic: 35 sentences (`corpus.py`) spoken by 4 Deepgram
Aura-2 voices and 3 macOS voices (US, Indian, British English), each clean
and with low-passed noise at about 12 dB SNR, 490 clips in all. Read the
results as a ranking. A real person, a phone microphone and a real room
make more errors than this, and the Aura voices come from the same vendor
as the Deepgram candidates, which may flatter them.

No clip or result is kept in the repository; regenerate them.

## Run

From `backend/`, with `DEEPGRAM_API_KEY` and `OPENROUTER_API_KEY` exported
(the root `.env` has both), on macOS (`say`, `afconvert`):

```bash
python scripts/stt_eval/gen.py /tmp/stt/audio
python scripts/stt_eval/run.py /tmp/stt/audio /tmp/stt/results dg-tl-kt deepgram tl+kt
python scripts/stt_eval/run.py /tmp/stt/audio /tmp/stt/results gem35 audio-llm google/gemini-3.5-flash
python scripts/stt_eval/score.py /tmp/stt/results
```

`run.py`'s docstring lists the kinds of setup it can run: Deepgram through
the server's own `seams.transcribe`, another Deepgram model, an
audio-input model on OpenRouter, a text model correcting a transcript, or
an audio model given a Deepgram draft. Every setup that can take the
person's names gets the same list (`names.py`, built by the server's
`capture.vocabulary.keyterms`).

## Scoring

`score.py` normalises both sides first (case, punctuation, "₱600,000" vs
"600000 pesos", "ten" vs "10", "kgs" vs "kilos"), so formatting is not an
error and a misheard word is. Two numbers per setup:

- **WER**: word edits over reference words.
- **Key terms kept**: of the names, numbers and food each sentence must
  carry (corpus column 4), the share found in the transcript.

Each is given overall, clean, noisy, and for the real-message, Taglish,
food and money sentences, with the median seconds per clip and the cost
per audio minute (Deepgram at the server's own rate; OpenRouter as billed).
