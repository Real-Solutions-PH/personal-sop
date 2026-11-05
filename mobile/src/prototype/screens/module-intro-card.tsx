// Today's one-time reintroduction of a hidden part (module-intro.ts): from
// day 14 after sign-up, the part's real Today card drawn dimmed, under a
// line on what it adds, with "Turn on" and "Not for me". Either answer is
// acknowledged in place; "Not for me" is kept on the account for good.
import type { ModuleKey } from "@domain/contract"
import { orderModules } from "@domain/dash/data"
import { dashStore } from "@domain/dash/store"
import { dayKey } from "@domain/lib/day"
import {
  BookOpen,
  Check,
  Dumbbell,
  ListChecks,
  type LucideIcon,
  Repeat2,
  Smartphone,
  Timer,
  Users,
  Utensils,
  Wallet,
} from "lucide-react-native"
import { type ComponentType, useState } from "react"
import { View } from "react-native"
import { extrasStore } from "../extras"
import {
  INTRO_ADDS,
  INTRO_LABEL,
  type IntroKey,
  introCandidate,
  introPause,
  notForMe,
  turnPartOn,
} from "../module-intro"
import { feel } from "../motion"
import { Copy, Frame, Line } from "../native-kit"
import { CommunityCard } from "../social/today-card"
import { type Accent, useTheme } from "../theme"
import { Button } from "../ui"
import { MoodCheckIn } from "./mood-check-in"

const LOOK: Record<IntroKey, { icon: LucideIcon; accent: Accent }> = {
  habits: { icon: Repeat2, accent: "hab" },
  tasks: { icon: ListChecks, accent: "tsk" },
  fitness: { icon: Dumbbell, accent: "fit" },
  nutrition: { icon: Utensils, accent: "nut" },
  focus: { icon: Timer, accent: "foc" },
  finance: { icon: Wallet, accent: "fin" },
  screen: { icon: Smartphone, accent: "scr" },
  journal: { icon: BookOpen, accent: "life" },
  social: { icon: Users, accent: "primary" },
}

export function ModuleIntroCard({
  cards,
}: {
  /** Today's own module cards, drawn dimmed as the preview. */
  cards: Partial<Record<ModuleKey, ComponentType>>
}) {
  const t = useTheme()
  const since = dashStore.use((s) => s.profile.since)
  const order = dashStore.use((s) => s.order)
  const enabled = dashStore.use((s) => s.enabled)
  const dismissed = dashStore.use((s) => s.intro.dismissed)
  const shown = extrasStore.use((s) => s)
  const pausedOn = introPause.use((s) => s.day)
  // The answer just given, acknowledged until Today is next opened.
  const [answered, setAnswered] = useState<{
    k: IntroKey
    on: boolean
  } | null>(null)
  const k = introCandidate({
    since,
    today: dayKey(),
    order: orderOf(order, cards),
    enabled,
    shown,
    dismissed,
    pausedOn,
  })
  if (answered) {
    const label = INTRO_LABEL[answered.k]
    return (
      <Frame style={{ padding: 16 }}>
        <Line style={{ gap: 10 }}>
          <Check size={18} color={answered.on ? t.good : t.muted} />
          <Copy size={14} style={{ flex: 1 }}>
            {answered.on
              ? `${label} is on. Its card is on Today now.`
              : `Got it. Unfurl won't suggest ${label} again. It stays in Settings if you change your mind.`}
          </Copy>
        </Line>
      </Frame>
    )
  }
  if (!k) return null
  const Preview =
    k === "journal" ? MoodCheckIn : k === "social" ? CommunityCard : cards[k]
  if (!Preview) return null
  const { icon: Icon, accent } = LOOK[k]
  const tint = t[accent]
  const label = INTRO_LABEL[k]
  return (
    <View style={{ gap: 12 }} testID="module-intro">
      <Frame style={{ padding: 16, gap: 10, borderColor: `${tint}55` }}>
        <Line style={{ gap: 10 }}>
          <Icon size={18} color={tint} />
          <Copy size={16} weight="semibold" style={{ flex: 1 }}>
            {`You hid ${label}. Here's what it adds`}
          </Copy>
        </Line>
        <Copy size={14} muted>
          {INTRO_ADDS[k]}
        </Copy>
        <Line style={{ gap: 8, flexWrap: "wrap" }}>
          <Button
            small
            onPress={() => {
              feel.tap()
              turnPartOn(k)
              setAnswered({ k, on: true })
            }}
          >
            {`Turn on ${label}`}
          </Button>
          <Button
            small
            tone="quiet"
            onPress={() => {
              notForMe(k)
              setAnswered({ k, on: false })
            }}
          >
            Not for me
          </Button>
        </Line>
      </Frame>
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ opacity: 0.35 }}
      >
        <Preview />
      </View>
    </View>
  )
}

/** The person's module order, kept to modules with a Today card. */
const orderOf = (
  order: readonly string[] | undefined,
  cards: Partial<Record<ModuleKey, ComponentType>>,
): ModuleKey[] => orderModules(order).filter((m) => cards[m])
