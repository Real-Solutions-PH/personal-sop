import { fmtDuration } from "@domain/lib/day"
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio"
import { LinearGradient } from "expo-linear-gradient"
import { Mic, MicOff, Pause, Play, Send, Trash2 } from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import { AppState, View } from "react-native"
import { liveMode } from "@/live/config"
import { Copy, IconTap, Line } from "../native-kit"
import { useTheme } from "../theme"
import { Button, Sheet } from "../ui"

const samples: Record<string, string> = {
  meal: "two eggs, pandesal and coffee for breakfast",
  expense: "spent 180 on lunch at jollibee gcash",
  "weigh-in": "weighed 78.4",
  task: "remind me to call the dentist tomorrow at 10am, buy detergent",
  workout: "did legs: squat 3x5 100, rdl 3x8 80",
  journal: "Long day but I showed up anyway. Grateful for the small wins.",
}
export function CaptureVoice({
  hint,
  onClose,
  onDone,
  maxSec = 300,
  onRecording,
}: {
  hint?: string
  onClose: () => void
  onDone: (text: string, seconds: number) => void
  maxSec?: number
  /** Live mode: the real recording, for the server to transcribe. Without
   * it (or in the prototype) the sheet hands back a sample transcript. */
  onRecording?: (uri: string, seconds: number) => void
}) {
  const t = useTheme(),
    recorder = useAudioRecorder({
      ...RecordingPresets.HIGH_QUALITY,
      isMeteringEnabled: true,
    }),
    status = useAudioRecorderState(recorder, 100),
    [phase, setPhase] = useState<
      "requesting" | "recording" | "paused" | "denied" | "transcribing"
    >("requesting"),
    [levels, setLevels] = useState(() => Array<number>(36).fill(0.06)),
    mounted = useRef(true),
    finishing = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seconds = Math.min(maxSec, status.durationMillis / 1000)
  const serverTranscribes = liveMode && onRecording !== undefined
  async function start() {
    setPhase("requesting")
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync()
      if (!mounted.current) return
      if (!permission.granted) {
        setPhase("denied")
        return
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      })
      await recorder.prepareToRecordAsync()
      if (!mounted.current) {
        await recorder.stop()
        return
      }
      recorder.record()
      setPhase("recording")
    } catch {
      if (mounted.current) setPhase("denied")
    }
  }
  async function finish(simulated = false) {
    if (finishing.current) return
    finishing.current = true
    try {
      if (status.isRecording || phase === "paused") await recorder.stop()
    } catch {}
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {})
    if (!mounted.current) return
    if (liveMode && onRecording && recorder.uri) {
      onRecording(recorder.uri, Math.max(1, Math.round(seconds)))
      return
    }
    if (liveMode) {
      // Never stand a demo sentence in for what the person said.
      onClose()
      return
    }
    setPhase("transcribing")
    timer.current = setTimeout(() => {
      if (mounted.current)
        onDone(
          samples[hint ?? ""] ??
            "ran 5k 32 min, spent 250 on grab, remind me to pay rent on the 30th",
          simulated ? 6 : Math.max(1, Math.round(seconds)),
        )
    }, 700)
  }
  // Recording starts only after the user opens the microphone sheet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: own one recording for the lifetime of this sheet
  useEffect(() => {
    mounted.current = true
    void start()
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        if (recorder.isRecording) recorder.pause()
        setPhase((p) => (p === "recording" ? "paused" : p))
      }
    })
    return () => {
      mounted.current = false
      sub.remove()
      if (timer.current) clearTimeout(timer.current)
      void recorder.stop().catch(() => {})
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {})
    }
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: update waveform with audio samples, finish once at the limit
  useEffect(() => {
    if (phase === "recording") {
      const level = Math.max(
        0.06,
        Math.min(1, 10 ** ((status.metering ?? -50) / 30)),
      )
      setLevels((x) => [...x.slice(1), level])
      if (seconds >= maxSec) void finish()
    }
  }, [status.durationMillis, status.metering])
  return (
    <Sheet
      title={
        phase === "denied"
          ? "Microphone unavailable"
          : phase === "transcribing"
            ? "Transcribing…"
            : "Listening…"
      }
      open
      onClose={onClose}
    >
      {phase === "denied" ? (
        <>
          <View
            style={{
              alignSelf: "center",
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: `${t.bad}1f`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MicOff size={24} color={t.bad} />
          </View>
          <Copy size={14} style={{ textAlign: "center" }}>
            Microphone access is blocked for this app. Voice capture needs it to
            record — nothing is recorded until you tap the mic.
          </Copy>
          <View
            style={{ padding: 12, borderRadius: 12, backgroundColor: t.soft }}
          >
            <Copy size={14}>
              Allow microphone access in your device's app permissions, then try
              again.
            </Copy>
          </View>
          <Button onPress={() => void start()}>Try again</Button>
          <Button tone="quiet" onPress={() => void finish(true)}>
            Simulate a voice note (prototype)
          </Button>
          <Button tone="quiet" onPress={onClose}>
            Use text instead
          </Button>
        </>
      ) : phase === "transcribing" ? (
        <View style={{ alignItems: "center", paddingVertical: 40, gap: 12 }}>
          <Copy size={14} muted>
            Turning your voice note into text
          </Copy>
          <Copy size={14} muted>
            {fmtDuration(seconds)} of audio
          </Copy>
        </View>
      ) : (
        <>
          <Copy size={14} muted>
            Talk naturally — several things at once is fine. Max{" "}
            {Math.round(maxSec / 60)} min.
          </Copy>
          <View style={{ alignItems: "center", gap: 16, paddingBottom: 8 }}>
            <Copy size={48} weight="display">
              {fmtDuration(seconds)}
            </Copy>
            <View
              style={{
                height: 80,
                width: "100%",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
              }}
            >
              {levels.map((v, i) => (
                <LinearGradient
                  key={i}
                  colors={
                    phase === "paused" ? [t.muted, t.muted] : [t.hab, t.primary]
                  }
                  style={{
                    width: 6,
                    height: Math.max(5, v * 80),
                    borderRadius: 3,
                  }}
                />
              ))}
            </View>
            <Copy size={12} muted>
              {phase === "requesting"
                ? "Asking for the microphone…"
                : phase === "paused"
                  ? "Paused"
                  : " "}
            </Copy>
            <Line
              style={{
                width: "100%",
                justifyContent: "space-between",
                paddingHorizontal: 16,
              }}
            >
              <IconTap
                size={56}
                icon={Trash2}
                label="Cancel recording"
                background={t.soft}
                onPress={onClose}
              />
              <LinearGradient
                colors={[t.primary, t.hab]}
                style={{ borderRadius: 40 }}
              >
                <IconTap
                  size={80}
                  icon={Send}
                  label="Stop and send"
                  color="#fff"
                  onPress={() => {
                    if (phase !== "requesting") void finish()
                  }}
                />
              </LinearGradient>
              <IconTap
                size={56}
                icon={phase === "paused" ? Play : Pause}
                label={phase === "paused" ? "Resume" : "Pause"}
                background={t.soft}
                onPress={() => {
                  if (phase === "recording") {
                    recorder.pause()
                    setPhase("paused")
                  } else if (phase === "paused") {
                    recorder.record()
                    setPhase("recording")
                  }
                }}
              />
            </Line>
            <Line style={{ gap: 4 }}>
              <Mic size={12} color={t.muted} />
              <Copy size={11} muted>
                {serverTranscribes
                  ? "Your recording is sent and transcribed on the server."
                  : "Transcription is simulated in this prototype."}
              </Copy>
            </Line>
          </View>
        </>
      )}
    </Sheet>
  )
}
