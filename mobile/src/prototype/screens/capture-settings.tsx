import { clearThread, updateAISettings } from "@domain/capture/actions"
import { type RecordCard, RULE_LABELS } from "@domain/capture/data"
import { captureStore } from "@domain/capture/store"
import { LinearGradient } from "expo-linear-gradient"
import { Bot, ChevronRight, Cpu, Link2, Lock, Power } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { priceText, useServerModels } from "../../live/ai-models"
import {
  Bar,
  border,
  Copy,
  Frame,
  Line,
  SectionHeading,
  Segmented,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { Switch } from "../switch"
import { useTheme } from "../theme"
import { Button, confirm, Screen } from "../ui"

const peso = (n: number) =>
  `₱${n.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`
export function CaptureSettings({
  connector = false,
}: {
  connector?: boolean
}) {
  return connector ? <Connector /> : <Settings />
}
function Settings() {
  const t = useTheme(),
    st = captureStore.use((s) => s.settings),
    spend = captureStore.use((s) => s.spend),
    captures = captureStore.use((s) => s.captures),
    recs = captures.flatMap((c) =>
      (c.reply?.items ?? []).filter((i): i is RecordCard => i.t === "record"),
    ),
    saved = recs.filter(
      (r) =>
        r.log.some((l) => l.action === "saved" && l.actor === "ai") ||
        r.state === "edited",
    ),
    corrected = saved.filter(
      (r) => r.state === "undone" || r.state === "edited",
    ),
    mix = [...new Set(captures.map((c) => c.source))]
      .map((src) => ({
        src,
        n: captures.filter((c) => c.source === src).length,
      }))
      .sort((a, b) => b.n - a.n)
  const row = (title: string, sub: string, right: React.ReactNode) => (
    <Line style={{ minHeight: 56, gap: 12, paddingVertical: 8 }}>
      <View style={{ flex: 1 }}>
        <Copy size={15} weight="medium">
          {title}
        </Copy>
        {!!sub && (
          <Copy size={12} muted>
            {sub}
          </Copy>
        )}
      </View>
      {right}
    </Line>
  )
  const chip = (n: number, on: boolean, press: () => void, fin = false) => (
    <Tap
      key={n}
      onPress={press}
      style={{
        height: 44,
        borderRadius: fin ? 12 : 22,
        paddingHorizontal: 16,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: on ? (fin ? t.fin : t.primary) : t.soft,
        flex: fin ? 1 : undefined,
      }}
    >
      <Copy
        size={14}
        weight="medium"
        style={{ color: on ? t.onPrimary : t.text }}
      >
        {peso(n)}
      </Copy>
    </Tap>
  )
  return (
    <Screen title="AI & Capture">
      <View>
        <Frame
          style={{
            padding: 16,
            borderColor: st.aiEnabled ? t.line : border(t.bad, 0.4),
          }}
        >
          <Line style={{ gap: 12, alignItems: "flex-start" }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: border(st.aiEnabled ? t.primary : t.bad, 0.15),
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Power size={20} color={st.aiEnabled ? t.primary : t.bad} />
            </View>
            <View style={{ flex: 1 }}>
              <Copy weight="semibold">
                {st.aiEnabled ? "AI is on" : "AI is off"}
              </Copy>
              <Copy size={12} muted>
                {st.aiEnabled
                  ? "Kill switch — turn off to stop every AI call now."
                  : "Captures are kept and offered as quick add."}
              </Copy>
            </View>
            <Switch
              compact
              accent="primary"
              label="AI on"
              value={st.aiEnabled}
              onChange={(aiEnabled) => updateAISettings({ aiEnabled })}
            />
          </Line>
          <Line
            style={{
              marginTop: 16,
              alignItems: "flex-end",
              justifyContent: "space-between",
            }}
          >
            <View>
              <Copy size={28} weight="display">
                {peso(spend.amount)}
              </Copy>
              <Copy size={12} muted>
                AI spend this month
              </Copy>
            </View>
            <Copy size={12} muted>
              {spend.calls} calls · cap {peso(st.spendCap)}
            </Copy>
          </Line>
          <View style={{ marginTop: 8 }}>
            <Bar
              value={spend.amount / st.spendCap}
              color={spend.amount / st.spendCap > 0.8 ? t.life : t.primary}
            />
          </View>
          <Line style={{ marginTop: 12, gap: 8 }}>
            <Copy size={12} muted style={{ flex: 1 }}>
              Monthly cap
            </Copy>
            <Line style={{ gap: 6 }}>
              {[200, 500, 1000].map((v) =>
                chip(v, st.spendCap === v, () =>
                  updateAISettings({ spendCap: v }),
                ),
              )}
            </Line>
          </Line>
          <Copy size={11} muted style={{ marginTop: 8 }}>
            At the cap, AI pauses until next month; captures fall back to quick
            add.
          </Copy>
        </Frame>
        <SectionHeading>Auto-save or confirm</SectionHeading>
        <Frame style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
          <Copy size={12} muted style={{ paddingVertical: 8 }}>
            Auto-saved entries show a card with Undo. Confirm means nothing is
            written until you tap it. Photos always confirm.
          </Copy>
          {RULE_LABELS.map((r) => (
            <View
              key={r.key}
              style={{
                borderBottomWidth: 1,
                borderBottomColor: border(t.line, 0.5),
              }}
            >
              {row(
                r.label,
                r.hint,
                <View style={{ width: 160 }}>
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
                </View>,
              )}
            </View>
          ))}
        </Frame>
        <SectionHeading>Money</SectionHeading>
        <Frame style={{ padding: 16 }}>
          {row(
            "Confirm expenses above",
            "Smaller ones with a clear category auto-save",
            <Copy size={20} weight="displayMedium">
              {peso(st.moneyThreshold)}
            </Copy>,
          )}
          <Line style={{ gap: 6 }}>
            {[500, 1000, 2000, 5000].map((v) =>
              chip(
                v,
                st.moneyThreshold === v,
                () => updateAISettings({ moneyThreshold: v }),
                true,
              ),
            )}
          </Line>
        </Frame>
        <SectionHeading>Privacy</SectionHeading>
        <Frame style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
          {row(
            "Send photos to the AI",
            "Only photos you attach, never your library",
            <Switch
              compact
              accent="primary"
              label="Send photos"
              value={st.sendPhotos}
              onChange={(sendPhotos) => updateAISettings({ sendPhotos })}
            />,
          )}
          {row(
            "Journal in Q&A",
            "Off: questions never read your journal",
            <Switch
              compact
              accent="primary"
              label="Journal in Q&A"
              value={st.journalInQA}
              onChange={(journalInQA) => updateAISettings({ journalInQA })}
            />,
          )}
          <View style={{ paddingVertical: 12, gap: 8 }}>
            <Copy size={15} weight="medium">
              Finance detail for answers
            </Copy>
            <Segmented
              value={st.financeScope}
              options={[
                { value: "aggregates", label: "Totals only" },
                { value: "records", label: "Individual transactions" },
              ]}
              onChange={(financeScope) => updateAISettings({ financeScope })}
            />
          </View>
          {row(
            "Keep undo history",
            "Undo reaches back this far",
            <Copy size={14} muted>
              {st.retentionDays} days
            </Copy>,
          )}
        </Frame>
        <SectionHeading>Language & voice</SectionHeading>
        <Frame style={{ padding: 16, gap: 12 }}>
          <View style={{ gap: 8 }}>
            <Copy size={15} weight="medium">
              Input language
            </Copy>
            <Segmented
              value={st.language}
              options={[
                { value: "en-tl", label: "English + Taglish" },
                { value: "en", label: "English" },
              ]}
              onChange={(language) => updateAISettings({ language })}
            />
          </View>
          <View style={{ gap: 8 }}>
            <Copy size={15} weight="medium">
              Transcription
            </Copy>
            <Segmented
              value={st.transcription}
              options={[
                { value: "server", label: "Server (accurate)" },
                { value: "browser", label: "On-device preview" },
              ]}
              onChange={(transcription) => updateAISettings({ transcription })}
            />
          </View>
        </Frame>
        <SectionHeading>Model</SectionHeading>
        <ModelPicker picked={st.model} />
        <SectionHeading>How it's going</SectionHeading>
        <Frame style={{ padding: 16 }}>
          <Line style={{ gap: 12 }}>
            {[
              { label: "Entries saved by AI", value: saved.length },
              {
                label: "Correction rate",
                value: `${Math.round(saved.length ? (corrected.length / saved.length) * 100 : 0)}%`,
              },
            ].map((x) => (
              <View key={x.label} style={{ flex: 1 }}>
                <Copy size={28} weight="display">
                  {x.value}
                </Copy>
                <Copy size={12} muted>
                  {x.label}
                </Copy>
              </View>
            ))}
          </Line>
          <View style={{ marginTop: 16, gap: 6 }}>
            {mix.map(({ src, n }) => (
              <Line key={src} style={{ gap: 8 }}>
                <Copy size={12} muted style={{ width: 80 }}>
                  {src === "connector"
                    ? "Claude"
                    : src[0].toUpperCase() + src.slice(1)}
                </Copy>
                <View style={{ flex: 1 }}>
                  <Bar
                    value={n / Math.max(1, captures.length)}
                    color={t.primary}
                  />
                </View>
                <Copy size={12} style={{ width: 24, textAlign: "right" }}>
                  {n}
                </Copy>
              </Line>
            ))}
          </View>
          <Copy size={11} muted style={{ marginTop: 12 }}>
            A high correction rate means that entry type should move from Auto
            to Confirm.
          </Copy>
        </Frame>
        <SectionHeading>More</SectionHeading>
        <Frame style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
          {[
            {
              title: "Claude connector",
              sub: "Use your Claude app with your data · coming soon",
              href: "/capture/connector",
            },
            { title: "Journal", sub: "", href: "/journal" },
            {
              title: "Pending & offline",
              sub: st.simulateOffline ? "Simulating offline" : "",
              href: "/capture/queue",
            },
          ].map((x) => (
            <Tap key={x.href} onPress={() => go(x.href)}>
              {row(x.title, x.sub, <ChevronRight size={16} color={t.muted} />)}
            </Tap>
          ))}
          <Tap
            onPress={() =>
              confirm(
                "Clear the Capture thread?",
                "Messages and cards disappear from the thread and history. Everything they saved stays in Habits, Tasks, Fitness, Finance and your journal.",
                () => {
                  clearThread()
                  toast("Thread cleared")
                },
              )
            }
          >
            {row("Clear thread", "Entries stay where they were saved", null)}
          </Tap>
        </Frame>
      </View>
    </Screen>
  )
}
function Connector() {
  const t = useTheme(),
    [scope, setScope] = useState("write"),
    captures = captureStore.use((s) => s.captures)
  return (
    <Screen title="Claude connector">
      <View>
        <Frame style={{ padding: 16 }}>
          <Line style={{ gap: 12 }}>
            <LinearGradient
              colors={[t.primary, t.hab]}
              style={{
                width: 48,
                height: 48,
                borderRadius: 16,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Bot size={24} color="#fff" />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Copy size={20} weight="displayMedium">
                Use Claude with your SOP
              </Copy>
              <Copy size={14} muted>
                Log and ask from the Claude app you already use.
              </Copy>
            </View>
          </Line>
          <Line
            style={{
              alignSelf: "flex-start",
              gap: 6,
              borderRadius: 20,
              backgroundColor: border(t.warn, 0.15),
              paddingHorizontal: 10,
              paddingVertical: 4,
              marginTop: 12,
            }}
          >
            <Lock size={12} color={t.warn} />
            <Copy size={12} weight="semibold" style={{ color: t.warn }}>
              Coming soon · after v1
            </Copy>
          </Line>
          <Line
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              marginTop: 12,
              gap: 8,
              borderRadius: 12,
              backgroundColor: border(t.soft, 0.6),
            }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: t.muted,
              }}
            />
            <Copy size={14}>Status: Not connected</Copy>
          </Line>
        </Frame>
        <SectionHeading>How it works</SectionHeading>
        <Frame style={{ padding: 16, gap: 12 }}>
          {[
            [
              "Connect",
              "Add the SOP server in Claude › Settings › Connectors and approve access here.",
            ],
            [
              "Talk to Claude",
              "“log 2 eggs and toast for breakfast” — Claude calls the same tools the in-app AI uses.",
            ],
            [
              "Review here",
              "Every write shows up in Capture history as “Claude”, with Undo.",
            ],
          ].map(([title, body], i) => (
            <Line key={title} style={{ gap: 12, alignItems: "flex-start" }}>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: border(t.primary, 0.15),
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Copy weight="displayMedium" style={{ color: t.primary }}>
                  {i + 1}
                </Copy>
              </View>
              <View style={{ flex: 1 }}>
                <Copy size={14} weight="medium">
                  {title}
                </Copy>
                <Copy size={14} muted>
                  {body}
                </Copy>
              </View>
            </Line>
          ))}
        </Frame>
        <SectionHeading>Server</SectionHeading>
        <Frame style={{ padding: 16, gap: 12, opacity: 0.7 }}>
          <Copy size={12} weight="medium" muted>
            MCP server URL
          </Copy>
          <Line
            style={{
              paddingHorizontal: 12,
              paddingVertical: 12,
              borderWidth: 1,
              borderColor: t.line,
              borderRadius: 12,
              backgroundColor: t.bg,
            }}
          >
            <Link2 size={16} color={t.muted} />
            <Copy size={14}>https://sop.app/mcp</Copy>
          </Line>
          <Copy size={12} weight="medium" muted>
            Access
          </Copy>
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: "read", label: "Read only" },
              { value: "write", label: "Read + write" },
            ]}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {[
              "log_expense",
              "log_meal",
              "log_workout",
              "check_habit",
              "create_task",
              "get_spending",
              "get_prs",
              "get_today",
            ].map((x, i) => (
              <View
                key={x}
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 8,
                  backgroundColor: t.soft,
                }}
              >
                <Copy
                  size={12}
                  muted={scope === "read" && i < 5}
                  style={{
                    textDecorationLine:
                      scope === "read" && i < 5 ? "line-through" : "none",
                  }}
                >
                  {x}
                </Copy>
              </View>
            ))}
          </View>
        </Frame>
        <View style={{ marginTop: 16 }}>
          <Button disabled>Connect Claude</Button>
        </View>
        <Copy size={11} muted style={{ marginTop: 8, paddingHorizontal: 4 }}>
          Claude only sees what a request needs. Revoke any time; revoked tokens
          fail immediately.
        </Copy>
        <SectionHeading>Recent connector writes</SectionHeading>
        {!captures.some((c) => c.source === "connector") && (
          <View style={{ padding: 24, alignItems: "center", gap: 8 }}>
            <Copy weight="semibold">None yet</Copy>
            <Copy size={14} muted>
              Once connected, anything Claude logs shows here and in History
              (source: Claude).
            </Copy>
          </View>
        )}
      </View>
    </Screen>
  )
}

const SHOWN = 6

/** The models the server's own key answers with (Nebius Token Factory).
 * "" is the server default. A provider key of the user's own, when assigned
 * through the API, takes precedence over this pick. */
function ModelPicker({ picked }: { picked: string }) {
  const t = useTheme()
  const q = useServerModels()
  const [all, setAll] = useState(false)
  const pick = (model: string) => updateAISettings({ model })
  const row = (key: string, title: string, sub: string, on: boolean) => (
    <Tap
      key={key}
      label={`${title}${on ? ", in use" : ""}`}
      onPress={() => pick(key)}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        minHeight: 56,
        borderRadius: 12,
        backgroundColor: on ? border(t.primary, 0.12) : "transparent",
        borderWidth: on ? 1 : 0,
        borderColor: border(t.primary, 0.5),
      }}
    >
      <Line style={{ gap: 12 }}>
        <Cpu size={20} color={on ? t.primary : t.muted} />
        <View style={{ flex: 1 }}>
          <Copy weight="medium">{title}</Copy>
          <Copy size={12} muted>
            {sub}
          </Copy>
        </View>
        {on && (
          <Copy size={12} weight="semibold" style={{ color: t.primary }}>
            In use
          </Copy>
        )}
      </Line>
    </Tap>
  )
  if (q.isPending)
    return (
      <Frame style={{ padding: 16 }}>
        <Copy size={14} muted>
          Loading models…
        </Copy>
      </Frame>
    )
  if (q.isError)
    return (
      <Frame style={{ padding: 16, gap: 10 }}>
        <Copy size={14} muted>
          Couldn't load the models. Your pick is kept.
        </Copy>
        <Button small tone="quiet" onPress={() => void q.refetch()}>
          Try again
        </Button>
      </Frame>
    )
  const { models, serverDefault } = q.data
  if (!models.length)
    return (
      <Frame style={{ padding: 16 }}>
        <Copy size={14} muted>
          No models are offered yet, so replies come from the built-in rules.
        </Copy>
      </Frame>
    )
  const byId = new Map(models.map((m) => [m.id, m]))
  const fallback = serverDefault ? byId.get(serverDefault.model) : undefined
  const photos = serverDefault
    ? byId.get(serverDefault.vision_model)
    : undefined
  const sorted = [...models].sort(
    (a, b) => a.usd_in + a.usd_out - (b.usd_in + b.usd_out),
  )
  const current = picked && byId.has(picked) ? picked : ""
  const shown = all
    ? sorted
    : sorted
        .slice(0, SHOWN)
        .concat(
          current && !sorted.slice(0, SHOWN).some((m) => m.id === current)
            ? [byId.get(current) as (typeof models)[number]]
            : [],
        )
  return (
    <Frame style={{ padding: 8, gap: 6 }}>
      {row(
        "",
        "Server default",
        fallback
          ? `${fallback.label} · photos with ${photos?.label ?? "a vision model"}`
          : "Picked by the server",
        current === "",
      )}
      {shown.map((m) =>
        row(
          m.id,
          m.label,
          `${m.vendor} · ${m.kind === "vision" ? "reads photos · " : ""}${priceText(m)}`,
          current === m.id,
        ),
      )}
      {sorted.length > SHOWN && (
        <Tap
          label={all ? "Show fewer models" : `Show all ${sorted.length} models`}
          onPress={() => setAll((v) => !v)}
          style={{ paddingHorizontal: 12, paddingVertical: 10 }}
        >
          <Line style={{ gap: 6 }}>
            <Copy size={13} weight="medium" style={{ color: t.primary }}>
              {all ? "Show fewer" : `Show all ${sorted.length} models`}
            </Copy>
            <ChevronRight size={14} color={t.primary} />
          </Line>
        </Tap>
      )}
      {!serverDefault && (
        <Copy
          size={12}
          style={{ paddingHorizontal: 12, paddingTop: 2, color: t.warn }}
        >
          The server has no AI key yet: replies come from the built-in rules
          until one is added. Your pick is kept for then.
        </Copy>
      )}
      <Copy size={11} muted style={{ paddingHorizontal: 12, paddingBottom: 4 }}>
        Runs on Nebius Token Factory. Photos use{" "}
        {photos?.label ?? "a vision model"} unless your pick reads them.
      </Copy>
    </Frame>
  )
}
