import { peso } from "@domain/lib/day"
import { privacyStore } from "@domain/lib/privacy"
export function useMoney() {
  const hidden = privacyStore.use((s) => s.hidden)
  return (n: number) => (hidden ? "••••" : peso(n))
}
export { AdvisorAnswer } from "./finance-advisor-answer"
export { PlannedEditor } from "./finance-planned-editor"
export { RecordEditor } from "./finance-record-editor"
export type AdvisorQuestion = {
  key:
    | "afford"
    | "finance"
    | "leaks"
    | "emergency"
    | "invest"
    | "review"
    | "generic"
  name?: string
  amount?: number
  month?: string
  n?: number
  period?: string
}
export function advisorQuestion(text: string): AdvisorQuestion {
  const t = text.toLowerCase(),
    m = t.match(/(\d+(?:\.\d+)?)\s*(k)?/)
  const amount = m ? Number(m[1]) * (m[2] ? 1000 : 1) : undefined
  if (/0%|financ|install|or pay cash/.test(t))
    return { key: "finance", amount: amount ?? 30000, n: 12 }
  if (/afford|buy|laptop|purchase/.test(t))
    return { key: "afford", amount: amount ?? 45000 }
  if (/leak|where.*money|coffee|wasting/.test(t)) return { key: "leaks" }
  if (/emergency|runway|safety/.test(t)) return { key: "emergency" }
  if (/invest|mp2|index|stock/.test(t)) return { key: "invest" }
  if (/review|last month|how did i/.test(t)) return { key: "review" }
  return { key: "generic" }
}
