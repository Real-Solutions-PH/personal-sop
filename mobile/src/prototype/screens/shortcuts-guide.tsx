import type { LucideIcon } from "lucide-react-native"
import {
  AudioLines,
  Camera,
  ChartPie,
  CircleCheck,
  Info,
  Leaf,
  Smartphone,
  Timer,
  Wallet,
} from "lucide-react-native"
import { Linking, Platform, View } from "react-native"
import { toast } from "sonner-native"
import { border, Copy, Frame, Line, SectionHeading } from "../native-kit"
import { useTheme } from "../theme"
import { Button, Screen } from "../ui"

// Settings > Shortcuts & Back Tap: how to put Fern on a tap on the back of
// the phone. The app cannot set Back Tap itself (iOS only lets the person
// pick a Shortcut in Accessibility settings), so this page shows the
// recommended mapping, the steps, and the rest of what Unfurl offers in the
// Shortcuts app and Siri (plugins/app-intents/UnfurlAppIntents.swift).

/** The two taps, in the order Back Tap lists them. */
const TAPS: {
  taps: string
  name: string
  does: string
  icon: LucideIcon
}[] = [
  {
    taps: "Double tap",
    name: "Talk to Fern",
    does: "Fern opens listening. Stop talking and it sends.",
    icon: AudioLines,
  },
  {
    taps: "Triple tap",
    name: "Snap and log",
    does: "The camera opens for a meal, a receipt or a food label.",
    icon: Camera,
  },
]

const STEPS = [
  "Open Settings, then Accessibility.",
  "Tap Touch, then Back Tap at the very bottom.",
  "Tap Double Tap and pick Talk to Fern under Unfurl.",
  "Go back, tap Triple Tap and pick Snap and log.",
]

/** What else shows up in Shortcuts, Spotlight and Siri, with the phrase to
 * say. Siri only understands these in English. */
const MORE: { name: string; say: string; does: string; icon: LucideIcon }[] = [
  {
    name: "Ask Fern",
    say: "Ask Fern in Unfurl",
    does: "Hear her answer without opening the app",
    icon: Leaf,
  },
  {
    name: "Log an expense",
    say: "Log an expense in Unfurl",
    does: "Say “250 lunch”; see today against your daily cap",
    icon: Wallet,
  },
  {
    name: "Mark a habit done",
    say: "I took my meds in Unfurl",
    does: "Medicine first; works from the Lock Screen",
    icon: CircleCheck,
  },
  {
    name: "Start or stop focus",
    say: "Start focus in Unfurl",
    does: "Pomodoro or stopwatch, on the Lock Screen",
    icon: Timer,
  },
  {
    name: "What's left today",
    say: "What's left today in Unfurl",
    does: "Calories, protein and money left",
    icon: ChartPie,
  },
]

async function openShortcuts() {
  try {
    await Linking.openURL("shortcuts://")
  } catch {
    toast.error("Couldn't open Shortcuts. Find it on your Home Screen.")
  }
}

function Badge({ icon: Icon, tone }: { icon: LucideIcon; tone: string }) {
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: border(tone, 0.15),
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon size={20} color={tone} />
    </View>
  )
}

export function ShortcutsGuide() {
  const t = useTheme()
  const ios = Platform.OS === "ios"
  const info = t["chart-1"]
  return (
    <Screen title="Shortcuts & Back Tap">
      {!ios && (
        <Frame style={{ padding: 16 }}>
          <Copy size={14} muted>
            Back Tap and Shortcuts are on iPhone. On Android, add the Fern
            widget to your Home Screen for the same one-tap start.
          </Copy>
        </Frame>
      )}

      <SectionHeading>Tap the back of your phone</SectionHeading>
      <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
        {TAPS.map((x, i) => (
          <Line
            key={x.name}
            style={{
              gap: 12,
              paddingVertical: 12,
              alignItems: "flex-start",
              borderBottomWidth: i < TAPS.length - 1 ? 1 : 0,
              borderBottomColor: border(t.line, 0.5),
            }}
          >
            <Badge icon={x.icon} tone={t.frond} />
            <View style={{ flex: 1, gap: 2 }}>
              <Copy size={12} muted>
                {x.taps}
              </Copy>
              <Copy weight="semibold">{x.name}</Copy>
              <Copy size={14} muted>
                {x.does}
              </Copy>
            </View>
          </Line>
        ))}
      </Frame>

      <SectionHeading>Set it up once</SectionHeading>
      <Frame style={{ padding: 16, gap: 12 }}>
        {STEPS.map((s, i) => (
          <Line key={s} style={{ gap: 12, alignItems: "flex-start" }}>
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: t.primary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Copy size={12} weight="semibold" style={{ color: t.onPrimary }}>
                {String(i + 1)}
              </Copy>
            </View>
            <Copy size={15} style={{ flex: 1 }}>
              {s}
            </Copy>
          </Line>
        ))}
        <Copy size={12} muted>
          Back Tap needs an iPhone 8 or later. It works from any app, and from
          the Lock Screen once you unlock.
        </Copy>
        {ios && (
          <Button icon={Smartphone} onPress={() => void openShortcuts()}>
            Open Shortcuts
          </Button>
        )}
      </Frame>

      <Line
        style={{
          gap: 10,
          marginTop: 12,
          padding: 12,
          borderRadius: 12,
          alignItems: "flex-start",
          backgroundColor: border(info, 0.1),
        }}
      >
        <Info size={16} color={info} style={{ marginTop: 2 }} />
        <Copy size={13} style={{ flex: 1 }}>
          Have an Action button (iPhone 15 Pro and later)? Settings › Action
          Button › Shortcut, then pick Talk to Fern. Fern also has controls for
          Control Center and the Lock Screen: Ask Fern, Dictate to Fern and Snap
          and log.
        </Copy>
      </Line>

      <SectionHeading>Also in Shortcuts and Siri</SectionHeading>
      <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
        {MORE.map((x, i) => (
          <Line
            key={x.name}
            style={{
              gap: 12,
              paddingVertical: 10,
              alignItems: "flex-start",
              borderBottomWidth: i < MORE.length - 1 ? 1 : 0,
              borderBottomColor: border(t.line, 0.5),
            }}
          >
            <x.icon size={18} color={t.muted} style={{ marginTop: 2 }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Copy weight="medium">{x.name}</Copy>
              <Copy size={13} muted>
                {x.does}
              </Copy>
              <Copy size={13} style={{ color: t.primary }}>
                “Hey Siri, {x.say}”
              </Copy>
            </View>
          </Line>
        ))}
      </Frame>
      <Copy size={12} muted style={{ marginTop: 8, marginBottom: 24 }}>
        Siri understands these in English. Every one also shows in the Shortcuts
        app under Unfurl, ready to add to Back Tap or the Action button.
      </Copy>
    </Screen>
  )
}
