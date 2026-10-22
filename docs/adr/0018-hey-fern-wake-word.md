# ADR-0018 — "Hey Fern": a foreground wake phrase on the phone's recogniser

- **Date:** 2026-10-22
- **Status:** accepted
- **Deciders:** maintainers

## Context

The owner wants to say "Hey Fern" and have the app answer and start
dictating, hands-free. Live dictation (ADR-0016) already runs on the
phone's speech recogniser through `expo-speech-recognition`.

iOS does not let a third-party app listen in the background or while the
phone is locked, so any wake phrase works only while the app is open on
screen.

Two ways to hear the phrase:

1. **A dedicated wake-word engine**, such as Picovoice Porcupine. It is
   built for this and light on battery, but the SDK refuses to start
   without a Picovoice AccessKey, a custom phrase has to be trained in
   Picovoice's console, and the free tier was withdrawn on 2026-06-30 (as
   Picovoice users reported), leaving paid enterprise plans. It would also
   add a native module and a config plugin.
2. **The recogniser the app already ships**, running continuously and
   checking each partial transcript for the phrase. No account, key, cost
   or new native module. It uses more battery than a wake-word engine, and
   a recognition task has to be restarted when it ends.

## Decision

Option 2. While the person has turned it on (Fern's settings, off by
default) and the app is in the foreground, the app runs continuous
recognition, on the device whenever the phone supports it, biased towards
"Hey Fern" with contextual strings. Each task is recycled after 50 seconds,
which keeps transcripts short and stays under the one-minute limit iOS sets
on server-backed recognition. A task that fails at once is retried with a
growing wait, up to 30 seconds.

When the phrase is heard the listener aborts, and only after the recogniser
has stopped does it play a short chime and a haptic, open Fern's chat (or
use the full chat page if that is showing) and start live dictation there.
Words said after the name go into the box.

There is one recogniser, so the listener stands down while a composer is
dictating, while a reply is read aloud, and when the app leaves the
foreground. An ear on Fern's tab button, and the chat's subtitle, show
while it is listening.

**What this excludes:**
- Background or lock-screen listening (not possible on iOS).
- A wake-word engine and its account, key and native module.
- Sending anything automatically: dictation still fills the box for review.

## Constitution clause deviated from

None beyond ADR-0016, which this builds on.

## Consequences

**Positive:**
- Hands-free start in the foreground, at no cost and with no new native
  dependency.
- On phones that support it, the always-on listening never leaves the
  device.

**Negative:**
- More battery than a dedicated engine while it is on; the setting says so.
- A general recogniser can mishear the name. The match accepts common
  mishearings of "Fern" ("Vern", "firn") and requires a greeting before it.
- Where on-device recognition is unavailable, the always-on audio goes to
  Apple's recogniser.

**Follow-ups:**
- If battery use is a complaint, stop listening after a stretch with no
  interaction, or revisit a licensed wake-word engine.
