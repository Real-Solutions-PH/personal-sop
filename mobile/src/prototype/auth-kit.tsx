import * as Haptics from "expo-haptics"
import {
  Check,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  Circle as EmptyCircle,
  Eye,
  EyeOff,
  type LucideIcon,
} from "lucide-react-native"
import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native"
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Svg, { Path } from "react-native-svg"
import { liveMode } from "@/live/config"
import { FernMark } from "./companion/brand"
import { back } from "./navigation"
import { passwordStrength } from "./session"
import { fonts, useTheme } from "./theme"

// Building blocks for the prototype's sign-in, sign-up and recovery screens.

const fire = (run: () => Promise<unknown>) => {
  try {
    void run().catch(() => {})
  } catch {}
}
export const haptic = {
  success: () =>
    fire(() =>
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    ),
  error: () =>
    fire(() =>
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    ),
  tap: () => fire(() => Haptics.selectionAsync()),
}

const webNoOutline =
  Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null

/** Staggered entrance; renders statically when reduced motion is on. */
export function Rise({
  i = 0,
  children,
  style,
}: {
  i?: number
  children: ReactNode
  style?: ViewStyle
}) {
  const reduced = useReducedMotion()
  return (
    <Animated.View
      entering={
        reduced ? undefined : FadeInDown.delay(40 + i * 55).duration(420)
      }
      style={style}
    >
      {children}
    </Animated.View>
  )
}

export function Wordmark({
  color = "#fff",
  size = 13,
}: {
  color?: string
  size?: number
}) {
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel="Unfurl"
      style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
    >
      <FernMark size={size * 2.2} color={color} />
      <Text
        style={{
          fontFamily: fonts.medium,
          fontSize: size * 1.6,
          letterSpacing: -0.03 * size * 1.6,
          color,
        }}
      >
        unfurl
      </Text>
    </View>
  )
}

/** Round icon badge that heads a form or a success state. */
export function Badge({
  icon: Icon,
  tone = "primary",
}: {
  icon: LucideIcon
  tone?: "primary" | "good" | "bad"
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const color = tone === "good" ? t.good : tone === "bad" ? t.bad : t.primary
  return (
    <Animated.View
      entering={reduced ? undefined : ZoomIn.springify().damping(14)}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        width: 64,
        height: 64,
        borderRadius: 22,
        backgroundColor: `${color}1f`,
        borderWidth: 1,
        borderColor: `${color}33`,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon size={28} color={color} strokeWidth={2} />
    </Animated.View>
  )
}

/** Safe-area, keyboard-aware page with a back button and a large title. */
export function AuthScreen({
  title,
  subtitle,
  badge,
  children,
  footer,
  onBack,
  showBack = true,
}: {
  title: string
  subtitle?: ReactNode
  badge?: ReactNode
  children: ReactNode
  footer?: ReactNode
  onBack?: () => void
  showBack?: boolean
}) {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: t.bg }}
    >
      <View
        style={{
          paddingTop: safe.top,
          paddingHorizontal: 8,
          height: safe.top + 52,
          justifyContent: "center",
        }}
      >
        {showBack && (
          <Pressable
            cssInterop={false}
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={onBack ?? (() => back("/welcome"))}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? t.soft : "transparent",
            })}
          >
            <ChevronLeft size={24} color={t.text} />
          </Pressable>
        )}
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 20,
          paddingTop: 4,
          paddingBottom: safe.bottom + 24,
          width: "100%",
          maxWidth: 460,
          alignSelf: "center",
        }}
      >
        <Rise i={0} style={{ gap: 12, marginBottom: 24 }}>
          {badge}
          <Text
            accessibilityRole="header"
            style={{
              fontFamily: fonts.display,
              fontSize: 32,
              lineHeight: 36,
              letterSpacing: -0.5,
              color: t.text,
            }}
          >
            {title}
          </Text>
          {subtitle !== undefined && (
            <Text
              style={{
                fontFamily: fonts.body,
                fontSize: 16,
                lineHeight: 23,
                color: t.muted,
              }}
            >
              {subtitle}
            </Text>
          )}
        </Rise>
        {children}
        <View style={{ flexGrow: 1, minHeight: 16 }} />
        {footer && <Rise i={8}>{footer}</Rise>}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

export function AuthField({
  label,
  icon: Icon,
  error,
  hint,
  right,
  ref,
  onFocus,
  onBlur,
  style,
  ...props
}: TextInputProps & {
  label: string
  icon?: LucideIcon
  error?: string
  hint?: ReactNode
  right?: ReactNode
  ref?: Ref<TextInput>
}) {
  const t = useTheme()
  const [focused, setFocused] = useState(false)
  const border = error ? t.bad : focused ? t.primary : t.line
  return (
    <View style={{ gap: 6, marginBottom: 14 }}>
      <Text
        nativeID={`${label}-label`}
        style={{ fontFamily: fonts.medium, fontSize: 13, color: t.text }}
      >
        {label}
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: 52,
          borderRadius: 14,
          borderWidth: focused || error ? 1.5 : 1,
          borderColor: border,
          backgroundColor: t.card,
          paddingLeft: Icon ? 12 : 14,
          paddingRight: right ? 4 : 14,
          gap: 10,
          boxShadow: focused ? `0px 0px 0px 3px ${border}26` : undefined,
        }}
      >
        {Icon && (
          <Icon size={18} color={focused && !error ? t.primary : t.muted} />
        )}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={error}
          aria-invalid={!!error}
          placeholderTextColor={t.muted}
          onFocus={(e) => {
            setFocused(true)
            onFocus?.(e)
          }}
          onBlur={(e) => {
            setFocused(false)
            onBlur?.(e)
          }}
          style={[
            {
              flex: 1,
              minHeight: 48,
              fontFamily: fonts.body,
              fontSize: 16,
              color: t.text,
              paddingVertical: 12,
            },
            webNoOutline,
            style,
          ]}
          {...props}
        />
        {right}
      </View>
      {error ? (
        <Animated.View
          entering={FadeIn.duration(160)}
          accessibilityLiveRegion="polite"
          style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}
        >
          <CircleAlert size={14} color={t.bad} style={{ marginTop: 3 }} />
          <Text
            accessibilityRole="alert"
            style={{
              flex: 1,
              fontFamily: fonts.medium,
              fontSize: 13,
              lineHeight: 19,
              color: t.bad,
            }}
          >
            {error}
          </Text>
        </Animated.View>
      ) : (
        hint
      )}
    </View>
  )
}

export function PasswordField(
  props: Omit<Parameters<typeof AuthField>[0], "right" | "secureTextEntry">,
) {
  const t = useTheme()
  const [shown, setShown] = useState(false)
  return (
    <AuthField
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      {...props}
      secureTextEntry={!shown}
      right={
        <Pressable
          cssInterop={false}
          accessibilityRole="button"
          accessibilityLabel={shown ? "Hide password" : "Show password"}
          onPress={() => {
            setShown((s) => !s)
            haptic.tap()
          }}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          {shown ? (
            <EyeOff size={20} color={t.muted} />
          ) : (
            <Eye size={20} color={t.muted} />
          )}
        </Pressable>
      }
    />
  )
}

export function AuthButton({
  children,
  onPress,
  loading = false,
  loadingLabel,
  disabled = false,
  tone = "primary",
  icon,
}: {
  children: string
  onPress: () => void
  loading?: boolean
  loadingLabel?: string
  disabled?: boolean
  tone?: "primary" | "secondary" | "ghost"
  icon?: ReactNode
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const scale = useSharedValue(1)
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))
  const inactive = disabled || loading
  const fg =
    tone === "primary" ? t.onPrimary : tone === "ghost" ? t.primary : t.text
  return (
    <Animated.View style={pressStyle}>
      <Pressable
        cssInterop={false}
        accessibilityRole="button"
        accessibilityLabel={loading ? (loadingLabel ?? children) : children}
        accessibilityState={{ disabled: inactive, busy: loading }}
        disabled={inactive}
        onPress={onPress}
        onPressIn={() => {
          if (!reduced) scale.value = withSpring(0.97, { damping: 20 })
        }}
        onPressOut={() => {
          scale.value = reduced ? 1 : withSpring(1, { damping: 20 })
        }}
        style={({ pressed }) => ({
          minHeight: 52,
          borderRadius: 14,
          paddingHorizontal: 18,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          backgroundColor:
            tone === "primary"
              ? t.primary
              : tone === "secondary"
                ? t.card
                : "transparent",
          borderWidth: tone === "secondary" ? 1 : 0,
          borderColor: t.line,
          opacity: disabled && !loading ? 0.45 : pressed ? 0.85 : 1,
        })}
      >
        {loading ? <ActivityIndicator size="small" color={fg} /> : icon}
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.semibold, fontSize: 16, color: fg }}
        >
          {loading ? (loadingLabel ?? children) : children}
        </Text>
      </Pressable>
    </Animated.View>
  )
}

/** Inline text link with a 44pt touch target. */
export function TextLink({
  children,
  onPress,
  align = "center",
}: {
  children: string
  onPress: () => void
  align?: "center" | "flex-start" | "flex-end"
}) {
  const t = useTheme()
  return (
    <Pressable
      cssInterop={false}
      accessibilityRole="link"
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        minHeight: 44,
        justifyContent: "center",
        alignSelf: align,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text
        style={{ fontFamily: fonts.semibold, fontSize: 15, color: t.primary }}
      >
        {children}
      </Text>
    </Pressable>
  )
}

/** "Question? Action" line used at the bottom of every form. */
export function SwitchPrompt({
  question,
  action,
  onPress,
}: {
  question: string
  action: string
  onPress: () => void
}) {
  const t = useTheme()
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        columnGap: 6,
      }}
    >
      <Text style={{ fontFamily: fonts.body, fontSize: 15, color: t.muted }}>
        {question}
      </Text>
      <TextLink onPress={onPress}>{action}</TextLink>
    </View>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
  children,
  error,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  children?: ReactNode
  error?: boolean
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  return (
    <Pressable
      cssInterop={false}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={() => {
        onChange(!checked)
        haptic.tap()
      }}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        opacity: pressed ? 0.7 : 1,
        flexShrink: 1,
      })}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 7,
          borderWidth: checked ? 0 : 1.5,
          borderColor: error ? t.bad : t.muted,
          backgroundColor: checked ? t.primary : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && (
          <Animated.View entering={reduced ? undefined : ZoomIn.duration(160)}>
            <Check size={15} color={t.onPrimary} strokeWidth={3} />
          </Animated.View>
        )}
      </View>
      {children ?? (
        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: 15,
            color: t.text,
            flexShrink: 1,
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  )
}

/** Error banner that shakes each time `shakeKey` changes. */
export function ErrorBanner({
  message,
  shakeKey,
  action,
}: {
  message: string
  shakeKey: number
  action?: ReactNode
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const x = useSharedValue(0)
  useEffect(() => {
    if (reduced || !shakeKey) return
    x.value = withSequence(
      withTiming(-10, { duration: 45 }),
      withRepeat(withTiming(10, { duration: 90 }), 3, true),
      withTiming(0, { duration: 45 }),
    )
  }, [shakeKey, reduced, x])
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }))
  return (
    <Animated.View
      entering={reduced ? undefined : FadeInDown.duration(220)}
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
      style={[
        {
          flexDirection: "row",
          gap: 10,
          padding: 14,
          borderRadius: 14,
          backgroundColor: `${t.bad}17`,
          borderWidth: 1,
          borderColor: `${t.bad}40`,
          marginBottom: 18,
        },
        style,
      ]}
    >
      <CircleAlert size={18} color={t.bad} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{
            fontFamily: fonts.medium,
            fontSize: 15,
            lineHeight: 21,
            color: t.text,
          }}
        >
          {message}
        </Text>
        {action}
      </View>
    </Animated.View>
  )
}

/** Muted note explaining how to trigger the prototype's simulated cases. */
export function DemoTip({ children }: { children: string }) {
  const t = useTheme()
  // Demo hints describe the simulated account; a live account has none.
  if (liveMode) return null
  return (
    <View
      style={{
        marginTop: 20,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: t.line,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.body,
          fontSize: 13,
          lineHeight: 18,
          color: t.muted,
        }}
      >
        <Text style={{ fontFamily: fonts.semibold }}>Prototype · </Text>
        {children}
      </Text>
    </View>
  )
}

export function OrDivider({ label = "or" }: { label?: string }) {
  const t = useTheme()
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginVertical: 20,
      }}
    >
      <View style={{ flex: 1, height: 1, backgroundColor: t.line }} />
      <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: t.muted }}>
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: t.line }} />
    </View>
  )
}

function AppleGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z"
      />
    </Svg>
  )
}
function GoogleGlyph() {
  return (
    <Svg width={18} height={18} viewBox="0 0 48 48">
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  )
}
/** Apple and Google buttons; Apple follows its black/white HIG styling. */
export function SocialButtons({
  busy,
  onPress,
  disabled = false,
}: {
  busy: "apple" | "google" | null
  onPress: (provider: "apple" | "google") => void
  disabled?: boolean
}) {
  const t = useTheme()
  const appleBg = t.dark ? "#fff" : "#000"
  const appleFg = t.dark ? "#000" : "#fff"
  const button = (
    provider: "apple" | "google",
    label: string,
    bg: string,
    fg: string,
    glyph: ReactNode,
  ) => (
    <Pressable
      key={provider}
      cssInterop={false}
      accessibilityRole="button"
      accessibilityLabel={`Continue with ${label}`}
      accessibilityState={{
        disabled: disabled || !!busy,
        busy: busy === provider,
      }}
      disabled={disabled || !!busy}
      onPress={() => onPress(provider)}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 52,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        backgroundColor: bg,
        borderWidth: provider === "google" ? 1 : 0,
        borderColor: t.line,
        opacity: pressed ? 0.8 : busy && busy !== provider ? 0.5 : 1,
      })}
    >
      {busy === provider ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        glyph
      )}
      <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: fg }}>
        {label}
      </Text>
    </Pressable>
  )
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      {button(
        "apple",
        "Apple",
        appleBg,
        appleFg,
        <AppleGlyph color={appleFg} />,
      )}
      {button("google", "Google", t.card, t.text, <GoogleGlyph />)}
    </View>
  )
}

function Segment({ on, color }: { on: boolean; color: string }) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const fill = useSharedValue(on ? 1 : 0)
  useEffect(() => {
    fill.value = withTiming(on ? 1 : 0, { duration: reduced ? 0 : 260 })
  }, [on, reduced, fill])
  const style = useAnimatedStyle(() => ({
    transform: [{ scaleX: fill.value }],
  }))
  return (
    <View
      style={{
        flex: 1,
        height: 6,
        borderRadius: 3,
        backgroundColor: t.soft,
        overflow: "hidden",
      }}
    >
      <Animated.View
        style={[
          {
            height: 6,
            borderRadius: 3,
            backgroundColor: color,
            transformOrigin: "left",
          },
          style,
        ]}
      />
    </View>
  )
}
/** Four-segment strength meter plus the rule checklist. */
export function StrengthMeter({
  password,
  showRules = true,
}: {
  password: string
  showRules?: boolean
}) {
  const t = useTheme()
  const s = passwordStrength(password)
  const color = [t.line, t.bad, t.warn, t.primary, t.good][s.score]
  return (
    <View style={{ gap: 10, marginTop: -4, marginBottom: 14 }}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`Password strength: ${password ? s.label : "empty"}`}
        accessibilityValue={{ min: 0, max: 4, now: s.score }}
        style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
      >
        <View style={{ flex: 1, flexDirection: "row", gap: 4 }}>
          {[1, 2, 3, 4].map((n) => (
            <Segment key={n} on={s.score >= n} color={color} />
          ))}
        </View>
        <Text
          style={{
            minWidth: 58,
            textAlign: "right",
            fontFamily: fonts.semibold,
            fontSize: 13,
            color: password ? color : t.muted,
          }}
        >
          {password ? s.label : "Strength"}
        </Text>
      </View>
      {showRules && (
        <View style={{ gap: 6 }}>
          {s.checks.map((c) => (
            <View
              key={c.label}
              accessible
              accessibilityLabel={`${c.label}: ${c.ok ? "met" : "not met"}`}
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              {c.ok ? (
                <CircleCheck size={16} color={t.good} />
              ) : (
                <EmptyCircle size={16} color={t.muted} />
              )}
              <Text
                style={{
                  fontFamily: fonts.body,
                  fontSize: 13,
                  color: c.ok ? t.text : t.muted,
                }}
              >
                {c.label}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

/** Seconds left until a resend is allowed; `restart()` begins a new wait. */
export function useCountdown(seconds: number) {
  const [deadline, setDeadline] = useState(() => Date.now() + seconds * 1000)
  const [now, setNow] = useState(Date.now())
  const left = Math.max(0, Math.ceil((deadline - now) / 1000))
  useEffect(() => {
    if (left <= 0) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [left])
  const restart = useCallback(() => {
    const start = Date.now()
    setNow(start)
    setDeadline(start + seconds * 1000)
  }, [seconds])
  return { left, restart }
}
export const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

/** Six code boxes driven by one hidden input, so typing, autofill and paste all work. */
export function CodeInput({
  value,
  onChange,
  error,
  shakeKey,
  disabled,
  ref,
}: {
  value: string
  onChange: (code: string) => void
  error?: boolean
  shakeKey: number
  disabled?: boolean
  ref?: Ref<TextInput>
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const [focused, setFocused] = useState(false)
  const x = useSharedValue(0)
  const caret = useSharedValue(1)
  useEffect(() => {
    if (reduced || !shakeKey) return
    x.value = withSequence(
      withTiming(-10, { duration: 45 }),
      withRepeat(withTiming(10, { duration: 90 }), 3, true),
      withTiming(0, { duration: 45 }),
    )
  }, [shakeKey, reduced, x])
  useEffect(() => {
    caret.value = reduced
      ? 1
      : withRepeat(withTiming(0, { duration: 520 }), -1, true)
  }, [reduced, caret])
  const shake = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }))
  const blink = useAnimatedStyle(() => ({ opacity: caret.value }))
  const active = Math.min(value.length, 5)
  return (
    <Animated.View style={[{ marginBottom: 8 }, shake]}>
      <View
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{ flexDirection: "row", gap: 8, justifyContent: "center" }}
      >
        {Array.from({ length: 6 }, (_, i) => {
          const isActive = focused && i === active && value.length < 6
          return (
            <View
              key={i}
              style={{
                flex: 1,
                maxWidth: 52,
                height: 60,
                borderRadius: 14,
                borderWidth: isActive || error ? 1.5 : 1,
                borderColor: error
                  ? t.bad
                  : isActive
                    ? t.primary
                    : value[i]
                      ? t.muted
                      : t.line,
                backgroundColor: t.card,
                alignItems: "center",
                justifyContent: "center",
                boxShadow: isActive
                  ? `0px 0px 0px 3px ${t.primary}26`
                  : undefined,
              }}
            >
              {value[i] ? (
                <Animated.Text
                  entering={reduced ? undefined : ZoomIn.duration(140)}
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 28,
                    color: t.text,
                  }}
                >
                  {value[i]}
                </Animated.Text>
              ) : (
                isActive && (
                  <Animated.View
                    style={[
                      {
                        width: 2,
                        height: 26,
                        borderRadius: 1,
                        backgroundColor: t.primary,
                      },
                      blink,
                    ]}
                  />
                )
              )}
            </View>
          )
        })}
      </View>
      <TextInput
        ref={ref}
        value={value}
        editable={!disabled}
        onChangeText={(text) => onChange(text.replace(/\D/g, "").slice(0, 6))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === "android" ? "sms-otp" : "one-time-code"}
        autoFocus
        caretHidden
        contextMenuHidden={false}
        accessibilityLabel="6-digit verification code"
        accessibilityHint={error ? "The code was incorrect" : undefined}
        style={[
          {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: 0.015,
            color: "transparent",
            fontSize: 1,
          },
          webNoOutline,
        ]}
      />
    </Animated.View>
  )
}

/** Small green tick/red cross/spinner shown inside a field. */
export function FieldStatus({
  status,
}: {
  status: "idle" | "checking" | "ok" | "bad"
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  if (status === "idle") return null
  return (
    <View
      style={{
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {status === "checking" ? (
        <ActivityIndicator size="small" color={t.muted} />
      ) : (
        <Animated.View entering={reduced ? undefined : ZoomIn.duration(180)}>
          {status === "ok" ? (
            <CircleCheck size={20} color={t.good} />
          ) : (
            <CircleAlert size={20} color={t.bad} />
          )}
        </Animated.View>
      )}
    </View>
  )
}

/** Shared busy flag + error state for a simulated submit. */
export function useSubmit() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shakeKey, setShakeKey] = useState(0)
  const mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
    },
    [],
  )
  const run = useCallback(
    async (task: () => Promise<void>, onError?: (e: unknown) => void) => {
      setBusy(true)
      setError(null)
      try {
        await task()
        if (mounted.current) setBusy(false)
        return true
      } catch (e) {
        if (!mounted.current) return false
        setBusy(false)
        setError(e instanceof Error ? e.message : "Something went wrong")
        setShakeKey((k) => k + 1)
        haptic.error()
        onError?.(e)
        return false
      }
    },
    [],
  )
  const fail = useCallback((message: string) => {
    setError(message)
    setShakeKey((k) => k + 1)
    haptic.error()
  }, [])
  return { busy, error, shakeKey, run, fail, clear: () => setError(null) }
}
