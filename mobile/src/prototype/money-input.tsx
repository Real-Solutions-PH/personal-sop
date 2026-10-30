// Typing an amount: the one money field every screen uses, and the pure
// helpers behind it.
import { useCurrency } from "@domain/lib/money"
import { TextInput, type TextInputProps } from "react-native"
import { useTheme } from "./theme"
import { Field } from "./ui"

/** An amount as typed: digits and at most one point with up to ``digits``
 * decimals (stripping the point turned 2,500.75 into 250,075). A
 * zero-decimal currency (JPY, KRW) takes no point at all. */
export const amountDraft = (v: string, digits = 2) => {
  const [whole, ...rest] = v.replace(/[^\d.]/g, "").split(".")
  if (digits === 0) return whole
  return rest.length ? `${whole}.${rest.join("").slice(0, digits)}` : whole
}
/** The draft with thousands separators, keeping a trailing point or decimals. */
export const groupAmount = (draft: string) => {
  if (!draft) return ""
  const [whole, dec] = draft.split(".")
  const grouped = Number(whole || 0).toLocaleString("en")
  return dec === undefined ? grouped : `${grouped}.${dec}`
}
/** A signed draft: ``amountDraft`` with a leading minus kept. */
export const signedDraft = (v: string, digits = 2) => {
  const draft = amountDraft(v, digits)
  return v.trim().startsWith("-") ? `-${draft}` : draft
}
/** What a draft shows: "-1708.64" reads "-1,708.64". */
export const showDraft = (draft: string) =>
  draft.startsWith("-") ? `-${groupAmount(draft.slice(1))}` : groupAmount(draft)

type Props = Omit<
  TextInputProps,
  "value" | "onChange" | "onChangeText" | "keyboardType" | "inputMode"
> & {
  label: string
  /** The amount as typed, without separators ("36000.50"); ``Number`` of
   * it is the exact amount. */
  value: string
  onChange: (draft: string) => void
  error?: string
  hideLabel?: boolean
  /** Takes a leading minus (an overdrawn opening balance). */
  signed?: boolean
  /** A bare input for rows that draw their own label; a labelled field
   * otherwise. */
  bare?: boolean
}

/** A money field: shows "36,000.50" while typing and hands back the exact
 * draft ("36000.50"), limited to the currency's decimals. */
export function MoneyInput({
  value,
  onChange,
  signed = false,
  bare = false,
  label,
  error,
  hideLabel,
  ...props
}: Props) {
  const digits = useCurrency().digits,
    t = useTheme(),
    change = (v: string) =>
      onChange(signed ? signedDraft(v, digits) : amountDraft(v, digits)),
    shared = {
      value: showDraft(value),
      onChangeText: change,
      keyboardType: (signed
        ? "numbers-and-punctuation"
        : "decimal-pad") as TextInputProps["keyboardType"],
    }
  if (bare)
    return (
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.muted}
        {...props}
        {...shared}
      />
    )
  return (
    <Field
      label={label}
      error={error}
      hideLabel={hideLabel}
      {...props}
      {...shared}
    />
  )
}
