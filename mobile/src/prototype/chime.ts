type Chime = { seekTo(s: number): Promise<void> | void; play(): void }
let chimePlayer: Chime | null = null
/** A short chime (the wake word's, the rest timer's end). */
export function chime() {
  try {
    const audio = require("expo-audio") as typeof import("expo-audio")
    chimePlayer ??= audio.createAudioPlayer(
      require("./sounds/wake.wav"),
    ) as unknown as Chime
    void Promise.resolve(chimePlayer.seekTo(0)).catch(() => {})
    chimePlayer.play()
  } catch {
    // No audio module in this build: the haptic still answers.
  }
}
