// Typing a peso amount: pure helpers for the text fields that hold one.

/** A peso amount as typed: digits and at most one point with two decimals
 * (stripping the point turned ₱2,500.75 into ₱250,075). */
export const pesoDraft = (v: string) => {
  const [whole, ...rest] = v.replace(/[^\d.]/g, "").split(".")
  return rest.length ? `${whole}.${rest.join("").slice(0, 2)}` : whole
}
/** The draft with thousands separators, keeping a trailing point or decimals. */
export const groupPesos = (draft: string) => {
  if (!draft) return ""
  const [whole, dec] = draft.split(".")
  const grouped = Number(whole || 0).toLocaleString("en-PH")
  return dec === undefined ? grouped : `${grouped}.${dec}`
}
