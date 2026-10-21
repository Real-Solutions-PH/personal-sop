// Live statement import: the /finance/imports REST routes behind the
// prototype's import screens. Imports are server-driven (no sync mapper):
// the server parses the file, reconciles it against the records it holds,
// and on commit writes the records itself, stamped with the import's id, so
// an undo on the server reverts exactly what the import did. The device
// mirrors each import into finStore.imports (the screens keep reading the
// store) and pulls the records the server wrote through the sync engine.
//
// Files: a CSV goes up as its text (GCash and BPI export layouts, or a
// generic column mapping); a screenshot's rows would come from an OCR step,
// which the device does not have, so a screenshot uploads no rows and the
// server reports it as unreadable. The screen's four sample statements are
// rendered as the matching bank export before upload.

import type { SampleFile } from "@domain/finance/actions"
import { today } from "@domain/finance/calc"
import type {
  Account,
  ImportRow,
  StatementImport,
  StatementRow,
} from "@domain/finance/data"
import { finStore, sampleStatements } from "@domain/finance/store"
import { newId } from "@domain/lib/ids"
import { ApiError, type Http, NetworkError } from "./http"
import { categoryIds, fromMinor } from "./mappers/finance"

// ---------------------------------------------------------------- wire shapes

export type CsvLayout = "generic" | "gcash" | "bpi"
export type FailCode =
  | "unreadable"
  | "password"
  | "bad_password"
  | "wrong_account"
  | "no_rows"

export interface CsvMapping {
  date: string
  description: string
  amount?: string
  debit?: string
  credit?: string
}

export interface WExtractedRow {
  ref: string
  date: string
  time: string
  raw: string
  amount_minor: number
  direction: "in" | "out"
  pending: boolean
}

export interface WImport {
  id: string
  account_id: string
  file_name: string
  file_type: StatementImport["fileType"]
  period_from: string | null
  period_to: string | null
  closing_minor: number | null
  status: StatementImport["status"]
  counts: StatementImport["counts"] | null
  created_ids: string[]
  file_kept: boolean
  error_code: string | null
  created_at: string
}

export interface WRow {
  id: string
  position: number
  ref: string
  on_date: string
  time: string | null
  raw: string
  amount_minor: number
  direction: "in" | "out"
  pending: boolean
  payee: string
  suggested_category_id: string | null
  state: ImportRow["state"]
  reason: string | null
  match_id: string | null
  confidence: number
  decision: ImportRow["decision"]
  category_id: string | null
  is_transfer: boolean
}

export interface WDetail {
  import: WImport
  rows: WRow[]
  app_balance_minor: number
}

export interface WCommit {
  gap_minor: number
  created: number
  updated: number
  matched: number
  ignored: number
}

export interface WRowPatch {
  row_ids: string[]
  decision?: ImportRow["decision"]
  category_id?: string | null
  payee?: string
  match_id?: string | null
}

// ---------------------------------------------------------------- REST client

export function createImportClient(http: Http) {
  const base = "/finance/imports"
  const one = (id: string) => `${base}/${encodeURIComponent(id)}`
  return {
    list: () =>
      http.request<{ data: WImport[]; count: number }>(
        "GET",
        `${base}?skip=0&limit=100`,
      ),
    start: (body: {
      id: string
      account_id: string
      file_name: string
      file_type: StatementImport["fileType"]
    }) => http.request<WImport>("POST", base, body),
    csv: (
      id: string,
      body: {
        text: string
        layout: CsvLayout
        mapping?: CsvMapping
        force_account?: boolean
      },
    ) => http.request<WImport>("POST", `${one(id)}/csv`, body),
    rows: (id: string, rows: WExtractedRow[]) =>
      http.request<WImport>("POST", `${one(id)}/rows`, { rows }),
    fail: (id: string, error_code: FailCode) =>
      http.request<WImport>("POST", `${one(id)}/fail`, { error_code }),
    detail: (id: string) => http.request<WDetail>("GET", one(id)),
    patchRows: (id: string, body: WRowPatch) =>
      http.request<WRow[]>("PATCH", `${one(id)}/rows`, body),
    commit: (id: string, transferAccountId?: string) =>
      http.request<WCommit>("POST", `${one(id)}/commit`, {
        transfer_account_id: transferAccountId ?? null,
      }),
    undo: (id: string) => http.request<WImport>("POST", `${one(id)}/undo`),
    remove: (id: string) => http.request<unknown>("DELETE", one(id)),
    restore: (id: string) =>
      http.request<WImport>("POST", `${one(id)}/restore`),
    discardFile: (id: string) =>
      http.request<WImport>("POST", `${one(id)}/discard-file`),
  }
}
export type ImportClient = ReturnType<typeof createImportClient>

// ---------------------------------------------------------------- statements

/** What the device uploads for one file. */
export type StatementSource =
  | { kind: "csv"; text: string; layout: CsvLayout; mapping?: CsvMapping }
  | { kind: "rows"; rows: WExtractedRow[] }
  | { kind: "fail"; code: FailCode }

const LAYOUT_HEADERS: Record<"gcash" | "bpi", string[]> = {
  gcash: ["Date and Time", "Description", "Reference No.", "Debit", "Credit"],
  bpi: [
    "Transaction Date",
    "Description",
    "Reference Number",
    "Debit",
    "Credit",
  ],
}

const cell = (v: string) =>
  /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v

/** Statement rows written out as a GCash or BPI CSV export. */
export function exportCsv(
  layout: "gcash" | "bpi",
  rows: StatementRow[],
): string {
  const lines = [LAYOUT_HEADERS[layout].join(",")]
  for (const r of rows) {
    const amount = r.amount.toFixed(2)
    lines.push(
      [
        `${r.date} ${r.time}`,
        cell(r.raw),
        cell(r.ref),
        r.direction === "out" ? amount : "",
        r.direction === "in" ? amount : "",
      ].join(","),
    )
  }
  return `${lines.join("\n")}\n`
}

/** The live screen's sample files: the two statements are CSV exports. */
export const LIVE_SAMPLE_META: Partial<
  Record<
    SampleFile,
    {
      name: string
      type: StatementImport["fileType"]
      hint: string
      size: string
    }
  >
> = {
  "gcash-pdf": {
    name: "GCash_Transaction_History.csv",
    type: "csv",
    size: "4 KB",
    hint: "Exported from GCash › Profile › Transactions",
  },
  "bpi-pdf": {
    name: "BPI_SA_History.csv",
    type: "csv",
    size: "3 KB",
    hint: "BPI online banking › Account history › Download",
  },
}

/** The bytes a sample file uploads as. */
export function sampleSource(key: SampleFile): StatementSource {
  switch (key) {
    case "gcash-pdf":
      return {
        kind: "csv",
        layout: "gcash",
        text: exportCsv("gcash", sampleStatements().gcash),
      }
    case "bpi-pdf":
      return {
        kind: "csv",
        layout: "bpi",
        text: exportCsv("bpi", sampleStatements().bpi),
      }
    case "maya-shot":
      // A screenshot with no OCR step: nothing was read from it.
      return { kind: "rows", rows: [] }
    default:
      return { kind: "fail", code: "unreadable" }
  }
}

function splitLine(line: string): string[] {
  const sep = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ","
  return line
    .split(sep)
    .map((c) => c.trim().replace(/^"|"$/g, "").trim().toLowerCase())
}

/** Which layout a CSV someone picked is in, from its header line; null when
 * no line in the first 30 names a date, a description and an amount. */
export function detectCsv(text: string): StatementSource | null {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).slice(0, 30)
  for (const line of lines) {
    const names = splitLine(line)
    const has = (n: string) => names.includes(n)
    if (has("date and time") && has("description") && has("debit"))
      return { kind: "csv", layout: "gcash", text }
    if (has("transaction date") && has("description") && has("debit"))
      return { kind: "csv", layout: "bpi", text }
    const find = (re: RegExp) => names.find((n) => re.test(n))
    const date = find(/date/)
    const description = find(
      /description|details|particulars|narrative|remarks|memo/,
    )
    if (!date || !description) continue
    const amount = find(/amount/)
    const debit = find(/debit|withdraw/)
    const credit = find(/credit|deposit/)
    if (amount)
      return {
        kind: "csv",
        layout: "generic",
        text,
        mapping: { date, description, amount },
      }
    if (debit && credit)
      return {
        kind: "csv",
        layout: "generic",
        text,
        mapping: { date, description, debit, credit },
      }
  }
  return null
}

const LAYOUT_ACCOUNTS: Record<
  "gcash" | "bpi",
  { types: Account["type"][]; brand: RegExp }
> = {
  gcash: { types: ["ewallet"], brand: /gcash/i },
  bpi: { types: ["bank", "credit"], brand: /bpi/i },
}

/** The user's own account a file looks like it belongs to: one of the
 * layout's account types, preferring one named after the bank. */
export function detectedAccount(
  accounts: Account[],
  source: StatementSource | undefined,
  except: string,
): Account | undefined {
  if (source?.kind !== "csv" || source.layout === "generic") return undefined
  const want = LAYOUT_ACCOUNTS[source.layout]
  const fits = accounts.filter(
    (a) => !a.archived && a.id !== except && want.types.includes(a.type),
  )
  return fits.find((a) => want.brand.test(a.name)) ?? fits[0]
}

// ---------------------------------------------------------------- mapping

type Cats = ReturnType<typeof categoryIds>

const ERRORS: Record<string, string> = {
  unreadable: "Couldn't read this file.",
  password: "This PDF is password-protected.",
  bad_password: "That password didn't open the file.",
  wrong_account: "This file looks like it belongs to another account.",
  no_rows: "0 transactions found in this file.",
}

export function errorText(
  code: string | null,
  type: StatementImport["fileType"],
): string | undefined {
  if (!code) return undefined
  if (code === "no_rows" && type === "image")
    return "0 transactions found in the screenshot — try a longer scroll capture."
  return ERRORS[code] ?? ERRORS.unreadable
}

export function rowFromServer(w: WRow, cats: Cats): ImportRow {
  return {
    id: w.id,
    ref: w.ref,
    date: w.on_date,
    time: w.time ?? "12:00",
    raw: w.raw,
    amount: fromMinor(w.amount_minor),
    direction: w.direction,
    pending: w.pending || undefined,
    payee: w.payee,
    suggestedCategoryId: cats.in(w.suggested_category_id),
    state: w.state,
    reason: w.reason ?? undefined,
    matchId: w.match_id ?? undefined,
    confidence: w.confidence,
    decision: w.decision,
    categoryId: cats.in(w.category_id),
    isTransfer: w.is_transfer || undefined,
  }
}

export function importFromServer(
  w: WImport,
  rows: ImportRow[],
): StatementImport {
  return {
    id: w.id,
    accountId: w.account_id,
    fileName: w.file_name,
    fileType: w.file_type,
    from: w.period_from ?? today(),
    to: w.period_to ?? today(),
    closing: fromMinor(w.closing_minor ?? 0),
    status: w.status,
    createdAt: new Date(w.created_at).toISOString(),
    rows,
    counts: w.counts ?? undefined,
    createdIds: w.created_ids,
    // The server keeps the before-images; the screens read the counts.
    changed: [],
    fileKept: w.file_kept,
    error: errorText(w.error_code, w.file_type),
  }
}

/** A screen's row edit as the server's row patch. */
export function patchToServer(
  rowIds: string[],
  patch: Partial<ImportRow>,
  cats: Cats,
): WRowPatch {
  const out: WRowPatch = { row_ids: rowIds }
  if (patch.decision) out.decision = patch.decision
  if ("categoryId" in patch) out.category_id = cats.out(patch.categoryId)
  if (patch.payee !== undefined) out.payee = patch.payee
  if ("matchId" in patch) out.match_id = patch.matchId ?? null
  return out
}

/** The text a person sees for a failed request (never a raw body). */
export function failureText(error: unknown): string {
  if (error instanceof NetworkError)
    return "You're offline — try again when you're connected."
  if (error instanceof ApiError && error.status < 500) return error.message
  return "Something went wrong — try again."
}

// ---------------------------------------------------------------- live actions

export interface LiveImportDeps {
  client: ImportClient
  userId: () => Promise<string | null>
  /** Push pending edits and pull what the server wrote. */
  sync: () => Promise<void>
}

export type ReadResult = "ok" | "wrong-account" | "failed"

export function createLiveImport(deps: LiveImportDeps) {
  const { client } = deps
  const sources = new Map<string, StatementSource>()
  let cats: { user: string; ids: Cats } | null = null

  async function catIds(): Promise<Cats> {
    const user = (await deps.userId()) ?? ""
    if (cats?.user !== user) cats = { user, ids: categoryIds(user) }
    return cats.ids
  }

  const find = (id: string) => finStore.get().imports.find((i) => i.id === id)

  function put(imp: StatementImport) {
    finStore.set((s) => ({
      ...s,
      imports: s.imports.some((i) => i.id === imp.id)
        ? s.imports.map((i) => (i.id === imp.id ? imp : i))
        : [imp, ...s.imports],
    }))
  }

  function patchLocal(id: string, patch: Partial<StatementImport>) {
    const imp = find(id)
    if (imp) put({ ...imp, ...patch })
  }

  async function putServer(w: WImport, rows?: WRow[]) {
    const ids = await catIds()
    const mapped = rows
      ? rows.map((r) => rowFromServer(r, ids))
      : (find(w.id)?.rows ?? [])
    put(importFromServer(w, mapped))
  }

  /** Re-read one import (its rows included); false when the server has none. */
  async function load(id: string): Promise<boolean> {
    try {
      const d = await client.detail(id)
      await putServer(d.import, d.rows)
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return false
      throw error
    }
  }

  return {
    /** A new import on the device, read on the server by read(). */
    begin(
      accountId: string,
      file: { name: string; type: StatementImport["fileType"] },
      source: StatementSource,
    ): string {
      const id = newId()
      sources.set(id, source)
      put({
        id,
        accountId,
        fileName: file.name,
        fileType: file.type,
        from: today(),
        to: today(),
        closing: 0,
        status: "parsing",
        createdAt: new Date().toISOString(),
        rows: [],
        createdIds: [],
        changed: [],
        fileKept: true,
      })
      return id
    },

    /** The source an import uploads (a sample, or a picked file). */
    sourceOf(id: string, sample?: SampleFile): StatementSource | undefined {
      const known = sources.get(id)
      if (known) return known
      const imp = find(id)
      const key =
        sample ??
        (Object.entries(LIVE_SAMPLE_META).find(
          ([, m]) => m?.name === imp?.fileName,
        )?.[0] as SampleFile | undefined)
      return key ? sampleSource(key) : undefined
    },

    /** Start the import on the server and upload its file. A different
     * account re-points the import; force accepts a layout's mismatch. */
    async read(
      id: string,
      source: StatementSource | undefined,
      opts: { accountId?: string; force?: boolean } = {},
    ): Promise<ReadResult> {
      const imp = find(id)
      if (!imp) return "failed"
      const accountId = opts.accountId ?? imp.accountId
      if (accountId !== imp.accountId) patchLocal(id, { accountId })
      try {
        // Records logged on this device must be on the server before it
        // reconciles the statement against them.
        await deps.sync()
        await client.start({
          id,
          account_id: accountId,
          file_name: imp.fileName,
          file_type: imp.fileType,
        })
        let w: WImport
        if (!source) w = await client.fail(id, "unreadable")
        else if (source.kind === "csv")
          try {
            w = await client.csv(id, {
              text: source.text,
              layout: source.layout,
              mapping: source.mapping,
              force_account: Boolean(opts.force),
            })
          } catch (error) {
            if (error instanceof ApiError && error.code === "wrong_account")
              return "wrong-account"
            if (error instanceof ApiError && error.code.startsWith("csv_"))
              w = await client.fail(id, "unreadable")
            else throw error
          }
        else if (source.kind === "rows") w = await client.rows(id, source.rows)
        else w = await client.fail(id, source.code)
        if (w.status === "failed") {
          await putServer(w, [])
          return "failed"
        }
        await load(id)
        return "ok"
      } catch (error) {
        patchLocal(id, { status: "failed", error: failureText(error) })
        return "failed"
      }
    },

    load,

    /** The server's import history merged into the store (rows kept). */
    async loadList(): Promise<void> {
      const page = await client.list()
      for (const w of page.data) await putServer(w)
    },

    /** Review edits: applied on the device at once, then replaced by the
     * server's rows; a refused edit is rolled back to the server's state. */
    async patchRows(
      id: string,
      rowIds: string[],
      patch: Partial<ImportRow>,
    ): Promise<void> {
      const imp = find(id)
      if (!imp) return
      put({
        ...imp,
        rows: imp.rows.map((r) =>
          rowIds.includes(r.id) ? { ...r, ...patch } : r,
        ),
      })
      try {
        const ids = await catIds()
        const out = await client.patchRows(
          id,
          patchToServer(rowIds, patch, ids),
        )
        const byId = new Map(out.map((r) => [r.id, rowFromServer(r, ids)]))
        const cur = find(id)
        if (cur) put({ ...cur, rows: cur.rows.map((r) => byId.get(r.id) ?? r) })
      } catch (error) {
        await load(id).catch(() => undefined)
        throw error
      }
    },

    /** Statement transfer rows need the account on their other side. */
    needsTransferAccount(imp: StatementImport): boolean {
      return imp.rows.some(
        (r) => r.decision !== "ignore" && r.isTransfer && !r.matchId,
      )
    },

    /** Commit on the server, then pull the records it wrote. */
    async commit(
      id: string,
      transferAccountId?: string,
    ): Promise<{ gap: number; created: number; updated: number }> {
      const out = await client.commit(id, transferAccountId)
      await deps.sync()
      await load(id)
      return {
        gap: fromMinor(out.gap_minor),
        created: out.created,
        updated: out.updated,
      }
    },

    async undo(id: string): Promise<void> {
      await putServer(await client.undo(id))
      await deps.sync()
    },

    async discard(id: string): Promise<void> {
      await client.remove(id)
      finStore.set((s) => ({
        ...s,
        imports: s.imports.filter((i) => i.id !== id),
      }))
    },

    async restore(imp: StatementImport): Promise<void> {
      await putServer(await client.restore(imp.id), [])
      await load(imp.id)
    },

    async discardFile(id: string): Promise<void> {
      await putServer(await client.discardFile(id))
    },
  }
}
export type LiveImport = ReturnType<typeof createLiveImport>

let shared: LiveImport | null = null

/** The signed-in app's import actions (auth and the sync engine are loaded
 * lazily, so prototype mode never builds them). */
export function liveImport(): LiveImport {
  if (!shared) {
    const auth = require("./auth") as typeof import("./auth")
    const runtime = require("./runtime") as typeof import("./runtime")
    shared = createLiveImport({
      client: createImportClient(auth.http),
      userId: auth.currentUserId,
      sync: async () => {
        await runtime.engine()?.sync()
      },
    })
  }
  return shared
}
