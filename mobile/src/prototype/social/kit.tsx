import { palette } from "@domain/design/tokens"
import * as Haptics from "expo-haptics"
import { LinearGradient } from "expo-linear-gradient"
import { useVideoPlayer, VideoView } from "expo-video"
import {
  Award,
  CheckSquare,
  CircleCheck,
  Dumbbell,
  Flame,
  Lightbulb,
  Medal,
  Sparkles,
  Sprout,
  Target,
  Trophy as TrophyIcon,
  User,
  Volume2,
  VolumeX,
  Wallet,
} from "lucide-react-native"
import { type ReactNode, useEffect, useRef, useState } from "react"
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated"
import Svg, { Circle } from "react-native-svg"
import { Sparkline } from "../chart"
import { go } from "../navigation"
import { type Accent, fonts, useTheme } from "../theme"
import { Sheet } from "../ui"
import { RemoteImage } from "./remote-image"
import {
  CHEERS,
  type Cheer,
  cheer,
  cheerCounts,
  clearNote,
  compact,
  ME,
  type Media,
  type Person,
  type Post,
  type Progress,
  type ProgressStat,
  setNote,
  socialStore,
  type Trophy,
  usePerson,
} from "./store"

/** The icon of each cheer: outline icons, never emoji (the brand rule). */
export const CHEER_ICON: Record<Cheer, typeof Sprout> = {
  keep_going: Sprout,
  proud: Award,
  inspired: Lightbulb,
}

export const haptic = {
  tap: () =>
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  pop: () =>
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
      () => {},
    ),
  done: () =>
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success,
    ).catch(() => {}),
}

/** Check-in ring state for a person: unseen / close friends / seen / none.
 * Your own ring stays lit while you have check-ins up: posting one marks it
 * seen, and a grey ring read as "nothing to open". */
export function useRing(id: string) {
  return socialStore.use((s) => {
    const items = s.stories.filter((x) => x.by === id)
    if (!items.length) return null
    if (id === ME) return "unseen" as const
    if (!items.some((x) => !s.seen.includes(x.id))) return "seen" as const
    return items.some((x) => x.audience === "close")
      ? ("close" as const)
      : ("unseen" as const)
  })
}

/** Which of a person's check-ins I have seen, in order (true = seen). */
function useRingSegments(id: string): string {
  // A string, so the selector's result compares by value.
  return socialStore.use((s) =>
    s.stories
      .filter((x) => x.by === id)
      .slice(0, MAX_SEGMENTS)
      .map((x) => (id !== ME && s.seen.includes(x.id) ? "1" : "0"))
      .join(""),
  )
}
const MAX_SEGMENTS = 8

/** Unfurl's check-in ring: one arc per check-in, like a progress ring
 * filling up, in the brand colour while unseen and a hairline once seen.
 * Close-friends check-ins draw in the life colour. */
function CheckInRing({
  id,
  size,
  state,
}: {
  id: string
  size: number
  state: "seen" | "unseen" | "close"
}) {
  const t = useTheme()
  const segments = useRingSegments(id)
  const n = Math.max(1, segments.length)
  const stroke = size >= 56 ? 3 : 2.25
  const box = size + 10
  const r = (box - stroke) / 2
  const c = 2 * Math.PI * r
  const gap = n > 1 ? Math.min(6, c / n / 4) : 0
  const live = state === "close" ? t.life : t.primary
  return (
    <Svg
      width={box}
      height={box}
      style={{ position: "absolute", top: 0, left: 0 }}
      pointerEvents="none"
    >
      {Array.from({ length: n }, (_, i) => (
        <Circle
          key={i}
          cx={box / 2}
          cy={box / 2}
          r={r}
          fill="none"
          stroke={segments[i] === "1" || state === "seen" ? t.line : live}
          strokeWidth={stroke}
          strokeLinecap={n > 1 ? "round" : "butt"}
          strokeDasharray={`${c / n - gap} ${c - c / n + gap}`}
          strokeDashoffset={-((c / n) * i) + c / 4 - gap / 2}
        />
      ))}
    </Svg>
  )
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join("")

export function Face({ person, size }: { person: Person; size: number }) {
  const t = useTheme()
  return person.photo ? (
    <Image
      source={{ uri: person.photo }}
      accessibilityIgnoresInvertColors
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: t.soft,
      }}
    />
  ) : (
    <LinearGradient
      colors={[t[person.accent], t["share-vivid-to"]]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: "#fff",
          fontFamily: fonts.bold,
          fontSize: size * 0.38,
        }}
      >
        {initials(person.name)}
      </Text>
    </LinearGradient>
  )
}

/** Avatar with an optional check-in ring (see CheckInRing). */
export function Avatar({
  id,
  size = 36,
  ring = true,
  onPress,
  label,
}: {
  id: string
  size?: number
  ring?: boolean
  onPress?: () => void
  /** What a tap does, when it is not "open this person". */
  label?: string
}) {
  const t = useTheme()
  const person = usePerson(id)
  const state = useRing(id)
  // Not loaded yet (or gone): a neutral circle rather than empty space.
  if (!person)
    return (
      <View
        accessibilityLabel="Profile photo"
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: t.soft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <User size={size * 0.5} color={t.muted} />
      </View>
    )
  const show = ring && state
  const body = show ? (
    <View
      style={{
        width: size + 10,
        height: size + 10,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <CheckInRing id={id} size={size} state={state} />
      <Face person={person} size={size} />
    </View>
  ) : (
    <Face person={person} size={size} />
  )
  if (!onPress) return body
  return (
    <Pressable
      cssInterop={false}
      accessibilityRole="button"
      accessibilityLabel={
        label ??
        (id === ME
          ? state
            ? "Play your check-ins"
            : "Your profile"
          : `${person.name}${state && state !== "seen" ? ", new check-in" : ""}`)
      }
      onPress={onPress}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.94 : 1 }] })}
    >
      {body}
    </Pressable>
  )
}

/** Avatar that opens the person's stories if any, else their profile. */
export function PersonAvatar({ id, size = 36 }: { id: string; size?: number }) {
  const ring = useRing(id)
  return (
    <Avatar
      id={id}
      size={size}
      onPress={() => go(ring ? `/social/stories/${id}` : `/social/u/${id}`)}
    />
  )
}

export function Name({
  id,
  size = 14,
  onPress,
}: {
  id: string
  size?: number
  onPress?: () => void
}) {
  const t = useTheme()
  const p = usePerson(id)
  return (
    <Text
      onPress={onPress ?? (() => go(`/social/u/${id}`))}
      style={{ fontFamily: fonts.semibold, fontSize: size, color: t.text }}
    >
      {p?.username ?? "unknown"}
      {p?.verified && <Text style={{ color: t.primary }}> ✓</Text>}
    </Text>
  )
}

/** Animated press-scale wrapper for icon buttons. */
export function Bounce({
  children,
  onPress,
  label,
  style,
  onLongPress,
}: {
  children: ReactNode
  onPress: () => void
  label: string
  style?: ViewStyle
  onLongPress?: () => void
}) {
  const reduced = useReducedMotion()
  const scale = useSharedValue(1)
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  return (
    <Pressable
      cssInterop={false}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => {
        if (!reduced) scale.value = withSpring(0.86, { duration: 120 })
      }}
      onPressOut={() => {
        scale.value = withSpring(1)
      }}
      style={{
        minWidth: 40,
        minHeight: 40,
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      <Animated.View style={anim}>{children}</Animated.View>
    </Pressable>
  )
}

/** The cheer mark (a sprout, Unfurl's own "like"): it grows when it turns
 * on. */
export function CheerSprout({
  liked,
  size = 24,
  color,
}: {
  liked: boolean
  size?: number
  color?: string
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const scale = useSharedValue(1)
  const was = useRef(liked)
  // Grow only when the cheer turns on, never on mount.
  useEffect(() => {
    if (liked && !was.current && !reduced)
      scale.value = withSequence(
        withSpring(1.35, { duration: 140 }),
        withSpring(1),
      )
    was.current = liked
  }, [liked, scale, reduced])
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  return (
    <Animated.View style={anim}>
      <Sprout
        size={size}
        color={liked ? t.primary : (color ?? t.text)}
        strokeWidth={liked ? 2.25 : 1.75}
      />
    </Animated.View>
  )
}

/** A sprout that grows over media after a double-tap cheer. */
export function useCheerBurst() {
  const reduced = useReducedMotion()
  const scale = useSharedValue(0)
  const opacity = useSharedValue(0)
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }))
  const fire = () => {
    if (reduced) {
      opacity.value = withSequence(
        withTiming(1, { duration: 1 }),
        withTiming(0, { duration: 600 }),
      )
      scale.value = 1
      return
    }
    scale.value = 0.3
    opacity.value = 1
    scale.value = withSequence(
      withSpring(1.15, { damping: 8, stiffness: 260 }),
      withTiming(1, { duration: 120 }),
      withTiming(0.0, { duration: 260 }),
    )
    opacity.value = withSequence(
      withTiming(1, { duration: 500 }),
      withTiming(0, { duration: 260 }),
    )
  }
  const node = (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        inset: 0,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View style={style}>
        <View
          style={{
            width: 112,
            height: 112,
            borderRadius: 56,
            backgroundColor: "#121513b3",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Sprout size={64} color="#8fcaa6" strokeWidth={2} />
        </View>
      </Animated.View>
    </View>
  )
  return { fire, node }
}

export function VideoMedia({
  uri,
  active,
  style,
  showMute = true,
  loop = true,
  onReady,
  onError,
}: {
  uri: string
  active: boolean
  style: ViewStyle
  showMute?: boolean
  loop?: boolean
  /** The first frame can play (``readyToPlay``). */
  onReady?: () => void
  onError?: () => void
}) {
  const [muted, setMuted] = useState(true)
  const player = useVideoPlayer(uri, (p) => {
    p.loop = loop
    p.muted = true
  })
  const ready = useRef(onReady)
  ready.current = onReady
  const failed = useRef(onError)
  failed.current = onError
  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status }) => {
      if (status === "readyToPlay") ready.current?.()
      else if (status === "error") failed.current?.()
    })
    return () => sub.remove()
  }, [player])
  useEffect(() => {
    try {
      if (active) player.play()
      else player.pause()
    } catch {}
  }, [active, player])
  useEffect(() => {
    try {
      player.muted = muted
    } catch {}
  }, [muted, player])
  return (
    <View style={style}>
      <VideoView
        player={player}
        nativeControls={false}
        contentFit="cover"
        style={{ width: "100%", height: "100%" }}
      />
      {showMute && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={muted ? "Unmute" : "Mute"}
          onPress={() => setMuted((m) => !m)}
          style={{
            position: "absolute",
            right: 12,
            bottom: 12,
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: "#000a",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {muted ? (
            <VolumeX size={16} color="#fff" />
          ) : (
            <Volume2 size={16} color="#fff" />
          )}
        </Pressable>
      )}
    </View>
  )
}

export const kindIcon = (kind: string) =>
  /workout|lift|pr|run|training/i.test(kind)
    ? Dumbbell
    : /habit|streak|routine/i.test(kind)
      ? Target
      : /saving|finance|budget|money/i.test(kind)
        ? Wallet
        : /task/i.test(kind)
          ? CheckSquare
          : /meal|nutrition|protein|weigh/i.test(kind)
            ? Flame
            : /trophy|achievement/i.test(kind)
              ? TrophyIcon
              : /goal/i.test(kind)
                ? Target
                : /check-in/i.test(kind)
                  ? CircleCheck
                  : Sparkles

const INK = "#0b0c0b"
/** ``#rrggbb`` at an opacity, for the always-dark card. */
const tint = (hex: string, o: number) =>
  `${hex.slice(0, 7)}${Math.round(o * 255)
    .toString(16)
    .padStart(2, "0")}`

/** Rendered progress attachment — the in-app form of a share card: always
 * dark like the share cards, the area's colour only as glow and accents. */
export function ProgressCard({
  progress,
  width,
  height,
  compact = false,
}: {
  progress: Progress
  width: number
  height?: number
  compact?: boolean
}) {
  const h = height ?? width * 1.0
  if (progress.image)
    return (
      <Image
        source={{ uri: progress.image }}
        accessibilityLabel={`${progress.kind}: ${progress.title}`}
        resizeMode="cover"
        style={{ width, height: h, backgroundColor: "#000" }}
      />
    )
  // The dark palette's accents: bright enough on the dark card either way.
  const accent = palette.dark[progress.accent]
  const Icon = kindIcon(progress.kind)
  const pad = compact ? 10 : Math.max(18, width * 0.07)
  const stats = progress.stats.slice(0, compact ? 2 : 3)
  // Numbers shrink to their column instead of cutting off ("3,343…"); a
  // mono digit is ~0.6 em wide. (adjustsFontSizeToFit is native only.)
  const statSize = compact ? 13 : Math.min(28, width * 0.07),
    column =
      (width - 2 * pad - (compact ? 6 : 10) * (stats.length - 1)) /
      Math.max(1, stats.length),
    sizeOf = (st: ProgressStat) => {
      const chars = st.value.length + (st.unit ? st.unit.length * 0.6 + 0.5 : 0)
      return Math.min(statSize, column / (chars * 0.62))
    }
  const checkIn =
    progress.day && progress.of
      ? Math.max(0, Math.min(1, progress.day / progress.of))
      : null
  return (
    <LinearGradient
      accessibilityRole="image"
      accessibilityLabel={`${progress.kind}: ${progress.title}. ${progress.stats.map((s) => `${s.label} ${s.value}${s.unit ?? ""}`).join(", ")}`}
      colors={[tint(accent, 0.34), INK]}
      locations={[0, 0.72]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.85, y: 1 }}
      style={{
        width,
        height: h,
        padding: pad,
        justifyContent: "space-between",
        overflow: "hidden",
        backgroundColor: INK,
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          right: -width * 0.12,
          bottom: -width * 0.1,
        }}
      >
        <Icon
          size={width * 0.62}
          color={tint(accent, 0.09)}
          strokeWidth={1.25}
        />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View
          style={{
            width: compact ? 22 : 30,
            height: compact ? 22 : 30,
            borderRadius: compact ? 7 : 10,
            backgroundColor: tint(accent, 0.18),
            borderWidth: 1,
            borderColor: tint(accent, 0.35),
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon size={compact ? 12 : 16} color={accent} strokeWidth={2} />
        </View>
        <Text
          numberOfLines={1}
          style={{
            color: accent,
            fontFamily: fonts.mono,
            fontSize: compact ? 8.5 : 11,
            letterSpacing: 1.2,
            textTransform: "uppercase",
            flex: 1,
          }}
        >
          {progress.kind}
        </Text>
        {!compact && progress.day ? (
          <Text
            style={{
              color: "#ffffffcc",
              fontFamily: fonts.mono,
              fontSize: 11,
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 99,
              borderWidth: 1,
              borderColor: "#ffffff26",
            }}
          >
            DAY {progress.day}
            {progress.of ? `/${progress.of}` : ""}
          </Text>
        ) : null}
      </View>
      <View style={{ gap: compact ? 2 : 6 }}>
        {progress.subtitle && !compact && (
          <Text
            numberOfLines={1}
            style={{
              color: "#ffffff99",
              fontFamily: fonts.medium,
              fontSize: 13,
            }}
          >
            {progress.subtitle}
          </Text>
        )}
        <Text
          numberOfLines={2}
          style={{
            color: "#fff",
            fontFamily: fonts.display,
            fontSize: compact ? 15 : Math.min(38, width * 0.095),
            lineHeight: compact ? 18 : Math.min(42, width * 0.105),
            letterSpacing: compact ? -0.2 : -0.8,
          }}
        >
          {progress.title}
        </Text>
      </View>
      {!compact && progress.spark && progress.spark.length > 1 && (
        <View style={{ marginHorizontal: -pad }}>
          <Sparkline
            values={progress.spark}
            color={accent}
            area={false}
            height={Math.min(72, h * 0.18)}
            label={`${progress.title} trend`}
          />
        </View>
      )}
      <View style={{ gap: compact ? 6 : 12 }}>
        {checkIn !== null && (
          <View
            style={{
              height: compact ? 3 : 4,
              borderRadius: 2,
              backgroundColor: "#ffffff1a",
              overflow: "hidden",
            }}
          >
            <View
              style={{
                width: `${checkIn * 100}%`,
                height: "100%",
                backgroundColor: accent,
              }}
            />
          </View>
        )}
        <View
          style={{
            flexDirection: "row",
            gap: compact ? 6 : 10,
            paddingTop: compact ? 6 : 12,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderColor: "#ffffff2e",
          }}
        >
          {stats.map((s) => (
            <View key={s.label} style={{ flex: 1, minWidth: 0 }}>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.55}
                style={{
                  color: "#fff",
                  fontFamily: fonts.mono,
                  fontSize: sizeOf(s),
                  // One line height for all, so a shrunk number keeps its row.
                  lineHeight: statSize * 1.2,
                  letterSpacing: -0.5,
                }}
              >
                {s.value}
                {s.unit && (
                  <Text
                    style={{
                      fontSize: Math.min(compact ? 8 : 12, sizeOf(s) * 0.6),
                      fontFamily: fonts.medium,
                      color: "#ffffff8c",
                      letterSpacing: 0,
                    }}
                  >
                    {" "}
                    {s.unit}
                  </Text>
                )}
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  color: "#ffffff80",
                  fontFamily: fonts.medium,
                  fontSize: compact ? 7.5 : 10,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  marginTop: 2,
                }}
              >
                {s.label}
              </Text>
            </View>
          ))}
        </View>
        {!compact && (
          <Text
            style={{
              fontFamily: fonts.semibold,
              fontSize: 11,
              color: "#ffffff73",
              letterSpacing: -0.2,
            }}
          >
            unfurl
          </Text>
        )}
      </View>
    </LinearGradient>
  )
}
/**
 * Paged media with dots, double-tap to like and a heart burst. Progress
 * attachments render as the last page.
 */
export function MediaCarousel({
  media,
  progress,
  width,
  active,
  onDoubleTap,
}: {
  media: Media[]
  progress?: Progress
  width: number
  active: boolean
  onDoubleTap: () => void
}) {
  const t = useTheme()
  const [page, setPage] = useState(0)
  const burst = useCheerBurst()
  // Photos lead; the stat strip under them carries the numbers, so the
  // rendered card is a page only when there is no photo to show.
  const pair =
    progress?.beforeAfter &&
    media.length >= 2 &&
    media[0].kind === "image" &&
    media[1].kind === "image"
  const shown = pair ? media.slice(2) : media
  const card = progress && !media.length
  const pages = (pair ? 1 : 0) + shown.length + (card ? 1 : 0)
  // Square when a stat strip follows, so the numbers stay near the photo;
  // 4:5 for a plain photo post and for a card-only post.
  const height = Math.round(width * (progress && !card ? 1 : 1.25))
  // The worklet may close over plain functions only: `burst` also holds the
  // heart element, which Worklets cannot copy (the feed failed to render).
  const fire = burst.fire
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(260)
    .onEnd(() => {
      runOnJS(fire)()
      runOnJS(onDoubleTap)()
    })
  if (!pages) return null
  return (
    <GestureDetector gesture={doubleTap}>
      <View collapsable={false}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={32}
          onScroll={(e) =>
            setPage(Math.round(e.nativeEvent.contentOffset.x / width))
          }
          style={{ width, height }}
        >
          {pair && (
            <BeforeAfter
              before={media[0]}
              after={media[1]}
              width={width}
              height={height}
              active={active}
            />
          )}
          {shown.map((m, i) =>
            m.kind === "video" ? (
              <VideoMedia
                key={m.uri + i}
                uri={m.uri}
                active={active && page === i}
                style={{ width, height, backgroundColor: "#000" }}
              />
            ) : (
              <View
                key={m.uri + i}
                style={{
                  backgroundColor: m.ratio && m.ratio < 0.75 ? "#000" : t.soft,
                }}
              >
                <RemoteImage
                  media={m}
                  width={width}
                  height={height}
                  // Tall share cards (9:16) letterbox instead of cropping.
                  fit={m.ratio && m.ratio < 0.75 ? "contain" : "cover"}
                  active={active}
                  accessibilityLabel={`Photo ${i + 1 + (pair ? 1 : 0)} of ${pages}`}
                />
              </View>
            ),
          )}
          {card && (
            <ProgressCard progress={progress} width={width} height={height} />
          )}
        </ScrollView>
        {burst.node}
        {progress && !card && (
          <DayBadge progress={progress} style={{ top: 12, left: 12 }} />
        )}
        {pages > 1 && (
          <View
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              paddingHorizontal: 9,
              paddingVertical: 3,
              borderRadius: 12,
              backgroundColor: "#000a",
            }}
          >
            <Text
              style={{ color: "#fff", fontSize: 12, fontFamily: fonts.medium }}
            >
              {page + 1}/{pages}
            </Text>
          </View>
        )}
        {pages > 1 && (
          <View
            style={{
              position: "absolute",
              bottom: 10,
              alignSelf: "center",
              flexDirection: "row",
              justifyContent: "center",
              gap: 4,
              paddingHorizontal: 8,
              paddingVertical: 5,
              borderRadius: 999,
              backgroundColor: "#121513b3",
            }}
          >
            {Array.from({ length: pages }, (_, i) => (
              <View
                key={i}
                style={{
                  width: i === page ? 14 : 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor:
                    i === page ? palette.dark.primary : "#ffffff66",
                }}
              />
            ))}
          </View>
        )}
      </View>
    </GestureDetector>
  )
}

const trophyIcon = {
  pr: Medal,
  streak: Flame,
  best: Award,
  goal: Target,
  first: Sparkles,
}
const trophyAccent: Record<Trophy["type"], Accent> = {
  pr: "fit",
  streak: "life",
  best: "hab",
  goal: "fin",
  first: "tsk",
}
export function TrophyChip({ trophy }: { trophy: Trophy }) {
  const t = useTheme()
  const Icon = trophyIcon[trophy.type]
  const c = t[trophyAccent[trophy.type]]
  return (
    <View
      style={{
        width: 112,
        padding: 12,
        borderRadius: 16,
        backgroundColor: t.card,
        borderWidth: 1,
        borderColor: t.line,
        gap: 6,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: `${c}26`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={16} color={c} />
      </View>
      <Text
        style={{ fontFamily: fonts.display, fontSize: 18, color: t.text }}
        numberOfLines={1}
      >
        {trophy.value}
      </Text>
      <Text
        numberOfLines={2}
        style={{
          fontFamily: fonts.medium,
          fontSize: 12,
          lineHeight: 16,
          color: t.muted,
        }}
      >
        {trophy.title}
      </Text>
    </View>
  )
}

/** Before and after, side by side, labelled. */
function BeforeAfter({
  before,
  after,
  width,
  height,
  active,
}: {
  before: Media
  after: Media
  width: number
  height: number
  active: boolean
}) {
  const _t = useTheme()
  const half = (width - 2) / 2
  const label = (text: string) => (
    <View
      style={{
        position: "absolute",
        bottom: 12,
        left: 12,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: "#000000a6",
      }}
    >
      <Text
        style={{
          color: "#fff",
          fontFamily: fonts.bold,
          fontSize: 11,
          letterSpacing: 1,
        }}
      >
        {text}
      </Text>
    </View>
  )
  return (
    <View
      accessibilityLabel="Before and after photos"
      style={{ width, height, flexDirection: "row", gap: 2 }}
    >
      {[
        { media: before, text: "BEFORE" },
        { media: after, text: "NOW" },
      ].map((x) => (
        <View key={x.text} style={{ width: half, height }}>
          <RemoteImage
            media={x.media}
            width={half}
            height={height}
            active={active}
          />
          {label(x.text)}
        </View>
      ))}
    </View>
  )
}

/** "Day 12 of 30", "Day 214", or null when the card is not a check-in. */
export function dayLabel(p?: Progress) {
  if (!p?.day) return null
  return p.of ? `Day ${p.day} of ${p.of}` : `Day ${p.day}`
}

/** Where a progress card sits in the feed's area filter. */
export type FeedArea = "habits" | "fitness" | "tasks" | "finance"
export const FEED_AREAS: { key: FeedArea; label: string; accent: Accent }[] = [
  { key: "habits", label: "Habits", accent: "hab" },
  { key: "fitness", label: "Fitness", accent: "fit" },
  { key: "tasks", label: "Tasks", accent: "tsk" },
  { key: "finance", label: "Finance", accent: "fin" },
]
const AREA_OF: Record<Accent, FeedArea | null> = {
  hab: "habits",
  life: "habits",
  fit: "fitness",
  nut: "fitness",
  foc: "tasks",
  tsk: "tasks",
  fin: "finance",
  // Screen time has no feed filter of its own.
  scr: null,
  primary: null,
}
export const areaOf = (p?: Progress) => (p ? AREA_OF[p.accent] : null)

/** Translucent "🔥 DAY 41 OF 84" pill over a photo. */
export function DayBadge({
  progress,
  style,
}: {
  progress: Progress
  style?: ViewStyle
}) {
  const label = dayLabel(progress)
  if (!label) return null
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: "#121513cc",
        ...style,
      }}
    >
      <Sprout size={14} color={palette.dark.primary} strokeWidth={2} />
      <Text
        style={{
          color: "#fff",
          fontFamily: fonts.medium,
          fontSize: 12,
        }}
      >
        {label}
      </Text>
    </View>
  )
}

/** What a post is progress on: icon, title and kind, in the area colour. */
export function ProgressContext({ progress }: { progress: Progress }) {
  const t = useTheme()
  const c = t[progress.accent]
  const Icon = kindIcon(progress.kind)
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Icon size={13} color={c} />
      <Text
        numberOfLines={1}
        style={{ flex: 1, fontFamily: fonts.medium, fontSize: 12, color: c }}
      >
        {progress.title}
        <Text style={{ color: t.muted }}> · {progress.kind}</Text>
      </Text>
    </View>
  )
}

/** The post's own numbers under its photo, with a day-of-target bar. */
export function StatStrip({ progress }: { progress: Progress }) {
  const t = useTheme()
  const c = t[progress.accent]
  const stats = progress.stats.slice(0, 3)
  const pct =
    progress.day && progress.of ? Math.min(1, progress.day / progress.of) : null
  if (!stats.length && pct === null) return null
  return (
    <View
      style={{
        marginHorizontal: 12,
        padding: 12,
        gap: 10,
        borderRadius: 14,
        backgroundColor: t.card,
        borderWidth: 1,
        borderColor: t.line,
      }}
    >
      {pct !== null && (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text
              style={{
                flex: 1,
                color: t.text,
                fontFamily: fonts.semibold,
                fontSize: 13,
              }}
            >
              {dayLabel(progress)}
            </Text>
            <Text
              style={{ color: t.muted, fontFamily: fonts.medium, fontSize: 12 }}
            >
              {pct >= 1 ? "Done" : `${Math.round(pct * 100)}%`}
            </Text>
          </View>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{
              min: 0,
              max: progress.of,
              now: Math.min(progress.day ?? 0, progress.of ?? 0),
            }}
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: t.soft,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                width: `${pct * 100}%`,
                height: 6,
                borderRadius: 3,
                backgroundColor: c,
              }}
            />
          </View>
        </View>
      )}
      {stats.length > 0 && (
        <View style={{ flexDirection: "row", gap: 12 }}>
          {stats.map((x) => (
            <View key={x.label} style={{ flex: 1, gap: 2 }}>
              <Text
                numberOfLines={1}
                style={{
                  color: t.text,
                  fontFamily: fonts.display,
                  fontSize: 20,
                }}
              >
                {x.value}
                {x.unit ? (
                  <Text
                    style={{
                      fontSize: 12,
                      fontFamily: fonts.medium,
                      color: t.muted,
                    }}
                  >
                    {" "}
                    {x.unit}
                  </Text>
                ) : null}
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  color: t.muted,
                  fontFamily: fonts.medium,
                  fontSize: 11,
                }}
              >
                {x.label}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

/** Encouragement in place of a like: three kinds, one per person. */
export function CheerBar({ post }: { post: Post }) {
  const t = useTheme()
  const counts = cheerCounts(post)
  const mine: Cheer | undefined =
    post.myCheer ?? (post.liked ? "keep_going" : undefined)
  return (
    <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12 }}>
      {CHEERS.map((c) => {
        const on = mine === c.kind
        const Icon = CHEER_ICON[c.kind]
        return (
          <Pressable
            cssInterop={false}
            key={c.kind}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${c.label}, ${counts[c.kind]}${on ? ". Tap to take back" : ""}`}
            onPress={() => {
              haptic.tap()
              cheer(post.id, c.kind)
            }}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 48,
              paddingVertical: 6,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              borderWidth: 1,
              borderColor: on ? t.primary : t.line,
              backgroundColor: on ? `${t.primary}22` : t.card,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            })}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <Icon
                size={16}
                color={on ? t.primary : t.muted}
                strokeWidth={on ? 2 : 1.75}
              />
              <Text
                style={{
                  color: t.text,
                  fontFamily: fonts.mono,
                  fontSize: 14,
                }}
              >
                {compact(counts[c.kind])}
              </Text>
            </View>
            <Text
              numberOfLines={1}
              style={{
                color: on ? t.text : t.muted,
                fontFamily: fonts.medium,
                fontSize: 11,
              }}
            >
              {c.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** A check-in over a story or its composer: "Day 12 of 30", what was done,
 * and how far along the target it is. */
export function CheckInOverlay({ progress }: { progress: Progress }) {
  const t = useTheme()
  const c = t[progress.accent]
  const pct =
    progress.day && progress.of ? Math.min(1, progress.day / progress.of) : null
  return (
    <View
      style={{
        gap: 8,
        padding: 16,
        borderRadius: 20,
        backgroundColor: "#000000a6",
      }}
    >
      {progress.day ? (
        <Text
          style={{
            color: "#fff",
            fontFamily: fonts.display,
            fontSize: 40,
            lineHeight: 46,
          }}
        >
          Day {progress.day}
          {progress.of ? (
            <Text style={{ fontSize: 20, color: "#ffffffb3" }}>
              {" "}
              of {progress.of}
            </Text>
          ) : null}
        </Text>
      ) : progress.subtitle ? (
        <Text
          style={{
            color: "#ffffffb3",
            fontFamily: fonts.semibold,
            fontSize: 12,
            letterSpacing: 1,
          }}
        >
          {progress.subtitle.toUpperCase()}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <CircleCheck size={20} color={c} />
        <Text
          style={{
            flex: 1,
            color: "#fff",
            fontFamily: fonts.semibold,
            fontSize: 18,
          }}
        >
          {progress.title}
        </Text>
      </View>
      {pct !== null && (
        <View
          style={{
            height: 6,
            borderRadius: 3,
            backgroundColor: "#ffffff33",
            overflow: "hidden",
          }}
        >
          <View
            style={{
              width: `${pct * 100}%`,
              height: 6,
              borderRadius: 3,
              backgroundColor: c,
            }}
          />
        </View>
      )}
    </View>
  )
}

/** A check-in with no photo: its card on the area's colour. */
export function CheckInSlide({
  progress,
  width,
  height,
}: {
  progress: Progress
  width: number
  height: number
}) {
  const t = useTheme()
  return (
    <LinearGradient
      colors={[t[progress.accent], "#06070a"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.6, y: 1 }}
      style={{ width, height, justifyContent: "center", padding: 24 }}
    >
      <CheckInOverlay progress={progress} />
    </LinearGradient>
  )
}

/** A check-in card: a story kind "progress" that only says what was done. */
export const isCheckIn = (p?: Progress) =>
  !!p && (p.kind === "Check-in" || !p.stats.length)

/** A note's speech bubble above an avatar. */
export function Bubble({ text, mine }: { text?: string; mine?: boolean }) {
  const t = useTheme()
  return (
    <View
      style={{
        position: "absolute",
        top: -6,
        left: -6,
        right: -6,
        alignItems: "center",
        zIndex: 2,
      }}
    >
      <View
        style={{
          backgroundColor: t.card,
          borderRadius: 14,
          paddingHorizontal: 10,
          paddingVertical: 6,
          maxWidth: 96,
          borderWidth: 1,
          borderColor: t.line,
          boxShadow: "0px 2px 8px #0002",
        }}
      >
        <Text
          numberOfLines={2}
          style={{
            color: text ? t.text : t.muted,
            fontSize: 11,
            lineHeight: 14,
            fontFamily: fonts.body,
            textAlign: "center",
          }}
        >
          {text ?? (mine ? "Note…" : "")}
        </Text>
      </View>
    </View>
  )
}

/** Leave or change my note: opened from the inbox and from the feed's
 * Create sheet. */
export function NoteComposer({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const t = useTheme()
  const mine = socialStore.use((s) => s.notes.find((n) => n.by === ME))
  const [text, setText] = useState(mine?.text ?? "")
  const ideas = [
    "leg day 🦵",
    "5K this weekend?",
    "meal prep done ✅",
    "day 30 of no sugar",
    "need a gym buddy",
  ]
  return (
    <Sheet title="New note" open={open} onClose={onClose}>
      <View style={{ alignItems: "center", gap: 14, paddingTop: 12 }}>
        <View style={{ paddingTop: 50 }}>
          <Bubble text={text || undefined} mine />
          <Avatar id={ME} size={88} ring={false} />
        </View>
        <TextInput
          value={text}
          onChangeText={(v) => setText(v.slice(0, 60))}
          placeholder="Share a thought…"
          placeholderTextColor={t.muted}
          accessibilityLabel="Note text"
          autoFocus
          style={{
            alignSelf: "stretch",
            minHeight: 48,
            borderRadius: 14,
            paddingHorizontal: 14,
            backgroundColor: t.soft,
            color: t.text,
            fontFamily: fonts.body,
            fontSize: 16,
            textAlign: "center",
          }}
        />
        <Text style={{ color: t.muted, fontSize: 12 }}>
          {text.length}/60 · Shared with followers you follow back for 24 hours
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6 }}
        >
          {ideas.map((i) => (
            <Pressable
              key={i}
              accessibilityRole="button"
              onPress={() => setText(i)}
              style={{
                paddingHorizontal: 12,
                minHeight: 32,
                justifyContent: "center",
                borderRadius: 16,
                borderWidth: 1,
                borderColor: t.line,
              }}
            >
              <Text
                style={{ color: t.text, fontSize: 13, fontFamily: fonts.body }}
              >
                {i}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 8, alignSelf: "stretch" }}>
          {mine && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                clearNote()
                setText("")
                onClose()
              }}
              style={{
                flex: 1,
                minHeight: 44,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: t.soft,
              }}
            >
              <Text style={{ color: t.bad, fontFamily: fonts.semibold }}>
                Delete note
              </Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !text.trim() }}
            disabled={!text.trim()}
            onPress={() => {
              setNote(text.trim())
              haptic.done()
              onClose()
            }}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: t.primary,
              opacity: text.trim() ? 1 : 0.4,
            }}
          >
            <Text style={{ color: t.onPrimary, fontFamily: fonts.semibold }}>
              Share
            </Text>
          </Pressable>
        </View>
      </View>
    </Sheet>
  )
}
