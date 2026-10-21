"use client"
import { createStore } from "../lib/store"
import { buildSeed, type FinState, type StatementRow } from "./data"
export const finStore = createStore<FinState>(
  "finance",
  () => buildSeed().state,
)
export const useFin = () => finStore.use((s) => s)
let stmts: Record<"gcash" | "bpi", StatementRow[]> | null = null
export function sampleStatements() {
  if (!stmts) stmts = buildSeed().statements
  return stmts
}
