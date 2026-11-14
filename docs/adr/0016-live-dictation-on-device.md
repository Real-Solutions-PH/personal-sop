# ADR-0016 — Live dictation: on-device recognition, Deepgram as fallback

- **Date:** 2026-10-22
- **Status:** accepted
- **Deciders:** maintainers

## Context

ADR-0015 made Fern's microphone a dictation button: record, upload to
`POST /capture/dictate`, get the words back. It works, but nothing shows
while the person speaks. The owner asked for dictation like Claude's, where
words appear as they are recognised.

Words in real time need recognition while the audio is still arriving.
There are two ways to get that:

1. **Stream audio to Deepgram's live API.** Our server would need a
   WebSocket relay, or the device would connect to Deepgram directly with a
   short-lived token from our server. The project's Deepgram key cannot mint
   those tokens: `POST /v1/auth/grant` answers 403 "Insufficient
   permissions" on 2026-10-22. It would also need a native module that
   streams raw PCM, and cost about $0.008 per minute.
2. **The phone's own speech recogniser** (iOS `SFSpeechRecognizer`, Android
   `SpeechRecognizer`) through `expo-speech-recognition` (MIT, built for
   this Expo SDK). It gives partial results as the person speaks, adds
   punctuation, needs no server or key, and costs nothing.

## Decision

Fern's microphone uses the phone's recogniser (option 2), with interim
results shown live in the chat box. The text stays in the box for the person
to review and send; nothing is sent automatically.

When live recognition is unavailable, the microphone falls back to the
ADR-0015 path: record, then server speech-to-text (Deepgram). That covers a
denied speech permission, a device without a recogniser, or a language the
recogniser lacks.

**What this excludes:**
- Streaming audio through our server: no WebSocket on our side, so §4.2's
  SSE-only transport stands.
- Deepgram's live API.
- Voice captures on the capture screen, which keep recording to the server.

## Constitution clause deviated from

§4.2 chat transport and STT: "voice = record → server-side STT", with
Deepgram as the default STT. Live dictation runs on the device instead. The
same clause marks STT as optional, not a hard dependency, and the server
Deepgram path remains as the fallback.

## Consequences

**Positive:**
- Words appear while the person speaks, with no network round trip.
- No cost, and no audio leaves the phone except through the platform's own
  recogniser. (Superseded by the 2026-10-23 amendment: the recording now
  also goes to our server.)

**Negative:**
- Quality depends on the platform. Apple's and Google's recognisers handle
  English well; Taglish is weaker than Deepgram's `multi` model.
- A new native module, so the app has to be rebuilt.
- On iOS, recognition may still use Apple's servers unless on-device
  recognition is required. It is not required here, because that would
  lower accuracy.

**Follow-ups:**
- If Taglish accuracy matters, mint Deepgram live tokens (needs a key with
  the Member role) and stream to Deepgram instead.

## Amendment (2026-10-23): the server's words replace the phone's

Measured on 350 synthetic clips of the owner's kind of message (five voices,
clean and with background noise; English, money, food, brands, Taglish),
the phone's recogniser (Apple, `en-US`, as shipped) made 22.6% word errors
and kept 71% of the names and numbers that matter. Deepgram Nova-3 with the
person's own habit, exercise, account and food names as key terms made
14.6% and kept 88%. The real chat history showed the same misses:
"friend" for Fern, "weight protein" for whey protein, "real solutions pH".
Apple with the `en-PH` locale (23.2% / 69%) or with the same names as
`contextualStrings` (19.8% / 79%) did not close the gap.

So in live mode the recogniser also writes the audio to a 16 kHz mono WAV.
When the person stops, the app sends it to `POST /capture/dictate`, and the
server's transcript replaces the phone's words in the box, unless the person
has edited the box in the meantime. If the server fails, the phone's words
stay. The live words while speaking are unchanged.

This reverses "no cost" and "no audio leaves the phone": each dictation is
now metered like any server transcription (Deepgram plus its key-term
add-on, about ₱0.32 a minute), and the recording is uploaded. Nothing is
stored on the server but the usage row.

## Amendment (2026-11-14): the phone gets contextual strings; nothing auto-sends

The phone's live words still stand whenever the server's pass is not used
(it failed, or Send was tapped before it returned). The recogniser is now
started with `contextualStrings`: "Fern", the person's live habit and
account names, then a short list of Philippine food and brands, at most 100
(the 19.8% / 79% row above, against 22.6% / 71% without). The server's
query was reviewed and left as it is: Nova-3 is still Deepgram's newest
pre-recorded model, and `language_hint` (en, tl) changed nothing on a small
sanity check. (Superseded the same day by the next amendment: the server
pass now adds a second listener.)

The Shortcut / Back Tap "Talk to Fern" launch no longer sends by itself
after a pause. It dictates like any other dictation; a long silence (8 s)
turns the mic off, and the person taps Send.

## Amendment (2026-11-14): a second listener, and why the server's words stopped arriving

**The server's pass had stopped working.** In the production API log every
`POST /capture/dictate` from 2026-11-12 01:17 UTC to 2026-11-14 returned
502 (11 in a row; earlier days were mixed). So the owner's chat box kept
the phone's words every time, which is the accuracy he was comparing.
The cause is not proven. A read-only task in production built the owner's
key-term list exactly as the endpoint does (56 terms, 791 characters,
`en-tl`) and Deepgram accepted it, with synthetic speech, through the
same `seams.transcribe`; so the failure depends on the uploaded audio. A
WAV holding only its header (or under about 0.1 s of sound) passes the
server's type check and Deepgram refuses it as "corrupt or unsupported
data", which is that 502; the phone uploading its recording before the
recogniser has written it out would look like this. The server logged no
reason, so it now logs Deepgram's error code and message with the
recording's type and size (never the query, which holds the names).

A related limit is fixed: Deepgram caps key terms at 500 tokens counted by
the language model in use, and `multi` counts more per character than
`en`. A 77-term, 797-character list passed `en` and was refused by `multi`
above about 640 characters, while the server allows 800. A key-term
refusal is now retried with the first half of the list.

**Measured.** The 2026-10-23 corpus (35 sentences), rebuilt as 490 clips:
seven synthetic voices (four Deepgram Aura-2, three macOS: US, Indian and
British English), each clean and with noise at about 12 dB SNR. Scored by
`backend/scripts/stt_eval/` (word error rate, and the share of the names,
numbers and food each sentence must carry that survive). These are not the
2026-10-23 clips (deleted with that session), so the absolute numbers
differ from the amendment above; read them as a ranking. Synthetic voices
pronounce Tagalog badly, so the Taglish column says more about the voices
than the recognisers; the "real" column (the owner's real messages, read
aloud) is the closest to use.

| Setup | WER | Kept | Real msgs WER | Median s/clip | US$/min |
|---|---|---|---|---|---|
| **Before:** Nova-3 `multi` + key terms | 23.3% | 78% | 10.4% | 1.5 | 0.0056 |
| Nova-3 `en` + key terms | 21.5% | 80% | 8.6% | 1.5 | 0.0056 |
| Nova-3 `multi`, no key terms | 25.8% | 70% | 10.6% | 1.8 | 0.0043 |
| Gemini 3.1 Flash Lite (audio, names in prompt) | 15.6% | 87% | 10.1% | 1.8 | 0.0019 |
| Gemini 3.8 Flash, minimal reasoning | 11.7% | 89% | 10.9% | 3.0 | 0.0042 |
| Gemini 3.5 Flash, default reasoning | 12.3% | 91% | 10.6% | 4.9 | 0.2808 |
| Gemini 3.5 Flash, minimal reasoning | 224% (looped) | 89% | — | 2.2 | 0.0227 |
| Nova-3 transcript corrected by Gemini 3.1 Flash Lite (text) | 18.2% | 82% | 11.6% | 1.1 | +0.0012 |
| Gemini 3.8 Flash hearing the clip with Nova-3's draft | 10.0% | 90% | 9.3% | 4.5 (in series) | 0.0102 |
| **After:** Nova-3 and Gemini 3.8 Flash in parallel, guarded | **11.6%** | **90%** | **8.2%** | 3.0 | 0.0101 |

Not measurable with the keys we hold: OpenAI `gpt-4o-transcribe` and
ElevenLabs Scribe (no keys); `openai/gpt-audio-mini` on OpenRouter refused
WAV input; Deepgram's hosted Whisper hit its rate limit.

The audio models alone fail in a way Deepgram does not: Gemini 3.8 Flash
stopped mid-sentence on 4 of 420 clips of the six clearer voices ("Fern, I
want"), and 3.5 Flash looped. A dictation that silently loses its second
half is worse than a misheard word.

**Decision.** On the server's own Deepgram key, WAV and MP3 recordings
(the phone's live dictation uploads WAV) are heard by Nova-3 and by
Gemini 3.8 Flash (OpenRouter, minimal reasoning, the person's key terms in
its prompt) at the same time. Gemini's words are used when their length is
60% to 160% of Nova-3's; otherwise, or when it fails or takes over 20 s,
Nova-3's. When Nova-3 fails the call fails as before (the phone's words
stay): alone, an audio model can put words to an empty or cut-off upload.
A person's own provider key is never paired with the server's OpenRouter
key. Voice captures (mostly m4a) stay on Nova-3 alone.
`STT_CHECK_ENABLED=false` turns it off.

Threshold for switching, set before the final runs: at least 3 points
lower WER than before, no worse on the real messages, key terms kept at
least as high, at most 2x the cost per minute, median at most 3 s per clip,
and no transcript that adds or drops what was said. The guarded setup:
-11.7 points, 8.2% vs 10.4% on real messages, 90% vs 78% kept, 1.8x cost,
3.0 s median (4.3 s at p90), and 2 of 490 clips more than 2 words worse
than Nova-3 alone (a reworded date, a misheard opening), against 281
better.

**Cost.** About ₱0.58 a minute instead of ₱0.32, metered as
`transcription_minor(..., checked=True)`. At 30 minutes of dictation a
month that is US$0.30, inside every Plus budget (ADR-0038).

**Privacy.** Dictation audio and the person's key terms now also go to
OpenRouter and Google (the model's provider), as well as Deepgram. Nothing
is stored on our side beyond the usage row.

**Not verified:** the cause of the 502s; accuracy on the owner's own voice
and phone microphone; how often Send is tapped before the slower pass
returns (the wait is now about 3 s instead of 1.5 s, and until it returns
the phone's words are what Send sends).
