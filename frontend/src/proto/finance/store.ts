"use client"

import { createStore } from "../lib/store"
import { buildSeed, type FinState, type StatementRow } from "./data"

/** The finance mock store (ADR-0009): seeded, persisted to localStorage. */
export const finStore = createStore<FinState>(
  "finance",
  () => buildSeed().state,
)

/** Whole-state selector — returns the stored reference; derive with useMemo. */
export const useFin = () => finStore.use((s) => s)

let stmts: Record<"gcash" | "bpi", StatementRow[]> | null = null
/** Mock statement files for the import flow (generated with the seed). */
export function sampleStatements() {
  if (!stmts) stmts = buildSeed().statements
  return stmts
}
