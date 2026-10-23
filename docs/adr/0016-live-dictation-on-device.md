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
