import { Platform } from "react-native"

/**
 * Space kept between a focused field and whatever sits on the keyboard (the
 * keyboard itself, or a footer pinned to it), so the whole field — its
 * border and anything under the caret — stays in view while typing.
 */
export const FIELD_CLEARANCE = 24
/**
 * Every form scroller: a tap on a button or row still lands while the
 * keyboard is up; a tap on empty space, or dragging the content, closes it.
 */
export const formScrollProps = {
  keyboardShouldPersistTaps: "handled",
  keyboardDismissMode: Platform.OS === "ios" ? "interactive" : "on-drag",
} as const
