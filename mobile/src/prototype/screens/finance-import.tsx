import * as A from "@domain/finance/actions"
import * as C from "@domain/finance/calc"
import {
  type ImportRow,
  type StatementImport,
  signedFor,
} from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import * as DocumentPicker from "expo-document-picker"
import { useLocalSearchParams } from "expo-router"
import {
  Camera,
  Check,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Lock,
  RotateCcw,
  Tag,
  Trash2,
  Upload,
} from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import { ActivityIndicator, Platform, ScrollView, View } from "react-native"
import { toast } from "sonner-native"
import { liveMode } from "@/live/config"
import {
  detectCsv,
  detectedAccount,
  failureText,
  LIVE_SAMPLE_META,
  liveImport,
  type StatementSource,
  sampleSource,
} from "@/live/finance-import"
import {
  Copy,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  Segmented,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import {
  Button,
  Choices,
  confirm,
  Empty,
  Field,
  Screen,
  Sheet,
  undo,
} from "../ui"
import { useMoney } from "./finance"
import { AccountIcon } from "./finance-accounts"
import { FinPill } from "./finance-planned"
import { FinChip } from "./finance-projection"

// Live mode: a review edit goes to the server; prototype mode edits the store.
function editRows(importId: string, ids: string[], patch: Partial<ImportRow>) {
  if (!liveMode) return A.patchRows(importId, ids, patch)
  void liveImport()
    .patchRows(importId, ids, patch)
    .catch((e) => toast(failureText(e)))
}
const liveError = (e: unknown) => void toast(failureText(e))
// The server keeps an import's before-images; live mode counts them.
const changedCount = (i: StatementImport) =>
  liveMode && i.counts ? i.counts.matched + i.counts.updated : i.changed.length
/** A picked file's text (web hands over a File, native a cache uri). */
async function pickedText(asset: DocumentPicker.DocumentPickerAsset) {
  if (Platform.OS === "web")
    return asset.file ? asset.file.text() : (await fetch(asset.uri)).text()
  const { File } = await import("expo-file-system")
  return new File(asset.uri).text()
}
export function ImportStatement({ id }: { id?: string }) {
  const s = finStore.use((s) => s),
    imp = s.imports.find((i) => i.id === id),
    [loading, setLoading] = useState(liveMode && !!id && !imp)
  // Live: read the server's copy (rows, counts) unless the device is
  // reading the file right now.
  useEffect(() => {
    if (!liveMode || !id) return
    const cur = finStore.get().imports.find((i) => i.id === id)
    if (cur?.status === "parsing" || cur?.status === "failed") return
    liveImport()
      .load(id)
      .catch(liveError)
      .finally(() => setLoading(false))
  }, [id])
  if (!id) return <ImportStart />
  if (!imp && loading)
    return (
      <Screen title="Import">
        <ActivityIndicator style={{ paddingVertical: 40 }} />
      </Screen>
    )
  if (!imp)
    return (
      <Screen title="Import">
        <Empty
          title="Import not found"
          detail="It may have been deleted."
          action={<Button href="/finance/import">New import</Button>}
        />
      </Screen>
    )
  return imp.status === "parsing" ? (
    <Parsing imp={imp} />
  ) : imp.status === "review" ? (
    <Review imp={imp} />
  ) : imp.status === "failed" ? (
    <Failed imp={imp} />
  ) : (
    <Done imp={imp} />
  )
}
const caps = { textTransform: "uppercase", letterSpacing: 0.6 } as const
function ImportStart() {
  const s = finStore.use((s) => s),
    t = useTheme(),
    p = useLocalSearchParams<{ account?: string }>(),
    [chosen, setAcct] = useState(p.account ?? (liveMode ? "" : "gcash")),
    [file, setFileKey] = useState<A.SampleFile | null>(null),
    [picked, setPicked] = useState<{
      name: string
      size: string
      source: StatementSource
    } | null>(null),
    eligible = s.accounts.filter((a) => !a.archived && a.type !== "investment"),
    // Live: no demo "gcash"; start on the default (or first) real account.
    acct =
      chosen ||
      (
        eligible.find((a) => a.id === s.settings.defaultAccountId) ??
        eligible[0]
      )?.id ||
      "",
    samples = A.SAMPLE_FILES.map((f) =>
      liveMode ? { ...f, ...LIVE_SAMPLE_META[f.key] } : f,
    ),
    setFile = (f: A.SampleFile) => {
      setPicked(null)
      setFileKey(f)
    },
    browse = async () => {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "text/comma-separated-values",
          "application/vnd.ms-excel",
          "text/plain",
        ],
        copyToCacheDirectory: true,
      })
      const asset = res.canceled ? undefined : res.assets[0]
      if (!asset) return
      const source = detectCsv(await pickedText(asset))
      if (!source) {
        toast("Couldn't find date, description and amount columns in that file")
        return
      }
      setFileKey(null)
      setPicked({
        name: asset.name,
        size: `${Math.max(1, Math.round((asset.size ?? 0) / 1024))} KB`,
        source,
      })
    }
  return (
    <Screen title="Import statement">
      <Copy size={14} muted style={{ paddingHorizontal: 4 }}>
        Upload a bank or e-wallet statement. I'll read it, match it against your
        transactions, and show you every difference before anything changes.
      </Copy>
      <Copy size={12} muted weight="medium" style={caps}>
        Account
      </Copy>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Line style={{ gap: 8 }}>
          {eligible.map((a) => (
            <FinChip
              key={a.id}
              label={a.name}
              active={acct === a.id}
              onPress={() => setAcct(a.id)}
              leading={<AccountIcon account={a} size={24} />}
            />
          ))}
        </Line>
      </ScrollView>
      <Copy size={12} muted weight="medium" style={caps}>
        File
      </Copy>
      <View style={{ gap: 8 }}>
        {picked && (
          <Frame
            style={{
              padding: 12,
              borderColor: t.fin,
              backgroundColor: `${t.fin}1a`,
            }}
          >
            <Line>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: t.soft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <FileText size={20} color={t.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Copy size={14} weight="medium">
                  {picked.name}
                </Copy>
                <Copy size={12} muted>
                  {picked.size} · Your file
                </Copy>
              </View>
              <Check size={20} color={t.fin} />
            </Line>
          </Frame>
        )}
        {samples.map((f) => {
          const Icon =
            f.type === "image"
              ? ImageIcon
              : f.key === "bpi-pdf"
                ? Lock
                : FileText
          return (
            <Tap key={f.key} onPress={() => setFile(f.key)}>
              <Frame
                style={{
                  padding: 12,
                  borderColor: file === f.key ? t.fin : t.line,
                  backgroundColor: file === f.key ? `${t.fin}1a` : t.card,
                }}
              >
                <Line>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      backgroundColor: t.soft,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon size={20} color={t.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Copy size={14} weight="medium">
                      {f.name}
                    </Copy>
                    <Copy size={12} muted>
                      {f.size} · {f.hint}
                    </Copy>
                  </View>
                  {file === f.key && <Check size={20} color={t.fin} />}
                </Line>
              </Frame>
            </Tap>
          )
        })}
        <Line style={{ gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              tone="quiet"
              icon={Upload}
              onPress={() =>
                liveMode ? void browse().catch(liveError) : setFile("gcash-pdf")
              }
            >
              Browse files
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button
              tone="quiet"
              icon={Camera}
              onPress={() => setFile("maya-shot")}
            >
              Screenshots
            </Button>
          </View>
        </Line>
      </View>
      <Copy size={11} muted>
        {liveMode
          ? "Pick a sample statement, or Browse files for a CSV export."
          : "Prototype: pick one of these sample files."}
      </Copy>
      <Frame style={{ padding: 16, backgroundColor: t.soft }}>
        <Copy size={12} weight="medium" style={{ marginBottom: 4 }}>
          Tips
        </Copy>
        <Copy size={12} muted>
          GCash: Profile › Transactions › Download (PDF, emailed). BPI:
          e-Statement PDF (password is usually your birthdate). Multiple
          screenshots work — overlaps are de-duplicated. Files are deleted after
          you confirm; the read rows are kept for reference.
        </Copy>
      </Frame>
      <Button
        disabled={liveMode ? !acct || (!file && !picked) : !file}
        onPress={() => {
          if (liveMode) {
            const meta = picked
                ? { name: picked.name, type: "csv" as const }
                : samples.find((f) => f.key === file),
              source = picked?.source ?? (file ? sampleSource(file) : null)
            if (!meta || !source || !acct) return
            const id = liveImport().begin(acct, meta, source)
            go(`/finance/import/${id}`)
          } else if (file) {
            const id = A.startImport(acct, file)
            go(`/finance/import/${id}?file=${file}`)
          }
        }}
      >
        Upload & read
      </Button>
    </Screen>
  )
}
function Parsing({ imp }: { imp: StatementImport }) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    p = useLocalSearchParams<{ file?: A.SampleFile }>(),
    file =
      p.file ??
      A.SAMPLE_FILES.find((f) => f.name === imp.fileName)?.key ??
      "gcash-pdf",
    [step, setStep] = useState(0),
    [prompt, setPrompt] = useState(""),
    [pw, setPw] = useState(""),
    timers = useRef<ReturnType<typeof setTimeout>[]>([]),
    source = liveMode ? liveImport().sourceOf(imp.id, p.file) : undefined,
    liveDetected = liveMode
      ? detectedAccount(s.accounts, source, imp.accountId)
      : undefined,
    detected = liveMode
      ? (liveDetected?.id ?? "")
      : file === "bpi-pdf"
        ? "bpi"
        : file === "maya-shot"
          ? "maya"
          : "gcash",
    detectedName =
      liveDetected?.name ??
      (source?.kind === "csv" && source.layout === "bpi"
        ? "a BPI account"
        : liveMode
          ? "a GCash account"
          : detected),
    acct = s.accounts.find((a) => a.id === imp.accountId)
  const run = (force?: string) => {
    setPrompt("")
    setStep(1)
    timers.current.forEach(clearTimeout)
    if (liveMode) {
      // The server reads, parses and matches; "force" is the account the
      // person chose on the wrong-account prompt.
      timers.current = [setTimeout(() => setStep(2), 700)]
      void liveImport()
        .read(imp.id, source, {
          accountId: force,
          force: force === imp.accountId,
        })
        .then((r) => {
          if (r === "wrong-account") {
            setPrompt(r)
            setStep(0)
          } else setStep(3)
        })
      return
    }
    timers.current = [
      setTimeout(() => setStep(2), 700),
      setTimeout(() => {
        const r = A.parseImport(imp.id, file, {
          password: pw,
          forceAccount: force,
        })
        if (r === "password" || r === "bad-password" || r === "wrong-account") {
          setPrompt(r)
          setStep(0)
        } else setStep(3)
      }, 1500),
    ]
  }
  // Begin once for this import; retries use the current password and account choice.
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit per-import lifecycle
  useEffect(() => {
    run()
    return () => timers.current.forEach(clearTimeout)
  }, [imp.id])
  return (
    <Screen title="Reading statement">
      <Frame style={{ padding: 16 }}>
        <Line>
          <FileText size={32} color={t.muted} />
          <View style={{ flex: 1 }}>
            <Copy size={14} weight="medium">
              {imp.fileName}
            </Copy>
            <Copy size={12} muted>
              for {acct?.name}
            </Copy>
          </View>
        </Line>
      </Frame>
      {!prompt ? (
        <Frame style={{ padding: 16, gap: 12 }}>
          {[
            "Reading file",
            "Parsing transactions",
            "Matching to your transactions",
          ].map((label, i) => (
            <Line key={label}>
              {step > i ? (
                <CheckCircle2 size={20} color={t.good} />
              ) : step === i ? (
                <ActivityIndicator color={t.fin} />
              ) : (
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: t.line,
                  }}
                />
              )}
              <Copy size={14} muted={step < i}>
                {label}
              </Copy>
            </Line>
          ))}
        </Frame>
      ) : prompt === "wrong-account" ? (
        <Frame style={{ padding: 16, gap: 12 }}>
          <Copy weight="semibold">This looks like a different account</Copy>
          <Copy size={14} muted>
            Selected {acct?.name}, but the file looks like{" "}
            {s.accounts.find((a) => a.id === detected)?.name ?? detectedName}.
          </Copy>
          {(!liveMode || !!liveDetected) && (
            <Button onPress={() => run(detected)}>Use detected account</Button>
          )}
          <Button tone="quiet" onPress={() => run(imp.accountId)}>
            Use selected account anyway
          </Button>
          <Button tone="quiet" href="/finance/import">
            Choose another file
          </Button>
        </Frame>
      ) : (
        <Frame style={{ padding: 16, gap: 8 }}>
          <Copy weight="semibold">This PDF is password-protected</Copy>
          <Copy size={14} muted>
            Used once to open the file, never stored. (Prototype password: 1234)
          </Copy>
          <Field
            label="PDF password"
            value={pw}
            onChangeText={setPw}
            secureTextEntry
          />
          {prompt === "bad-password" && (
            <Copy size={12} style={{ color: t.bad }}>
              That password didn't open it. Try again.
            </Copy>
          )}
          <Button onPress={() => run()}>Unlock & read</Button>
        </Frame>
      )}
    </Screen>
  )
}
function Failed({ imp }: { imp: StatementImport }) {
  return (
    <Screen title="Import failed">
      <Empty
        title="Couldn't read this statement"
        detail={
          imp.error ??
          "The file is unreadable, for the wrong account, or has 0 rows."
        }
        action={
          <View style={{ gap: 8 }}>
            <Button
              icon={RotateCcw}
              onPress={() => {
                A.patchImport(imp.id, { status: "parsing", error: undefined })
                go(
                  liveMode
                    ? `/finance/import/${imp.id}`
                    : `/finance/import/${imp.id}?file=gcash-pdf`,
                )
              }}
            >
              Retry
            </Button>
            <Button
              tone="quiet"
              href={`/finance/import?account=${imp.accountId}`}
            >
              Choose another file
            </Button>
            <Button
              tone="quiet"
              onPress={() => toast("Thanks — file format reported (mock)")}
            >
              Report this format
            </Button>
          </View>
        }
      />
    </Screen>
  )
}
function ImportCounts({
  items,
}: {
  items: { label: string; n: number; color?: string }[]
}) {
  const t = useTheme()
  return (
    <Line style={{ gap: 6 }}>
      {items.map((x) => (
        <Frame
          key={x.label}
          style={{ flex: 1, paddingVertical: 8, alignItems: "center" }}
        >
          <Copy
            size={18}
            weight="displayMedium"
            style={{ color: x.color ?? t.text }}
          >
            {x.n}
          </Copy>
          <Copy size={10} muted>
            {x.label}
          </Copy>
        </Frame>
      ))}
    </Line>
  )
}
function Review({ imp }: { imp: StatementImport }) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    money = useMoney(),
    [tab, setTab] = useState("attention"),
    [sel, setSel] = useState<string[]>([]),
    [fix, setFix] = useState<string | null>(null),
    [picker, setPicker] = useState(false),
    [transferPick, setTransferPick] = useState(false),
    [busy, setBusy] = useState(false),
    acct = s.accounts.find((a) => a.id === imp.accountId),
    rows = imp.rows,
    attention = rows.filter(C.needsAttention),
    counts = {
      matched: rows.filter((r) => r.state === "matched").length,
      new: rows.filter((r) => r.state === "new").length,
      probable: rows.filter((r) => r.state === "probable").length,
      duplicate: rows.filter((r) => r.state === "duplicate").length,
    },
    list =
      tab === "attention" ? attention : rows.filter((r) => r.state === tab),
    appNow = acct ? C.balanceOf(s, acct, imp.to) : 0
  let after = appNow
  for (const r of rows) {
    if (r.decision === "ignore") continue
    if (
      r.state === "new" ||
      (r.state === "duplicate" && r.decision === "accept")
    )
      after += C.rowSigned(r)
    if (
      r.state === "probable" &&
      r.matchId &&
      (r.decision === "take" || r.decision === "merge")
    ) {
      const rec = s.records.find((x) => x.id === r.matchId)
      if (rec) after += C.rowSigned(r) - signedFor(rec, imp.accountId)
    }
  }
  const gap = imp.closing - after,
    caught =
      counts.matched /
      Math.max(1, counts.matched + counts.new + counts.probable),
    report = (res: { gap: number; created: number; updated: number }) => {
      toast(`Imported — ${res.created} added, ${res.updated} updated`)
      if (Math.abs(res.gap) >= 1 && acct)
        confirm(
          "Balance adjustment",
          `The statement differs by ${money(res.gap)}. Log an adjustment to match it?`,
          () =>
            A.adjustBalance(
              acct.id,
              C.balanceOf(finStore.get(), acct) + res.gap,
              `Gap after ${imp.fileName}`,
            ),
        )
    },
    // Live: the server writes the records (linked to this import).
    applyLive = (transferAccountId?: string) => {
      setBusy(true)
      liveImport()
        .commit(imp.id, transferAccountId)
        .then(report, liveError)
        .finally(() => setBusy(false))
    }
  return (
    <Screen
      title="Match with statement"
      footer={
        <Frame style={{ margin: 16, padding: 8 }}>
          <Line style={{ gap: 8 }}>
            <Button
              tone="quiet"
              onPress={() => {
                toast("Draft saved — resume from Import history")
                go("/finance/imports")
              }}
            >
              Save draft
            </Button>
            <View style={{ flex: 1 }}>
              <Button
                disabled={busy}
                onPress={() => {
                  if (!liveMode) report(A.commitImport(imp.id))
                  else if (liveImport().needsTransferAccount(imp))
                    setTransferPick(true)
                  else applyLive()
                }}
              >{`Apply ${rows.filter((r) => r.decision !== "ignore").length} changes`}</Button>
            </View>
          </Line>
        </Frame>
      }
    >
      <Line style={{ paddingBottom: 8 }}>
        <FileText size={36} color={t.fin} />
        <View style={{ flex: 1 }}>
          <Copy weight="medium">{acct?.name} statement</Copy>
          <Copy size={12} muted>
            {C.shortDate(imp.from)} – {C.shortDate(imp.to)} · {rows.length} rows
          </Copy>
        </View>
      </Line>
      <ImportCounts
        items={[
          { label: "matched", n: counts.matched, color: t.good },
          { label: "new", n: counts.new, color: t.fin },
          { label: "conflicts", n: counts.probable, color: t.warn },
          { label: "dupes", n: counts.duplicate, color: t.muted },
        ]}
      />
      <Frame style={{ padding: 16, gap: 4 }}>
        <Line style={{ justifyContent: "space-between" }}>
          <Copy size={14} muted>
            Statement closing
          </Copy>
          <Copy size={14} weight="semibold">
            {money(imp.closing)}
          </Copy>
        </Line>
        <Line style={{ justifyContent: "space-between" }}>
          <Copy size={14} muted>
            App balance after import
          </Copy>
          <Copy size={14} weight="semibold">
            {money(after)}
          </Copy>
        </Line>
        <Copy
          size={12}
          style={{
            padding: 8,
            borderRadius: 8,
            marginTop: 4,
            color: Math.abs(gap) < 1 ? t.good : t.warn,
            backgroundColor: Math.abs(gap) < 1 ? `${t.good}1a` : `${t.warn}1a`,
          }}
        >
          {Math.abs(gap) < 1
            ? "✓ Balances will match"
            : `⚠ Off by ${money(gap)} — you can log an adjustment after import`}
        </Copy>
        <Copy size={12} muted style={{ marginTop: 4 }}>
          You caught{" "}
          <Copy size={12} weight="semibold">
            {Math.round(caught * 100)}%
          </Copy>{" "}
          of these yourself. Nice logging.
        </Copy>
      </Frame>
      <Segmented
        value={tab}
        onChange={(v) => {
          setTab(v)
          setSel([])
        }}
        options={[
          { value: "attention", label: `Needs attention ${attention.length}` },
          { value: "new", label: `New ${counts.new}` },
          { value: "matched", label: `Matched ${counts.matched}` },
        ]}
      />
      {tab === "new" && (
        <Line style={{ gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              tone="quiet"
              small
              icon={Check}
              onPress={() => {
                editRows(
                  imp.id,
                  rows.filter((r) => r.state === "new").map((r) => r.id),
                  { decision: "accept" },
                )
                toast("All new rows accepted")
              }}
            >
              Accept all new
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button
              tone="quiet"
              small
              icon={Tag}
              disabled={!sel.length}
              onPress={() => setPicker(true)}
            >{`Category (${sel.length})`}</Button>
          </View>
        </Line>
      )}
      {!list.length && (
        <Copy
          size={14}
          muted
          style={{ paddingVertical: 40, textAlign: "center" }}
        >
          {tab === "attention"
            ? "Nothing needs your attention."
            : "No rows here."}
        </Copy>
      )}
      <View style={{ gap: 8 }}>
        {list.map((r) => {
          const rec = s.records.find((x) => x.id === r.matchId)
          return (
            <Frame
              key={r.id}
              style={{ opacity: r.decision === "ignore" ? 0.5 : 1 }}
            >
              <Line style={{ gap: 8, alignItems: "stretch" }}>
                {tab === "new" && (
                  <Tap
                    label="Select row"
                    onPress={() =>
                      setSel(
                        sel.includes(r.id)
                          ? sel.filter((id) => id !== r.id)
                          : [...sel, r.id],
                      )
                    }
                    style={{
                      width: 40,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <View
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor: sel.includes(r.id) ? t.fin : t.line,
                        backgroundColor: sel.includes(r.id)
                          ? t.fin
                          : "transparent",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {sel.includes(r.id) && <Check size={14} color={t.bg} />}
                    </View>
                  </Tap>
                )}
                <Tap
                  onPress={() => setFix(r.id)}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    paddingRight: 12,
                    paddingLeft: tab === "new" ? 0 : 12,
                  }}
                >
                  <Line style={{ gap: 8 }}>
                    <Copy size={14} weight="medium" style={{ flex: 1 }}>
                      {r.payee}
                    </Copy>
                    <Copy
                      size={14}
                      weight="semibold"
                      style={{ color: r.direction === "in" ? t.good : t.text }}
                    >
                      {r.direction === "in" ? "+" : "−"}
                      {money(r.amount)}
                    </Copy>
                  </Line>
                  <Copy size={10} muted style={{ marginTop: 2 }}>
                    {r.raw}
                  </Copy>
                  <Line style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                    <FinPill
                      tone={
                        r.state === "matched"
                          ? "good"
                          : r.state === "probable"
                            ? "warn"
                            : r.state === "new"
                              ? "fin"
                              : "muted"
                      }
                    >
                      {r.state === "probable" ? "conflict" : r.state}
                    </FinPill>
                    <Copy size={11} muted>
                      {C.shortDate(r.date)} {r.time}
                    </Copy>
                    {r.state === "new" && (
                      <Copy size={11} muted>
                        ·{" "}
                        {s.categories.find((c) => c.id === r.categoryId)
                          ?.name ?? "no category"}
                      </Copy>
                    )}
                    {r.state === "new" && r.confidence < 0.7 && (
                      <FinPill tone="warn">unsure</FinPill>
                    )}
                    {r.decision === "ignore" && (
                      <Copy size={11} muted>
                        · will ignore
                      </Copy>
                    )}
                  </Line>
                  {r.state === "probable" && rec && (
                    <View
                      style={{
                        marginTop: 8,
                        padding: 8,
                        borderRadius: 8,
                        backgroundColor: t.soft,
                      }}
                    >
                      <Line style={{ gap: 8, alignItems: "flex-start" }}>
                        {[
                          {
                            label: "Your transaction",
                            amount: rec.amount,
                            date: C.recDay(rec),
                          },
                          {
                            label: "Statement",
                            amount: r.amount,
                            date: r.date,
                          },
                        ].map((x, i) => (
                          <View key={x.label} style={{ flex: 1 }}>
                            <Copy size={11} muted>
                              {x.label}
                            </Copy>
                            <Copy
                              size={11}
                              style={{
                                color:
                                  rec.amount !== r.amount
                                    ? i
                                      ? t.good
                                      : t.bad
                                    : t.text,
                                textDecorationLine:
                                  rec.amount !== r.amount && !i
                                    ? "line-through"
                                    : "none",
                              }}
                            >
                              {money(x.amount)}
                            </Copy>
                            <Copy
                              size={11}
                              style={{
                                color:
                                  C.recDay(rec) !== r.date
                                    ? i
                                      ? t.good
                                      : t.bad
                                    : t.text,
                              }}
                            >
                              {C.shortDate(x.date)}
                            </Copy>
                          </View>
                        ))}
                      </Line>
                      <Copy size={11} muted>
                        Default:{" "}
                        {r.decision === "take"
                          ? "take statement, keep my category"
                          : r.decision === "keep"
                            ? "keep mine"
                            : r.decision === "merge"
                              ? "merge"
                              : "ignore"}
                      </Copy>
                    </View>
                  )}
                  {r.state === "matched" && rec && (
                    <Copy size={11} muted style={{ marginTop: 4 }}>
                      ✓ {rec.payee} · fills exact time {r.time} (you logged{" "}
                      {C.timeOf(rec.at)})
                    </Copy>
                  )}
                  {r.reason && r.state !== "probable" && (
                    <Copy size={11} muted style={{ marginTop: 4 }}>
                      {r.reason}
                    </Copy>
                  )}
                </Tap>
              </Line>
            </Frame>
          )
        })}
      </View>
      {picker && (
        <Sheet title="Category" open onClose={() => setPicker(false)}>
          {s.categories
            .filter((c) => c.kind === "expense" && !c.archived)
            .map((c) => (
              <Tap
                key={c.id}
                onPress={() => {
                  editRows(imp.id, sel, {
                    categoryId: c.id,
                    decision: "accept",
                  })
                  toast(`Category set on ${sel.length} rows`)
                  setSel([])
                  setPicker(false)
                }}
                style={{ paddingVertical: 12 }}
              >
                <Copy>
                  {c.icon} {c.name}
                </Copy>
              </Tap>
            ))}
        </Sheet>
      )}
      {transferPick && (
        <Sheet
          title="Transfers came from"
          open
          onClose={() => setTransferPick(false)}
        >
          <Copy size={14} muted>
            Some rows are transfers between your accounts. Pick the account on
            the other side.
          </Copy>
          {s.accounts
            .filter((a) => !a.archived && a.id !== imp.accountId)
            .map((a) => (
              <Tap
                key={a.id}
                onPress={() => {
                  setTransferPick(false)
                  applyLive(a.id)
                }}
                style={{ paddingVertical: 12 }}
              >
                <Line>
                  <AccountIcon account={a} size={24} />
                  <Copy>{a.name}</Copy>
                </Line>
              </Tap>
            ))}
          {!s.accounts.some((a) => !a.archived && a.id !== imp.accountId) && (
            <Copy size={14} muted>
              Add the other account first, or ignore the transfer rows.
            </Copy>
          )}
        </Sheet>
      )}
      {fix && <RowFix imp={imp} rowId={fix} onClose={() => setFix(null)} />}
    </Screen>
  )
}
function RowFix({
  imp,
  rowId,
  onClose,
}: {
  imp: StatementImport
  rowId: string
  onClose: () => void
}) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    money = useMoney(),
    r = imp.rows.find((r) => r.id === rowId),
    rec = s.records.find((x) => x.id === r?.matchId)
  if (!r) return null
  const set = (patch: Partial<ImportRow>, message: string) => {
      editRows(imp.id, [r.id], patch)
      toast(message)
      onClose()
    },
    claimed = new Set(imp.rows.map((x) => x.matchId).filter(Boolean)),
    candidates = s.records
      .filter(
        (x) =>
          (x.accountId === imp.accountId || x.toAccountId === imp.accountId) &&
          !claimed.has(x.id) &&
          Math.abs(C.diffDays(C.recDay(x), r.date)) <= 5 &&
          Math.abs(x.amount - r.amount) <= Math.max(60, r.amount * 0.25),
      )
      .slice(0, 4)
  return (
    <Sheet title="Fix row" open onClose={onClose}>
      <Copy size={14} muted>
        {r.reason ??
          (r.state === "matched"
            ? "Matched with high confidence."
            : "Not in your transactions yet.")}
      </Copy>
      <Line style={{ gap: 8, alignItems: "stretch" }}>
        <Frame style={{ flex: 1, padding: 12, backgroundColor: t.soft }}>
          <Copy size={11} muted>
            STATEMENT
          </Copy>
          <Copy size={14} weight="medium">
            {r.payee}
          </Copy>
          <Copy size={14} weight="semibold">
            {r.direction === "in" ? "+" : "−"}
            {money(r.amount)}
          </Copy>
          <Copy size={12} muted>
            {C.shortDate(r.date)} · {r.time}
          </Copy>
          <Copy size={10} muted>
            {r.raw}
          </Copy>
          <Copy size={10} muted>
            Ref {r.ref}
          </Copy>
        </Frame>
        <Frame style={{ flex: 1, padding: 12, backgroundColor: t.soft }}>
          <Copy size={11} muted>
            YOUR TRANSACTION
          </Copy>
          {rec ? (
            <>
              <Copy size={14} weight="medium">
                {rec.payee ??
                  s.categories.find((c) => c.id === rec.categoryId)?.name}
              </Copy>
              <Copy
                size={14}
                weight="semibold"
                style={{ color: rec.amount !== r.amount ? t.bad : t.text }}
              >
                {money(signedFor(rec, imp.accountId))}
              </Copy>
              <Copy size={12} muted>
                {C.shortDate(C.recDay(rec))} · {C.timeOf(rec.at)}
              </Copy>
              <Copy size={11} muted>
                {s.categories.find((c) => c.id === rec.categoryId)?.name ??
                  s.accounts.find((a) => a.id === rec.toAccountId)?.name}
              </Copy>
            </>
          ) : (
            <Copy size={12} muted>
              No matching transaction — this would be added as new.
            </Copy>
          )}
        </Frame>
      </Line>
      {["new", "duplicate", "pending"].includes(r.state) && !r.isTransfer && (
        <Choices
          label="Category"
          value={r.categoryId ?? ""}
          options={s.categories
            .filter(
              (c) =>
                !c.archived &&
                c.kind === (r.direction === "in" ? "income" : "expense"),
            )
            .map((c) => ({ value: c.id, label: `${c.icon} ${c.name}` }))}
          onChange={(categoryId) =>
            editRows(imp.id, [r.id], { categoryId, decision: "accept" })
          }
        />
      )}
      <View style={{ gap: 8 }}>
        {r.state === "probable" && (
          <>
            <Button
              tone="quiet"
              onPress={() =>
                set({ decision: "keep" }, "Keeping your transaction")
              }
            >
              Keep mine
            </Button>
            <Button
              onPress={() =>
                set({ decision: "take" }, "Taking the statement values")
              }
            >
              Take statement
            </Button>
            <Button
              tone="quiet"
              onPress={() =>
                set(
                  { decision: "merge" },
                  "Merged: statement amount, your date & category",
                )
              }
            >
              Merge
            </Button>
            <Button
              tone="quiet"
              onPress={() =>
                set(
                  {
                    state: "new",
                    matchId: undefined,
                    decision: "accept",
                    categoryId: rec?.categoryId,
                  },
                  "Will be added as a separate transaction",
                )
              }
            >
              Create new
            </Button>
          </>
        )}
        {["new", "duplicate", "pending"].includes(r.state) && (
          <Button
            onPress={() =>
              set(
                { decision: "accept" },
                r.state === "new" ? "Will be added" : "Will be imported anyway",
              )
            }
          >
            {r.state === "new" ? "Add as new" : "Import anyway"}
          </Button>
        )}
        {r.state === "matched" && (
          <Button
            tone="quiet"
            onPress={() =>
              set(
                { state: "new", matchId: undefined, decision: "accept" },
                "Unmatched — will be added as new",
              )
            }
          >
            Not the same
          </Button>
        )}
        <Button
          tone="quiet"
          onPress={() => set({ decision: "ignore" }, "Row ignored")}
        >
          Ignore
        </Button>
      </View>
      {!!candidates.length && r.state !== "matched" && (
        <>
          <SectionHeading>Re-match to another transaction</SectionHeading>
          {candidates.map((c) => (
            <Tap
              key={c.id}
              onPress={() =>
                set(
                  {
                    state:
                      c.amount === r.amount && C.recDay(c) === r.date
                        ? "matched"
                        : "probable",
                    matchId: c.id,
                    decision: c.amount === r.amount ? "accept" : "take",
                  },
                  "Re-matched",
                )
              }
            >
              <Line style={{ paddingVertical: 12 }}>
                <View style={{ flex: 1 }}>
                  <Copy>
                    {c.payee ??
                      s.categories.find((x) => x.id === c.categoryId)?.name ??
                      "Transaction"}
                  </Copy>
                  <Copy size={12} muted>
                    {C.shortDate(C.recDay(c))} · {C.timeOf(c.at)}
                  </Copy>
                </View>
                <Copy>{money(c.amount)}</Copy>
              </Line>
            </Tap>
          ))}
        </>
      )}
    </Sheet>
  )
}
function Done({ imp }: { imp: StatementImport }) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    a = s.accounts.find((a) => a.id === imp.accountId),
    undone = imp.status === "undone",
    Icon = undone ? RotateCcw : CheckCircle2
  return (
    <Screen title="Import">
      <View style={{ alignItems: "center", paddingVertical: 32 }}>
        <Icon size={48} color={undone ? t.muted : t.good} />
        <Copy
          size={18}
          weight="semibold"
          style={{ marginTop: 12, textAlign: "center" }}
        >
          {undone ? "Import undone" : `${a?.name} matched with statement`}
        </Copy>
        <Copy size={14} muted style={{ textAlign: "center" }}>
          {C.shortDate(imp.from)} – {C.shortDate(imp.to)} · {imp.fileName}
        </Copy>
      </View>
      {imp.counts && (
        <ImportCounts
          items={[
            { label: "matched", n: imp.counts.matched },
            { label: "added", n: imp.counts.created },
            { label: "updated", n: imp.counts.updated },
            { label: "ignored", n: imp.counts.ignored },
          ]}
        />
      )}
      <Frame style={{ padding: 16 }}>
        <Copy size={12} muted>
          {imp.fileKept
            ? "The statement file is still stored."
            : "The statement file was deleted after import (the read rows are kept)."}
        </Copy>
      </Frame>
      <Button
        href={`/finance/accounts/${imp.accountId}`}
      >{`View ${a?.name}`}</Button>
      {!undone && (
        <Button
          tone="quiet"
          icon={RotateCcw}
          onPress={() =>
            confirm(
              "Undo this import?",
              `Reverts only what it did: removes ${imp.createdIds.length} added transactions and restores ${changedCount(imp)} edited ones.`,
              () => {
                if (liveMode)
                  void liveImport()
                    .undo(imp.id)
                    .then(() => toast("Import undone"), liveError)
                else {
                  A.undoImport(imp.id)
                  toast("Import undone")
                }
              },
            )
          }
        >
          Undo import
        </Button>
      )}
      <Button tone="quiet" href="/finance">
        Back to Finance
      </Button>
    </Screen>
  )
}
export function Imports() {
  const s = finStore.use((s) => s),
    t = useTheme(),
    [tab, setTab] = useState("all"),
    order = (i: StatementImport) =>
      i.status === "review" || i.status === "parsing" ? 0 : 1,
    list = [...s.imports]
      .sort(
        (a, b) => order(a) - order(b) || b.createdAt.localeCompare(a.createdAt),
      )
      .filter((i) =>
        tab === "drafts"
          ? ["review", "parsing"].includes(i.status)
          : tab === "done"
            ? ["done", "undone"].includes(i.status)
            : true,
      )
  // Live: the server's history (another device's imports included).
  useEffect(() => {
    if (liveMode) void liveImport().loadList().catch(liveError)
  }, [])
  return (
    <Screen
      title="Imports"
      actions={
        <IconTap
          icon={Upload}
          label="New import"
          size={40}
          color={t.text}
          onPress={() => go("/finance/import")}
        />
      }
    >
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "all", label: "All" },
          { value: "drafts", label: "Drafts" },
          { value: "done", label: "Imported" },
        ]}
      />
      {!s.imports.length ? (
        <Empty
          title="No imports yet"
          detail="Upload a GCash or bank statement to catch anything you forgot to log."
          action={<Button href="/finance/import">Import a statement</Button>}
        />
      ) : (
        <View style={{ gap: 8 }}>
          {list.map((i) => {
            const a = s.accounts.find((a) => a.id === i.accountId),
              draft = ["review", "parsing"].includes(i.status)
            return (
              <Frame key={i.id} style={{ padding: 16 }}>
                <Line>
                  <FileText size={32} color={t.fin} />
                  <View style={{ flex: 1 }}>
                    <Copy size={14} weight="medium">
                      {i.fileName}
                    </Copy>
                    <Copy size={12} muted>
                      {a?.name} · {C.shortDate(i.from)} – {C.shortDate(i.to)}
                    </Copy>
                  </View>
                  <FinPill
                    tone={
                      i.status === "done"
                        ? "good"
                        : i.status === "failed"
                          ? "bad"
                          : i.status === "undone"
                            ? "muted"
                            : "warn"
                    }
                  >
                    {draft ? "draft" : i.status}
                  </FinPill>
                </Line>
                {i.counts && (
                  <Copy size={12} muted style={{ marginTop: 8 }}>
                    {i.counts.matched} matched · {i.counts.created} added ·{" "}
                    {i.counts.updated} updated · {i.counts.ignored} ignored
                  </Copy>
                )}
                {draft && (
                  <Copy size={12} muted style={{ marginTop: 8 }}>
                    {i.rows.filter(C.needsAttention).length} rows need attention
                  </Copy>
                )}
                {i.error && (
                  <Copy size={12} style={{ color: t.bad, marginTop: 8 }}>
                    {i.error}
                  </Copy>
                )}
                <Line style={{ gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  {draft && (
                    <Button small href={`/finance/import/${i.id}`}>
                      Resume
                    </Button>
                  )}
                  {["done", "undone"].includes(i.status) && (
                    <Button small tone="quiet" href={`/finance/import/${i.id}`}>
                      Summary
                    </Button>
                  )}
                  {i.status === "done" &&
                    i.createdIds.length + changedCount(i) > 0 && (
                      <Button
                        small
                        tone="quiet"
                        icon={RotateCcw}
                        onPress={() =>
                          confirm(
                            "Undo this import?",
                            `Removes ${i.createdIds.length} transactions it added and restores ${changedCount(i)} it edited. Nothing else changes.`,
                            () => {
                              if (liveMode)
                                void liveImport()
                                  .undo(i.id)
                                  .then(() => toast("Import undone"), liveError)
                              else {
                                A.undoImport(i.id)
                                toast("Import undone")
                              }
                            },
                          )
                        }
                      >
                        Undo
                      </Button>
                    )}
                  {i.fileKept && (
                    <Button
                      small
                      tone="quiet"
                      onPress={() => {
                        if (liveMode)
                          void liveImport()
                            .discardFile(i.id)
                            .then(
                              () => toast("Statement file deleted"),
                              liveError,
                            )
                        else {
                          A.patchImport(i.id, { fileKept: false })
                          toast("Statement file deleted")
                        }
                      }}
                    >
                      Delete file
                    </Button>
                  )}
                  {(draft || i.status === "failed") && (
                    <IconTap
                      icon={Trash2}
                      label="Discard import"
                      onPress={() => {
                        if (liveMode)
                          void liveImport()
                            .discard(i.id)
                            .then(
                              () =>
                                undo(
                                  "Import discarded",
                                  () =>
                                    void liveImport()
                                      .restore(i)
                                      .catch(liveError),
                                ),
                              liveError,
                            )
                        else {
                          A.deleteImport(i.id)
                          undo("Import discarded", () => A.restoreImport(i))
                        }
                      }}
                    />
                  )}
                </Line>
              </Frame>
            )
          })}
        </View>
      )}
    </Screen>
  )
}
