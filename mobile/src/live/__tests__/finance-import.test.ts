// Live statement import: the REST client against a fake HTTP layer, the
// sample-file exports, and the actions that mirror server imports into
// finStore. Expected request bodies are written out by hand from the
// backend's schemas (backend/app/modules/finance/schema.py, ImportStart /
// CsvIn / RowPatch / CommitIn), never derived from the module under test.

import type { Account, StatementImport } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { derivedId } from "@domain/lib/ids"
import { configureStorage, resetAll } from "@domain/lib/store"
import {
  createImportClient,
  createLiveImport,
  detectCsv,
  detectedAccount,
  exportCsv,
  failureText,
  importFromServer,
  patchToServer,
  rowFromServer,
  sampleSource,
  type WDetail,
  type WImport,
  type WRow,
} from "../finance-import"
import { ApiError, type Http, NetworkError } from "../http"
import { categoryIds } from "../mappers/finance"

const USER = "11111111-1111-4111-8111-111111111111"
const ACCT = "22222222-2222-4222-8222-222222222222"
const BANK = "33333333-3333-4333-8333-333333333333"
const ROW1 = "44444444-4444-4444-8444-444444444444"
const ROW2 = "55555555-5555-4555-8555-555555555555"
const REC = "66666666-6666-4666-8666-666666666666"
const FOOD = derivedId("category", USER, "food")

type Call = { method: string; path: string; body?: unknown }
type Route = (call: Call) => unknown
function fakeHttp(routes: Record<string, Route>) {
  const calls: Call[] = []
  const http: Http = {
    async request<T>(method: string, path: string, body?: unknown) {
      const call = { method, path, body }
      calls.push(call)
      const key = `${method} ${path.split("?")[0]}`
      const route = routes[key]
      if (!route) throw new ApiError(404, "not_found", key)
      return route(call) as T
    },
    raw: () => Promise.reject(new Error("unused")),
  }
  return { http, calls }
}

const wImport = (id: string, over: Partial<WImport> = {}): WImport => ({
  id,
  account_id: ACCT,
  file_name: "GCash_Transaction_History.csv",
  file_type: "csv",
  period_from: "2026-10-01",
  period_to: "2026-10-05",
  closing_minor: 123456,
  status: "review",
  counts: null,
  created_ids: [],
  file_kept: true,
  error_code: null,
  created_at: "2026-10-06T01:02:03Z",
  ...over,
})
const wRow = (id: string, over: Partial<WRow> = {}): WRow => ({
  id,
  position: 0,
  ref: "R1",
  on_date: "2026-10-02",
  time: "09:30",
  raw: "JOLLIBEE MAKATI",
  amount_minor: 25050,
  direction: "out",
  pending: false,
  payee: "Jollibee",
  suggested_category_id: FOOD,
  state: "new",
  reason: null,
  match_id: null,
  confidence: 0.9,
  decision: "accept",
  category_id: null,
  is_transfer: false,
  ...over,
})

const account = (id: string, name: string, type: Account["type"]): Account => ({
  id,
  name,
  type,
  opening: 0,
  openingDate: "2026-01-01",
  color: "var(--acct-blue)",
  inNetWorth: true,
  inProjection: true,
  archived: false,
  order: 0,
})

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  finStore.set((s) => ({
    ...s,
    accounts: [account(ACCT, "GCash", "ewallet"), account(BANK, "BPI", "bank")],
    imports: [],
    records: [],
  }))
})

// ------------------------------------------------------------------ client

test("the client calls each import route with the server's body shape", async () => {
  const id = "77777777-7777-4777-8777-777777777777"
  const { http, calls } = fakeHttp({
    "GET /finance/imports": () => ({ data: [], count: 0 }),
    "POST /finance/imports": () => wImport(id),
    [`POST /finance/imports/${id}/csv`]: () => wImport(id),
    [`POST /finance/imports/${id}/rows`]: () => wImport(id),
    [`POST /finance/imports/${id}/fail`]: () => wImport(id),
    [`GET /finance/imports/${id}`]: () => ({}),
    [`PATCH /finance/imports/${id}/rows`]: () => [],
    [`POST /finance/imports/${id}/commit`]: () => ({}),
    [`POST /finance/imports/${id}/undo`]: () => wImport(id),
    [`DELETE /finance/imports/${id}`]: () => ({}),
    [`POST /finance/imports/${id}/restore`]: () => wImport(id),
    [`POST /finance/imports/${id}/discard-file`]: () => wImport(id),
  })
  const c = createImportClient(http)
  await c.list()
  await c.start({
    id,
    account_id: ACCT,
    file_name: "a.csv",
    file_type: "csv",
  })
  await c.csv(id, { text: "x", layout: "gcash", force_account: false })
  await c.rows(id, [])
  await c.fail(id, "unreadable")
  await c.detail(id)
  await c.patchRows(id, { row_ids: [ROW1], decision: "ignore" })
  await c.commit(id, BANK)
  await c.commit(id)
  await c.undo(id)
  await c.remove(id)
  await c.restore(id)
  await c.discardFile(id)
  expect(calls).toEqual([
    { method: "GET", path: "/finance/imports?skip=0&limit=100" },
    {
      method: "POST",
      path: "/finance/imports",
      body: { id, account_id: ACCT, file_name: "a.csv", file_type: "csv" },
    },
    {
      method: "POST",
      path: `/finance/imports/${id}/csv`,
      body: { text: "x", layout: "gcash", force_account: false },
    },
    { method: "POST", path: `/finance/imports/${id}/rows`, body: { rows: [] } },
    {
      method: "POST",
      path: `/finance/imports/${id}/fail`,
      body: { error_code: "unreadable" },
    },
    { method: "GET", path: `/finance/imports/${id}` },
    {
      method: "PATCH",
      path: `/finance/imports/${id}/rows`,
      body: { row_ids: [ROW1], decision: "ignore" },
    },
    {
      method: "POST",
      path: `/finance/imports/${id}/commit`,
      body: { transfer_account_id: BANK },
    },
    {
      method: "POST",
      path: `/finance/imports/${id}/commit`,
      body: { transfer_account_id: null },
    },
    { method: "POST", path: `/finance/imports/${id}/undo` },
    { method: "DELETE", path: `/finance/imports/${id}` },
    { method: "POST", path: `/finance/imports/${id}/restore` },
    { method: "POST", path: `/finance/imports/${id}/discard-file` },
  ])
})

// ------------------------------------------------------------------ files

test("statement rows export as the GCash and BPI CSV layouts the server parses", () => {
  const rows = [
    {
      ref: "A1",
      date: "2026-10-02",
      time: "09:30",
      raw: 'SHOP, "BIG" SALE',
      amount: 250.5,
      direction: "out" as const,
    },
    {
      ref: "A2",
      date: "2026-10-03",
      time: "18:00",
      raw: "CASH-IN VIA INSTAPAY",
      amount: 1000,
      direction: "in" as const,
    },
  ]
  // Header names: backend imports.LAYOUTS; a quoted cell doubles its quotes.
  expect(exportCsv("gcash", rows)).toBe(
    "Date and Time,Description,Reference No.,Debit,Credit\n" +
      '2026-10-02 09:30,"SHOP, ""BIG"" SALE",A1,250.50,\n' +
      "2026-10-03 18:00,CASH-IN VIA INSTAPAY,A2,,1000.00\n",
  )
  expect(exportCsv("bpi", rows).split("\n")[0]).toBe(
    "Transaction Date,Description,Reference Number,Debit,Credit",
  )
})

test("each sample file uploads as what the server can read", () => {
  const gcash = sampleSource("gcash-pdf")
  expect(gcash.kind === "csv" && gcash.layout).toBe("gcash")
  expect(gcash.kind === "csv" && gcash.text.split("\n").length).toBeGreaterThan(
    3,
  )
  const bpi = sampleSource("bpi-pdf")
  expect(bpi.kind === "csv" && bpi.layout).toBe("bpi")
  expect(sampleSource("maya-shot")).toEqual({ kind: "rows", rows: [] })
  expect(sampleSource("blurry")).toEqual({ kind: "fail", code: "unreadable" })
})

test("a picked CSV's layout is read from its header line", () => {
  expect(
    detectCsv("Date and Time,Description,Reference No.,Debit,Credit\n"),
  ).toMatchObject({ layout: "gcash" })
  expect(
    detectCsv(
      "BPI Savings 1234\nTransaction Date,Description,Reference Number,Debit,Credit\n",
    ),
  ).toMatchObject({ layout: "bpi" })
  expect(detectCsv("Posting Date;Particulars;Amount\n")).toMatchObject({
    layout: "generic",
    mapping: {
      date: "posting date",
      description: "particulars",
      amount: "amount",
    },
  })
  expect(
    detectCsv('"Date","Details","Withdrawals","Deposits"\n'),
  ).toMatchObject({
    layout: "generic",
    mapping: {
      date: "date",
      description: "details",
      debit: "withdrawals",
      credit: "deposits",
    },
  })
  expect(detectCsv("name,email\nAna,a@x.ph\n")).toBeNull()
})

test("the detected account is the user's own account of the layout's type", () => {
  const accounts = [
    account(ACCT, "Wallet", "ewallet"),
    account(BANK, "Payroll", "bank"),
    account("99999999-9999-4999-8999-999999999999", "BPI Savings", "bank"),
  ]
  const bpi = sampleSource("bpi-pdf")
  // Prefers the account named after the bank over the first bank.
  expect(detectedAccount(accounts, bpi, ACCT)?.name).toBe("BPI Savings")
  expect(detectedAccount(accounts, sampleSource("gcash-pdf"), BANK)?.id).toBe(
    ACCT,
  )
  // Never the account already chosen; none for a screenshot.
  expect(
    detectedAccount(accounts, sampleSource("gcash-pdf"), ACCT),
  ).toBeUndefined()
  expect(
    detectedAccount(accounts, sampleSource("maya-shot"), ACCT),
  ).toBeUndefined()
})

// ------------------------------------------------------------------ mapping

test("server rows and imports map to the screen's shapes", () => {
  const cats = categoryIds(USER)
  const row = rowFromServer(
    wRow(ROW1, { match_id: REC, state: "probable", time: null }),
    cats,
  )
  expect(row).toEqual({
    id: ROW1,
    ref: "R1",
    date: "2026-10-02",
    time: "12:00",
    raw: "JOLLIBEE MAKATI",
    amount: 250.5,
    direction: "out",
    pending: undefined,
    payee: "Jollibee",
    suggestedCategoryId: "food",
    state: "probable",
    reason: undefined,
    matchId: REC,
    confidence: 0.9,
    decision: "accept",
    categoryId: undefined,
    isTransfer: undefined,
  })
  const imp = importFromServer(
    wImport("i1", {
      status: "failed",
      file_type: "image",
      error_code: "no_rows",
      counts: { matched: 1, created: 2, updated: 3, ignored: 4 },
    }),
    [row],
  )
  expect(imp).toMatchObject({
    accountId: ACCT,
    from: "2026-10-01",
    to: "2026-10-05",
    closing: 1234.56,
    status: "failed",
    createdAt: "2026-10-06T01:02:03.000Z",
    counts: { matched: 1, created: 2, updated: 3, ignored: 4 },
    error:
      "0 transactions found in the screenshot — try a longer scroll capture.",
  })
})

test("screen row edits become the server's row patch", () => {
  const cats = categoryIds(USER)
  expect(
    patchToServer([ROW1], { decision: "accept", categoryId: "food" }, cats),
  ).toEqual({
    row_ids: [ROW1],
    decision: "accept",
    category_id: FOOD,
  })
  // "Create new" / "Not the same": an explicit undefined match clears it.
  expect(
    patchToServer(
      [ROW1],
      { state: "new", matchId: undefined, decision: "accept" },
      cats,
    ),
  ).toEqual({ row_ids: [ROW1], decision: "accept", match_id: null })
  expect(
    patchToServer([ROW1], { matchId: REC, decision: "take" }, cats),
  ).toEqual({
    row_ids: [ROW1],
    decision: "take",
    match_id: REC,
  })
})

test("failure text never shows a server error body", () => {
  expect(failureText(new NetworkError("TypeError: x"))).toMatch(/offline/)
  expect(
    failureText(
      new ApiError(422, "transfer_account_required", "Pick the account"),
    ),
  ).toBe("Pick the account")
  expect(failureText(new ApiError(500, "internal", "Traceback ..."))).toBe(
    "Something went wrong — try again.",
  )
})

// ------------------------------------------------------------------ actions

function setup(routes: Record<string, Route>) {
  const { http, calls } = fakeHttp(routes)
  const sync = jest.fn(async () => {})
  const live = createLiveImport({
    client: createImportClient(http),
    userId: async () => USER,
    sync,
  })
  return { live, calls, sync }
}
const imports = () => finStore.get().imports
const get = (id: string) =>
  imports().find((i) => i.id === id) as StatementImport

test("read: syncs first, starts, uploads the sample CSV and loads the review", async () => {
  const id = begin(setup({}).live)
  expect(get(id)).toMatchObject({ status: "parsing", accountId: ACCT })
  const order: string[] = []
  const s = setupWith(id, {
    start: () => {
      order.push("start")
      return wImport(id, { status: "parsing" })
    },
    csv: () => wImport(id),
    detail: (): WDetail => ({
      import: wImport(id),
      rows: [
        wRow(ROW1),
        wRow(ROW2, { position: 1, is_transfer: true, direction: "in" }),
      ],
      app_balance_minor: 0,
    }),
  })
  s.sync.mockImplementation(async () => void order.push("sync"))
  expect(await s.live.read(id, sampleSource("gcash-pdf"))).toBe("ok")
  // Device edits reach the server before it reconciles against them.
  expect(order).toEqual(["sync", "start"])
  expect(s.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
    "POST /finance/imports",
    `POST /finance/imports/${id}/csv`,
    `GET /finance/imports/${id}`,
  ])
  expect(s.calls[0].body).toEqual({
    id,
    account_id: ACCT,
    file_name: "GCash_Transaction_History.csv",
    file_type: "csv",
  })
  expect(s.calls[1].body).toMatchObject({
    layout: "gcash",
    force_account: false,
  })
  expect(get(id).status).toBe("review")
  expect(get(id).rows.map((r) => [r.id, r.amount, r.isTransfer])).toEqual([
    [ROW1, 250.5, undefined],
    [ROW2, 250.5, true],
  ])
  expect(s.live.needsTransferAccount(get(id))).toBe(true)
})

/** A live import whose routes answer for one import id. */
function setupWith(
  id: string,
  r: {
    start?: Route
    csv?: Route
    rows?: Route
    fail?: Route
    detail?: Route
    patch?: Route
    commit?: Route
    undo?: Route
    remove?: Route
    restore?: Route
  },
) {
  const base = `/finance/imports/${id}`
  const routes: Record<string, Route> = {
    "POST /finance/imports":
      r.start ?? (() => wImport(id, { status: "parsing" })),
  }
  if (r.csv) routes[`POST ${base}/csv`] = r.csv
  if (r.rows) routes[`POST ${base}/rows`] = r.rows
  if (r.fail) routes[`POST ${base}/fail`] = r.fail
  if (r.detail) routes[`GET ${base}`] = r.detail
  if (r.patch) routes[`PATCH ${base}/rows`] = r.patch
  if (r.commit) routes[`POST ${base}/commit`] = r.commit
  if (r.undo) routes[`POST ${base}/undo`] = r.undo
  if (r.remove) routes[`DELETE ${base}`] = r.remove
  if (r.restore) routes[`POST ${base}/restore`] = r.restore
  return setup(routes)
}

function begin(live: ReturnType<typeof setup>["live"]) {
  return live.begin(
    ACCT,
    { name: "GCash_Transaction_History.csv", type: "csv" },
    sampleSource("gcash-pdf"),
  )
}

test("read: a wrong-account refusal returns the prompt; force re-uploads", async () => {
  const id = begin(setup({}).live)
  let refuse = true
  const s = setupWith(id, {
    csv: () => {
      if (refuse) throw new ApiError(409, "wrong_account", "another account")
      return wImport(id)
    },
    detail: () => ({ import: wImport(id), rows: [], app_balance_minor: 0 }),
  })
  expect(await s.live.read(id, sampleSource("bpi-pdf"))).toBe("wrong-account")
  expect(get(id).status).toBe("parsing")
  refuse = false
  expect(
    await s.live.read(id, sampleSource("bpi-pdf"), {
      accountId: ACCT,
      force: true,
    }),
  ).toBe("ok")
  expect(
    s.calls
      .filter((c) => c.path.endsWith("/csv"))
      .map((c) => (c.body as { force_account: boolean }).force_account),
  ).toEqual([false, true])
})

test("read: 'use detected account' re-points the import before uploading", async () => {
  const id = begin(setup({}).live)
  const s = setupWith(id, {
    start: (c) =>
      wImport(id, {
        status: "parsing",
        account_id: (c.body as { account_id: string }).account_id,
      }),
    csv: () => wImport(id, { account_id: BANK }),
    detail: () => ({
      import: wImport(id, { account_id: BANK }),
      rows: [],
      app_balance_minor: 0,
    }),
  })
  expect(
    await s.live.read(id, sampleSource("bpi-pdf"), { accountId: BANK }),
  ).toBe("ok")
  expect((s.calls[0].body as { account_id: string }).account_id).toBe(BANK)
  expect(get(id).accountId).toBe(BANK)
})

test("read: a CSV the server cannot parse is failed as unreadable", async () => {
  const id = begin(setup({}).live)
  const s = setupWith(id, {
    csv: () => {
      throw new ApiError(422, "csv_header_not_found", "Couldn't read this file")
    },
    fail: () => wImport(id, { status: "failed", error_code: "unreadable" }),
  })
  expect(await s.live.read(id, sampleSource("gcash-pdf"))).toBe("failed")
  expect(s.calls.at(-1)).toEqual({
    method: "POST",
    path: `/finance/imports/${id}/fail`,
    body: { error_code: "unreadable" },
  })
  expect(get(id)).toMatchObject({
    status: "failed",
    error: "Couldn't read this file.",
  })
})

test("read: a screenshot uploads no rows and shows the server's no-rows failure", async () => {
  const id = setup({}).live.begin(
    ACCT,
    { name: "Screenshot_Maya_history.png", type: "image" },
    sampleSource("maya-shot"),
  )
  const s = setupWith(id, {
    rows: () =>
      wImport(id, {
        status: "failed",
        error_code: "no_rows",
        file_type: "image",
      }),
  })
  expect(await s.live.read(id, sampleSource("maya-shot"))).toBe("failed")
  expect(s.calls[1].body).toEqual({ rows: [] })
  expect(get(id).error).toMatch(/0 transactions found in the screenshot/)
})

test("read: offline marks the device's import failed (retryable), not empty", async () => {
  const id = begin(setup({}).live)
  const s = setupWith(id, {
    start: () => {
      throw new NetworkError("down")
    },
  })
  expect(await s.live.read(id, sampleSource("gcash-pdf"))).toBe("failed")
  expect(get(id)).toMatchObject({
    status: "failed",
    error: expect.stringMatching(/offline/),
  })
})

test("patchRows: applied at once, then replaced by the server's rows", async () => {
  const id = begin(setup({}).live)
  const s = setupWith(id, {
    detail: () => ({
      import: wImport(id),
      rows: [wRow(ROW1), wRow(ROW2, { position: 1 })],
      app_balance_minor: 0,
    }),
    patch: () => [wRow(ROW1, { decision: "ignore", reason: "server says" })],
  })
  await s.live.load(id)
  const p = s.live.patchRows(id, [ROW1], { decision: "ignore" })
  expect(get(id).rows[0].decision).toBe("ignore")
  await p
  expect(get(id).rows[0]).toMatchObject({
    decision: "ignore",
    reason: "server says",
  })
  expect(s.calls.at(-1)?.body).toEqual({ row_ids: [ROW1], decision: "ignore" })
})

test("patchRows: a refused edit rolls back to the server's rows", async () => {
  const id = begin(setup({}).live)
  const s = setupWith(id, {
    detail: () => ({
      import: wImport(id),
      rows: [wRow(ROW1)],
      app_balance_minor: 0,
    }),
    patch: () => {
      throw new ApiError(
        409,
        "import_not_in_review",
        "This import is not being reviewed",
      )
    },
  })
  await s.live.load(id)
  await expect(
    s.live.patchRows(id, [ROW1], { decision: "ignore" }),
  ).rejects.toThrow("This import is not being reviewed")
  expect(get(id).rows[0].decision).toBe("accept")
})

test("commit: on the server with the transfer account, then pulls and reloads", async () => {
  const id = begin(setup({}).live)
  let done = false
  const s = setupWith(id, {
    commit: () => {
      done = true
      return {
        gap_minor: -1050,
        created: 2,
        updated: 1,
        matched: 3,
        ignored: 0,
      }
    },
    detail: () => ({
      import: wImport(
        id,
        done
          ? {
              status: "done",
              file_kept: false,
              created_ids: ["a", "b"],
              counts: { matched: 3, created: 2, updated: 1, ignored: 0 },
            }
          : {},
      ),
      rows: [wRow(ROW1)],
      app_balance_minor: 0,
    }),
  })
  const order: string[] = []
  s.sync.mockImplementation(async () => void order.push(`sync done=${done}`))
  expect(await s.live.commit(id, BANK)).toEqual({
    gap: -10.5,
    created: 2,
    updated: 1,
  })
  expect(s.calls[0].body).toEqual({ transfer_account_id: BANK })
  // The pull runs after the commit, so the server's records come down.
  expect(order).toEqual(["sync done=true"])
  expect(get(id)).toMatchObject({
    status: "done",
    createdIds: ["a", "b"],
    fileKept: false,
  })
})

test("undo, discard and restore go to the server", async () => {
  const id = begin(setup({}).live)
  const s = setupWith(id, {
    undo: () => wImport(id, { status: "undone" }),
    remove: () => ({ ids: [id] }),
    restore: () => wImport(id, { status: "review" }),
    detail: () => ({
      import: wImport(id),
      rows: [wRow(ROW1)],
      app_balance_minor: 0,
    }),
  })
  await s.live.undo(id)
  expect(get(id).status).toBe("undone")
  expect(s.sync).toHaveBeenCalled()
  const snapshot = get(id)
  await s.live.discard(id)
  expect(imports().some((i) => i.id === id)).toBe(false)
  await s.live.restore(snapshot)
  expect(get(id)).toMatchObject({
    status: "review",
    rows: [expect.objectContaining({ id: ROW1 })],
  })
})

test("loadList merges the server's history and keeps rows already loaded", async () => {
  const id = begin(setup({}).live)
  const other = "88888888-8888-4888-8888-888888888888"
  const s = setup({
    [`GET /finance/imports/${id}`]: () => ({
      import: wImport(id),
      rows: [wRow(ROW1)],
      app_balance_minor: 0,
    }),
    "GET /finance/imports": () => ({
      data: [wImport(id), wImport(other, { status: "done" })],
      count: 2,
    }),
  })
  await s.live.load(id)
  await s.live.loadList()
  expect(get(id).rows.map((r) => r.id)).toEqual([ROW1])
  expect(get(other).status).toBe("done")
})

test("sourceOf: an import started on this device keeps its file; others resolve by sample name", () => {
  const { live } = setup({})
  const picked = { kind: "csv" as const, layout: "generic" as const, text: "x" }
  const id = live.begin(ACCT, { name: "mine.csv", type: "csv" }, picked)
  expect(live.sourceOf(id)).toBe(picked)
  finStore.set((s) => ({
    ...s,
    imports: [
      { ...get(id), id: "elsewhere", fileName: "BPI_SA_History.csv" },
      ...s.imports,
    ],
  }))
  expect(live.sourceOf("elsewhere")).toMatchObject({ layout: "bpi" })
})
