import * as Haptics from "expo-haptics"
import {
  Archive,
  ArrowDown,
  CalendarDays,
  Check,
  ChevronLeft,
  Clock,
  Ellipsis,
  type LucideIcon,
  Trash2,
  X,
} from "lucide-react-native"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { ScrollViewInstance } from "react-native"
import {
  Alert,
  AppState,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  useWindowDimensions,
  View,
} from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable"
import {
  KeyboardAwareScrollView,
  KeyboardStickyView,
  useKeyboardState,
} from "react-native-keyboard-controller"
import Animated, {
  FadeIn,
  FadeOut,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { screenShown } from "./boot/first-screen"
import { formatPick, parseDay, startOf, toClock, toDay } from "./date-pick"
import { useFollowBottom } from "./follow"
import { FIELD_CLEARANCE, formScrollProps } from "./form-scroll"

export { formScrollProps }

import { feel } from "./motion"
import { back, go } from "./navigation"
import { Switch } from "./switch"
import { fonts, useTheme } from "./theme"

export function Label({
  children,
  muted = false,
  large = false,
}: {
  children: ReactNode
  muted?: boolean
  large?: boolean
}) {
  const t = useTheme()
  return (
    <Text
      style={{
        color: muted ? t.muted : t.text,
        fontSize: large ? 28 : 15,
        fontFamily: large ? fonts.mono : fonts.body,
        fontVariant: ["tabular-nums"],
        lineHeight: large ? 34 : 22,
      }}
    >
      {children}
    </Text>
  )
}
export function Title({ children }: { children: ReactNode }) {
  const t = useTheme()
  return (
    <Text
      accessibilityRole="header"
      style={{
        fontSize: 20,
        fontFamily: fonts.display,
        color: t.text,
        marginTop: 12,
        marginBottom: 8,
      }}
    >
      {children}
    </Text>
  )
}
export function Button({
  children,
  icon: Icon,
  onPress,
  href,
  tone = "primary",
  disabled = false,
  small = false,
}: {
  children: string
  icon?: LucideIcon
  onPress?: () => void
  href?: string
  tone?: "primary" | "quiet" | "danger"
  disabled?: boolean
  small?: boolean
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const scale = useSharedValue(1)
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))
  return (
    <Animated.View style={style}>
      <Pressable
        cssInterop={false}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          void Haptics.selectionAsync().catch(() => {})
          // A full button ends editing, as on iOS: whatever it opens or saves
          // must not sit under a keyboard left up by the last field.
          Keyboard.dismiss()
          if (href) go(href)
          else onPress?.()
        }}
        onPressIn={() => {
          scale.value = reduced ? 1 : withSpring(0.97)
        }}
        onPressOut={() => {
          scale.value = reduced ? 1 : withSpring(1)
        }}
        style={({ pressed }) => ({
          minHeight: small ? 36 : 44,
          flexDirection: "row",
          gap: 8,
          paddingHorizontal: small ? 12 : 18,
          paddingVertical: small ? 8 : 11,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          // The brand's one filled button is moss on every screen; area
          // colours stay on data (ADR-0019). Quiet buttons are outlined.
          backgroundColor:
            tone === "quiet"
              ? t.card
              : tone === "danger"
                ? `${t.bad}26`
                : t.primary,
          borderWidth: tone === "quiet" ? 1 : 0,
          borderColor: t.input,
          opacity: disabled ? 0.4 : pressed ? 0.72 : 1,
        })}
      >
        {Icon && (
          <Icon
            size={16}
            color={
              tone === "quiet"
                ? t.text
                : tone === "danger"
                  ? t.bad
                  : t.onPrimary
            }
          />
        )}
        <Text
          style={{
            fontSize: 14,
            fontFamily: fonts.semibold,
            color:
              tone === "quiet"
                ? t.text
                : tone === "danger"
                  ? t.bad
                  : t.onPrimary,
          }}
        >
          {children}
        </Text>
      </Pressable>
    </Animated.View>
  )
}
export function Actions({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        marginVertical: 8,
      }}
    >
      {children}
    </View>
  )
}
export function Card({ children }: { children: ReactNode }) {
  const t = useTheme()
  return (
    <View
      style={{
        backgroundColor: t.card,
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: t.line,
        gap: 8,
        marginBottom: 12,
      }}
    >
      {children}
    </View>
  )
}
export function Field({
  label,
  value,
  onChangeText,
  error,
  hideLabel = false,
  ...props
}: TextInputProps & { label: string; error?: string; hideLabel?: boolean }) {
  const t = useTheme()
  return (
    <View style={{ gap: 6, marginVertical: 6 }}>
      {!hideLabel && (
        <Text
          style={{ fontSize: 12, fontFamily: fonts.medium, color: t.muted }}
        >
          {label}
        </Text>
      )}
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={t.muted}
        style={{
          minHeight: 44,
          borderWidth: 1,
          borderColor: error ? t.bad : t.line,
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingVertical: 10,
          fontSize: 14,
          fontFamily: fonts.body,
          color: t.text,
          backgroundColor: t.card,
          textAlignVertical: props.multiline ? "top" : "center",
        }}
        {...props}
      />
      {error && (
        <Text accessibilityRole="alert" style={{ color: t.bad }}>
          {error}
        </Text>
      )}
    </View>
  )
}
export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  const t = useTheme()
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        minHeight: 52,
      }}
    >
      <Text
        style={{ color: t.text, flex: 1, fontSize: 15, fontFamily: fonts.body }}
      >
        {label}
      </Text>
      <Switch label={label} value={value} onChange={onChange} />
    </View>
  )
}
export function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
  wrap = false,
}: {
  label?: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  wrap?: boolean
}) {
  const t = useTheme(),
    content = options.map((o) => (
      <Pressable
        key={o.value}
        accessibilityRole="button"
        accessibilityState={{ selected: o.value === value }}
        onPress={() => onChange(o.value)}
        style={{
          minHeight: 44,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 24,
          // Selected is a 2 pt ink outline and a check, never colour alone
          // (ADR-0019); the rest sit on a hairline.
          borderWidth: o.value === value ? 2 : 1,
          borderColor: o.value === value ? t.text : t.line,
          flexDirection: "row",
          gap: 6,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: t.card,
        }}
      >
        {o.value === value && <Check size={14} color={t.text} />}
        <Text
          style={{
            color: t.text,
            fontSize: 14,
            lineHeight: 20,
            fontFamily: fonts.medium,
          }}
        >
          {o.label}
        </Text>
      </Pressable>
    ))
  return (
    <View style={{ gap: 6, marginVertical: 6 }}>
      {label && (
        <Text
          style={{ fontSize: 12, fontFamily: fonts.medium, color: t.muted }}
        >
          {label}
        </Text>
      )}
      {wrap ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {content}
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6 }}
        >
          {content}
        </ScrollView>
      )}
    </View>
  )
}
export function Row({
  title,
  detail,
  href,
  onPress,
  onLongPress,
  longPressLabel = "Actions",
  right,
}: {
  title: string
  detail?: string
  href?: string
  onPress?: () => void
  /** A second gesture on the row, e.g. an actions sheet; also offered to
   * VoiceOver as a named action. */
  onLongPress?: () => void
  longPressLabel?: string
  right?: ReactNode
}) {
  const t = useTheme()
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: t.line,
        minHeight: 68,
        gap: 8,
      }}
    >
      <Pressable
        accessibilityRole={href || onPress ? "button" : undefined}
        accessibilityHint={onLongPress ? "Long press for actions" : undefined}
        accessibilityActions={
          onLongPress
            ? [{ name: "longpress", label: longPressLabel }]
            : undefined
        }
        onAccessibilityAction={
          onLongPress
            ? (e) => {
                if (e.nativeEvent.actionName === "longpress") onLongPress()
              }
            : undefined
        }
        onLongPress={onLongPress}
        delayLongPress={onLongPress ? 350 : undefined}
        onPress={() => (href ? go(href) : onPress?.())}
        disabled={!href && !onPress}
        cssInterop={false}
        style={({ pressed }) => ({
          flex: 1,
          paddingVertical: 12,
          paddingRight: 4,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text
          style={{ fontSize: 16, fontFamily: fonts.semibold, color: t.text }}
        >
          {title}
        </Text>
        {detail && (
          <Text
            style={{
              fontSize: 13,
              color: t.muted,
              fontFamily: fonts.body,
              lineHeight: 19,
              marginTop: 4,
            }}
          >
            {detail}
          </Text>
        )}
      </Pressable>
      {right}
      {href && <Text style={{ color: t.muted }}>›</Text>}
    </View>
  )
}
export function Empty({
  title = "Nothing here yet",
  action,
  detail = "Add your first entry to get started.",
  icon: Icon = Archive,
}: {
  title?: string
  action?: ReactNode
  detail?: string
  icon?: LucideIcon
}) {
  const t = useTheme()
  return (
    <View
      style={{
        alignItems: "center",
        paddingHorizontal: 24,
        paddingVertical: 40,
        gap: 8,
      }}
    >
      <Icon size={32} color={t.muted} />
      <Text
        style={{
          fontFamily: fonts.semibold,
          fontSize: 16,
          lineHeight: 24,
          color: t.text,
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          fontFamily: fonts.body,
          fontSize: 14,
          lineHeight: 20,
          color: t.muted,
          textAlign: "center",
          maxWidth: 300,
        }}
      >
        {detail}
      </Text>
      {action && <View style={{ marginTop: 8 }}>{action}</View>}
    </View>
  )
}
/** Pauses the page's scrolling while a drag inside it runs. */
export const ScrollLock = createContext<(locked: boolean) => void>(() => {})
/** Scrolls the page so content down to ``y`` (from the top of the page's
 * content) shows above its bottom edge; no-op when it already does. */
export const PageScroll = createContext<(y: number) => void>(() => {})
/** Scrolls the page by ``dy`` points within its content (a drag held at the
 * screen's edge, while ScrollLock holds the page); returns how far it went. */
export const PageNudge = createContext<(dy: number) => number>(() => 0)

/** How close to the end of a page (pt) its next rows are added. */
const END_DISTANCE = 600
/** Rows a long list opens with: a little more than a screen of them. */
const FIRST_PAGE = 15
/** A long list's rows a page at a time: a screenful first, then `page`
 * more each time `more` is called (pass it to Screen's onEndReached).
 * Rendering every row of years of history at once is what made those
 * screens slow to open; `resetKey` (a search, a filter) starts again from
 * the first page. */
export function usePaged<T>(rows: T[], resetKey: unknown = null, page = 30) {
  const first = FIRST_PAGE
  const [shown, setShown] = useState({ key: resetKey, n: first })
  const fresh = !Object.is(shown.key, resetKey)
  // A new search or filter: back to the first page (React's "adjust state
  // while rendering" pattern, so no render shows the old count).
  if (fresh) setShown({ key: resetKey, n: first })
  const n = fresh ? first : shown.n
  const hasMore = rows.length > n
  const more = useCallback(() => {
    if (hasMore) setShown((cur) => ({ ...cur, n: cur.n + page }))
  }, [hasMore, page])
  return { rows: hasMore ? rows.slice(0, n) : rows, more, hasMore }
}
/** Rows by key in one pass, in their order (a list grouped under day
 * headings, without filtering the whole list again for every day). */
export function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const row of rows) {
    const k = key(row)
    const list = out.get(k)
    if (list) list.push(row)
    else out.set(k, [row])
  }
  return out
}
/** The end of a list with more rows to come: a dimmed row while the next
 * page renders. */
export function MoreRows() {
  const t = useTheme()
  return (
    <View
      accessibilityLabel="Loading more"
      style={{ paddingVertical: 14, gap: 8, opacity: 0.6 }}
    >
      {[0.7, 0.45].map((w) => (
        <View
          key={w}
          style={{
            width: `${w * 100}%`,
            height: 12,
            borderRadius: 6,
            backgroundColor: t.soft,
          }}
        />
      ))}
    </View>
  )
}

export function Screen({
  title,
  onTitlePress,
  titleContent,
  children,
  actions,
  root = false,
  eyebrow,
  footer,
  pinned,
  prototypeLayout = true,
  scrollToEnd = false,
  onRefresh,
  onEndReached,
}: {
  titleContent?: ReactNode
  title: string
  onTitlePress?: () => void
  children: ReactNode
  actions?: ReactNode
  root?: boolean
  eyebrow?: string
  footer?: ReactNode
  /** Stays under the header while the page scrolls beneath it. */
  pinned?: ReactNode
  prototypeLayout?: boolean
  scrollToEnd?: boolean
  /** Enables pull-to-refresh; resolve when the refresh finishes. */
  onRefresh?: () => unknown
  /** Called as the page scrolls near its end (and while the content is
   * shorter than the screen): a long list shows its next page (usePaged). */
  onEndReached?: () => void
}) {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  const scroller = useRef<ScrollViewInstance>(null)
  // A chat page follows its newest message only while the reader lets it.
  const latest = useFollowBottom(scroller, scrollToEnd)
  // A drag inside the page (reordering a list) pauses its scrolling.
  const [locked, setLocked] = useState(false)
  // A hairline appears under the header once content scrolls beneath it.
  const [scrolled, setScrolled] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [footerHeight, setFooterHeight] = useState(0)
  const slot = useRef<FooterSlotStore>(null)
  if (!slot.current) slot.current = footerSlot()
  const view = useRef({ top: 0, height: 0, content: 0 })
  // The keyboard now covers the bottom of the page instead of shrinking it
  // (see KeyboardAwareScrollView below), so what shows is the page less it.
  const keyboard = useKeyboardState((k) => (k.isVisible ? k.height : 0))
  const covered = useRef(0)
  covered.current = scrollToEnd ? 0 : keyboard
  const reveal = useCallback((y: number) => {
    const { top } = view.current
    const height = view.current.height - covered.current
    if (height <= 0 || y <= top + height) return
    view.current.top = y - height
    scroller.current?.scrollTo({ y: y - height, animated: false })
  }, [])
  const nudge = useCallback((dy: number) => {
    const { top, height, content } = view.current
    const next = Math.max(0, Math.min(Math.max(0, content - height), top + dy))
    if (next === top) return 0
    view.current.top = next
    scroller.current?.scrollTo({ y: next, animated: false })
    return next - top
  }, [])
  const refresh = async () => {
    if (!onRefresh) return
    setRefreshing(true)
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }
  return (
    // A chat page (scrollToEnd) keeps its composer footer on the keyboard by
    // shrinking, so the newest message stays in view; a form page instead
    // scrolls the focused field above the keyboard (KeyboardAwareScrollView).
    <KeyboardAvoidingView
      enabled={scrollToEnd}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: t.bg, paddingTop: safe.top }}
      onLayout={screenShown}
    >
      <Pressable
        accessible={false}
        onPress={Keyboard.dismiss}
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: prototypeLayout && !eyebrow ? 8 : 16,
          paddingVertical: prototypeLayout ? (eyebrow ? 12 : 0) : 4,
          height: prototypeLayout && !eyebrow ? 56 : undefined,
          gap: prototypeLayout && !eyebrow ? 4 : 12,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderColor: scrolled && !pinned ? t.line : "transparent",
        }}
      >
        {!root && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => back()}
            hitSlop={4}
            style={{
              minWidth: prototypeLayout ? 40 : 44,
              minHeight: 44,
              justifyContent: "center",
              alignItems: prototypeLayout ? "center" : undefined,
            }}
          >
            <ChevronLeft size={prototypeLayout ? 20 : 22} color={t.text} />
          </Pressable>
        )}
        <View
          style={{
            flex: 1,
            paddingHorizontal: prototypeLayout && root && !eyebrow ? 8 : 0,
          }}
        >
          {eyebrow && (
            <Text
              style={{
                fontFamily: fonts.medium,
                fontSize: 13,
                lineHeight: 18,
                color: t.muted,
                marginBottom: prototypeLayout ? 0 : 2,
              }}
            >
              {eyebrow}
            </Text>
          )}
          {titleContent ?? (
            <Text
              accessibilityRole="header"
              onPress={onTitlePress}
              style={{
                fontFamily: prototypeLayout
                  ? fonts.displayMedium
                  : fonts.display,
                fontSize: eyebrow ? 24 : root ? 30 : prototypeLayout ? 20 : 22,
                lineHeight: prototypeLayout
                  ? eyebrow
                    ? 32
                    : root
                      ? 36
                      : 28
                  : undefined,
                letterSpacing: prototypeLayout && eyebrow ? -0.6 : undefined,
                color: t.text,
              }}
            >
              {title}
            </Text>
          )}
        </View>
        {actions}
      </Pressable>
      {pinned != null && pinned !== false && (
        <View
          testID="screen-pinned"
          style={{
            paddingHorizontal: 16,
            paddingBottom: 8,
            backgroundColor: t.bg,
            zIndex: 1,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderColor: scrolled ? t.line : "transparent",
          }}
        >
          {pinned}
        </View>
      )}
      <View style={{ flex: 1 }}>
        <KeyboardAwareScrollView
          ref={scroller as never}
          enabled={!scrollToEnd}
          bottomOffset={FIELD_CLEARANCE + footerHeight}
          {...formScrollProps}
          scrollEnabled={!locked}
          scrollEventThrottle={64}
          // Content growing above what the reader sees (an earlier reply
          // settling) does not move it.
          maintainVisibleContentPosition={
            scrollToEnd ? { minIndexForVisible: 0 } : undefined
          }
          onScrollBeginDrag={latest.handlers.onScrollBeginDrag}
          onScrollEndDrag={latest.handlers.onScrollEndDrag}
          onMomentumScrollEnd={latest.handlers.onMomentumScrollEnd}
          onLayout={(e) => {
            view.current.height = e.nativeEvent.layout.height
          }}
          onScroll={(e) => {
            if (scrollToEnd) latest.handlers.onScroll(e)
            const { contentOffset, contentSize, layoutMeasurement } =
              e.nativeEvent
            view.current.top = contentOffset.y
            view.current.content = contentSize.height
            const next = contentOffset.y > 4
            if (next !== scrolled) setScrolled(next)
            if (
              onEndReached &&
              contentOffset.y + layoutMeasurement.height >
                contentSize.height - END_DISTANCE
            )
              onEndReached()
          }}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void refresh()}
                tintColor={t.muted}
                colors={[t.primary]}
              />
            ) : undefined
          }
          onContentSizeChange={(_w, h) => {
            view.current.content = h
            latest.handlers.onContentSizeChange()
            // Not enough rows to scroll yet: the next page fills the screen.
            if (onEndReached && view.current.height && h < view.current.height)
              onEndReached()
          }}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: prototypeLayout ? 0 : 8,
            // Clears the Fern button, which rises ~36pt above the tab bar.
            paddingBottom: safe.bottom + 64,
            gap: prototypeLayout ? 12 : 8,
          }}
        >
          <ScrollLock.Provider value={setLocked}>
            <PageScroll.Provider value={reveal}>
              <PageNudge.Provider value={nudge}>
                <PinnedFooterContext.Provider value={slot.current}>
                  {children}
                </PinnedFooterContext.Provider>
              </PageNudge.Provider>
            </PageScroll.Provider>
          </ScrollLock.Provider>
        </KeyboardAwareScrollView>
        {scrollToEnd && latest.away && (
          <JumpToLatest unread={latest.unread} onPress={latest.jump} />
        )}
      </View>
      <FooterSlot
        store={slot.current}
        fallback={footer}
        render={(node) => (
          <KeyboardStickyView
            enabled={!scrollToEnd}
            // Clear of the home indicator; on the keyboard, that inset is gone.
            offset={{ opened: scrollToEnd ? 0 : safe.bottom }}
            onLayout={(e) =>
              setFooterHeight(
                e.nativeEvent.layout.height - (scrollToEnd ? 0 : safe.bottom),
              )
            }
            style={{ paddingBottom: scrollToEnd ? 0 : safe.bottom }}
          >
            {node}
          </KeyboardStickyView>
        )}
      />
    </KeyboardAvoidingView>
  )
}

/** Back to the newest message of a chat the reader scrolled up in; the dot
 * says something arrived meanwhile. */
export function JumpToLatest({
  unread,
  onPress,
}: {
  unread: boolean
  onPress: () => void
}) {
  const t = useTheme()
  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(150)}
      style={{ position: "absolute", right: 16, bottom: 12 }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          unread ? "Jump to latest, new messages" : "Jump to latest"
        }
        hitSlop={8}
        onPress={() => {
          feel.tap()
          onPress()
        }}
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: t.card,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.line,
          boxShadow: "0px 4px 12px #00000026",
        }}
      >
        <ArrowDown size={18} color={t.text} />
        {unread && (
          <View
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: t.primary,
            }}
          />
        )}
      </Pressable>
    </Animated.View>
  )
}
export function ListScreen<T>({
  title,
  data,
  renderItem,
  header,
  empty,
  actions,
  footer,
}: {
  title: string
  data: T[]
  renderItem: (item: T, index: number) => ReactNode
  header?: ReactNode
  empty?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
}) {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  const [footerHeight, setFooterHeight] = useState(0)
  return (
    <View
      style={{ flex: 1, backgroundColor: t.bg, paddingTop: safe.top }}
      onLayout={screenShown}
    >
      <Pressable
        accessible={false}
        onPress={Keyboard.dismiss}
        style={{
          paddingHorizontal: 8,
          height: 56,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => back()}
          style={{
            width: 40,
            height: 40,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ChevronLeft size={20} color={t.text} />
        </Pressable>
        <Text
          style={{
            flex: 1,
            fontSize: 20,
            lineHeight: 28,
            fontFamily: fonts.display,
            color: t.text,
          }}
        >
          {title}
        </Text>
        {actions}
      </Pressable>
      <FlatList
        data={data}
        keyExtractor={(item, index) =>
          String((item as { id?: string }).id ?? index)
        }
        renderItem={({ item, index }) => <>{renderItem(item, index)}</>}
        ListHeaderComponent={<View>{header}</View>}
        ListEmptyComponent={<View>{empty ?? <Empty />}</View>}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: safe.bottom + 64,
        }}
        {...formScrollProps}
        renderScrollComponent={(props) => (
          <KeyboardAwareScrollView
            {...props}
            bottomOffset={FIELD_CLEARANCE + footerHeight}
          />
        )}
      />
      {footer != null && footer !== false && (
        <KeyboardStickyView
          onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
        >
          {footer}
        </KeyboardStickyView>
      )}
    </View>
  )
}
// iOS will not present a modal while another is still being dismissed: a
// sheet asked to open as another closes (a picker handing off to the
// new-exercise editor) silently never appears. Such a sheet waits until
// every closing sheet is gone.
let closingSheets = 0
const waitingSheets = new Set<() => void>()
function sheetGone() {
  closingSheets = Math.max(0, closingSheets - 1)
  if (closingSheets) return
  for (const show of [...waitingSheets]) {
    waitingSheets.delete(show)
    show()
  }
}
type FooterSlotStore = {
  node: ReactNode
  set: (node: ReactNode) => void
  listen: (fn: () => void) => () => void
}
function footerSlot(): FooterSlotStore {
  const fns = new Set<() => void>()
  const store: FooterSlotStore = {
    node: null,
    set(node) {
      store.node = node
      for (const fn of fns) fn()
    },
    listen(fn) {
      fns.add(fn)
      return () => {
        fns.delete(fn)
      }
    },
  }
  return store
}
const PinnedFooterContext = createContext<FooterSlotStore | null>(null)
/** Only the slot re-renders when a form hands it new actions. */
function FooterSlot({
  store,
  fallback,
  render,
}: {
  store: FooterSlotStore
  fallback: ReactNode
  render: (node: ReactNode) => ReactNode
}) {
  const [, bump] = useState(0)
  const node = store.node ?? fallback
  const shown = useRef(store.node)
  shown.current = store.node
  // A form's PinnedFooter sets its actions in a layout effect that runs
  // before this one subscribes: catch up on that first hand-off too.
  useLayoutEffect(() => {
    const off = store.listen(() => bump((n) => n + 1))
    if (store.node !== shown.current) bump((n) => n + 1)
    return off
  }, [store])
  return node == null || node === false ? null : render(node)
}
/**
 * A form's primary action, wherever the form sits inside a Sheet or Screen:
 * shown pinned under the content and riding on the keyboard, so Save is
 * never scrolled out of reach. Outside either it renders in place.
 */
export function PinnedFooter({ children }: { children: ReactNode }) {
  const store = useContext(PinnedFooterContext)
  // Every render: the actions close over the form's latest state.
  useLayoutEffect(() => {
    store?.set(children)
  })
  useLayoutEffect(
    () => () => {
      store?.set(null)
    },
    [store],
  )
  return store ? null : children
}
export function Sheet({
  title,
  open,
  onClose,
  onBack,
  backLabel = "Back",
  onClosed,
  fill,
  footer,
  children,
}: {
  title: string
  open: boolean
  /** Full height, and the children scroll themselves (a virtualized list
   * must not sit inside the sheet's own ScrollView). */
  fill?: boolean
  onClose: () => void
  /** A step inside the sheet: shows a back chevron before the title. */
  onBack?: () => void
  backLabel?: string
  /** Once the sheet is fully gone (its modal dismissed): the moment to open
   * the next one, which iOS would refuse while this one is still leaving. */
  onClosed?: () => void
  /** The sheet's primary action: pinned under the content and riding on
   * the keyboard, so it is never scrolled out of reach. */
  footer?: ReactNode
  children: ReactNode
}) {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  const reduced = useReducedMotion()
  const { height: screen } = useWindowDimensions()
  const [footerHeight, setFooterHeight] = useState(0)
  const bottom = Math.max(safe.bottom, 16)
  const slot = useRef<FooterSlotStore>(null)
  if (!slot.current) slot.current = footerSlot()
  // Stay mounted through the exit animation, then unmount.
  const [mounted, setMounted] = useState(open)
  const y = useSharedValue(screen)
  const closing = useRef(false)
  // Whether this sheet counts in ``closingSheets`` until its modal is gone.
  const counted = useRef(false)
  const closed = useRef(onClosed)
  closed.current = onClosed
  const gone = useCallback(() => {
    if (!counted.current) return
    counted.current = false
    sheetGone()
    closed.current?.()
  }, [])
  // Runs on open/close only: adding `mounted` would restart the open spring.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (open) {
      closing.current = false
      const show = () => {
        setMounted(true)
        y.value = screen
        y.value = reduced
          ? 0
          : withSpring(0, { damping: 26, stiffness: 260, mass: 0.9 })
      }
      if (!closingSheets) show()
      else {
        waitingSheets.add(show)
        return () => {
          waitingSheets.delete(show)
        }
      }
    } else if (mounted) {
      counted.current = true
      closingSheets++
      if (reduced) setMounted(false)
      else
        y.value = withTiming(screen, { duration: 220 }, (done) => {
          if (done) runOnJS(setMounted)(false)
        })
    }
  }, [open])
  // Gone once the modal is dismissed: iOS reports it (onDismiss); the
  // timer covers a dismissal that is never reported, and other platforms.
  useEffect(() => {
    if (mounted || !counted.current) return
    const id = setTimeout(gone, Platform.OS === "ios" ? 400 : 0)
    return () => clearTimeout(id)
  }, [mounted, gone])
  useEffect(() => gone, [gone])
  // Each dismiss request; the effect below sees whether the owner closed.
  const [asked, setAsked] = useState(0)
  const dismiss = () => {
    if (closing.current) return
    closing.current = true
    onClose()
    setAsked((n) => n + 1)
  }
  // The owner kept the sheet open (its onClose stepped back inside it, or
  // refused): take dismissals again and settle a dragged sheet back up.
  // Without this the close button, backdrop and drag stay dead for good.
  // biome-ignore lint/correctness/useExhaustiveDependencies: per request only
  useEffect(() => {
    if (!asked || !open || !closing.current) return
    closing.current = false
    y.value = reduced ? 0 : withSpring(0, { damping: 22, stiffness: 260 })
  }, [asked])
  // A plain JS function for the gestures below: a worklet must not capture
  // the Keyboard module itself.
  const endEditing = () => Keyboard.dismiss()
  // Drag the grabber/header down to dismiss, like a native sheet.
  const drag = Gesture.Pan()
    .onStart(() => {
      runOnJS(endEditing)()
    })
    .onUpdate((e) => {
      y.value = Math.max(0, e.translationY) + Math.min(0, e.translationY) * 0.15
    })
    .onEnd((e) => {
      if (e.translationY > 110 || e.velocityY > 900) runOnJS(dismiss)()
      else y.value = withSpring(0, { damping: 22, stiffness: 260 })
    })
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
  }))
  const backdrop = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, screen * 0.6], [1, 0], "clamp"),
  }))
  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={dismiss}
      onDismiss={Platform.OS === "ios" ? gone : undefined}
    >
      {/* A full-height sheet shrinks above the keyboard; any other grows
          with it (see the ScrollView below). */}
      <KeyboardAvoidingView
        enabled={!!fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "flex-end" }}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: "#0009" },
            backdrop,
          ]}
        >
          <Pressable
            style={{ flex: 1 }}
            accessibilityLabel="Close dialog"
            onPress={dismiss}
          />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={[
            {
              maxHeight: "88%",
              height: fill ? "88%" : undefined,
              backgroundColor: t.bg,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: 16,
              paddingBottom: bottom,
            },
            sheetStyle,
          ]}
        >
          <GestureDetector
            gesture={Gesture.Exclusive(
              drag,
              // A tap on the header ends editing, as anywhere outside a field.
              Gesture.Tap().onEnd(() => {
                runOnJS(endEditing)()
              }),
            )}
          >
            <View collapsable={false}>
              <View
                style={{
                  alignSelf: "center",
                  width: 40,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: t.line,
                  marginTop: 8,
                }}
              />
              <View
                style={{
                  paddingTop: 16,
                  paddingBottom: 8,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                {onBack && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={backLabel}
                    onPress={onBack}
                    hitSlop={10}
                    style={({ pressed }) => ({
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: pressed ? t.line : t.soft,
                      alignItems: "center",
                      justifyContent: "center",
                    })}
                  >
                    <ChevronLeft size={20} color={t.text} />
                  </Pressable>
                )}
                <Text
                  accessibilityRole="header"
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 18,
                    lineHeight: 28,
                    color: t.text,
                    flex: 1,
                  }}
                >
                  {title}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  onPress={dismiss}
                  hitSlop={10}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    backgroundColor: t.soft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <X size={16} color={t.muted} />
                </Pressable>
              </View>
            </View>
          </GestureDetector>
          <PinnedFooterContext.Provider value={slot.current}>
            {fill ? (
              <View style={{ flex: 1 }}>{children}</View>
            ) : (
              // Layout mode: the keyboard's space is real content, so a short
              // sheet grows by the keyboard's height and rises with it rather
              // than vanishing behind it; a tall one scrolls the focused field
              // into view above the keyboard (and the pinned footer).
              <KeyboardAwareScrollView
                {...formScrollProps}
                mode="layout"
                bottomOffset={FIELD_CLEARANCE + footerHeight}
                extraKeyboardSpace={-bottom}
                bounces={false}
                contentContainerStyle={{ gap: 12, paddingBottom: 4 }}
              >
                {children}
              </KeyboardAwareScrollView>
            )}
          </PinnedFooterContext.Provider>
          <FooterSlot
            store={slot.current}
            fallback={footer}
            render={(node) => (
              <KeyboardStickyView
                enabled={!fill}
                offset={{ opened: bottom }}
                onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
                style={{ paddingTop: 12, backgroundColor: t.bg }}
              >
                {node}
              </KeyboardStickyView>
            )}
          />
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
export function SwipeRow({
  children,
  onComplete,
  onMore,
  moreLabel = "Actions",
  onDismiss,
  dismissLabel = "Delete",
  completeLabel = "Complete",
  completeIcon = Check,
  background,
}: {
  children: ReactNode
  onComplete?: () => void
  onMore?: () => void
  moreLabel?: string
  /** Full left swipe removes the row (pair with an undo toast). */
  onDismiss?: () => void
  dismissLabel?: string
  completeLabel?: string
  completeIcon?: LucideIcon
  /** Surface colour behind the row; defaults to the page background. */
  background?: string
}) {
  const t = useTheme()
  const ref = useRef<React.ComponentRef<typeof Swipeable>>(null)
  const [direction, setDirection] = useState<string | null>(null)
  return (
    <Swipeable
      ref={ref}
      friction={1.4}
      leftThreshold={72}
      rightThreshold={48}
      onSwipeableWillOpen={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
          () => {},
        )
      }}
      onSwipeableOpen={(side) => {
        setDirection(side)
        if (side === "right" && onComplete) {
          ref.current?.close()
          onComplete()
          void Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success,
          ).catch(() => {})
        }
        if (side === "left" && onDismiss) {
          ref.current?.close()
          onDismiss()
          feel.warning()
        }
      }}
      onSwipeableClose={() => setDirection(null)}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={
        onComplete
          ? (progress) => (
              <SwipeAction
                progress={progress}
                hidden={direction !== "right"}
                color={t.good}
                icon={completeIcon}
                label={completeLabel}
                align="left"
              />
            )
          : undefined
      }
      renderRightActions={
        onDismiss
          ? (progress) => (
              <SwipeAction
                progress={progress}
                hidden={direction !== "left"}
                color={t.bad}
                icon={Trash2}
                label={dismissLabel}
                align="right"
              />
            )
          : onMore
            ? (progress) => (
                <SwipeAction
                  progress={progress}
                  hidden={direction !== "left"}
                  color={t.muted}
                  icon={Ellipsis}
                  label={moreLabel}
                  align="right"
                  onPress={() => {
                    ref.current?.close()
                    onMore()
                  }}
                />
              )
            : undefined
      }
    >
      <View style={{ backgroundColor: background ?? t.bg }}>{children}</View>
    </Swipeable>
  )
}
function SwipeAction({
  progress,
  hidden,
  color,
  icon: Icon,
  label,
  align,
  onPress,
}: {
  progress: SharedValue<number>
  hidden: boolean
  color: string
  icon: LucideIcon
  label: string
  align: "left" | "right"
  onPress?: () => void
}) {
  // The icon grows as you drag, so the threshold is felt before release.
  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(progress.value, [0, 1], [0.6, 1.1], "clamp") },
    ],
    opacity: interpolate(progress.value, [0, 0.4], [0, 1], "clamp"),
  }))
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label}
      aria-hidden={hidden}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      onPress={onPress}
      style={{
        width: 88,
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
        borderTopLeftRadius: align === "left" ? 12 : 0,
        borderBottomLeftRadius: align === "left" ? 12 : 0,
        borderTopRightRadius: align === "right" ? 12 : 0,
        borderBottomRightRadius: align === "right" ? 12 : 0,
        gap: 4,
      }}
    >
      <Animated.View style={iconStyle}>
        <Icon size={22} color="#fff" strokeWidth={2.4} />
      </Animated.View>
      <Text style={{ color: "#fff", fontFamily: fonts.semibold, fontSize: 12 }}>
        {label}
      </Text>
    </Pressable>
  )
}
export function Progress({ value, label }: { value: number; label?: string }) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
  const fill = useSharedValue(clamped)
  useEffect(() => {
    fill.value = withTiming(clamped, { duration: reduced ? 0 : 240 })
  }, [fill, clamped, reduced])
  const fillStyle = useAnimatedStyle(() => ({
    width: `${fill.value * 100}%` as `${number}%`,
  }))
  return (
    <View style={{ gap: 6 }}>
      {label && <Label muted>{label}</Label>}
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{
          min: 0,
          max: 100,
          now: Math.round(clamped * 100),
        }}
        style={{
          height: 8,
          backgroundColor: t.soft,
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <Animated.View
          style={[
            fillStyle,
            { height: 8, backgroundColor: t.accent, borderRadius: 4 },
          ]}
        />
      </View>
    </View>
  )
}
export function confirm(
  title: string,
  message: string,
  onConfirm: () => void,
  label = "Confirm",
) {
  if (Platform.OS === "web") {
    if (globalThis.confirm(`${title}\n\n${message}`)) onConfirm()
    return
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: label, style: "destructive", onPress: onConfirm },
  ])
}
/** The one success toast: after a habit or a task is ticked off, with Undo.
 * Nothing else confirms with a toast; the screen changing is the feedback. */
export function undo(message: string, action: () => void) {
  toast(message, {
    action: { label: "Undo", onClick: action },
    duration: 5000,
  })
}
/** The time, refreshed every `everyMs`. Each tick re-renders the caller and
 * everything under it, so a screen that shows minutes asks for a minute: a
 * one-second clock on a large screen keeps the JS thread busy and every tap
 * waits behind it. */
export function useNow(everyMs = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const id = setInterval(tick, everyMs)
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") tick()
    })
    return () => {
      clearInterval(id)
      sub.remove()
    }
  }, [everyMs])
  return now
}
export async function shareText(message: string) {
  try {
    await Share.share({ message })
  } catch {
    toast.error("Could not open sharing. Please try again.")
  }
}

/** The one date (or time) field. A tap opens the picker: on iOS a sheet
 * with the calendar (or wheel) already showing and a Done to keep it; on
 * Android the system dialog. The field shows the formatted day, never a
 * raw key, and nothing about it opens a keyboard. Web keeps a text field.
 * Values stay local ``YYYY-MM-DD`` days or ``HH:mm`` times. */
export function DateField({
  label,
  value,
  onChangeText,
  mode = "date",
  hideLabel = false,
  minimumDate,
  maximumDate,
  defaultValue,
  clearable = false,
  placeholder,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  mode?: "date" | "time"
  hideLabel?: boolean
  /** Earliest day that can be picked (``YYYY-MM-DD``). */
  minimumDate?: string
  /** Latest day that can be picked (``YYYY-MM-DD``). */
  maximumDate?: string
  /** Where the picker opens while the field is empty (else today / 09:00). */
  defaultValue?: string
  /** An optional field: shows a clear (×) while it holds a value. */
  clearable?: boolean
  /** Shown while empty. */
  placeholder?: string
}) {
  const t = useTheme()
  const [open, setOpen] = useState(false)
  const [turning, setTurning] = useState(() =>
    startOf(mode, value, defaultValue, minimumDate, maximumDate),
  )
  if (Platform.OS === "web")
    return (
      <Field
        hideLabel={hideLabel}
        label={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
      />
    )
  const Picker = (
    require("@react-native-community/datetimepicker") as typeof import("@react-native-community/datetimepicker")
  ).default
  const bounds =
    mode === "date"
      ? {
          minimumDate: parseDay(minimumDate ?? "") ?? undefined,
          maximumDate: parseDay(maximumDate ?? "") ?? undefined,
        }
      : {}
  const write = (d: Date) =>
    onChangeText(mode === "date" ? toDay(d) : toClock(d))
  const shown = value ? formatPick(mode, value) : ""
  const empty =
    placeholder ?? (mode === "date" ? "Choose a date" : "Choose a time")
  return (
    <View style={{ gap: 6, marginVertical: 8 }}>
      {!hideLabel && (
        <Text
          style={{ fontFamily: fonts.medium, fontSize: 12, color: t.muted }}
        >
          {label}
        </Text>
      )}
      <View
        style={{
          minHeight: 44,
          backgroundColor: t.card,
          borderWidth: 1,
          borderColor: open ? t.accent : t.line,
          borderRadius: 12,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityValue={{ text: shown || "Not set" }}
          accessibilityHint={`Opens a ${mode} picker`}
          onPress={() => {
            setTurning(
              startOf(mode, value, defaultValue, minimumDate, maximumDate),
            )
            setOpen(true)
          }}
          style={{
            flex: 1,
            minHeight: 42,
            paddingHorizontal: 12,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              flexShrink: 1,
              fontFamily: fonts.body,
              fontSize: 14,
              color: shown ? t.text : t.muted,
            }}
          >
            {shown || empty}
          </Text>
          {!(clearable && value) &&
            (mode === "date" ? (
              <CalendarDays size={16} color={t.muted} />
            ) : (
              <Clock size={16} color={t.muted} />
            ))}
        </Pressable>
        {clearable && !!value && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
            hitSlop={8}
            onPress={() => onChangeText("")}
            style={{
              width: 40,
              minHeight: 42,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={16} color={t.muted} />
          </Pressable>
        )}
      </View>
      {Picker && open && Platform.OS === "android" && (
        <Picker
          value={turning}
          mode={mode}
          display="default"
          {...bounds}
          onChange={(event, next) => {
            setOpen(false)
            if (event.type === "set" && next) write(next)
          }}
        />
      )}
      {Platform.OS === "ios" && (
        <Sheet title={label} open={open} onClose={() => setOpen(false)}>
          <View style={{ alignItems: "center" }}>
            {Picker && (
              <Picker
                testID="date-wheel"
                value={turning}
                mode={mode}
                display={mode === "date" ? "inline" : "spinner"}
                themeVariant={t.dark ? "dark" : "light"}
                accentColor={t.accent}
                textColor={t.text}
                {...bounds}
                onChange={(_, next) => next && setTurning(next)}
              />
            )}
          </View>
          <Button
            onPress={() => {
              write(turning)
              setOpen(false)
            }}
          >
            Done
          </Button>
          {clearable && !!value && (
            <Button
              tone="quiet"
              onPress={() => {
                onChangeText("")
                setOpen(false)
              }}
            >
              Clear
            </Button>
          )}
        </Sheet>
      )}
    </View>
  )
}
