# Personal SOP — Expo mobile

Native React Native implementation of the Personal SOP prototype. Start it without backend credentials:

```sh
bun install --frozen-lockfile
bun run start
```

Use the Expo QR code on a compatible phone, or a configured iOS/Android simulator. `bun run web` runs the browser target. The app uses the Expo SDK version pinned in `package.json`; install native libraries with `bunx expo install`.

Prototype data is seeded and saved on the device. AI, transcription, statement parsing and reminders are simulated. Camera/library selection, audio recording, clipboard and sharing use platform APIs. There is no cross-device data sync.

See [mobile architecture and verification](../docs/mobile.md) for route coverage, storage boundaries and device checks. `bun run start:connected` opens the separately guarded authenticated API template; it does not wire the prototype to that backend.

```sh
bun run typecheck
bun run test --runInBand
bunx biome ci ./ ../shared/prototype
bunx expo-doctor
bunx expo export --platform all --max-workers 2
```
