import * as Haptics from "expo-haptics"
import {
  Archive,
  CalendarDays,
  Check,
  ChevronLeft,
  Ellipsis,
  type LucideIcon,
  Trash2,
  X,
} from "lucide-react-native"
import {
  createContext,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import type { ScrollViewInstance } from "react-native"
import {
  Alert,
  AppState,
  FlatList,
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
import Animated, {
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
          backgroundColor:
            tone === "quiet"
              ? t.soft
              : tone === "danger"
                ? `${t.bad}26`
                : t.accent,
          opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
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
                  : t.dark
                    ? t.bg
                    : "#FFF"
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
                  : t.dark
                    ? t.bg
                    : "#FFF",
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
          borderWidth: 1,
          borderColor: o.value === value ? "transparent" : t.line,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: o.value === value ? t.accent : t.card,
        }}
      >
        <Text
          style={{
            color: o.value === value ? t.bg : t.text,
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
}) {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  const scroller = useRef<ScrollViewInstance>(null)
  // A drag inside the page (reordering a list) pauses its scrolling.
  const [locked, setLocked] = useState(false)
  // A hairline appears under the header once content scrolls beneath it.
  const [scrolled, setScrolled] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
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
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: t.bg, paddingTop: safe.top }}
    >
      <View
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
                fontSize: prototypeLayout ? 12 : 11,
                lineHeight: prototypeLayout ? 16 : undefined,
                letterSpacing: 1,
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
      </View>
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
      <ScrollView
        ref={scroller}
        scrollEnabled={!locked}
        scrollEventThrottle={64}
        onScroll={(e) => {
          const next = e.nativeEvent.contentOffset.y > 4
          if (next !== scrolled) setScrolled(next)
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
        onContentSizeChange={() => {
          if (scrollToEnd) scroller.current?.scrollToEnd({ animated: false })
        }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: prototypeLayout ? 0 : 8,
          // Clears the Fern button, which rises ~36pt above the tab bar.
          paddingBottom: safe.bottom + 64,
          gap: prototypeLayout ? 12 : 8,
        }}
      >
        <ScrollLock.Provider value={setLocked}>{children}</ScrollLock.Provider>
      </ScrollView>
      {footer}
    </KeyboardAvoidingView>
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
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: t.bg, paddingTop: safe.top }}
    >
      <View
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
      </View>
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
        keyboardShouldPersistTaps="handled"
      />
      {footer}
    </KeyboardAvoidingView>
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
export function Sheet({
  title,
  open,
  onClose,
  onBack,
  backLabel = "Back",
  onClosed,
  children,
}: {
  title: string
  open: boolean
  onClose: () => void
  /** A step inside the sheet: shows a back chevron before the title. */
  onBack?: () => void
  backLabel?: string
  /** Once the sheet is fully gone (its modal dismissed): the moment to open
   * the next one, which iOS would refuse while this one is still leaving. */
  onClosed?: () => void
  children: ReactNode
}) {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  const reduced = useReducedMotion()
  const { height: screen } = useWindowDimensions()
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
  const dismiss = () => {
    if (closing.current) return
    closing.current = true
    onClose()
  }
  // Drag the grabber/header down to dismiss, like a native sheet.
  const drag = Gesture.Pan()
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
      <KeyboardAvoidingView
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
              backgroundColor: t.bg,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: 16,
              paddingBottom: Math.max(safe.bottom, 16),
            },
            sheetStyle,
          ]}
        >
          <GestureDetector gesture={drag}>
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
          <ScrollView
            keyboardShouldPersistTaps="handled"
            bounces={false}
            contentContainerStyle={{ gap: 12, paddingBottom: 4 }}
          >
            {children}
          </ScrollView>
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
          void Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Warning,
          ).catch(() => {})
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
export function undo(message: string, action: () => void) {
  toast(message, {
    action: { label: "Undo", onClick: action },
    duration: 5000,
  })
}
export function useNow() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const id = setInterval(tick, 1000)
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") tick()
    })
    return () => {
      clearInterval(id)
      sub.remove()
    }
  }, [])
  return now
}
export async function shareText(message: string) {
  try {
    await Share.share({ message })
  } catch {
    toast.error("Could not open sharing. Please try again.")
  }
}

export function DateField({
  label,
  value,
  onChangeText,
  mode = "date",
  hideLabel = false,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  mode?: "date" | "time"
  hideLabel?: boolean
}) {
  const t = useTheme()
  const [open, setOpen] = useState(false)
  if (Platform.OS === "web")
    return (
      <Field
        hideLabel={hideLabel}
        label={label}
        value={value}
        onChangeText={onChangeText}
      />
    )
  const parsed =
    mode === "date"
      ? new Date(`${value}T12:00:00`)
      : new Date(`2000-01-01T${value || "09:00"}:00`)
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  const Picker = open
    ? (
        require("@react-native-community/datetimepicker") as typeof import("@react-native-community/datetimepicker")
      ).default
    : null
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    <View style={{ gap: 6, marginVertical: 8 }}>
      {!hideLabel && (
        <Text
          style={{ fontFamily: fonts.medium, fontSize: 12, color: t.muted }}
        >
          {label.replace(" (YYYY-MM-DD)", "").replace(" (HH:mm)", "")}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        style={{
          minHeight: 44,
          backgroundColor: t.card,
          borderWidth: 1,
          borderColor: t.line,
          borderRadius: 12,
          paddingHorizontal: 12,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <Text style={{ fontFamily: fonts.body, fontSize: 14, color: t.text }}>
          {value || `Choose ${mode}`}
        </Text>
        <CalendarDays size={16} color={t.muted} />
      </Pressable>
      {Picker && (
        <Picker
          value={date}
          mode={mode}
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(event, next) => {
            if (Platform.OS !== "ios" || event.type === "dismissed")
              setOpen(false)
            if (event.type === "set" && next)
              onChangeText(
                mode === "date"
                  ? `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`
                  : `${pad(next.getHours())}:${pad(next.getMinutes())}`,
              )
          }}
        />
      )}
      {open && Platform.OS === "ios" && (
        <Button onPress={() => setOpen(false)}>Done</Button>
      )}
    </View>
  )
}
