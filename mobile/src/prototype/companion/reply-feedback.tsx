import { createStore } from "@domain/lib/store"
import {
  type LucideIcon,
  type LucideProps,
  Send,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react-native"
import { useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"
import Animated, { FadeIn } from "react-native-reanimated"
import { toast } from "sonner-native"
import { liveMode } from "@/live/config"
import type { FeedbackBody, Rating, Reason } from "@/live/feedback"
import { IconTap } from "../native-kit"
import { fonts, useTheme } from "../theme"

/** The person's thumb on each Fern reply, kept on the phone so the row
 * shows it again after a restart (the server is the record Fern learns
 * from). */
export const replyFeedback = createStore<{
  ratings: Record<string, { rating: Rating; reason?: Reason }>
}>("fern-reply-feedback", () => ({ ratings: {} }))

const REASONS: { value: Reason; label: string }[] = [
  { value: "wrong", label: "Wrong" },
  { value: "too_long", label: "Too long" },
  { value: "missed", label: "Missed my ask" },
  { value: "slow", label: "Too slow" },
  { value: "other", label: "Other" },
]

async function send(id: string, body: FeedbackBody): Promise<boolean> {
  if (!liveMode) return true
  const { http } = require("@/live/auth") as typeof import("@/live/auth")
  const { sendFeedback } =
    require("@/live/feedback") as typeof import("@/live/feedback")
  try {
    await sendFeedback(http, id, body)
    return true
  } catch {
    return false
  }
}

function setLocal(
  id: string,
  value: { rating: Rating; reason?: Reason } | null,
) {
  replyFeedback.set((s) => {
    const ratings = { ...s.ratings }
    if (value) ratings[id] = value
    else delete ratings[id]
    return { ratings }
  })
}

/** Saves a rating (or clears it with null), shows the outcome, and offers
 * Undo, which puts back what was there before. */
async function rate(id: string, body: FeedbackBody) {
  const before = replyFeedback.get().ratings[id] ?? null
  setLocal(
    id,
    body.rating
      ? { rating: body.rating, reason: body.reason ?? undefined }
      : null,
  )
  if (!(await send(id, body))) {
    setLocal(id, before)
    toast.error("Couldn't send that. Check your connection and try again.")
    return
  }
  if (!body.rating) return
  toast(
    body.rating === "up"
      ? "Thanks — glad that helped."
      : "Thanks — Fern will learn from this.",
    {
      action: {
        label: "Undo",
        onClick: () => {
          setLocal(id, before)
          void send(
            id,
            before
              ? { rating: before.rating, reason: before.reason ?? null }
              : { rating: null },
          )
        },
      },
    },
  )
}

// The chosen thumb is filled as well as coloured, so the choice still
// reads without colour.
const filled = (Icon: LucideIcon) =>
  ((props: LucideProps) => (
    <Icon {...props} fill={props.color} />
  )) as unknown as LucideIcon
const UpFilled = filled(ThumbsUp)
const DownFilled = filled(ThumbsDown)

/** 👍 and 👎 for the reply's action row. */
export function ThumbButtons({ id }: { id: string }) {
  const t = useTheme()
  const mine = replyFeedback.use((s) => s.ratings[id]?.rating ?? null)
  return (
    <>
      <IconTap
        size={36}
        icon={mine === "up" ? UpFilled : ThumbsUp}
        label={mine === "up" ? "Remove good reply rating" : "Good reply"}
        color={mine === "up" ? t.primary : t.muted}
        onPress={() => void rate(id, { rating: mine === "up" ? null : "up" })}
      />
      <IconTap
        size={36}
        icon={mine === "down" ? DownFilled : ThumbsDown}
        label={mine === "down" ? "Remove bad reply rating" : "Bad reply"}
        color={mine === "down" ? t.primary : t.muted}
        onPress={() =>
          void rate(id, { rating: mine === "down" ? null : "down" })
        }
      />
    </>
  )
}

/** After a thumbs-down: why, in one tap. "Other" opens a short note. The
 * row goes once a reason is sent. */
export function DownReasons({ id }: { id: string }) {
  const t = useTheme()
  const entry = replyFeedback.use((s) => s.ratings[id])
  const [other, setOther] = useState(false)
  const [note, setNote] = useState("")
  if (entry?.rating !== "down" || entry.reason) return null
  const pick = (reason: Reason, text?: string) =>
    void rate(id, { rating: "down", reason, note: text?.trim() || null })
  return (
    <Animated.View entering={FadeIn.duration(180)} style={{ gap: 8 }}>
      <Text style={{ color: t.muted, fontFamily: fonts.medium, fontSize: 12 }}>
        What went wrong?
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {REASONS.map((r) => (
          <Pressable
            key={r.value}
            cssInterop={false}
            accessibilityRole="button"
            accessibilityLabel={`Reason: ${r.label}`}
            onPress={() =>
              r.value === "other" ? setOther(true) : pick(r.value)
            }
            style={({ pressed }) => ({
              justifyContent: "center",
              paddingHorizontal: 12,
              minHeight: 34,
              borderRadius: 17,
              borderWidth: 1,
              borderColor: t.line,
              backgroundColor:
                pressed || (r.value === "other" && other)
                  ? t.soft
                  : "transparent",
            })}
          >
            <Text
              style={{ color: t.text, fontFamily: fonts.medium, fontSize: 13 }}
            >
              {r.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {other && (
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <TextInput
            value={note}
            onChangeText={setNote}
            autoFocus
            maxLength={280}
            placeholder="e.g. Just give me the grams"
            placeholderTextColor={t.muted}
            accessibilityLabel="What went wrong"
            returnKeyType="send"
            onSubmitEditing={() => pick("other", note)}
            style={{
              flex: 1,
              minHeight: 38,
              paddingHorizontal: 12,
              borderRadius: 19,
              borderWidth: 1,
              borderColor: t.line,
              color: t.text,
              fontFamily: fonts.body,
              fontSize: 14,
            }}
          />
          <Pressable
            cssInterop={false}
            accessibilityRole="button"
            accessibilityLabel="Send reason"
            onPress={() => pick("other", note)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 14,
              minHeight: 38,
              borderRadius: 19,
              backgroundColor: pressed ? `${t.primary}cc` : t.primary,
            })}
          >
            <Send size={14} color={t.onPrimary} />
            <Text
              style={{
                color: t.onPrimary,
                fontFamily: fonts.semibold,
                fontSize: 13,
              }}
            >
              Send
            </Text>
          </Pressable>
        </View>
      )}
    </Animated.View>
  )
}
