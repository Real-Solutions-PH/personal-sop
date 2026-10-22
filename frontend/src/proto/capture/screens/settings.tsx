"use client"

import {
  BookOpen,
  Bot,
  ChevronRight,
  Copy,
  Cpu,
  KeyRound,
  Link2,
  Lock,
  Plug,
  Power,
  ShieldCheck,
  Trash2,
  WifiOff,
} from "lucide-react"
import { useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { money } from "../../lib/money"
import {
  Bar,
  Btn,
  Card,
  Empty,
  Row,
  Screen,
  SectionTitle,
  Segmented,
  Stat,
} from "../../ui/kit"
import { clearThread, updateAISettings } from "../actions"
import { type CaptureSource, type RecordCard, RULE_LABELS } from "../data"
import { captureStore } from "../store"
import { toast } from "../toast"
import { FOCUS, SOURCE_LABEL, Toggle } from "../ui"

// CAP-17 AI settings (trust rules, ₱ threshold, privacy, model, spend cap +
// kill switch) and CAP-18 Claude connector (designed, ships disabled — X-10).

const MODELS = [
  {
    v: "anthropic/claude-sonnet (OpenRouter)",
    label: "Claude Sonnet",
    sub: "Best Taglish + photos · ~₱0.40/capture",
  },
  {
    v: "anthropic/claude-haiku (OpenRouter)",
    label: "Claude Haiku",
    sub: "Fastest, cheapest · ~₱0.08/capture",
  },
  {
    v: "google/gemini-flash (OpenRouter)",
    label: "Gemini Flash",
    sub: "Cheap, good photos · ~₱0.10/capture",
  },
]

function Line({
  title,
  sub,
  children,
}: {
  title: string
  sub?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-[15px]">{title}</div>
        {sub && <div className="text-muted-foreground text-xs">{sub}</div>}
      </div>
      {children}
    </div>
  )
}

export function AISettingsScreen() {
  const st = captureStore.use((s) => s.settings)
  const spend = captureStore.use((s) => s.spend)
  const captures = captureStore.use((s) => s.captures)
  const [clear, setClear] = useState(false)

  const trust = useMemo(() => {
    const recs = captures.flatMap((c) =>
      (c.reply?.items ?? []).filter((i): i is RecordCard => i.t === "record"),
    )
    const saved = recs.filter(
      (r) =>
        r.log.some((l) => l.action === "saved" && l.actor === "ai") ||
        r.state === "edited",
    )
    const corrected = recs.filter(
      (r) => r.state === "undone" || r.state === "edited",
    )
    const mix = new Map<CaptureSource, number>()
    for (const c of captures) mix.set(c.source, (mix.get(c.source) ?? 0) + 1)
    return {
      saved: saved.length,
      rate: saved.length ? corrected.length / saved.length : 0,
      mix: [...mix.entries()].sort((a, b) => b[1] - a[1]),
      total: captures.length,
    }
  }, [captures])

  const pctSpend = spend.amount / st.spendCap
  return (
    <Screen title="AI & Capture" back className={FOCUS}>
      <Card className={cn(!st.aiEnabled && "border-bad/40")}>
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "grid size-10 place-items-center rounded-xl",
              st.aiEnabled
                ? "bg-primary/15 text-primary"
                : "bg-bad/15 text-bad",
            )}
          >
            <Power className="size-5" />
          </span>
          <div className="flex-1">
            <div className="font-semibold">
              {st.aiEnabled ? "AI is on" : "AI is off"}
            </div>
            <div className="text-muted-foreground text-xs">
              {st.aiEnabled
                ? "Kill switch — turn off to stop every AI call now."
                : "Captures are kept and offered as quick add."}
            </div>
          </div>
          <Toggle
            label="AI on"
            on={st.aiEnabled}
            onChange={(aiEnabled) => updateAISettings({ aiEnabled })}
          />
        </div>
        <div className="mt-4 flex items-end justify-between">
          <Stat label="AI spend this month" value={money(spend.amount)} />
          <div className="text-right text-muted-foreground text-xs">
            {spend.calls} calls · cap {money(st.spendCap)}
          </div>
        </div>
        <Bar
          className="mt-2"
          value={pctSpend}
          accent={pctSpend > 0.8 ? "life" : "primary"}
        />
        <div className="mt-3 flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Monthly cap</span>
          <div className="flex flex-1 justify-end gap-1.5">
            {[200, 500, 1000].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => updateAISettings({ spendCap: v })}
                className={cn(
                  "h-11 rounded-full px-4 font-medium text-sm",
                  st.spendCap === v
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted",
                )}
              >
                {money(v)}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          At the cap, AI pauses until next month; captures fall back to quick
          add.
        </p>
      </Card>

      <SectionTitle>Auto-save or confirm</SectionTitle>
      <Card className="py-1">
        <p className="py-2 text-muted-foreground text-xs">
          Auto-saved entries show a card with Undo. Confirm means nothing is
          written until you tap it. Photos always confirm.
        </p>
        <div className="divide-y divide-border/50">
          {RULE_LABELS.map((r) => (
            <Line key={r.key} title={r.label} sub={r.hint}>
              <div className="w-40">
                <Segmented
                  value={st.rules[r.key]}
                  options={[
                    { value: "auto", label: "Auto" },
                    { value: "confirm", label: "Confirm" },
                  ]}
                  onChange={(v) =>
                    updateAISettings({ rules: { ...st.rules, [r.key]: v } })
                  }
                />
              </div>
            </Line>
          ))}
        </div>
      </Card>

      <SectionTitle>Money</SectionTitle>
      <Card>
        <Line
          title="Confirm expenses above"
          sub="Smaller ones with a clear category auto-save"
        >
          <span className="num font-display font-semibold text-xl">
            {money(st.moneyThreshold)}
          </span>
        </Line>
        <div className="flex gap-1.5">
          {[500, 1000, 2000, 5000].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => updateAISettings({ moneyThreshold: v })}
              className={cn(
                "h-11 flex-1 rounded-xl font-medium text-sm",
                st.moneyThreshold === v ? "bg-fin text-background" : "bg-muted",
              )}
            >
              {money(v)}
            </button>
          ))}
        </div>
      </Card>

      <SectionTitle>Privacy</SectionTitle>
      <Card className="divide-y divide-border/50 py-1">
        <Line
          title="Send photos to the AI"
          sub="Only photos you attach, never your library"
        >
          <Toggle
            label="Send photos"
            on={st.sendPhotos}
            onChange={(sendPhotos) => updateAISettings({ sendPhotos })}
          />
        </Line>
        <Line
          title="Journal in Q&A"
          sub="Off: questions never read your journal"
        >
          <Toggle
            label="Journal in Q&A"
            on={st.journalInQA}
            onChange={(journalInQA) => updateAISettings({ journalInQA })}
          />
        </Line>
        <div className="py-3">
          <div className="mb-2 font-medium text-[15px]">
            Finance detail for answers
          </div>
          <Segmented
            value={st.financeScope}
            options={[
              { value: "aggregates", label: "Totals only" },
              { value: "records", label: "Individual transactions" },
            ]}
            onChange={(financeScope) => updateAISettings({ financeScope })}
          />
        </div>
        <Line title="Keep undo history" sub="Undo reaches back this far">
          <span className="text-muted-foreground text-sm">
            {st.retentionDays} days
          </span>
        </Line>
      </Card>

      <SectionTitle>Language & voice</SectionTitle>
      <Card className="space-y-3">
        <div>
          <div className="mb-2 font-medium text-[15px]">Input language</div>
          <Segmented
            value={st.language}
            options={[
              { value: "en-tl", label: "English + Taglish" },
              { value: "en", label: "English" },
            ]}
            onChange={(language) => updateAISettings({ language })}
          />
        </div>
        <div>
          <div className="mb-2 font-medium text-[15px]">Transcription</div>
          <Segmented
            value={st.transcription}
            options={[
              { value: "server", label: "Server (accurate)" },
              { value: "browser", label: "On-device preview" },
            ]}
            onChange={(transcription) => updateAISettings({ transcription })}
          />
        </div>
      </Card>

      <SectionTitle>Model</SectionTitle>
      <Card className="space-y-1.5 p-2">
        {MODELS.map((m) => (
          <button
            key={m.v}
            type="button"
            onClick={() => updateAISettings({ model: m.v })}
            aria-pressed={st.model === m.v}
            className={cn(
              "flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left",
              st.model === m.v
                ? "bg-primary/12 ring-1 ring-primary/50"
                : "active:bg-muted",
            )}
          >
            <Cpu
              className={cn(
                "size-5",
                st.model === m.v ? "text-primary" : "text-muted-foreground",
              )}
            />
            <div className="flex-1">
              <div className="font-medium">{m.label}</div>
              <div className="text-muted-foreground text-xs">{m.sub}</div>
            </div>
            {st.model === m.v && (
              <span className="font-semibold text-primary text-xs">In use</span>
            )}
          </button>
        ))}
        <p className="px-3 pb-1 text-[11px] text-muted-foreground">
          Via OpenRouter — only providers that don't train on your data.
        </p>
      </Card>

      <SectionTitle>How it's going</SectionTitle>
      <Card>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Entries saved by AI" value={trust.saved} />
          <Stat
            label="Correction rate"
            value={`${Math.round(trust.rate * 100)}%`}
            goodWhen="down"
          />
        </div>
        <div className="mt-4 space-y-1.5">
          {trust.mix.map(([src, n]) => (
            <div key={src} className="flex items-center gap-2 text-xs">
              <span className="w-20 text-muted-foreground">
                {SOURCE_LABEL[src]}
              </span>
              <Bar className="flex-1" value={n / Math.max(1, trust.total)} />
              <span className="num w-6 text-right">{n}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          A high correction rate means that entry type should move from Auto to
          Confirm.
        </p>
      </Card>

      <SectionTitle>More</SectionTitle>
      <Card className="py-1">
        <Row
          href="/capture/connector"
          icon={<Plug className="size-5 text-muted-foreground" />}
          title="Claude connector"
          subtitle="Use your Claude app with your data · coming soon"
          right={<ChevronRight className="size-4 text-muted-foreground" />}
        />
        <Row
          href="/journal"
          icon={<BookOpen className="size-5 text-muted-foreground" />}
          title="Journal"
          right={<ChevronRight className="size-4 text-muted-foreground" />}
        />
        <Row
          href="/capture/queue"
          icon={<WifiOff className="size-5 text-muted-foreground" />}
          title="Pending & offline"
          subtitle={st.simulateOffline ? "Simulating offline" : undefined}
          right={<ChevronRight className="size-4 text-muted-foreground" />}
        />
        <Row
          onClick={() => setClear(true)}
          icon={<Trash2 className="size-5 text-bad" />}
          title={<span className="text-bad">Clear thread</span>}
          subtitle="Entries stay where they were saved"
        />
      </Card>

      <Dialog open={clear} onOpenChange={setClear}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Clear the Capture thread?</DialogTitle>
          <DialogDescription>
            Messages and cards disappear from the thread and history. Everything
            they saved stays in Habits, Tasks, Fitness, Finance and your
            journal.
          </DialogDescription>
          <DialogFooter className="flex-row gap-2">
            <Btn
              variant="secondary"
              className="flex-1"
              onClick={() => setClear(false)}
            >
              Cancel
            </Btn>
            <Btn
              variant="danger"
              className="flex-1"
              onClick={() => {
                clearThread()
                setClear(false)
                toast("Thread cleared")
              }}
            >
              Clear
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Screen>
  )
}

// ---------------------------------------------------------------- CAP-18

const TOOLS = [
  ["log_expense", "write"],
  ["log_meal", "write"],
  ["log_workout", "write"],
  ["check_habit", "write"],
  ["create_task", "write"],
  ["get_spending", "read"],
  ["get_prs", "read"],
  ["get_today", "read"],
] as const

export function ConnectorScreen() {
  const [scope, setScope] = useState<"read" | "write">("write")
  const captures = captureStore.use((s) => s.captures)
  const connectorWrites = captures.filter((c) => c.source === "connector")
  return (
    <Screen title="Claude connector" back className={FOCUS}>
      <Card className="relative overflow-hidden">
        <div className="-top-10 -right-10 absolute size-40 rounded-full bg-primary/10 blur-2xl" />
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-primary to-hab text-white">
            <Bot className="size-6" />
          </span>
          <div className="flex-1">
            <div className="font-display font-semibold text-xl">
              Use Claude with Unfurl
            </div>
            <div className="text-muted-foreground text-sm">
              Log and ask from the Claude app you already use.
            </div>
          </div>
        </div>
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-warn/15 px-2.5 py-1 font-semibold text-warn text-xs">
          <Lock className="size-3" /> Coming soon · after v1
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-sm">
          <span className="size-2 rounded-full bg-muted-foreground" />
          <span className="font-medium">Status:</span> Not connected
        </div>
      </Card>

      <SectionTitle>How it works</SectionTitle>
      <Card>
        <ol className="space-y-3 text-sm">
          {[
            [
              "Connect",
              "Add the Unfurl server in Claude › Settings › Connectors and approve access here.",
            ],
            [
              "Talk to Claude",
              "“log 2 eggs and toast for breakfast” — Claude calls the same tools the in-app AI uses.",
            ],
            [
              "Review here",
              "Every write shows up in Capture history as “Claude”, with Undo.",
            ],
          ].map(([t, b], i) => (
            <li key={t} className="flex gap-3">
              <span className="num grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 font-display font-semibold text-primary">
                {i + 1}
              </span>
              <div>
                <div className="font-medium">{t}</div>
                <div className="text-muted-foreground">{b}</div>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <SectionTitle>Server</SectionTitle>
      <Card className="space-y-3 opacity-70">
        <div>
          <div className="mb-1 font-medium text-muted-foreground text-xs">
            MCP server URL
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3">
            <Link2 className="size-4 text-muted-foreground" />
            <code className="min-w-0 flex-1 truncate py-3 text-sm">
              https://sop.app/mcp
            </code>
            <button
              type="button"
              disabled
              aria-label="Copy URL"
              className="grid size-11 place-items-center rounded-lg text-muted-foreground disabled:opacity-50"
            >
              <Copy className="size-4" />
            </button>
          </div>
        </div>
        <div>
          <div className="mb-1 font-medium text-muted-foreground text-xs">
            Access
          </div>
          <Segmented
            value={scope}
            options={[
              { value: "read", label: "Read only" },
              { value: "write", label: "Read + write" },
            ]}
            onChange={setScope}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TOOLS.map(([t, k]) => (
            <code
              key={t}
              className={cn(
                "rounded-lg px-2 py-1 text-xs",
                k === "write" && scope === "read"
                  ? "bg-muted text-muted-foreground line-through"
                  : "bg-muted",
              )}
            >
              {t}
            </code>
          ))}
        </div>
      </Card>
      <Btn className="mt-4 w-full" disabled>
        <KeyRound className="size-4" /> Connect Claude
      </Btn>
      <p className="mt-2 flex items-start gap-1.5 px-1 text-[11px] text-muted-foreground">
        <ShieldCheck className="mt-px size-3.5 shrink-0" />
        Claude only sees what a request needs. Revoke any time; revoked tokens
        fail immediately.
      </p>

      <SectionTitle>Recent connector writes</SectionTitle>
      {connectorWrites.length ? null : (
        <Empty
          title="None yet"
          body="Once connected, anything Claude logs shows here and in History (source: Claude)."
        />
      )}
    </Screen>
  )
}
