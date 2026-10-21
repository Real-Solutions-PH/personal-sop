// Typing an amount: pure helpers for the text fields that hold one.

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
